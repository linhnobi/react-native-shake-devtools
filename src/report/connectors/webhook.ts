import { devtoolsStrings, translate } from '../../i18n/translate';
import type { DevToolsLocale } from '../../i18n/types';
import { requestJson } from './http';
import { renderTicketSections } from './ticket-text';
import { ConnectorError, defineConnector, type ConnectorValues } from './types';

/** Giá trị các ô của Webhook (không bí mật; `headerValue` đi riêng qua `secrets`). */
export type WebhookValues = {
  readonly url?: string;
  readonly headerName?: string;
};

/** Host được dùng `http` thường để thử: máy chạy app và máy host của emulator Android. */
const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '10.0.2.2']);

/** Tên header hợp lệ (RFC 9110 `token`). Sai tên thì `Headers` ném `TypeError`. */
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * Tách `scheme` và `host` bằng regex: `URL` của RN không đầy đủ (một số getter ném "not
 * implemented"), nên không dựa vào nó.
 */
const URL_SHAPE = /^(https?):\/\/(?:[^/?#@\s]*@)?(\[[^\]]+\]|[^/?#:@\s]+)(?::\d+)?(?:[/?#]\S*)?$/i;

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

const t = (locale: DevToolsLocale, key: Parameters<typeof translate>[1]): string =>
  translate(devtoolsStrings[locale], key);

/**
 * Kiểm tra URL (`https`; `http` chỉ với `localhost`/`10.0.2.2`) và tên header. Ném
 * `ConnectorError('validation', …, { field })` với message theo `locale`; message không chứa URL
 * (query có thể mang khoá).
 */
const validate = (values: WebhookValues, locale: DevToolsLocale): string => {
  const url = str(values.url);
  const match = url === undefined ? null : URL_SHAPE.exec(url);
  if (url === undefined || match === null) {
    throw new ConnectorError('validation', t(locale, 'connections.webhook.urlInvalid'), {
      field: 'url',
    });
  }
  if (match[1].toLowerCase() === 'http' && !LOCAL_HOSTS.has(match[2].toLowerCase())) {
    throw new ConnectorError('validation', t(locale, 'connections.webhook.urlNotSecure'), {
      field: 'url',
    });
  }
  const headerName = str(values.headerName);
  if (headerName !== undefined && !HEADER_NAME.test(headerName)) {
    throw new ConnectorError('validation', t(locale, 'connections.webhook.headerNameInvalid'), {
      field: 'headerName',
    });
  }
  return url;
};

/** Link kết quả chỉ nhận `http(s)` — chuỗi khác (`javascript:`…) bị bỏ, vì màn sẽ hiện nó như link. */
const safeLink = (value: unknown): string | undefined =>
  typeof value === 'string' && /^https?:\/\/\S+$/i.test(value) ? value : undefined;

/**
 * **Chức năng:** loại kết nối **Webhook** (spec 5.4) — POST `multipart/form-data` tới URL của khách:
 * phần `report` là JSON (`id`, `createdAt`, `title`, `subtitle?`, `steps` dựng theo `ctx.locale`,
 * `actual`, `expected?`, `deviceInfo?`, `appContext?` — `{ lines, more }` đã che, giữ nguyên như
 * `BugReport`), mỗi file đính kèm là một phần riêng mang tên file (`context.json` là bản đủ). Một
 * header tuỳ chọn (tên + giá trị bí mật) cho khoá xác thực. Đây cũng là đường "relay" cho khách muốn
 * giữ token ở server.
 *
 * - `test`: **không gọi mạng** — chỉ kiểm URL (`https`; `http` cho `localhost`/`10.0.2.2`) và tên
 *   header, trả `{}`. Sai ⇒ `ConnectorError('validation', …, { field })`.
 * - `send`: kiểm lại như `test` (URL hỏng không được thành lỗi `network` rồi tự gửi lại), không tự
 *   đặt `Content-Type` (để `fetch` thêm `boundary`). 2xx là thành công kể cả thân rỗng/không phải
 *   JSON (server chỉ cần trả 2xx; gửi lại sẽ tạo bản trùng); thân JSON `{ url?, key? }` ⇒ `SendResult`.
 *   File mà `uploadPart` không dựng được thì bỏ và liệt kê ở `skippedFiles`. Giá trị header luôn đi
 *   vào `secrets` của `requestJson` nên không lọt vào message lỗi.
 *
 * **Input:** theo `ConnectorType.send` · **Output:** `SendResult`.
 *
 * @example
 * ```ts
 * webhookConnector.send(report, { url: 'https://hooks.acme.com/bug', headerName: 'X-Api-Key' }, { headerValue }, ctx);
 * ```
 *
 * **Unit test:** `webhook.test.ts` — 2 case khai báo · 14 case `send` (multipart + `report` ·
 * ngôn ngữ vi · phần file · ngữ cảnh app · header · không header · `{url,key}` · 204 · 2xx không phải JSON · JSON
 * lạ/link không an toàn · 500 · bí mật không lọt lỗi · `skippedFiles` · URL hỏng) · 10 case `test`
 * (https · http cục bộ · http từ xa · 5 URL sai · message theo ngôn ngữ · tên header sai).
 */
export const webhookConnector = defineConnector<WebhookValues & ConnectorValues>({
  id: 'webhook',
  label: (locale) => t(locale, 'connections.webhook.label'),
  fields: (locale) => [
    {
      id: 'url',
      label: t(locale, 'connections.webhook.url'),
      kind: 'url',
      required: true,
      help: t(locale, 'connections.webhook.urlHelp'),
      placeholder: 'https://',
    },
    {
      id: 'headerName',
      label: t(locale, 'connections.webhook.headerName'),
      kind: 'text',
      placeholder: 'X-Api-Key',
    },
    {
      id: 'headerValue',
      label: t(locale, 'connections.webhook.headerValue'),
      kind: 'secret',
      help: t(locale, 'connections.webhook.headerHelp'),
    },
  ],
  secretFieldIds: ['headerValue'],
  capabilities: () => ({ image: true, files: true }),

  test: async (values, _secrets, ctx) => {
    validate(values, ctx.locale);
    return {};
  },

  send: async (report, values, secrets, ctx) => {
    const url = validate(values, ctx.locale);
    const sections = renderTicketSections(report, ctx.locale);

    const form = new FormData();
    // Kiểu `append` của RN chỉ khai giá trị Blob/chuỗi; thực tế nhận `{ uri | string, name, type }`.
    const append = form.append.bind(form) as (name: string, value: unknown) => void;
    append(
      'report',
      JSON.stringify({
        id: report.id,
        createdAt: report.createdAt,
        title: report.title,
        ...(report.subtitle !== undefined ? { subtitle: report.subtitle } : {}),
        steps: sections.steps,
        actual: sections.actual,
        ...(sections.expected !== undefined ? { expected: sections.expected } : {}),
        ...(report.deviceInfo !== undefined ? { deviceInfo: report.deviceInfo } : {}),
        ...(report.appContext !== undefined ? { appContext: report.appContext } : {}),
      }),
    );

    const skippedFiles: string[] = [];
    for (const file of report.files) {
      try {
        append(file.name, await ctx.uploadPart(file));
      } catch {
        skippedFiles.push(file.name);
      }
    }

    const headerName = str(values.headerName);
    const headerValue = typeof secrets.headerValue === 'string' ? secrets.headerValue : undefined;
    const headers: Record<string, string> = {};
    if (headerName !== undefined && headerValue) headers[headerName] = headerValue;

    let json: unknown;
    try {
      ({ json } = await requestJson<unknown>(
        ctx,
        url,
        { method: 'POST', headers, body: form },
        { secrets: headerValue ? [headerValue] : [] },
      ));
    } catch (error) {
      // 2xx mà thân không phải JSON: server đã nhận — coi là thành công, không gửi lại.
      const acceptedWithoutJson =
        error instanceof ConnectorError &&
        error.kind === 'unknown' &&
        error.status !== undefined &&
        error.status >= 200 &&
        error.status < 300;
      if (!acceptedWithoutJson) throw error;
    }

    const body =
      typeof json === 'object' && json !== null && !Array.isArray(json)
        ? (json as { url?: unknown; key?: unknown })
        : {};
    const link = safeLink(body.url);
    const key = typeof body.key === 'string' && body.key !== '' ? body.key : undefined;
    return {
      ...(link !== undefined ? { url: link } : {}),
      ...(key !== undefined ? { key } : {}),
      ...(skippedFiles.length > 0 ? { skippedFiles } : {}),
    };
  },
});
