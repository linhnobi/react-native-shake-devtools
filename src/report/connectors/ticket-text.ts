import { devtoolsStrings, translate } from '../../i18n/translate';
import type { DevToolsKey, DevToolsLocale } from '../../i18n/types';
import type { BugReport } from '../bug-report';
import { renderStep } from '../steps';

/** Nhãn thông tin máy do `sessionInfoPairs` đặt (tiếng Anh trung lập) ⇒ khoá dịch theo kết nối. */
const INFO_LABEL: ReadonlyMap<string, DevToolsKey> = new Map<string, DevToolsKey>([
  ['App', 'report.ticket.info.app'],
  ['Env', 'report.ticket.info.env'],
  ['Device', 'report.ticket.info.device'],
  ['OS', 'report.ticket.info.os'],
  ['User', 'report.ticket.info.user'],
  ['Session', 'report.ticket.info.session'],
]);

/** Tiêu đề các mục của ticket (và hai câu ghi chú) theo ngôn ngữ của kết nối. */
export interface TicketHeadings {
  readonly steps: string;
  readonly actual: string;
  readonly expected: string;
  readonly environment: string;
  /** Mục ngữ cảnh do app cấp ("App context"). */
  readonly context: string;
  /** Ghi chú khi file đính kèm không gửi được qua đích này (Slack nhẹ, Lark nhẹ…). */
  readonly attachmentsNote: string;
  /** Ghi chú khi nội dung bị cắt cho vừa giới hạn của đích. */
  readonly truncatedNote: string;
}

/** Nội dung chữ của ticket, chưa định dạng cho đích nào. */
export interface TicketSections {
  readonly headings: TicketHeadings;
  /** Mỗi bước một câu, dựng theo `locale`; bước QA tự sửa chữ giữ nguyên. */
  readonly steps: string[];
  readonly actual: string;
  /** Vắng khi QA để trống ô "Mong đợi". */
  readonly expected?: string;
  readonly environment: Array<[string, string]>;
  /** Mục "App context": `[khoá, giá trị]` đã che, giữ nguyên (không dịch); rỗng nếu không có. */
  readonly context: Array<[string, string]>;
  /** Dòng cuối "…và N khoá khác" (đã dịch) khi tóm tắt bỏ bớt khoá; vắng (không có khoá) nếu không. */
  readonly contextMore?: string;
}

const isPair = (value: unknown): value is readonly [string, string] =>
  Array.isArray(value) &&
  value.length === 2 &&
  typeof value[0] === 'string' &&
  typeof value[1] === 'string';

/**
 * Ngữ cảnh app của bản báo, đọc phòng thủ: bản báo có thể đến từ file hàng đợi trên đĩa (cũ, hỏng,
 * sửa tay) — dòng sai hình bị bỏ, `more` không phải số nguyên dương thành 0.
 */
const contextOf = (report: BugReport): { lines: Array<[string, string]>; more: number } => {
  const raw: unknown = report.appContext;
  if (typeof raw !== 'object' || raw === null) return { lines: [], more: 0 };
  const { lines, more } = raw as { lines?: unknown; more?: unknown };
  return {
    lines: Array.isArray(lines) ? lines.filter(isPair).map(([k, v]): [string, string] => [k, v]) : [],
    more: typeof more === 'number' && Number.isInteger(more) && more > 0 ? more : 0,
  };
};

/**
 * **Chức năng:** dựng phần **chữ** dùng chung của ticket (Webhook, Slack, Lark, Jira): tiêu đề mục,
 * câu cho từng bước và **nhãn thông tin máy** (`App` → `Ứng dụng`…) theo `locale` của **kết nối**
 * (spec 11.2), không theo ngôn ngữ app. Bước `text` (QA đã sửa) giữ nguyên chữ, không dịch; nhãn
 * thông tin máy lạ (không do `sessionInfoPairs` đặt) giữ nguyên. Mỗi loại kết nối tự định dạng kết
 * quả theo đích (Block Kit, thẻ Lark, ADF…).
 *
 * Mục **ngữ cảnh app** (`report.appContext`, đã che lúc chụp): dòng giữ nguyên (khoá và dữ liệu của
 * app, không dịch); tiêu đề mục và dòng "…và N khoá khác" theo `locale`. Bản báo đọc từ file hàng đợi
 * có ngữ cảnh hỏng ⇒ dòng sai hình bị bỏ, không ném.
 *
 * **Input:** `report` · `locale`.
 * **Output:** `{ headings, steps, actual, expected?, environment, context, contextMore? }`. `expected`
 * vắng (không có khoá) nếu trống hoặc chỉ gồm khoảng trắng; `environment` rỗng nếu không có
 * `deviceInfo`; `context` rỗng và `contextMore` vắng nếu không có ngữ cảnh.
 *
 * @example
 * ```ts
 * const t = renderTicketSections(report, 'en');
 * t.headings.steps;   // 'Steps to reproduce'
 * t.steps[0];         // 'Open screen Cart'
 * ```
 *
 * **Unit test:** `ticket-text.test.ts` — 8 case: vi · en · bước `text` giữ nguyên · `actual`,
 * `expected`, `environment` · nhãn thông tin máy theo ngôn ngữ (nhãn lạ giữ nguyên) · thiếu/trống
 * `expected` và thiếu `deviceInfo` · ngữ cảnh app (vi/en, số ít/nhiều) · ngữ cảnh vắng/hỏng.
 */
export const renderTicketSections = (report: BugReport, locale: DevToolsLocale): TicketSections => {
  const strings = devtoolsStrings[locale];
  const expected = report.expected?.trim() ? report.expected : undefined;
  const context = contextOf(report);
  return {
    headings: {
      steps: translate(strings, 'report.ticket.steps'),
      actual: translate(strings, 'report.ticket.actual'),
      expected: translate(strings, 'report.ticket.expected'),
      environment: translate(strings, 'report.ticket.environment'),
      context: translate(strings, 'report.ticket.context'),
      attachmentsNote: translate(strings, 'report.ticket.attachmentsNote'),
      truncatedNote: translate(strings, 'report.ticket.truncatedNote'),
    },
    steps: report.steps.map((step) => renderStep(step, strings)),
    actual: report.actual,
    ...(expected !== undefined ? { expected } : {}),
    environment: (report.deviceInfo ?? []).map(([key, value]): [string, string] => {
      const label = INFO_LABEL.get(key);
      return [label ? translate(strings, label) : key, value];
    }),
    context: context.lines,
    ...(context.more > 0
      ? { contextMore: translate(strings, 'report.ticket.contextMore', { count: context.more }) }
      : {}),
  };
};
