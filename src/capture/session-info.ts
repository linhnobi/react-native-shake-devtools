import { formatDateTime } from './format-log';

/**
 * Thông tin về **bản build + máy + người dùng** của phiên đang gỡ — thứ BE/QA luôn phải hỏi lại
 * khi nhận một ticket ("bản nào? máy gì? user nào?").
 *
 * **App** cấp (lib không biết số build, không có `react-native-device-info`, không biết phiên đăng
 * nhập), qua `DevToolsConfig.sessionInfo`. Mọi trường đều là **chuỗi đã nấu chín**, trường nào vắng
 * thì không in.
 *
 * 🔴 `user` phải là bản **đã che** (vd `***812 · admin`) — khối này đi vào file xuất và bộ nhớ tạm.
 */
export interface DevToolsSessionInfo {
  /** Vd `'1.0.2 (58)'` — số phát hành + số build. */
  readonly appVersion?: string;
  /** Vd `'UAT'`. */
  readonly env?: string;
  /** Vd `'Samsung SM-A525F'`. */
  readonly device?: string;
  /** Vd `'Android 14'`. */
  readonly os?: string;
  /** Vd `'***812 · admin'` — **đã che**. */
  readonly user?: string;
}

/**
 * **Chức năng:** đổi thông tin phiên thành các cặp `[nhãn, giá trị]` **trung lập ngôn ngữ** — dùng
 * cho đầu file xuất và khối "Chép thông tin thiết bị".
 *
 * Nhãn tiếng Anh kỹ thuật, không i18n: khối này rời app (ticket, file), người đọc có thể không
 * dùng app — cùng lý do với `formatLog`. Màn panel thì tự dịch nhãn khi **hiện**.
 *
 * **Input:** `info` · `startedAt?` — mốc bắt đầu thu nhật ký (≈ lúc mở app).
 * **Output:** mảng cặp, theo thứ tự cố định App · Env · Device · OS · User · Session; trường vắng
 * bị bỏ.
 *
 * @example
 * ```ts
 * sessionInfoPairs({ appVersion: '1.0.2 (58)', env: 'UAT' });
 * // [['App', '1.0.2 (58)'], ['Env', 'UAT']]
 * sessionInfoPairs({});   // ca biên: [] — không in dòng trống
 * ```
 *
 * **Unit test:** `session-info.test.ts` › `sessionInfoPairs` — 3 case: đúng thứ tự cố định · trường
 * vắng bị bỏ · có `startedAt` thì thêm dòng `Session` ngày giờ đầy đủ.
 */
export const sessionInfoPairs = (
  info: DevToolsSessionInfo,
  startedAt?: number,
): ReadonlyArray<readonly [string, string]> => {
  const pairs: Array<readonly [string, string | undefined]> = [
    ['App', info.appVersion],
    ['Env', info.env],
    ['Device', info.device],
    ['OS', info.os],
    ['User', info.user],
    ['Session', startedAt === undefined ? undefined : formatDateTime(startedAt)],
  ];
  return pairs.filter((p): p is readonly [string, string] => Boolean(p[1]));
};

/**
 * **Chức năng:** khối text "thông tin thiết bị" — dán thẳng vào ticket.
 *
 * **Input:** như `sessionInfoPairs`. **Output:** mỗi cặp một dòng, nhãn đệm cho thẳng cột; không
 * có cặp nào ⇒ chuỗi rỗng.
 *
 * @example
 * ```ts
 * formatSessionInfo({ appVersion: '1.0.2 (58)', env: 'UAT' });
 * // 'App       : 1.0.2 (58)\nEnv       : UAT'
 * formatSessionInfo({});   // ca biên: ''
 * ```
 *
 * **Unit test:** `session-info.test.ts` › `formatSessionInfo` — 2 case: nhãn thẳng cột · rỗng ⇒
 * chuỗi rỗng.
 */
export const formatSessionInfo = (
  info: DevToolsSessionInfo,
  startedAt?: number,
): string =>
  sessionInfoPairs(info, startedAt)
    .map(([label, value]) => `${label.padEnd(10)}: ${value}`)
    .join('\n');
