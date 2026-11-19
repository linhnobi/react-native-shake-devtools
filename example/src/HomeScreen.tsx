import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  copyText,
  isRunningFromMetro,
  markScreen,
  markUser,
  useDevTools,
} from 'react-native-shake-devtools';
import {
  checkNetwork,
  clockTime,
  consoleBurst,
  consoleLevels,
  get200,
  get404,
  LONG_VIETNAMESE_TEXT,
  manyVietnameseErrors,
  networkError,
  postSecretsUnauthorized,
  postWithSecrets,
  rejectCatchLate,
  rejectUnhandled,
  server500,
  slowRequest,
  throwUncaught,
} from './scenarios';

const SCREENS = ['Home', 'Profile', 'Checkout'] as const;

const palette = {
  light: {
    bg: '#F5F6F8',
    card: '#FFFFFF',
    text: '#111827',
    muted: '#4B5563',
    border: '#D1D5DB',
    primary: '#2563EB',
    onPrimary: '#FFFFFF',
    danger: '#B91C1C',
  },
  dark: {
    bg: '#0B0D12',
    card: '#171A21',
    text: '#F3F4F6',
    muted: '#9CA3AF',
    border: '#374151',
    primary: '#60A5FA',
    onPrimary: '#0B0D12',
    danger: '#F87171',
  },
};

type Colors = typeof palette.light;

/**
 * Màn duy nhất của example: mỗi nút sinh một loại dòng nhật ký, rồi mở panel (lắc máy hoặc nút
 * "Open debug tools") để xem lib hiển thị ra sao.
 *
 * Dòng trạng thái đầu màn nói cú lắc đang thuộc về ai. Chạy JS từ Metro thì dev menu của RN giữ
 * cú lắc, và panel nằm trong dev menu ở dòng "Debug tools". Bản nhúng sẵn JS (release) thì cú lắc
 * mở thẳng panel.
 */
export function HomeScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColorScheme() === 'dark' ? palette.dark : palette.light;
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const devTools = useDevTools();
  const fromMetro = useMemo(() => isRunningFromMetro(), []);
  const [screen, setScreen] = useState<(typeof SCREENS)[number]>('Home');
  const [marks, setMarks] = useState(0);
  const [network, setNetwork] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [coupon, setCoupon] = useState('');
  const [renderBomb, setRenderBomb] = useState(false);

  // Mốc đổi màn: app thật nối `markScreen` vào `onStateChange` của NavigationContainer.
  useEffect(() => {
    markScreen(screen);
  }, [screen]);

  const copyLongText = () => {
    const ok = copyText(LONG_VIETNAMESE_TEXT);
    setCopied(
      ok
        ? `${clockTime()} · copied ${LONG_VIETNAMESE_TEXT.length} characters`
        : `${clockTime()} · clipboard unavailable`,
    );
  };

  const runNetworkCheck = () => {
    setNetwork('checking…');
    checkNetwork().then(setNetwork);
  };

  return (
    <ScrollView
      style={styles.screen}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 },
      ]}
    >
      <Text style={styles.title}>Shake Devtools example</Text>
      <Text style={styles.status} testID="shake-owner">
        {fromMetro
          ? 'JS from Metro: shaking opens the React Native dev menu. Pick "Debug tools" there, or tap the button below. Build a release (npm run android:release / ios:release) to test shake → panel.'
          : 'Embedded JS bundle: shake the phone to open the panel.'}
      </Text>

      <Btn
        styles={styles}
        primary
        label="Open debug tools"
        onPress={devTools.open}
        disabled={!devTools.enabled || devTools.isOpen}
      />

      <Section styles={styles} title="Console">
        <Btn
          styles={styles}
          label="log · info · warn · error"
          onPress={consoleLevels}
        />
        <Btn
          styles={styles}
          label="60 log lines"
          hint="Scroll, search (try “burst 42”), pause"
          onPress={() => consoleBurst()}
        />
      </Section>

      <Section styles={styles} title="Network">
        <Btn styles={styles} label="GET 200" onPress={get200} />
        <Btn styles={styles} label="GET 404" onPress={get404} />
        <Btn styles={styles} label="GET 500" onPress={server500} />
        <Btn
          styles={styles}
          label="Slow request (4 s)"
          hint="“Slow ≥3s” chip"
          onPress={slowRequest}
        />
        <Btn
          styles={styles}
          label="POST with secrets"
          hint="Authorization + password must show <redacted>"
          onPress={postWithSecrets}
        />
        <Btn
          styles={styles}
          label="POST with secrets → 401"
          hint="Failed, so it reaches Copy for AI, errors.txt and the report. Token in query, header and base64 body (with =): all <redacted>"
          onPress={postSecretsUnauthorized}
        />
        <Btn
          styles={styles}
          label="Network error"
          hint="Unresolvable host"
          onPress={networkError}
        />
      </Section>

      <Section styles={styles} title="Screen markers">
        <View style={styles.chips}>
          {SCREENS.map(name => (
            <Pressable
              key={name}
              accessibilityRole="button"
              accessibilityState={{ selected: name === screen }}
              onPress={() => setScreen(name)}
              style={[styles.chip, name === screen && styles.chipActive]}
            >
              <Text
                style={[
                  styles.chipText,
                  name === screen && styles.chipTextActive,
                ]}
              >
                {name}
              </Text>
            </Pressable>
          ))}
        </View>
        <Btn
          styles={styles}
          label={
            marks === 0
              ? 'Drop a user mark ⚑'
              : `Drop a user mark ⚑ (last: #${marks})`
          }
          onPress={() => setMarks(markUser())}
        />
      </Section>

      <Section styles={styles} title="Promise rejection">
        <Btn
          styles={styles}
          label="Unhandled promise rejection"
          hint="~2 s later: one UNCAUGHT line with a stack. The app keeps running."
          onPress={rejectUnhandled}
        />
        <Btn
          styles={styles}
          label="Rejection caught after 4 s"
          hint="The error line stays; a WARN “handled” line with the same id follows."
          onPress={rejectCatchLate}
        />
      </Section>

      <Section styles={styles} title="Bug report">
        <Text style={styles.note}>
          Panel › “App context (example)” picks what bugReport.appContext
          returns: Normal, Large, Throws or Never resolves. It is read once,
          when you tap Report a bug.
        </Text>
        <TextInput
          accessibilityLabel="Coupon code"
          placeholder="Type here, e.g. typed-secret-123"
          placeholderTextColor={colors.muted}
          value={coupon}
          onChangeText={setCoupon}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
        <Text style={styles.note}>
          The step reads Type in the “Coupon code” field. What you typed must
          not appear in the form, the ticket, its files or Copy for AI.
        </Text>
        <Btn
          styles={styles}
          label="35 errors in Vietnamese"
          hint="The form keeps the last 30 steps; title, Actual and steps come out in Vietnamese"
          onPress={() => manyVietnameseErrors()}
        />
        <Btn
          styles={styles}
          label="Copy 24 KB of Vietnamese text"
          hint={
            copied ??
            'Paste into Expected: a Lark card over 20 KB must be trimmed, not rejected'
          }
          onPress={copyLongText}
        />
        <Btn
          styles={styles}
          label="Check network"
          hint={
            network ??
            'Before and after airplane mode. Not logged, adds no step'
          }
          onPress={runNetworkCheck}
        />
      </Section>

      <Section styles={styles} title="Crash">
        <Btn
          styles={styles}
          danger
          label="Throw uncaught error"
          hint="Release build: the app closes. Reopen it → crash banner + “Previous session”."
          onPress={throwUncaught}
        />
        <Btn
          styles={styles}
          danger
          label="Throw during render"
          hint="No error boundary. Reopen the app: is the error in “Previous session”? (R2, not verified)"
          onPress={() => setRenderBomb(true)}
          disabled={renderBomb}
        />
        {renderBomb ? <RenderBomb /> : null}
      </Section>

      <Section styles={styles} title="Keyboard in a sheet">
        <Text style={styles.note}>
          Open Logs → tap the search field. The field and the list must stay
          above the keyboard, and the sheet must not jump when the keyboard
          closes.
        </Text>
      </Section>
    </ScrollView>
  );
}

/**
 * Ném lỗi **trong lúc render**, không có error boundary nào bọc (khác "Throw uncaught error", ném từ
 * `setTimeout`). Kiểu crash hay gặp nhất ở app thật: một component đọc `undefined.id`.
 *
 * Theo mã nguồn RN 0.86 (`src/private/renderer/errorhandling/ErrorHandlers.js`), lỗi render không ai
 * bắt đi `onUncaughtError` → `ExceptionsManager.handleException(error, true)`, **không** qua handler
 * `ErrorUtils` mà lib móc vào. Phiên trước có giữ được lỗi này không: kiểm trên máy (R2). Chưa kiểm.
 */
function RenderBomb(): ReactNode {
  throw new Error('Example render error');
}

type Styles = ReturnType<typeof makeStyles>;

function Section({
  styles,
  title,
  children,
}: {
  styles: Styles;
  title: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Btn({
  styles,
  label,
  hint,
  onPress,
  primary,
  danger,
  disabled,
}: {
  styles: Styles;
  label: string;
  hint?: string;
  onPress: () => void;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        primary && styles.btnPrimary,
        (pressed || disabled) && styles.btnDimmed,
      ]}
    >
      <Text
        style={[
          styles.btnLabel,
          primary && styles.btnLabelPrimary,
          danger && styles.btnLabelDanger,
        ]}
      >
        {label}
      </Text>
      {hint ? <Text style={styles.btnHint}>{hint}</Text> : null}
    </Pressable>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    content: { paddingHorizontal: 16, gap: 12 },
    title: { fontSize: 24, fontWeight: '700', color: c.text },
    status: { fontSize: 14, lineHeight: 20, color: c.muted },
    section: { gap: 6, marginTop: 8 },
    sectionTitle: {
      fontSize: 13,
      fontWeight: '600',
      color: c.muted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    card: {
      backgroundColor: c.card,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      padding: 8,
      gap: 8,
    },
    btn: {
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      backgroundColor: c.card,
    },
    btnPrimary: { backgroundColor: c.primary, borderColor: c.primary },
    btnDimmed: { opacity: 0.6 },
    btnLabel: { fontSize: 16, fontWeight: '600', color: c.text },
    btnLabelPrimary: { color: c.onPrimary, textAlign: 'center' },
    btnLabelDanger: { color: c.danger },
    btnHint: { fontSize: 13, color: c.muted, marginTop: 2 },
    chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    chip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: c.border,
    },
    chipActive: { backgroundColor: c.primary, borderColor: c.primary },
    chipText: { fontSize: 14, color: c.text },
    chipTextActive: { color: c.onPrimary, fontWeight: '600' },
    note: { fontSize: 14, lineHeight: 20, color: c.muted, padding: 4 },
    input: {
      minHeight: 44,
      paddingHorizontal: 12,
      borderRadius: 8,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border,
      color: c.text,
      fontSize: 16,
    },
  });
