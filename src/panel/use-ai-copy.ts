import { useCallback, useEffect, useRef, useState } from 'react';
import { Share } from 'react-native';
import { formatAiContext } from '../capture/format-ai-context';
import type { LogEntry } from '../capture/log-entry';
import type { RecordedAction } from '../capture/recorded-action';
import type { DevToolsSessionInfo } from '../capture/session-info';
import { copyText } from './copy-text';
import { safeInfo } from './use-log-export';

/** Dấu "Đã chép" / "Không chép được" ở lại bao lâu — cùng nhịp với dấu chép của panel và màn nhật ký. */
const RESULT_HINT_MS = 1500;

/**
 * `'copied'` — khối đã vào bộ nhớ tạm. Rơi về khay chia sẻ thì không có dấu riêng (khay đã là phản
 * hồi), trạng thái về thẳng `'idle'`.
 */
export type AiCopyState = 'idle' | 'busy' | 'copied' | 'failed';

export interface UseAiCopyInput {
  /** Ảnh chụp nhật ký **lúc bấm** (cũ→mới). Nên giữ danh tính ổn định, như `useLogExport`. */
  readonly getEntries: () => readonly LogEntry[];
  /** Thao tác QA đã ghi, lúc bấm. Vắng ⇒ phần "Recent steps" không có chạm/nhập. */
  readonly getActions?: () => readonly RecordedAction[];
  /** Dòng phụ môi trường, vd `'UAT · 1.0.2'`. */
  readonly build?: string;
  /** Bản build · máy · user (đã che) — gọi lúc bấm; ném ⇒ bỏ qua. */
  readonly sessionInfo?: () => DevToolsSessionInfo;
  /** Mốc bắt đầu thu nhật ký. */
  readonly sessionStartedAt?: number;
  /** Nhãn nguồn khi dựng từ phiên trước, vd `'previous session'`. */
  readonly source?: string;
}

export interface UseAiCopyResult {
  readonly state: AiCopyState;
  /** Giữ nguyên danh tính khi các input không đổi. */
  readonly run: () => void;
}

/** Nhường luồng JS cho một lượt commit + vẽ trước khi làm việc nặng. */
const yieldToPaint = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * **Chức năng:** nút **Chép cho AI** — dựng khối Markdown `formatAiContext` (đã che) rồi đặt vào bộ
 * nhớ tạm, để dán thẳng vào agent lập trình (Claude Code, Cursor, Copilot).
 *
 * ## Bộ nhớ tạm trước, khay chia sẻ sau
 *
 * Dùng lại đúng hai đường ra lib đã có, không thêm dependency: `copyText` (`Clipboard` của lõi RN,
 * như nút Chép cURL) và `Share.share` (như nút Chia sẻ). Bộ nhớ tạm là đích tự nhiên: trên máy ảo,
 * bộ nhớ tạm thường được đồng bộ sang máy tính đang chạy agent. Bộ nhớ tạm vắng (RN gỡ `Clipboard`
 * khỏi lõi) ⇒ mở khay chia sẻ với cùng khối chữ.
 *
 * Khác "Chép cURL": khối này **đã che** (cùng nhóm "đi tới người khác" với nút Chia sẻ), vì nó được
 * dán sang một dịch vụ AI bên ngoài.
 *
 * Chốt bấm đúp bằng `ref` và nhường một khung hình trước khi dựng khối — cùng hai lý do với
 * `useLogExport`.
 *
 * **Input:** {@link UseAiCopyInput}. **Output:** {@link UseAiCopyResult}.
 *
 * @example
 * ```ts
 * const ai = useAiCopy({ getEntries: logBuffer.snapshot, getActions: actionBuffer.snapshot,
 *   build: 'UAT · 1.0.2', sessionInfo, sessionStartedAt: getCaptureStartedAt() });
 * ai.run();   // 'busy' → chép → 'copied' → (1,5 s) 'idle'
 * // Ca biên: bộ nhớ tạm vắng ⇒ khay chia sẻ; khay reject ⇒ 'failed' → (1,5 s) 'idle'.
 * ```
 *
 * **Unit test:** `use-ai-copy.test.ts` › `useAiCopy` — 7 case: chép khối đã che kèm build, máy,
 * nguồn, bước ⇒ `copied` · bộ nhớ tạm vắng ⇒ `Share.share` rồi `idle` · khay reject ⇒ `failed` ·
 * hàm thông tin ném vẫn chép · bấm đúp chỉ chép một lần · `busy` trước khi dựng, dấu tự về `idle` ·
 * đọc nhật ký lúc bấm.
 */
export const useAiCopy = ({
  getEntries,
  getActions,
  build,
  sessionInfo,
  sessionStartedAt,
  source,
}: UseAiCopyInput): UseAiCopyResult => {
  const [state, setState] = useState<AiCopyState>('idle');
  const busyRef = useRef(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      if (hintTimer.current) clearTimeout(hintTimer.current);
    },
    [],
  );

  const flash = useCallback((result: 'copied' | 'failed') => {
    setState(result);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setState('idle'), RESULT_HINT_MS);
  }, []);

  const run = useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    setState('busy');

    void yieldToPaint()
      .then(async () => {
        const text = formatAiContext(getEntries(), {
          generatedAt: Date.now(),
          build,
          info: safeInfo(sessionInfo),
          sessionStartedAt,
          source,
          actions: getActions?.(),
        });
        if (copyText(text)) {
          flash('copied');
          return;
        }
        await Share.share({ message: text });
        setState('idle');
      })
      .catch(() => flash('failed'))
      .finally(() => {
        busyRef.current = false;
      });
  }, [build, flash, getActions, getEntries, sessionInfo, sessionStartedAt, source]);

  return { state, run };
};
