import type { LogEntry } from '../capture/log-entry';
import { maskPersonalData } from '../capture/mask-label';
import type { RecordedAction } from '../capture/recorded-action';
import { pathOf } from './steps';

/** Một dòng của `timeline.json`. Cố ý **không có** trường nào chứa header hay thân request. */
type TimelineItem =
  | { at: number; type: 'action'; kind: RecordedAction['kind']; label?: string }
  | { at: number; type: 'screen'; label: string }
  | {
      at: number;
      type: 'request';
      method: string;
      path: string;
      status?: number;
      durationMs?: number;
      error?: string;
    }
  | { at: number; type: 'error'; text: string };

/** Dòng đầu không rỗng của `text` (không kèm stack). */
const firstLine = (text: unknown): string => {
  if (typeof text !== 'string') return '';
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() !== '') return line.trim();
  }
  return '';
};

/**
 * **Chức năng:** dựng `timeline.json` — dòng thời gian của **cửa sổ bug** gồm mọi thao tác, mốc
 * màn, request (kể cả thành công) và lỗi `console.error`. File này đi chung chip Log lỗi và rời
 * máy vào Jira/Slack của khách, nên **không có header, không có thân request/response**, URL chỉ
 * giữ đường dẫn (bỏ host, query, fragment). Thân của dòng lỗi đã có trong `errors.txt` (đã che).
 * `url` không phải chuỗi (dữ liệu hỏng) ⇒ `path: ''`, không ném.
 *
 * - Chỉ lấy `at >= from`; mốc ⚑ của người dùng và `console` không phải lỗi bị bỏ.
 * - Xếp theo `at`; bằng giờ thì thao tác đứng trước mốc màn/request/lỗi (chạm rồi mới đổi màn).
 * - Nhãn thao tác, tên màn, đường dẫn và dòng đầu của lỗi đều qua `maskPersonalData`.
 * - Lỗi console chỉ mang **dòng đầu** của `text`, không stack.
 * - Trung lập ngôn ngữ (tiếng Anh kỹ thuật, không i18n), cùng quy ước với `errors.txt`.
 *
 * **Input:** `actions` · `entries` (ảnh chụp buffer) · `from` (mốc đầu cửa sổ).
 * **Output:** chuỗi JSON thụt lề 2 — mảng `{ at, type: 'action'|'screen'|'request'|'error', … }`
 * cũ → mới; không có gì ⇒ `'[]'`.
 *
 * @example
 * ```ts
 * formatTimeline({ from: 0, actions: [{ at: 1, kind: 'tap', label: 'Pay', source: 'text' }],
 *   entries: [{ id: 1, kind: 'network', at: 2, method: 'POST', url: 'https://a.com/pay?x=1', status: 500 }] });
 * // [ { "at": 1, "type": "action", "kind": "tap", "label": "Pay" },
 * //   { "at": 2, "type": "request", "method": "POST", "path": "/pay", "status": 500 } ]
 * formatTimeline({ from: 0, actions: [], entries: [] });   // ca biên: '[]'
 * ```
 *
 * **Unit test:** `timeline.test.ts` › `formatTimeline` — 9 case: request có method/path/status/
 * durationMs · `url` không phải chuỗi · request lỗi vận chuyển · không có khoá thân/header và
 * không lộ token, mật khẩu ·
 * trộn theo giờ, bằng giờ thì thao tác trước · lỗi console chỉ dòng đầu · bỏ mốc ⚑, warn và mọi
 * thứ trước `from` · che dữ liệu cá nhân · rỗng ⇒ `[]`.
 */
export const formatTimeline = (i: {
  actions: readonly RecordedAction[];
  entries: readonly LogEntry[];
  from: number;
}): string => {
  const items: Array<{ seq: number; item: TimelineItem }> = [];
  let seq = 0;
  for (const a of i.actions) {
    if (a.at < i.from) continue;
    const label = typeof a.label === 'string' && a.label.trim() !== '' ? a.label : undefined;
    items.push({
      seq: seq++,
      item: {
        at: a.at,
        type: 'action',
        kind: a.kind,
        ...(label !== undefined ? { label: maskPersonalData(label) } : {}),
      },
    });
  }
  for (const e of i.entries) {
    if (e.at < i.from) continue;
    if (e.kind === 'marker') {
      if (e.type === 'screen') {
        items.push({ seq: seq++, item: { at: e.at, type: 'screen', label: maskPersonalData(e.label) } });
      }
    } else if (e.kind === 'network') {
      items.push({
        seq: seq++,
        item: {
          at: e.at,
          type: 'request',
          method: e.method,
          path: maskPersonalData(pathOf(e.url)),
          ...(e.status !== undefined ? { status: e.status } : {}),
          ...(e.durationMs !== undefined ? { durationMs: e.durationMs } : {}),
          ...(e.error ? { error: e.error } : {}),
        },
      });
    } else if (e.level === 'error') {
      items.push({
        seq: seq++,
        item: { at: e.at, type: 'error', text: maskPersonalData(firstLine(e.text)) },
      });
    }
  }
  items.sort((a, b) => a.item.at - b.item.at || a.seq - b.seq);
  return JSON.stringify(
    items.map((x) => x.item),
    null,
    2,
  );
};
