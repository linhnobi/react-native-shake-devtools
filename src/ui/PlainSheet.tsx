import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useDevToolsT } from '../i18n/use-devtools-t';
import { useDevToolsUi } from './context';
import type { SheetProps } from './sheet-kit';
import { SheetHeader, sheetStylesOf } from './SheetHeader';
import { useSheetBackHandler } from './use-sheet-back-handler';
import { useSheetStatusBar } from './use-sheet-status-bar';
import { useSheetKeyboard } from './use-sheet-keyboard';
import { useStyles, useTheme } from './use-styles';

const NO_INSETS = { top: 0, bottom: 0, left: 0, right: 0 } as const;

/** Thời lượng trượt lên / xuống. Ngắn hơn khi đóng — người đã bấm đóng thì không muốn chờ. */
const OPEN_MS = 250;
const CLOSE_MS = 200;
/** Kéo xuống ít hơn chừng này (dp) thì chưa coi là kéo — chạm nút trong header vẫn là chạm. */
const DRAG_SLOP = 6;
/** Kéo quá chừng này (dp) — hoặc quá ¼ chiều cao sheet nếu sheet thấp hơn — rồi nhả là đóng. */
const DRAG_CLOSE_DISTANCE = 120;
/** Hất xuống nhanh hơn chừng này (dp/ms) là đóng, dù chưa kéo đủ xa. */
const DRAG_CLOSE_VELOCITY = 0.5;

/** ⚠️ Hằng module-scope — `useStyles` nhớ theo tham chiếu factory. */
const plainStylesOf = () => ({
  /** Phủ khít view cha của `DevToolsGate` và đứng trên mọi anh em của nó. */
  overlay: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
  },
  sheet: { position: 'absolute' as const, left: 0, right: 0, overflow: 'hidden' as const },
  /** Cùng trần với `maxDynamicContentSize` (94% màn) của bản gorhom. */
  dynamic: { maxHeight: '94%' as const },
  /** `view` trong sheet `dynamic`: nội dung dài hơn trần thì co lại, chân sheet vẫn thấy. */
  viewContent: { flexShrink: 1 },
});

/**
 * **Chức năng:** quyết định khi **nhả tay** sau cú kéo thanh kéo/header xuống: đóng sheet hay bật
 * về chỗ cũ. Hàm thuần để test được (cử chỉ thật không giả lập được trong jest).
 *
 * **Input:** `dy` (dp đã kéo xuống) · `vy` (dp/ms, dương = xuống) · `sheetHeight` (dp).
 * **Output:** `true` ⇒ đóng.
 *
 * @example
 * ```ts
 * shouldCloseOnRelease(130, 0, 600); // true — kéo quá 120
 * shouldCloseOnRelease(40, 0, 120);  // true — sheet thấp: quá ¼ chiều cao là đủ
 * // Ca biên: kéo ngắn nhưng hất mạnh (vy 0.8) ⇒ vẫn đóng.
 * ```
 *
 * **Unit test:** `PlainSheet.test.tsx` › `shouldCloseOnRelease` — 4 case.
 */
export const shouldCloseOnRelease = (dy: number, vy: number, sheetHeight: number): boolean => {
  if (dy <= 0) return false;
  if (vy > DRAG_CLOSE_VELOCITY) return true;
  return dy > Math.min(DRAG_CLOSE_DISTANCE, sheetHeight / 4);
};

/**
 * **Chức năng:** `SheetKit.Sheet` của entry `./plain` — cùng props và cùng hành vi với `Sheet`
 * (gorhom) ở những chỗ panel dựa vào, nhưng chỉ dùng React Native lõi: `Animated` (native driver)
 * để trượt, `PanResponder` để kéo đóng, sự kiện `Keyboard` để né bàn phím, `BackHandler` để nghe
 * Back. Không cần gorhom, `@gorhom/portal`, `react-native-gesture-handler`, và **không** cần
 * `BottomSheetModalProvider` / `GestureHandlerRootView` ở gốc app.
 *
 * 🔴 Không dùng `<Modal>` của RN: `<Modal>` tạo window riêng mà FLAG_SECURE của app không phủ. Sheet
 * này là một lớp phủ `absoluteFill` vẽ **ngay chỗ `DevToolsGate` đứng**, cùng window với app. Hệ quả:
 * gate phải đứng ở gốc, phủ toàn màn (view cha của nó là toàn màn). Gate nằm trong một khung nhỏ hơn
 * thì sheet chỉ phủ khung đó.
 *
 * ## Khác bản gorhom
 *
 * | | gorhom (`.`) | thuần (`./plain`) |
 * |---|---|---|
 * | Kéo để đóng | cả sheet, có nấc | chỉ vùng thanh kéo + header; nhả quá ngưỡng là đóng, không nấc |
 * | `dynamic` | đo nội dung, hoạt ảnh tới nấc | `maxHeight: 94%`, ôm nội dung |
 * | Bàn phím | `useAnimatedKeyboard`, mượt | `Keyboard` events — Android **nhảy** sau khi bàn phím mở xong |
 * | Header/footer | gorhom render như kiểu component ⇒ phải giữ phần tử ổn định | con thường; vẫn nên giữ ổn định (cùng call-site với bản gorhom) |
 *
 * Bàn phím: xem {@link useSheetKeyboard}. Đệm bằng cách nâng đáy sheet (`bottom`), nên sheet
 * `fullScreenSafe` co lại — danh sách ngắn đi, chân sheet nằm ngay trên bàn phím. Bàn phím đang hiện
 * ⇒ khoảng chừa đáy của chân bỏ inset (cùng luật `FooterInset` của bản gorhom).
 *
 * **Input:** {@link SheetProps}. **Output:** lớp phủ (nền + sheet); `visible=false` và đã trượt xong
 * ⇒ không render gì.
 *
 * @example
 * ```tsx
 * <PlainSheet visible={open} onDismiss={() => setOpen(false)} title="Công cụ" leftAction={close}>
 *   <Rows />
 * </PlainSheet>
 * // Ca biên: `visible=false` bằng code ⇒ trượt xuống rồi gỡ khỏi cây, KHÔNG gọi `onDismiss`.
 * ```
 *
 * **Unit test:** `PlainSheet.test.tsx` › `PlainSheet` — 12 case: `visible=false` không vẽ gì ·
 * `true` hiện nội dung + tiêu đề + dòng phụ + thanh kéo · bấm slot trái/phải · chạm nền ⇒
 * `onDismiss` đúng một lần · Back ⇒ `onDismiss`, đóng rồi Back không còn bị giữ · đóng bằng code
 * gỡ khỏi cây sau hoạt ảnh, không gọi `onDismiss`, mở lại được · `onClosed` một lần sau khi rời cây,
 * không bắn khi bị lượt mở cắt ngang · `fullScreenSafe` chừa status bar ·
 * chân + chừa inset đáy · khoảng chừa đáy ≥ lề trên của chân · bàn phím hiện (iOS) ⇒ nâng sheet và
 * bỏ inset đáy · Android `adjustResize` ⇒ không nâng.
 */
export const PlainSheet = ({
  visible,
  onDismiss,
  onClosed,
  title,
  description,
  leftAction,
  rightAction,
  size = 'dynamic',
  contentMode = 'view',
  footer,
  testID,
  children,
}: SheetProps) => {
  const theme = useTheme();
  const t = useDevToolsT();
  const { androidKeyboardInputMode } = useDevToolsUi();
  const styles = useStyles(sheetStylesOf);
  const plain = useStyles(plainStylesOf);
  const insets = useContext(SafeAreaInsetsContext) ?? NO_INSETS;
  const { height: windowHeight } = useWindowDimensions();
  const keyboard = useSheetKeyboard(visible, androidKeyboardInputMode, insets.bottom);

  /* Còn trong cây khi đang hiện hoặc đang trượt xuống; trượt xong mới gỡ. */
  const [mounted, setMounted] = useState(visible);
  /* Chiều cao thật của sheet (đo bằng `onLayout`) — quãng trượt. Trước lần đo đầu: cao màn. */
  const [sheetHeight, setSheetHeight] = useState(windowHeight);
  /* 0 = đóng hẳn, 1 = mở hẳn. Nền mờ theo nó, sheet trượt theo nó. */
  const progress = useRef(new Animated.Value(0)).current;
  /* Quãng ngón tay đang kéo xuống (dp, ≥ 0). */
  const drag = useRef(new Animated.Value(0)).current;

  /* Cùng hai cờ với bản gorhom: `onDismiss` chỉ bắn khi `visible` còn `true`, nên đóng bằng code
     không bắn, và nhiều đường đóng cùng lúc (nền · Back · kéo) chỉ bắn một lần. */
  const visibleRef = useRef(visible);
  const requestDismiss = useCallback(() => {
    if (!visibleRef.current) return;
    visibleRef.current = false;
    onDismiss();
  }, [onDismiss]);

  useEffect(() => {
    visibleRef.current = visible;
    if (visible) {
      setMounted(true);
      drag.setValue(0);
      Animated.timing(progress, {
        toValue: 1,
        duration: OPEN_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      return;
    }
    Animated.timing(progress, {
      toValue: 0,
      duration: CLOSE_MS,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      /* Bị một lượt mở cắt ngang ⇒ `finished=false` (hoặc `visible` đã lại `true`): giữ nguyên. */
      if (finished && !visibleRef.current) setMounted(false);
    });
  }, [visible, progress, drag]);

  useSheetBackHandler(visible, requestDismiss);
  useSheetStatusBar(visible);

  /* Báo `onClosed` SAU lượt commit gỡ sheet khỏi cây, không ngay trong callback hoạt ảnh: người nghe
     (vd chụp lại màn của app cho bug report) cần cây đã hết lớp phủ. */
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;
  const wasMounted = useRef(mounted);
  useEffect(() => {
    if (wasMounted.current && !mounted) onClosedRef.current?.();
    wasMounted.current = mounted;
  }, [mounted]);

  const onSheetLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0) setSheetHeight((prev) => (prev === h ? prev : h));
  }, []);

  const springBack = useCallback(() => {
    Animated.spring(drag, { toValue: 0, bounciness: 0, useNativeDriver: true }).start();
  }, [drag]);

  /*
    Kéo đóng chỉ gắn vào vùng thanh kéo + header: gắn lên cả sheet thì tranh cú cuộn dọc với danh
    sách bên trong. Xin quyền ở pha **move** (không phải start) nên chạm một nút trong header vẫn là
    chạm; chỉ khi ngón tay đi xuống rõ ràng thì sheet mới giành lấy cử chỉ.
  */
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => g.dy > DRAG_SLOP && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_e, g) => drag.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_e, g) => {
          if (shouldCloseOnRelease(g.dy, g.vy, sheetHeight)) requestDismiss();
          else springBack();
        },
        onPanResponderTerminate: springBack,
      }),
    [drag, sheetHeight, requestDismiss, springBack],
  );

  const translateY = useMemo(
    () =>
      Animated.add(
        progress.interpolate({ inputRange: [0, 1], outputRange: [sheetHeight, 0] }),
        drag,
      ),
    [progress, drag, sheetHeight],
  );

  if (!mounted) return null;

  const sub = (suffix: string) => (testID ? `${testID}-${suffix}` : undefined);
  const fullScreen = size === 'fullScreenSafe';
  /* Lề dưới tối thiểu = lề trên của chân (`styles.footer.paddingTop`); không có chân thì 0. */
  const footerInset = Math.max(keyboard.shown ? 0 : insets.bottom, footer ? theme.spacing.sm : 0);

  return (
    <View style={plain.overlay} pointerEvents="box-none" testID={sub('overlay')}>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: theme.colors.background.overlay, opacity: progress },
        ]}
      >
        <Pressable
          testID={sub('backdrop')}
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel={t('a11y.closeSheet')}
          onPress={requestDismiss}
        />
      </Animated.View>

      <Animated.View
        testID={sub('sheet')}
        accessibilityViewIsModal
        accessibilityLabel={title || t('a11y.sheet')}
        onLayout={onSheetLayout}
        style={[
          styles.sheet,
          plain.sheet,
          fullScreen ? { top: insets.top } : plain.dynamic,
          { bottom: keyboard.padding, transform: [{ translateY }] },
        ]}
      >
        <View testID={sub('handle-area')} {...pan.panHandlers}>
          <View
            testID={sub('handle')}
            style={styles.handle}
            accessible
            accessibilityLabel={t('a11y.sheetHandle')}
          >
            <View style={styles.indicator} />
          </View>
          <SheetHeader
            testID={sub('header')}
            title={title}
            description={description}
            leftAction={leftAction}
            rightAction={rightAction}
          />
        </View>

        <View
          testID={contentMode === 'scrollable' ? undefined : testID}
          style={contentMode === 'scroll' ? styles.scrollContent : plain.viewContent}
        >
          {children}
        </View>

        <View testID={sub('footer')} style={footer ? styles.footer : undefined}>
          {footer}
          <View testID={sub('footer-inset')} style={{ height: footerInset }} />
        </View>
      </Animated.View>
    </View>
  );
};
