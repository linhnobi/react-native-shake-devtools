export interface ThrottledListener {
  /** Bản đã gom nhịp — đưa cho `subscribe` thay cho listener gốc. */
  readonly listener: () => void;
  /** Huỷ lượt gọi đang hẹn (nếu có). Gọi khi huỷ đăng ký, để listener gốc không bị gọi sau đó. */
  readonly cancel: () => void;
}

/**
 * **Chức năng:** gom các lần báo đổi liên tiếp của một store thành **tối đa một lần mỗi `ms`**.
 *
 * ## Vì sao cần
 *
 * Vòng đệm nhật ký báo listener **đồng bộ theo từng dòng**. Một request tạo ba lần báo (lúc gửi,
 * lúc có phản hồi, dòng `http ok` của logger), một loạt `console.log` tạo hàng chục lần. Mỗi lần
 * báo là một lượt render của màn nhật ký — luồng JS bận render liên tục thì cú bấm của người dùng
 * phải xếp hàng chờ.
 *
 * ## Đầu và đuôi đều được gọi
 *
 * - **Đầu:** lần báo đầu tiên sau một quãng yên (≥ `ms`) gọi **ngay** — bấm "Đánh dấu" là thấy mốc
 *   hiện liền, không trễ 250 ms.
 * - **Đuôi:** các lần báo dồn trong cửa sổ gộp thành **một** lần gọi ở cuối cửa sổ — dòng cuối của
 *   một loạt không bao giờ bị rơi.
 *
 * Listener của `useSyncExternalStore` không mang dữ liệu (nó chỉ bảo React "đọc lại snapshot"),
 * nên gộp nhiều lần gọi thành một không làm mất gì.
 *
 * **Input:** `fn` — listener gốc · `ms` — độ dài cửa sổ gộp.
 * **Output:** {@link ThrottledListener}.
 *
 * @example
 * ```ts
 * const t = throttleListener(onChange, 250);
 * t.listener(); // gọi onChange ngay
 * t.listener(); t.listener(); // gộp — onChange gọi MỘT lần nữa sau 250 ms
 * t.cancel();   // ca biên: huỷ đăng ký giữa cửa sổ ⇒ lượt đang hẹn không bao giờ chạy
 * ```
 *
 * **Unit test:** `throttle-listener.test.ts` › `throttleListener` — 4 case: lần đầu gọi ngay ·
 * các lần trong cửa sổ gộp thành một lần ở cuối cửa sổ · sau quãng yên lại gọi ngay · `cancel`
 * bỏ lượt đang hẹn.
 */
export const throttleListener = (
  fn: () => void,
  ms: number,
): ThrottledListener => {
  let last = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const fire = () => {
    timer = undefined;
    last = Date.now();
    fn();
  };

  return {
    listener: () => {
      /* Đã có lượt hẹn ở cuối cửa sổ — lượt đó sẽ đọc dữ liệu mới nhất, không cần hẹn thêm. */
      if (timer !== undefined) return;
      const wait = ms - (Date.now() - last);
      if (wait <= 0) fire();
      else timer = setTimeout(fire, wait);
    },
    cancel: () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
};
