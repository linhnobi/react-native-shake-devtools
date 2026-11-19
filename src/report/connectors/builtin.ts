import { jiraCloudConnector } from './jira';
import { larkConnector } from './lark';
import { slackConnector } from './slack';
import type { ConnectorType } from './types';
import { webhookConnector } from './webhook';

/**
 * Bốn loại kết nối lib có sẵn (spec 3, mục tiêu 4), theo thứ tự hiện ở màn chọn loại: Jira Cloud
 * (đích chính) · Slack · Lark/Feishu · Webhook (đường relay chung, để cuối).
 */
export const builtinConnectorTypes: readonly ConnectorType[] = [
  jiraCloudConnector,
  slackConnector,
  larkConnector,
  webhookConnector,
];

/**
 * **Chức năng:** ghép các loại kết nối app đăng ký (`config.bugReport.connectorTypes`) vào danh sách
 * có sẵn — app thêm đích mới hoặc thay hẳn một loại có sẵn mà **không sửa lib** (spec 5.4).
 *
 * - Loại của app **trùng `id`** với loại có sẵn ⇒ thay loại có sẵn, giữ đúng vị trí của nó.
 * - `id` mới ⇒ thêm vào cuối, theo thứ tự app khai. App khai trùng `id` hai lần ⇒ bản sau thắng.
 * - Không đổi `builtinConnectorTypes` (luôn trả mảng mới).
 *
 * **Input:** `app?` — các loại của app. **Output:** danh sách đã ghép, mỗi `id` đúng một lần.
 *
 * @example
 * ```ts
 * mergeConnectorTypes([myLinear]);       // [jira-cloud, slack, lark, webhook, linear]
 * mergeConnectorTypes([mySlack]);        // [jira-cloud, mySlack, lark, webhook] — loại của app thắng
 * mergeConnectorTypes();                 // ca biên: đúng danh sách có sẵn
 * ```
 *
 * **Unit test:** `builtin.test.ts` — 5 case: danh sách có sẵn đúng thứ tự (gồm Lark) · app không khai gì ·
 * trùng id thay tại chỗ · id mới thêm cuối và không đổi mảng có sẵn · app khai trùng id hai lần.
 */
export const mergeConnectorTypes = (
  app: readonly ConnectorType[] = [],
): readonly ConnectorType[] => {
  const byId = new Map<string, ConnectorType>();
  for (const type of builtinConnectorTypes) byId.set(type.id, type);
  for (const type of app) byId.set(type.id, type);
  return [...byId.values()];
};
