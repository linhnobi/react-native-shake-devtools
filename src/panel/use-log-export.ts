import { useCallback, useEffect, useRef, useState } from 'react';
import { Share } from 'react-native';
import {
  errorReportFileName,
  formatErrorReport,
} from '../capture/format-error-report';
import type { LogEntry } from '../capture/log-entry';
import { countErrors } from '../capture/log-query';
import type { DevToolsSessionInfo } from '../capture/session-info';
import type { DevToolsExportFile } from '../gate/devtools-props';

/** Dấu kết quả ("Đã xuất" / "Không xuất được") ở lại bao lâu — cùng nhịp với dấu "Đã chép". */
const RESULT_HINT_MS = 2000;

export type LogExportState = 'idle' | 'busy' | 'done' | 'failed';

/**
 * Gọi hàm thông tin phiên của app mà **không** để nó làm hỏng lượt xuất: một getter ném (vd đọc
 * native module lỗi) thì file vẫn ra, chỉ thiếu mấy dòng đầu.
 */
export const safeInfo = (
  sessionInfo: (() => DevToolsSessionInfo) | undefined,
): DevToolsSessionInfo | undefined => {
  try {
    return sessionInfo?.();
  } catch {
    return undefined;
  }
};

export interface UseLogExportInput {
  /**
   * Trả ảnh chụp nhật ký (cũ→mới) **lúc bấm** — file lấy **mọi** dòng lỗi trong đó, không theo bộ
   * lọc màn. Là hàm chứ không phải mảng: truyền mảng thì `run` đổi danh tính theo từng dòng log,
   * kéo theo thanh nút đáy dựng lại. Nhật ký sống: `logBuffer.snapshot`. Nên giữ danh tính ổn định.
   */
  readonly getEntries: () => readonly LogEntry[];
  /** Dòng phụ môi trường, vd `'UAT · 1.0.2'` — vào đầu file. */
  readonly build?: string;
  /** Đường ra do app cấp. Vắng ⇒ `Share.share` của lõi RN (khối text, không phải file). */
  readonly exportFile?: (file: DevToolsExportFile) => Promise<void>;
  /**
   * Thông tin bản build · máy · user (đã che) — **hàm**, gọi lúc bấm chứ không lúc render: phiên
   * đăng nhập có thể đổi giữa hai lần xuất.
   */
  readonly sessionInfo?: () => DevToolsSessionInfo;
  /** Mốc bắt đầu thu nhật ký — dòng `Session` ở đầu file. */
  readonly sessionStartedAt?: number;
  /** Nhãn nguồn khi xuất phiên trước, vd `'previous session'`. */
  readonly source?: string;
}

export interface UseLogExportResult {
  readonly state: LogExportState;
  /** Giữ nguyên danh tính khi `getEntries` và các input khác không đổi. */
  readonly run: () => void;
}

/** Nhường luồng JS cho một lượt commit + vẽ trước khi làm việc nặng. */
const yieldToPaint = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * **Chức năng:** nút **Xuất lỗi** của màn nhật ký — dựng file báo cáo lỗi rồi giao cho đường ra
 * của app.
 *
 * ## Chặn bấm đúp bằng `ref`, không bằng state
 *
 * `setState('busy')` chỉ có hiệu lực ở lần render sau; hai lần chạm sát nhau nằm gọn trong cùng
 * một render ⇒ cả hai thấy `idle` và mở hai khay chia sẻ. `ref` đổi ngay trong lượt gọi — cùng
 * cách `useCicReportDownload` của app đã làm.
 *
 * ## Nhường một khung hình trước khi dựng file
 *
 * Dựng file là việc nặng: dàn JSON thân của hàng chục request lỗi. Làm ngay trong lượt bấm thì
 * vòng quay "đang xuất" không kịp hiện — nút đứng im tới khi khay chia sẻ bật lên, trông như chưa
 * nhận cú chạm. Nên `busy` được commit trước, việc dựng file chạy ở lượt sau.
 *
 * ## Rơi về `Share.share` khi app không cấp `exportFile`
 *
 * Lib không kéo native module nào (ghi đĩa, khay chia sẻ file đều là native). App nào chưa nối
 * `exportFile` vẫn gửi được nội dung — dạng **text** thay vì file đính kèm.
 *
 * **Input:** {@link UseLogExportInput}. **Output:** {@link UseLogExportResult}. Nút có khoá hay
 * không là việc của màn (nó đã có nhật ký trong tay); `run` tự bỏ qua khi không có dòng lỗi.
 *
 * @example
 * ```ts
 * const exp = useLogExport({ getEntries: logBuffer.snapshot, build: 'UAT · 1.0.2', exportFile });
 * exp.run();            // 'busy' (vẽ ngay) → dựng file → 'done' → (2s) 'idle'
 * // Ca biên: không có dòng lỗi ⇒ run() không làm gì, không mở khay rỗng.
 * // Ca biên: exportFile reject ⇒ 'failed' → (2s) 'idle', không ném ra màn.
 * ```
 *
 * **Unit test:** `use-log-export.test.ts` › `useLogExport` — 8 case: 0 lỗi ⇒ `run` không gọi gì ·
 * có `exportFile` ⇒ gọi đúng một lần với tên `devtools-errors-*.txt` + nội dung chỉ gồm dòng lỗi ·
 * không `exportFile` ⇒ `Share.share` với khối text · `exportFile` reject ⇒ `failed` · bấm hai lần
 * liền ⇒ chỉ một lời gọi · dấu kết quả tự về `idle` sau 2s · `busy` có hiệu lực trước khi dựng
 * file · đọc nhật ký lúc bấm, không lúc render.
 */
export const useLogExport = ({
  getEntries,
  build,
  exportFile,
  sessionInfo,
  sessionStartedAt,
  source,
}: UseLogExportInput): UseLogExportResult => {
  const [state, setState] = useState<LogExportState>('idle');
  const busyRef = useRef(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(
    () => () => {
      if (hintTimer.current) clearTimeout(hintTimer.current);
    },
    [],
  );

  const flash = useCallback((result: 'done' | 'failed') => {
    setState(result);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setState('idle'), RESULT_HINT_MS);
  }, []);

  const run = useCallback(() => {
    const entries = getEntries();
    if (busyRef.current || countErrors(entries) === 0) return;
    busyRef.current = true;
    setState('busy');

    /* Mọi bước sau `yieldToPaint` nằm trong chuỗi promise: dựng file ném (dữ liệu lạ) hay
       `exportFile` của app ném ĐỒNG BỘ (vd native module vắng) đều rơi vào `.catch`, thay vì
       thoát ra ngoài và để `busyRef` kẹt `true` mãi. */
    void yieldToPaint()
      .then(async () => {
        const at = Date.now();
        const file: DevToolsExportFile = {
          name: errorReportFileName(at),
          mimeType: 'text/plain',
          content: formatErrorReport(entries, {
            generatedAt: at,
            build,
            info: safeInfo(sessionInfo),
            sessionStartedAt,
            source,
          }),
        };
        if (exportFile) await exportFile(file);
        else await Share.share({ message: file.content, title: file.name });
      })
      .then(() => flash('done'))
      .catch(() => flash('failed'))
      .finally(() => {
        busyRef.current = false;
      });
  }, [build, exportFile, flash, getEntries, sessionInfo, sessionStartedAt, source]);

  return { state, run };
};
