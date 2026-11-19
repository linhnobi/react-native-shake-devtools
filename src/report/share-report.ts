import type { DevToolsExportFile, DevToolsShareFile } from '../gate/devtools-props';
import type { DevToolsLocale } from '../i18n/types';
import type { BugReport } from './bug-report';
import { renderTicketSections } from './connectors/ticket-text';

/**
 * **Chức năng:** dựng tin nhắn chữ của bản báo — tiêu đề, các bước (đánh số), kết quả thực tế,
 * kết quả mong đợi (nếu có), môi trường (nếu có), ngữ cảnh app (nếu có) — theo `locale`. Chỉ là chữ
 * thuần để dán vào khay chia sẻ; không có định dạng riêng của đích nào.
 *
 * **Input:** `report` · `locale`. **Output:** chuỗi nhiều đoạn, các đoạn cách nhau một dòng trống.
 *
 * @example
 * ```ts
 * buildMessage(report, 'en');
 * // 'Crash\n\nSteps to reproduce:\n1. Open screen Cart\n\nActual result:\n500'
 * ```
 *
 * **Unit test:** `share-report.test.ts` › `shareReport` — kiểm qua tin nhắn của cả ba đường (vi, en,
 * thiếu `expected`/`deviceInfo`, có ngữ cảnh app).
 */
const buildMessage = (report: BugReport, locale: DevToolsLocale): string => {
  const t = renderTicketSections(report, locale);
  const parts = [
    report.title,
    `${t.headings.steps}:\n${t.steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}`,
    `${t.headings.actual}:\n${t.actual}`,
  ];
  if (t.expected !== undefined) parts.push(`${t.headings.expected}:\n${t.expected}`);
  if (t.environment.length > 0) {
    parts.push(
      `${t.headings.environment}:\n${t.environment.map(([k, v]) => `${k}: ${v}`).join('\n')}`,
    );
  }
  if (t.context.length > 0 || t.contextMore !== undefined) {
    const lines = [
      ...t.context.map(([k, v]) => `${k}: ${v}`),
      ...(t.contextMore !== undefined ? [t.contextMore] : []),
    ];
    parts.push(`${t.headings.context}:\n${lines.join('\n')}`);
  }
  return parts.join('\n\n');
};

/**
 * **Chức năng:** tin nhắn + nội dung các file **chữ** (`content`) nối thành một chuỗi, mỗi file một
 * khối `--- <tên> ---`. File ảnh (chỉ có `uri`) bị bỏ qua — không đọc, không bịa nội dung.
 *
 * **Input:** `message` · `files`. **Output:** chuỗi; không có file chữ ⇒ đúng `message`.
 *
 * @example
 * ```ts
 * withTextAttachments('msg', [{ name: 'errors.txt', mimeType: 'text/plain', content: 'boom' }]);
 * // 'msg\n\n--- errors.txt ---\nboom'
 * ```
 *
 * **Unit test:** `share-report.test.ts` › `shareReport` — 2 case: file chữ vào chữ gộp · file có
 * `uri` không để lại dấu vết trong chữ.
 */
const withTextAttachments = (message: string, files: BugReport['files']): string => {
  const blocks = files
    .filter((file) => file.content !== undefined)
    .map((file) => `--- ${file.name} ---\n${file.content}`);
  return [message, ...blocks].join('\n\n');
};

/**
 * **Chức năng:** chia sẻ bản báo qua app khi không gửi được tới đích (mất mạng, lỗi gửi, chưa có
 * kết nối…) hoặc sau khi gửi tới đích không nhận file. Ba đường, theo năng lực app cấp (spec 5.7):
 *
 * 1. Có `shareFiles` ⇒ **một** lần gọi với mọi file (ảnh theo `uri`, file chữ theo `content`, chuyển
 *    nguyên trạng — tên người nhận thấy giữ nguyên `errors.txt`…, R47) và tin nhắn chữ.
 *    `droppedImage: false`. Không đè file của bản báo đang gửi: đường gửi ghi tạm dưới tên riêng
 *    `<reportId>-<tên>`, và gate chỉ cho một lần chia sẻ một lúc.
 * 2. Không có `shareFiles`, có `exportFile` ⇒ **một** file `.txt` gồm tin nhắn + nội dung các file
 *    chữ. Ảnh không đi được ⇒ `droppedImage` = bản báo có ảnh.
 * 3. Cả hai đều vắng ⇒ `share(tin nhắn + file chữ)` của RN. `droppedImage` như đường 2.
 *
 * Hàm **không** im lặng bỏ ảnh: `droppedImage: true` để màn hình nói rõ "Ảnh không chia sẻ được,
 * app chưa hỗ trợ". Lỗi từ callback của app lan ra nguyên vẹn (UI hiện "Không chia sẻ được"); callback
 * resolve khi người dùng tự đóng khay chia sẻ được coi là thành công. "Có ảnh" = có file mang `uri`
 * nhưng không mang `content`.
 *
 * **Input:** `report` · `deps` (`locale` của tin nhắn; `shareFiles?`, `exportFile?` do app cấp;
 * `share` — thường là `Share.share` của RN bọc lại). **Output:** `{ droppedImage }`.
 *
 * @example
 * ```ts
 * const { droppedImage } = await shareReport(report, {
 *   locale: 'vi',
 *   exportFile: config.exportFile,
 *   share: (message) => Share.share({ message }),
 * });
 * if (droppedImage) showNotice(translate(strings, 'report.share.imageDropped'));
 * ```
 *
 * **Unit test:** `share-report.test.ts` — 11 case: `shareFiles` một lần đủ file (tên giữ nguyên) ·
 * tin nhắn vi/en · thiếu `expected`/`deviceInfo` · ngữ cảnh app · `exportFile` gộp một `.txt` · `share` chữ · không
 * có ảnh ⇒ `droppedImage: false` · không có file nào · không bịa nội dung cho `uri` · `shareFiles`
 * giữ nguyên file · lỗi lan ra.
 */
export const shareReport = async (
  report: BugReport,
  deps: {
    locale: DevToolsLocale;
    shareFiles?: (files: readonly DevToolsShareFile[], message: string) => Promise<void>;
    exportFile?: (file: DevToolsExportFile) => Promise<void>;
    share: (message: string) => Promise<unknown>;
  },
): Promise<{ droppedImage: boolean }> => {
  const message = buildMessage(report, deps.locale);

  if (deps.shareFiles) {
    await deps.shareFiles(report.files, message);
    return { droppedImage: false };
  }

  const droppedImage = report.files.some((f) => f.uri !== undefined && f.content === undefined);
  const text = withTextAttachments(message, report.files);

  if (deps.exportFile) {
    const safeId = report.id.replace(/[^A-Za-z0-9._-]/g, '_');
    await deps.exportFile({
      name: `bug-report-${safeId}.txt`,
      mimeType: 'text/plain',
      content: text,
    });
  } else {
    await deps.share(text);
  }
  return { droppedImage };
};
