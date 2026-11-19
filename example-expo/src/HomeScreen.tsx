import { Component, useMemo, useState, type ReactNode } from 'react';
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
import { isRunningFromMetro, useDevTools } from 'react-native-shake-devtools/plain';
import {
  failWith500,
  failWithNetworkError,
  getWithFetch,
  getWithXhr,
  isExpoFetch,
  postSecretsUnauthorized,
  postWithSecrets,
  rejectUnhandled,
  warnAndError,
} from './scenarios';

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
 * The only screen of the Expo example: each button produces one kind of log line, then
 * **Open debug tools** (or a shake, in a build that has its JS bundled in) opens the panel.
 *
 * In Expo Go and in a development build the JS comes from Metro, and a shake opens Expo's dev
 * menu, not the panel; the button is the way in there.
 */
export function HomeScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColorScheme() === 'dark' ? palette.dark : palette.light;
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const devTools = useDevTools();
  const fromMetro = useMemo(() => isRunningFromMetro(), []);
  const expoFetch = useMemo(() => isExpoFetch(), []);
  const [result, setResult] = useState('Tap a button, then open the debug tools.');
  const [bomb, setBomb] = useState(false);
  const [boundaryKey, setBoundaryKey] = useState(0);
  const [renderBomb, setRenderBomb] = useState(false);
  const [coupon, setCoupon] = useState('');

  const run = (action: () => string | Promise<string>) => () => {
    Promise.resolve()
      .then(action)
      .then(setResult, (error: unknown) =>
        setResult(`failed: ${error instanceof Error ? error.message : String(error)}`),
      );
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
      <Text style={styles.title}>Shake Devtools · Expo</Text>
      <Text style={styles.status} testID="fetch-kind">
        {expoFetch
          ? 'Global fetch: expo/fetch (Expo built-in marker present).'
          : 'Global fetch: React Native fetch (whatwg on XMLHttpRequest).'}
      </Text>
      <Text style={styles.status} testID="shake-owner">
        {fromMetro
          ? 'JS from Metro (Expo Go or a development build): shaking opens Expo’s dev menu. Use the button below.'
          : 'Embedded JS bundle: shake the phone to open the panel.'}
      </Text>

      <Btn
        styles={styles}
        primary
        label="Open debug tools"
        onPress={devTools.open}
        disabled={!devTools.enabled || devTools.isOpen}
      />
      {!devTools.enabled ? (
        <Text style={styles.status}>
          Devtools are off in this bundle (no-op entries or enabled: false).
        </Text>
      ) : null}

      <Section styles={styles} title="Network">
        <Btn
          styles={styles}
          label="GET with fetch (expo/fetch)"
          hint="Row with status 200; the app still reads the whole body"
          onPress={run(getWithFetch)}
        />
        <Btn
          styles={styles}
          label="GET with XMLHttpRequest"
          hint="Row from the XHR tap"
          onPress={run(getWithXhr)}
        />
        <Btn styles={styles} label="Failing request (HTTP 500)" onPress={run(failWith500)} />
        <Btn
          styles={styles}
          label="Network error"
          hint="Unresolvable host, no status"
          onPress={run(failWithNetworkError)}
        />
        <Btn
          styles={styles}
          label="POST with secrets"
          hint="Authorization + password must show <redacted>"
          onPress={run(postWithSecrets)}
        />
        <Btn
          styles={styles}
          label="POST with secrets → 401"
          hint="Failed, so it reaches Copy for AI, errors.txt and the report. Token in query, header and base64 body (with =): all <redacted>"
          onPress={run(postSecretsUnauthorized)}
        />
      </Section>

      <Section styles={styles} title="Console and errors">
        <Btn styles={styles} label="console.warn + console.error" onPress={run(warnAndError)} />
        <Btn
          styles={styles}
          label="Unhandled promise rejection"
          hint="~2 s later: one UNCAUGHT line with a stack. The app keeps running."
          onPress={run(rejectUnhandled)}
        />
        <Btn
          styles={styles}
          danger
          label="Throw during render (error boundary)"
          hint="Caught by an error boundary on this screen, so the app keeps running. Not a crash."
          onPress={() => setBomb(true)}
          disabled={bomb}
        />
        <DemoBoundary
          key={boundaryKey}
          styles={styles}
          onReset={() => {
            setBomb(false);
            setBoundaryKey((k) => k + 1);
          }}
        >
          {bomb ? <RenderBomb message="Expo example render error" /> : null}
        </DemoBoundary>
      </Section>

      <Section styles={styles} title="Bug report">
        <Text style={styles.note}>
          Panel › “App context (example)” picks what bugReport.appContext returns: Normal, Large,
          Throws or Never resolves. It is read once, when you tap Report a bug.
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
          The step reads Type in the “Coupon code” field. What you typed must not appear in the
          form, the ticket, its files or Copy for AI.
        </Text>
        <Text style={styles.note}>
          Open debug tools › Report a bug. Add a connection of type Webhook and type an HTTPS URL
          you can watch (and an optional header). The URL and header are stored with
          expo-secure-store. Send: the report goes out as multipart/form-data with the
          screenshot, steps and error log.
        </Text>
      </Section>

      <Section styles={styles} title="Crash">
        <Btn
          styles={styles}
          danger
          label="Throw during render"
          hint="No error boundary: the whole app goes down. Release build: the app closes. Reopen it → crash banner + one FATAL row in “Previous session”."
          onPress={() => setRenderBomb(true)}
          disabled={renderBomb}
        />
        {renderBomb ? <RenderBomb message="Expo example uncaught render error" /> : null}
      </Section>

      <Text style={styles.result} testID="last-result">
        {result}
      </Text>
    </ScrollView>
  );
}

/**
 * Throws while rendering: what a bug in a component looks like (a component reading
 * `undefined.id`). Used twice, with different messages so the log tells them apart:
 *
 * - inside `DemoBoundary` (**Throw during render (error boundary)**): React hands the error to
 *   React Native's `onCaughtError`, a non-fatal `ERROR` row, and the app keeps running;
 * - with no error boundary (**Throw during render**): on React Native 0.81+ (React 19) React calls
 *   React Native's `onUncaughtError`, which goes to `ExceptionsManager.handleException(error, true)`
 *   without passing through `ErrorUtils` (RN 0.88 source,
 *   `src/private/renderer/errorhandling/ErrorHandlers.js`). The library wraps that call too, so it
 *   should be one `FATAL` row and a saved session before the release build closes. Not verified on
 *   device.
 */
function RenderBomb({ message }: { message: string }): ReactNode {
  throw new Error(message);
}

interface BoundaryProps {
  styles: Styles;
  onReset: () => void;
  children: ReactNode;
}

/**
 * Keeps a render error local to the demo, so the rest of the app (and the panel) keeps working.
 * React reports the caught error to React Native, which logs it with `console.error`.
 */
class DemoBoundary extends Component<BoundaryProps, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { styles, onReset } = this.props;
    return (
      <View style={styles.caught}>
        <Text style={styles.note}>Caught by an error boundary: {error.message}</Text>
        <Btn styles={styles} label="Reset" onPress={onReset} />
      </View>
    );
  }
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
    caught: { gap: 8, padding: 4 },
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
    result: { fontSize: 14, lineHeight: 20, color: c.text, marginTop: 8 },
  });
