import {
  BottomSheetBackdrop,
  BottomSheetFooter,
  BottomSheetModal,
  BottomSheetView,
  useBottomSheetInternal,
  type BottomSheetBackdropProps,
  type BottomSheetFooterProps,
} from '@gorhom/bottom-sheet';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ComponentRef,
  type ReactNode,
} from 'react';
import { useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { useDevToolsT } from '../i18n/use-devtools-t';
import { DevToolsUiContext, useDevToolsUi, type DevToolsUiValue } from './context';
import { SheetKitContext, type SheetKit, type SheetProps } from './sheet-kit';
import { SheetHeader, sheetStylesOf } from './SheetHeader';
import { useSheetBackHandler } from './use-sheet-back-handler';
import { useSheetStatusBar } from './use-sheet-status-bar';
import { useStyles, useTheme } from './use-styles';

export type { SheetContentMode, SheetProps, SheetSize } from './sheet-kit';

/** Chiều cao tối đa của sheet `dynamic`, theo tỉ lệ màn — chừa dải trên để còn thấy nền phía sau. */
const MAX_DYNAMIC_HEIGHT_RATIO = 0.94;

const NO_INSETS = { top: 0, bottom: 0, left: 0, right: 0 } as const;

/** Giá trị `KEYBOARD_STATUS.SHOWN` của gorhom. Enum đó không được export public. */
const GORHOM_KEYBOARD_SHOWN = 1;

/**
 * Khoảng chừa đáy của chân sheet (home indicator iOS · thanh điều hướng Android), có nền của chân
 * sheet nên nội dung cuộn không lộ ra bên dưới. Cao `max(inset, minHeight)`:
 *
 * - Bàn phím đang hiện ⇒ coi `inset` là 0, vì bàn phím đã phủ vùng đó. Chừa nguyên inset thì thành
 *   một dải trống giữa chân sheet và bàn phím (đo trên Samsung SM-M346B, app edge-to-edge: dải cao
 *   bằng thanh điều hướng). Đây đúng luật gorhom áp cho prop `bottomInset` của `BottomSheetFooter`.
 *   Không dùng thẳng prop đó vì nó đẩy cả chân sheet lên và để trống dải dưới, nội dung cuộn lộ qua đó.
 * - `minHeight` là lề dưới tối thiểu, bằng lề trên của chân sheet. Thiếu nó thì nút của chân dính
 *   sát mép bàn phím, hoặc sát thanh điều hướng ở app không edge-to-edge (inset đáy = 0).
 *
 * Đọc trạng thái bàn phím qua `useBottomSheetInternal` (export public của gorhom, footer của chính
 * gorhom cũng đọc như vậy). gorhom 5.0 lưu trạng thái là một số, các bản sau là `{ status }`, nên
 * hàm nhận cả hai dạng.
 */
const FooterInset = ({
  inset,
  minHeight,
  testID,
}: {
  inset: number;
  minHeight: number;
  testID?: string;
}) => {
  const { animatedKeyboardState } = useBottomSheetInternal();
  const style = useAnimatedStyle(() => {
    const state: unknown = animatedKeyboardState.get();
    const status =
      typeof state === 'number' ? state : (state as { status?: number } | undefined)?.status;
    const effectiveInset = status === GORHOM_KEYBOARD_SHOWN ? 0 : inset;
    return { height: Math.max(effectiveInset, minHeight) };
  }, [inset, minHeight, animatedKeyboardState]);
  return <Animated.View testID={testID} style={style} />;
};

/**
 * `true` khi vùng nội dung của sheet đã chừa sẵn chỗ cho chân ở đáy ({@link ScrollContent}). Vùng
 * cuộn / danh sách của bộ gorhom đọc cờ này để **không** đệm chân lần nữa
 * (`enableFooterMarginAdjustment`). Nội bộ của bộ gorhom, không export ra entry nào.
 */
export const FooterReservedContext = createContext(false);

/**
 * Vùng nội dung của sheet `contentMode="scroll"`: chừa ở đáy đúng chiều cao chân sheet mà gorhom đo
 * được (`animatedLayoutState.footerHeight` — cùng số `enableFooterMarginAdjustment` của gorhom dùng),
 * để khung nhìn của vùng cuộn bên trong **kết thúc ở mép trên của chân**, như bộ `plain` (chân xếp
 * dưới vùng cuộn).
 *
 * Vì sao không đệm `paddingBottom` như cũ: chân của gorhom nằm đè lên đáy vùng nội dung. Đệm chỉ cho
 * nội dung cuộn qua được chân, còn khung nhìn vẫn kéo xuống dưới chân. Android cuộn ô đang focus vào
 * trong **khung nhìn** (lúc chạm ô, và khi bàn phím làm khung co lại), nên ô sát đáy dừng ngay sau
 * chân — đo trên SM-M346B (7/11/2026): ô "Mong đợi" của form báo bug chỉ còn ~30 px, chữ đang gõ bị
 * che. Chừa bằng `marginBottom` thì khung nhìn ngắn lại đúng phần chân, ô luôn nằm trọn trên chân.
 *
 * gorhom chưa đo chân thì giá trị là số âm khởi tạo ⇒ chừa 0.
 */
const ScrollContent = ({
  testID,
  style,
  children,
}: {
  testID?: string;
  style: StyleProp<ViewStyle>;
  children: ReactNode;
}) => {
  const { animatedLayoutState } = useBottomSheetInternal();
  const reserve = useAnimatedStyle(() => {
    const height = (animatedLayoutState.get() as { footerHeight?: unknown } | undefined)
      ?.footerHeight;
    return { marginBottom: typeof height === 'number' && height > 0 ? height : 0 };
  }, [animatedLayoutState]);
  return (
    <Animated.View testID={testID} style={[style, reserve]}>
      <FooterReservedContext.Provider value>{children}</FooterReservedContext.Provider>
    </Animated.View>
  );
};

/**
 * Đưa lại hai context của lib vào trong sheet. `BottomSheetModal` render cả sheet (nội dung · header
 * · chân · nền) qua `@gorhom/portal` ở chỗ `BottomSheetModalProvider` đứng — gốc app, **trên**
 * `DevToolsGate` — nên context đặt giữa provider đó và sheet không tới bên trong. Thiếu cầu này thì
 * `SearchField` · `LogRow` · `LogDetail` (gọi `useSheetKit()` bên trong sheet) ném "missing sheet
 * kit", và mọi thứ trong sheet rơi về theme hệ thống + tiếng Anh. `Sheet` đọc hai giá trị ở ngoài
 * portal (cây của gate) rồi bọc lại từng vùng gorhom vẽ.
 *
 * Context **của app** (navigation, store…) cũng không qua portal — lib không biết chúng; hàng của
 * app nhận dữ liệu qua props của `DevToolsAction`, không đọc context trong sheet.
 */
const PortalBridge = ({
  kit,
  ui,
  children,
}: {
  kit: SheetKit | null;
  ui: DevToolsUiValue | null;
  children: ReactNode;
}) => (
  <SheetKitContext.Provider value={kit}>
    <DevToolsUiContext.Provider value={ui}>{children}</DevToolsUiContext.Provider>
  </SheetKitContext.Provider>
);

/**
 * **Chức năng:** bottom-sheet của entry `.` (`SheetKit.Sheet` của bộ gorhom), dựng trên
 * `BottomSheetModal` của gorhom — đúng phần panel gỡ lỗi cần: header căn giữa (tiêu đề + dòng phụ +
 * nút hai bên) · hai cỡ (`dynamic` · `fullScreenSafe`) · nội dung tĩnh hoặc cuộn · chân sheet cố
 * định · lớp nền chạm để đóng · nút Back của Android đóng sheet. Bản không gorhom của entry
 * `./plain` là `PlainSheet`.
 *
 * 🔴 **Header · footer · backdrop do gorhom render như kiểu component** (`handleComponent` ·
 * `footerComponent` · `backdropComponent`). Hàm vẽ chúng đổi tham chiếu ⇒ gorhom **gỡ ra dựng
 * lại**, nút đang bị ngón tay đè cũng bị gỡ và cú chạm rơi. Vì vậy `leftAction` · `rightAction` ·
 * `footer` phải là phần tử **ổn định** (`useMemo`), và mọi handler bên trong `useCallback`.
 *
 * 🔴 Dùng `BottomSheetModal` (cùng cửa sổ với app), **không** `<Modal>` của RN: `<Modal>` tạo
 * window riêng mà cờ chặn chụp màn hình của app không phủ tới.
 *
 * Bàn phím: không khai gì ở chỗ gọi. `dynamic` ⇒ `interactive`, `fullScreenSafe` ⇒ `extend`; ô nhập
 * trong sheet phải là {@link SearchField}/`BottomSheetTextInput` mới đăng ký được với sheet.
 * `android_keyboardInputMode` lấy từ `DevToolsUiProvider` (`DevToolsConfig.androidKeyboardInputMode`),
 * vì chỉ app biết cửa sổ của nó có co lại khi bàn phím mở hay không. Mặc định `adjustPan`.
 * `contentMode="scroll"` chừa đáy bằng chiều cao chân ({@link ScrollContent}) để ô đang focus sát đáy
 * không nằm dưới chân.
 *
 * Back (Android): gorhom 5.2.14 không tự nghe nút Back, nên sheet tự đăng ký qua
 * `useSheetBackHandler` khi đang `visible` — Back ⇒ `onDismiss`, Back không xuống app.
 *
 * **Điều kiện ở app:** `BottomSheetModalProvider` + `GestureHandlerRootView` ở gốc cây. Không có
 * `SafeAreaProvider` thì inset coi là 0 (không ném).
 *
 * **Input:** {@link SheetProps}. **Output:** sheet; `visible=false` từ đầu ⇒ chưa render gì.
 *
 * @example
 * ```tsx
 * const close = useMemo(() => <Button iconOnly label="Đóng" onPress={onDismiss} … />, [onDismiss]);
 * <Sheet visible={open} onDismiss={() => setOpen(false)} title="Công cụ" leftAction={close}>
 *   <Rows />
 * </Sheet>
 * // Ca biên: `onDismiss` chỉ gọi khi người dùng đóng — `visible=false` bằng code không gọi lại (không vòng lặp).
 * ```
 *
 * **Unit test:** `Sheet.test.tsx` › `Sheet` — 13 case: `visible=false` ⇒ không present · `true` ⇒ hiện
 * nội dung + tiêu đề + dòng phụ + thanh kéo · bấm slot trái/phải gọi handler · vuốt/chạm nền (gorhom
 * báo index −1) ⇒ `onDismiss` đúng một lần · đóng bằng code không gọi `onDismiss`, mở lại được ·
 * `onClosed` bắn một lần khi sheet rời cây (đóng bằng code hay người dùng), chưa mở thì không ·
 * footer + chừa inset đáy + `fullScreenSafe` chừa status bar · `dynamic` dùng nấc theo nội dung ·
 * chế độ bàn phím Android lấy từ provider (vắng ⇒ `adjustPan`) · khoảng chừa đáy không nhỏ hơn lề
 * trên của chân · bàn phím đang hiện ⇒ bỏ inset đáy, chỉ giữ lề · Back của Android ⇒ `onDismiss`
 * đúng một lần và đóng sheet; đóng rồi thì Back không còn bị giữ · nội dung, header, chân đọc
 * được bộ sheet + theme + ngôn ngữ dù gorhom vẽ qua portal (`PortalBridge`). `Sheet — chân sheet và
 * vùng cuộn (gorhom)` — 4 case: `scroll` chừa đáy bằng chân đo được, ScrollView không đệm lần nữa ·
 * danh sách cũng vậy · chân chưa đo (âm) ⇒ chừa 0 · `scrollable` giữ cách cũ.
 */
export const Sheet = ({
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
  /* Đọc ở đây (ngoài portal) để `PortalBridge` đưa lại vào trong sheet. */
  const kit = useContext(SheetKitContext);
  const ui = useContext(DevToolsUiContext);
  const styles = useStyles(sheetStylesOf);
  const insets = useContext(SafeAreaInsetsContext) ?? NO_INSETS;
  const { height: windowHeight } = useWindowDimensions();
  const sheetRef = useRef<ComponentRef<typeof BottomSheetModal>>(null);

  /*
    `visible` (app) ↔ present/close (gorhom), hai cờ ref để vòng này không tự bắn lại chính nó:
    · `presentedRef` — sheet đã được mở bởi lệnh của ta; chưa mở thì `visible=false` không cần `close()`.
    · `visibleRef` — `onDismiss` của app chỉ bắn khi `visible` còn `true` (đóng bằng code không bắn).
    Đóng bằng `close()` chứ không `dismiss()`: `dismiss()` đi qua `forceClose` và có thể kẹt cờ khoá nếu
    hoạt ảnh bị cắt ngang; `close()` + `enableDismissOnClose` vẫn gỡ sheet khỏi stack.
  */
  const visibleRef = useRef(visible);
  const presentedRef = useRef(false);

  useEffect(() => {
    visibleRef.current = visible;
    if (visible) {
      presentedRef.current = true;
      sheetRef.current?.present();
      return;
    }
    if (!presentedRef.current) return;
    presentedRef.current = false;
    sheetRef.current?.close();
  }, [visible]);

  const requestDismiss = useCallback(() => {
    if (!visibleRef.current) return;
    visibleRef.current = false;
    onDismiss();
  }, [onDismiss]);

  /* `onChange(-1)` bị gorhom gác bằng điều kiện của nó và có ca im lặng; `onDismiss` của gorhom bắn
     vô điều kiện khi sheet rời cây. Cần cả hai, và `requestDismiss` chặn bắn đôi. */
  useSheetBackHandler(visible, requestDismiss);
  useSheetStatusBar(visible);

  const handleChange = useCallback(
    (index: number) => {
      if (index >= 0) return;
      presentedRef.current = false;
      requestDismiss();
    },
    [requestDismiss],
  );
  /* `onDismiss` của gorhom = sheet đã rời cây ⇒ cũng là lúc báo `onClosed` (mọi đường đóng). */
  const handleDismissed = useCallback(() => {
    presentedRef.current = false;
    requestDismiss();
    onClosed?.();
  }, [requestDismiss, onClosed]);

  const fullScreen = size === 'fullScreenSafe';
  const snapPoints = useMemo(() => (fullScreen ? ['100%'] : undefined), [fullScreen]);
  const maxDynamicContentSize = fullScreen
    ? undefined
    : Math.round(windowHeight * MAX_DYNAMIC_HEIGHT_RATIO);

  const subTestID = useCallback(
    (suffix: string) => (testID ? `${testID}-${suffix}` : undefined),
    [testID],
  );

  const renderHandle = useCallback(
    () => (
      <View testID={subTestID('handle-area')}>
        <View
          testID={subTestID('handle')}
          style={styles.handle}
          accessible
          accessibilityLabel={t('a11y.sheetHandle')}
        >
          <View style={styles.indicator} />
        </View>
        <PortalBridge kit={kit} ui={ui}>
          <SheetHeader
            testID={subTestID('header')}
            title={title}
            description={description}
            leftAction={leftAction}
            rightAction={rightAction}
          />
        </PortalBridge>
      </View>
    ),
    [styles, t, title, description, leftAction, rightAction, subTestID, kit, ui],
  );

  const renderBackdrop = useCallback(
    (backdropProps: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...backdropProps}
        style={[backdropProps?.style, { backgroundColor: theme.colors.background.overlay }]}
        /* Độ mờ nằm sẵn trong alpha của màu nền; `opacity={1}` để gorhom không nhân thêm lớp thứ hai. */
        opacity={1}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior="close"
        accessibilityLabel={t('a11y.closeSheet')}
      />
    ),
    [theme, t],
  );

  const renderFooter = useCallback(
    (footerProps: BottomSheetFooterProps) => (
      <BottomSheetFooter {...footerProps}>
        <View testID={subTestID('footer')} style={footer ? styles.footer : undefined}>
          <PortalBridge kit={kit} ui={ui}>
            {footer}
          </PortalBridge>
          <FooterInset
            testID={subTestID('footer-inset')}
            inset={insets.bottom}
            /* Lề dưới tối thiểu = lề trên của chân (`styles.footer.paddingTop`); không có chân thì 0. */
            minHeight={footer ? theme.spacing.sm : 0}
          />
        </View>
      </BottomSheetFooter>
    ),
    [styles.footer, footer, insets.bottom, subTestID, theme.spacing.sm, kit, ui],
  );

  return (
    <BottomSheetModal
      ref={sheetRef}
      index={0}
      snapPoints={snapPoints}
      enableDynamicSizing={!fullScreen}
      maxDynamicContentSize={maxDynamicContentSize}
      onChange={handleChange}
      onDismiss={handleDismissed}
      enablePanDownToClose
      enableDismissOnClose
      stackBehavior="push"
      keyboardBehavior={fullScreen ? 'extend' : 'interactive'}
      keyboardBlurBehavior="restore"
      android_keyboardInputMode={androidKeyboardInputMode}
      topInset={fullScreen ? insets.top : undefined}
      backgroundStyle={styles.sheet}
      handleComponent={renderHandle}
      backdropComponent={renderBackdrop}
      footerComponent={renderFooter}
      accessibilityLabel={title || t('a11y.sheet')}
    >
      <PortalBridge kit={kit} ui={ui}>
        {contentMode === 'scrollable' ? (
          /* Vùng cuộn của gorhom phải là con trực tiếp của sheet để `enableDynamicSizing` đo được nó. */
          children
        ) : contentMode === 'scroll' ? (
          <ScrollContent testID={testID} style={styles.scrollContent}>
            {children}
          </ScrollContent>
        ) : (
          <BottomSheetView enableFooterMarginAdjustment testID={testID}>
            {children}
          </BottomSheetView>
        )}
      </PortalBridge>
    </BottomSheetModal>
  );
};
