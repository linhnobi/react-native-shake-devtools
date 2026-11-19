/**
 * Kiểu dữ liệu của bộ ghi thao tác QA. Tầng `capture` là JS thuần và **không bao giờ** import từ
 * `src/report`, nên các kiểu dùng chung giữa bộ nhận diện nhãn (`fiber-label.ts`) và bộ ghi chạm
 * (Task 3) nằm ở đây.
 */

/** Nhãn của phần tử bị chạm lấy từ đâu — để biết nhãn đáng tin tới mức nào. */
export type LabelSource = 'accessibilityLabel' | 'testID' | 'text' | 'placeholder' | 'none';

/** Loại thao tác đã ghi. */
export type RecordedActionKind = 'tap' | 'long-press' | 'input' | 'back' | 'background' | 'foreground';

/** Một thao tác của QA, ghi lại để đưa vào timeline của bug report. */
export interface RecordedAction {
  /** Thời điểm xảy ra (epoch ms). */
  readonly at: number;
  readonly kind: RecordedActionKind;
  /** Nhãn người đọc hiểu được, đã che dữ liệu cá nhân và cắt ngắn. Vắng ⇒ không biết chạm vào đâu. */
  readonly label?: string;
  readonly source: LabelSource;
}
