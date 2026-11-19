// Consumer fixture (scripts/check-consumer.mjs). README step 3 and the Configuration reference,
// written once against `__ENTRY__`: the script writes one copy per UI entry (`.` as `gorhom.tsx`,
// `./plain` as `plain.tsx`), replacing the placeholder with the entry's import path.
import { useMemo, useState, type ReactNode } from 'react';
import { Platform, Pressable, Text } from 'react-native';
import {
  ConnectorError,
  DevToolsGate,
  DevToolsUiProvider,
  LogSheet,
  defineConnector,
  devtoolsStrings,
  jiraCloudConnector,
  larkConnector,
  slackConnector,
  useDevTools,
  usePreviousSession,
  webhookConnector,
  type BugReport,
  type ConnectorType,
  type ConnectorValues,
  type DeepPartial,
  type DevToolsAction,
  type DevToolsCapturedImage,
  type DevToolsConfig,
  type DevToolsExportFile,
  type DevToolsLocale,
  type DevToolsSecureStore,
  type DevToolsShareFile,
  type DevToolsStrings,
  type SendResult,
} from '__ENTRY__';
import { APP_ENV, APP_VERSION, DEVTOOLS_ENABLED } from '../common/devtools-config.js';

declare const keychain: {
  get(service: string): Promise<{ password: string } | false>;
  set(service: string, user: string, password: string): Promise<boolean>;
  reset(service: string): Promise<void>;
};
declare const viewShot: { captureScreen(o: { format: 'jpg'; quality: number }): Promise<string> };
declare const shareSheet: { open(o: { urls: string[]; message: string }): Promise<void> };
declare const writeCacheFile: (name: string, content: string) => Promise<string>;

export const keychainStore: DevToolsSecureStore = {
  getItem: async (key) => {
    const found = await keychain.get(`devtools:${key}`);
    return found ? found.password : null;
  },
  setItem: async (key, value) => {
    if (!(await keychain.set(`devtools:${key}`, key, value))) throw new Error('refused');
  },
  removeItem: (key) => keychain.reset(`devtools:${key}`),
};

const captureScreen = async (): Promise<DevToolsCapturedImage | null> => ({
  uri: await viewShot.captureScreen({ format: 'jpg', quality: 0.7 }),
  mimeType: 'image/jpeg',
  width: 1080,
  height: 2400,
});

const shareFiles = async (files: readonly DevToolsShareFile[], message: string): Promise<void> => {
  const urls = await Promise.all(
    files.map((f) => (f.uri !== undefined ? f.uri : writeCacheFile(f.name, f.content ?? ''))),
  );
  await shareSheet.open({ urls, message });
};

const exportFile = async (file: DevToolsExportFile): Promise<void> => {
  await shareSheet.open({
    urls: [await writeCacheFile(file.name, file.content)],
    message: file.name,
  });
};

// A custom connector, as `defineConnector` documents it.
interface TeamsValues extends ConnectorValues {
  readonly url?: string;
}
export const teamsConnector: ConnectorType<TeamsValues> = defineConnector<TeamsValues>({
  id: 'teams',
  label: (locale) => (locale === 'vi' ? 'Teams (webhook)' : 'Teams webhook'),
  fields: () => [{ id: 'url', label: 'Webhook URL', kind: 'url', required: true }],
  secretFieldIds: ['url'],
  capabilities: () => ({ image: false, files: false }),
  test: async (_values, secrets, ctx) => {
    const url = secrets['url'];
    if (typeof url !== 'string') {
      throw new ConnectorError('validation', 'URL missing', { field: 'url' });
    }
    const res = await ctx.fetch(url, { method: 'HEAD' });
    if (!res.ok) throw new ConnectorError('network', `HTTP ${res.status}`, { status: res.status });
    return { account: 'Teams' };
  },
  send: async (report: BugReport, _values, secrets, ctx): Promise<SendResult> => {
    const url = secrets['url'];
    if (typeof url !== 'string') throw new ConnectorError('validation', 'URL missing');
    const first = report.files[0]; // noUncheckedIndexedAccess: ReportFile | undefined
    if (first !== undefined) await ctx.uploadPart(first);
    ctx.checkpoint({ posted: true });
    await ctx.fetch(url, { method: 'POST', body: JSON.stringify({ text: report.title }) });
    return {};
  },
});

const STRINGS: DeepPartial<DevToolsStrings> = {};
const englishTitle: string = devtoolsStrings.en === devtoolsStrings.vi ? 'same' : 'different';

export const useAppActions = (locale: DevToolsLocale, onLocale: (l: DevToolsLocale) => void) =>
  useMemo((): DevToolsAction[] => {
    const rows: DevToolsAction[] = [
      {
        id: 'locale',
        label: 'Panel language',
        choices: [
          { id: 'en', label: 'English' },
          { id: 'vi', label: 'Tiếng Việt' },
        ],
        selectedId: locale,
        onSelect: (id) => {
          if (id === 'en' || id === 'vi') onLocale(id);
        },
      },
      { id: 'reset', label: 'Reset onboarding', hint: englishTitle, onPress: () => {}, badge: 2 },
    ];
    if (Platform.OS === 'android') {
      rows.push({ id: 'android', label: 'Android only', dismissOnPress: false, onPress: () => {} });
    }
    return rows;
  }, [locale, onLocale]);

export const buildConfig = (locale: DevToolsLocale): DevToolsConfig => ({
  enabled: DEVTOOLS_ENABLED, // required, no default
  subtitle: `${APP_ENV.toUpperCase()} · ${APP_VERSION}`,
  locale,
  strings: STRINGS,
  colorScheme: 'dark',
  androidKeyboardInputMode: 'adjustResize',
  shake: { threshold: 10 },
  snoozeMinutes: 15,
  showLog: true,
  exportFile,
  sessionInfo: () => ({
    appVersion: APP_VERSION,
    env: APP_ENV,
    os: `${Platform.OS} ${Platform.Version}`,
  }),
  bugReport: {
    captureScreen,
    secureStore: keychainStore,
    shareFiles,
    writeTempFile: writeCacheFile,
    connectorTypes: [
      jiraCloudConnector,
      slackConnector,
      larkConnector,
      webhookConnector,
      teamsConnector,
    ],
    recordVisibleText: false,
  },
});

// @ts-expect-error `enabled` is required
export const missingEnabled: DevToolsConfig = { subtitle: 'x' };

export const OpenButton = () => {
  const { open, isOpen, enabled } = useDevTools();
  if (!enabled) return null;
  return (
    <Pressable onPress={open} disabled={isOpen}>
      <Text>Open devtools</Text>
    </Pressable>
  );
};

export const StandaloneLog = ({ children }: { children?: ReactNode }) => {
  const [visible, setVisible] = useState(false);
  const previous = usePreviousSession();
  return (
    <DevToolsUiProvider locale="en" colorScheme="light" androidKeyboardInputMode="adjustPan">
      {children}
      <LogSheet
        visible={visible}
        onDismiss={() => setVisible(false)}
        subtitle="UAT"
        exportFile={exportFile}
        archive={previous}
      />
    </DevToolsUiProvider>
  );
};

export const Gate = ({ children }: { children: ReactNode }) => {
  const [locale, setLocale] = useState<DevToolsLocale>('en');
  const actions = useAppActions(locale, setLocale);
  const config = useMemo(() => buildConfig(locale), [locale]);
  return (
    <DevToolsGate config={config} actions={actions}>
      {children}
      <OpenButton />
    </DevToolsGate>
  );
};

// @ts-expect-error `actions` is required
export const missingActions = <DevToolsGate config={buildConfig('en')}>{null}</DevToolsGate>;
