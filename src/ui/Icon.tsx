import { View, type ViewStyle } from 'react-native';
import { useTheme } from './use-styles';

/** Tên icon có sẵn. */
export type IconName = 'close' | 'delete' | 'back';

export interface IconProps {
  name: IconName;
  /** Cạnh khung vuông, dp. */
  size: number;
  /** Mặc định `colors.text.primary` của theme. */
  color?: string;
  testID?: string;
}

type Bar = ViewStyle;

/**
 * Vẽ bằng `View` thuần: không phụ thuộc font icon, không emoji, nên hiện giống nhau trên mọi nền
 * tảng và theo `color` đúng từng điểm ảnh. Toạ độ tính theo `size` trong khung vuông.
 */
const barsOf = (name: IconName, size: number, color: string): Bar[] => {
  const stroke = Math.max(1.5, Math.round(size / 10));
  switch (name) {
    case 'close': {
      const length = size * 0.8;
      const base: Bar = {
        position: 'absolute',
        left: (size - length) / 2,
        top: (size - stroke) / 2,
        width: length,
        height: stroke,
        borderRadius: stroke / 2,
        backgroundColor: color,
      };
      return [
        { ...base, transform: [{ rotate: '45deg' }] },
        { ...base, transform: [{ rotate: '-45deg' }] },
      ];
    }
    case 'back': {
      /* Chữ V xoay: hình vuông chỉ hai cạnh (trái + dưới) xoay 45° thành mũi tên trỏ trái. */
      const side = size * 0.5;
      return [
        {
          position: 'absolute',
          left: size * 0.32,
          top: (size - side) / 2,
          width: side,
          height: side,
          borderLeftWidth: stroke,
          borderBottomWidth: stroke,
          borderColor: color,
          transform: [{ rotate: '45deg' }],
        },
      ];
    }
    case 'delete': {
      const bodyWidth = size * 0.56;
      const bodyHeight = size * 0.62;
      const lidWidth = size * 0.78;
      return [
        /* Nắp */
        {
          position: 'absolute',
          left: (size - lidWidth) / 2,
          top: size * 0.2,
          width: lidWidth,
          height: stroke,
          borderRadius: stroke / 2,
          backgroundColor: color,
        },
        /* Quai nắp */
        {
          position: 'absolute',
          left: (size - size * 0.28) / 2,
          top: size * 0.08,
          width: size * 0.28,
          height: size * 0.14,
          borderTopLeftRadius: stroke,
          borderTopRightRadius: stroke,
          borderWidth: stroke,
          borderBottomWidth: 0,
          borderColor: color,
        },
        /* Thân thùng */
        {
          position: 'absolute',
          left: (size - bodyWidth) / 2,
          top: size * 0.2 + stroke * 1.5,
          width: bodyWidth,
          height: bodyHeight,
          borderWidth: stroke,
          borderTopWidth: 0,
          borderBottomLeftRadius: stroke * 1.5,
          borderBottomRightRadius: stroke * 1.5,
          borderColor: color,
        },
      ];
    }
  }
};

/**
 * **Chức năng:** icon của lib — ba hình (`close` ✕ · `delete` thùng rác · `back` mũi tên trái) vẽ
 * bằng `View`, không dependency.
 *
 * **Input:** {@link IconProps}. **Output:** khung `size × size`, ẩn khỏi a11y (nút chứa nó đã có
 * nhãn — để lộ thì screen reader đọc thêm một "hình ảnh" vô nghĩa).
 *
 * @example
 * ```tsx
 * <Icon name="close" size={20} />
 * <Icon name="back" size={16} color="#fff" />
 * // Ca biên: không truyền `color` ⇒ màu chữ chính của theme hiện tại (đổi theo sáng/tối).
 * ```
 *
 * **Unit test:** `Icon.test.tsx` › `Icon` — 3 case: khung đúng `size` · mặc định lấy màu chữ chính
 * của theme · `color` truyền vào được áp cho mọi nét.
 */
export const Icon = ({ name, size, color, testID }: IconProps) => {
  const theme = useTheme();
  const paint = color ?? theme.colors.text.primary;
  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size }}
    >
      {barsOf(name, size, paint).map((style, index) => (
        <View key={index} testID={testID ? `${testID}-bar-${index}` : undefined} style={style} />
      ))}
    </View>
  );
};
