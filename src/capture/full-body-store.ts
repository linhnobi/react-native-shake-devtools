import type { NetworkEntry } from './log-entry';
import { truncate } from './redact';

/** Trần một thân **đầy đủ** — đủ cho mọi response danh sách thật đã gặp, chặn ca tải file nhầm. */
export const FULL_BODY_LIMIT = 256_000;
/** Số request **gần nhất** được giữ thân đầy đủ. */
export const FULL_BODY_RECENT = 20;
/** Số request **lỗi** (HTTP ≥ 400) được giữ thêm, kể cả khi đã trôi khỏi nhóm gần nhất. */
export const FULL_BODY_ERRORS = 20;

export type BodySide = 'request' | 'response';

/** Một thân đầy đủ. `truncated` = vượt cả {@link FULL_BODY_LIMIT} (vẫn bị cắt, nhưng ở trần cao). */
export interface FullBody {
  text: string;
  truncated: boolean;
}

export interface FullBodyStore {
  /** Ghi thân thô của request `id`. Chỉ gọi khi thân **đã vượt** hạn mức của vòng đệm. */
  put: (id: number, side: BodySide, raw: string) => void;
  /** Đánh dấu request `id` là lỗi ⇒ được giữ ở nhóm lỗi. */
  markError: (id: number) => void;
  get: (id: number, side: BodySide) => FullBody | undefined;
  clear: () => void;
}

/**
 * **Chức năng:** kho thân **đầy đủ** đứng cạnh vòng đệm — vòng đệm chỉ giữ 4 KB mỗi thân (300 dòng
 * × 2 thân), kho này giữ bản tới {@link FULL_BODY_LIMIT} cho **20 request gần nhất** và **20 request
 * lỗi** gần nhất. Màn chi tiết + nút chép đọc ở đây trước, rơi về bản 4 KB khi không có.
 *
 * ## Vì sao không nâng hạn mức của vòng đệm
 *
 * Nâng chung lên 64 KB là ~38 MB trường hợp xấu nhất (300 dòng × 2 thân), cho những dòng không ai
 * mở. Thứ người ta mở là request **vừa xảy ra** hoặc request **lỗi** — đúng hai nhóm kho này giữ.
 * Trường hợp xấu nhất: 40 request × 2 thân × 256 KB ≈ 20 MB, và chỉ ở bản không phải prod.
 *
 * 🔴 Ghi **thô** như vòng đệm (che là việc của chỗ hiển thị/xuất — xem `redact.ts`), và **không**
 * lưu xuống đĩa: phiên trước chỉ có bản 4 KB.
 *
 * **Input:** không. **Output:** {@link FullBodyStore}.
 *
 * @example
 * ```ts
 * const store = createFullBodyStore();
 * store.put(7, 'response', bigJson);
 * store.get(7, 'response');   // { text: bigJson, truncated: false }
 * store.get(8, 'response');   // undefined — ca biên: thân nhỏ không bao giờ vào kho
 * ```
 *
 * **Unit test:** `full-body-store.test.ts` › `createFullBodyStore` — 5 case: ghi rồi đọc lại đúng
 * mặt · quá {@link FULL_BODY_RECENT} request ⇒ request cũ nhất bị bỏ · request lỗi sống sót khi
 * trôi khỏi nhóm gần nhất · vượt {@link FULL_BODY_LIMIT} ⇒ cắt + `truncated` · `clear` xoá hết.
 */
export const createFullBodyStore = (): FullBodyStore => {
  const bodies = new Map<number, Partial<Record<BodySide, FullBody>>>();
  const recent: number[] = [];
  const errors: number[] = [];

  const evict = (id: number) => {
    if (!recent.includes(id) && !errors.includes(id)) bodies.delete(id);
  };

  return {
    put: (id, side, raw) => {
      const cut = truncate(raw, FULL_BODY_LIMIT);
      if (cut.text === undefined) return;
      bodies.set(id, { ...bodies.get(id), [side]: { text: cut.text, truncated: cut.truncated } });
      if (!recent.includes(id)) {
        recent.push(id);
        if (recent.length > FULL_BODY_RECENT) evict(recent.shift() as number);
      }
    },
    markError: (id) => {
      if (!bodies.has(id) || errors.includes(id)) return;
      errors.push(id);
      if (errors.length > FULL_BODY_ERRORS) evict(errors.shift() as number);
    },
    get: (id, side) => bodies.get(id)?.[side],
    clear: () => {
      bodies.clear();
      recent.length = 0;
      errors.length = 0;
    },
  };
};

/** Kho dùng chung của tầng thu — `network-tap` ghi, màn chi tiết đọc, nút Xoá nhật ký dọn. */
export const fullBodies = createFullBodyStore();

/**
 * **Chức năng:** bản của dòng mạng với thân **đầy đủ** nếu kho còn giữ — chỗ hiển thị, nút chép và
 * cURL đi qua đây để không ai phải nhớ "đọc kho trước, rơi về vòng đệm sau".
 *
 * **Input:** `entry` của vòng đệm · `store` (mặc định kho dùng chung, tham số để test ghim).
 * **Output:** cùng object khi kho không có gì cho dòng này (giữ tham chiếu cho `useMemo`); object
 * mới với `requestBody`/`responseBody` + cờ `*Truncated` lấy từ kho khi có.
 *
 * @example
 * ```ts
 * withFullBodies(entry);   // { ...entry, responseBody: '<256 KB>', responseTruncated: false }
 * withFullBodies(small);   // small — ca biên: thân nhỏ, trả nguyên tham chiếu
 * ```
 *
 * **Unit test:** `full-body-store.test.ts` › `withFullBodies` — 2 case: kho có ⇒ thay thân + cờ ·
 * kho không có ⇒ trả **cùng** tham chiếu.
 */
export const withFullBodies = (entry: NetworkEntry, store: FullBodyStore = fullBodies): NetworkEntry => {
  const request = store.get(entry.id, 'request');
  const response = store.get(entry.id, 'response');
  if (!request && !response) return entry;
  return {
    ...entry,
    ...(request ? { requestBody: request.text, requestTruncated: request.truncated } : {}),
    ...(response ? { responseBody: response.text, responseTruncated: response.truncated } : {}),
  };
};
