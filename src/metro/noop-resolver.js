'use strict';

/**
 * Entry `react-native-shake-devtools/metro` — chạy trong **Node** (file `metro.config.js` của app),
 * không vào bundle. Vì thế là CommonJS thuần, không TypeScript: `metro.config.js` nạp nó bằng
 * `require` mà không qua bước biên dịch nào. Kiểu ở `noop-resolver.d.ts` cạnh bên.
 */

const PACKAGE = 'react-native-shake-devtools';

/**
 * Entry công khai → entry noop cùng bề mặt. Thêm entry mới vào `package.json#exports` thì thêm
 * cặp ở đây (và bản noop trong `src/noop/`) — không thì bản prod dừng bundle ở lỗi "chưa có bản
 * noop", không lặng lẽ mang code thật vào.
 */
const NOOP_ENTRIES = Object.freeze({
  [PACKAGE]: `${PACKAGE}/noop`,
  [`${PACKAGE}/capture`]: `${PACKAGE}/noop/capture`,
  [`${PACKAGE}/shake`]: `${PACKAGE}/noop/shake`,
  [`${PACKAGE}/i18n`]: `${PACKAGE}/noop/i18n`,
  [`${PACKAGE}/plain`]: `${PACKAGE}/noop/plain`,
});

/** Đường import của gói này mà để nguyên cũng không mang code devtools nào vào bundle. */
const PASS_THROUGH = new Set([...Object.values(NOOP_ENTRIES), `${PACKAGE}/package.json`]);

/**
 * **Chức năng:** đổi một đường import sang bản noop của nó — phần thuần (không I/O) của
 * `devtoolsNoopResolver`, tách ra để test được không cần Metro.
 *
 * **Input:** `moduleName` — chuỗi đứng sau `from` / trong `require()`, đúng như code viết.
 * **Output:** đường đã tráo nếu là một entry của gói này; nguyên văn nếu là gói khác hoặc đường
 * tương đối. **Ném** khi là đường *khác* của gói này (vd `react-native-shake-devtools/src/panel/LogRow`):
 * không có bản noop nào cho nó, để nguyên thì code thật vào bundle prod — thà dừng bundle còn hơn.
 *
 * @example
 * ```js
 * toNoopRequest('react-native-shake-devtools');          // 'react-native-shake-devtools/noop'
 * toNoopRequest('react-native-shake-devtools/capture');  // 'react-native-shake-devtools/noop/capture'
 * toNoopRequest('react-native-shake-devtools-extra');    // nguyên văn — ca biên: chỉ trùng tiền tố, gói khác
 * toNoopRequest('react-native-shake-devtools/src/x');    // ném
 * ```
 *
 * **Unit test:** `noop-resolver.test.ts` › `toNoopRequest` — 5 case: năm entry ra đúng bản noop ·
 * gói khác / đường tương đối / gói trùng tiền tố để nguyên · đường noop và `package.json` để nguyên
 * (không tráo hai lần) · đường lạ của gói ném lỗi có tên đường · mọi đích tráo đều có trong
 * `package.json#exports`.
 */
const toNoopRequest = (moduleName) => {
  if (moduleName !== PACKAGE && !moduleName.startsWith(`${PACKAGE}/`)) return moduleName;
  if (Object.prototype.hasOwnProperty.call(NOOP_ENTRIES, moduleName)) {
    return NOOP_ENTRIES[moduleName];
  }
  if (PASS_THROUGH.has(moduleName)) return moduleName;
  throw new Error(
    `[${PACKAGE}] Không có bản noop cho "${moduleName}". Chỉ import các entry công khai ` +
      `(${Object.keys(NOOP_ENTRIES).join(', ')}) — đường khác sẽ mang code devtools vào bundle prod.`,
  );
};

/**
 * **Chức năng:** dựng `resolver.resolveRequest` cho Metro — khi `enabled`, mọi import
 * `react-native-shake-devtools[/capture|/shake|/i18n|/plain]` (của app **và** của thư viện nào khác) được
 * tráo sang bản noop cùng bề mặt, nên bundle không còn dòng code devtools nào mà code app không
 * phải sửa một dòng import.
 *
 * Lib **không tự đọc biến môi trường**: bản nào là prod là luật của app (cùng lý do với
 * `DevToolsConfig.enabled`), app tự tính `enabled` trong `metro.config.js`.
 *
 * **Input:** `options.enabled` — `true` thì tráo, `false`/vắng thì không đụng gì ·
 * `options.resolveRequest?` — resolver app đang có (vd cho svg); vắng ⇒ resolver mặc định của Metro
 * (`context.resolveRequest`).
 * **Output:** hàm `(context, moduleName, platform) => Resolution` đúng chữ ký Metro.
 *
 * @example
 * ```js
 * // metro.config.js của app
 * const { devtoolsNoopResolver } = require('react-native-shake-devtools/metro');
 * module.exports = mergeConfig(getDefaultConfig(__dirname), {
 *   resolver: {
 *     resolveRequest: devtoolsNoopResolver({ enabled: process.env.DEVTOOLS_NOOP === '1' }),
 *   },
 * });
 * // Ca biên: biến vắng ⇒ enabled false ⇒ resolver chỉ chuyển tiếp, bundle y như không cài hàm này.
 * ```
 *
 * **Unit test:** `noop-resolver.test.ts` › `devtoolsNoopResolver` — 4 case: `enabled` tráo entry
 * rồi gọi resolver mặc định · `enabled: false` chuyển tiếp nguyên văn · có `resolveRequest` của
 * app thì gọi nó thay resolver mặc định · đường lạ của gói ném trước khi chạm resolver nào.
 */
const devtoolsNoopResolver =
  ({ enabled = false, resolveRequest } = {}) =>
  (context, moduleName, platform) => {
    const target = enabled ? toNoopRequest(moduleName) : moduleName;
    return (resolveRequest ?? context.resolveRequest)(context, target, platform);
  };

module.exports = { NOOP_ENTRIES, devtoolsNoopResolver, toNoopRequest };
