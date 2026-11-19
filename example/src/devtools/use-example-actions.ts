import { useMemo } from 'react';
import { Platform } from 'react-native';
import {
  clearPersistedLogs,
  type DevToolsAction,
  type DevToolsKeyboardInputMode,
  type DevToolsLocale,
} from 'react-native-shake-devtools';
import { sampleTraffic } from '../scenarios';
import { APP_CONTEXT_MODES, type AppContextMode } from './app-context';
import type { ThemeChoice } from './devtools-config';

interface ExampleActionsInput {
  locale: DevToolsLocale;
  onLocaleChange: (locale: DevToolsLocale) => void;
  theme: ThemeChoice;
  onThemeChange: (theme: ThemeChoice) => void;
  keyboardMode: DevToolsKeyboardInputMode;
  onKeyboardModeChange: (mode: DevToolsKeyboardInputMode) => void;
  contextMode: AppContextMode;
  onContextModeChange: (mode: AppContextMode) => void;
}

const LOCALES: readonly DevToolsLocale[] = ['en', 'vi'];
const THEMES: readonly ThemeChoice[] = ['system', 'light', 'dark'];
const KEYBOARD_MODES: readonly DevToolsKeyboardInputMode[] = [
  'adjustPan',
  'adjustResize',
];

const isLocale = (id: string): id is DevToolsLocale =>
  (LOCALES as readonly string[]).includes(id);
const isTheme = (id: string): id is ThemeChoice =>
  (THEMES as readonly string[]).includes(id);
const isKeyboardMode = (id: string): id is DevToolsKeyboardInputMode =>
  (KEYBOARD_MODES as readonly string[]).includes(id);
const isContextMode = (id: string): id is AppContextMode =>
  (APP_CONTEXT_MODES as readonly string[]).includes(id);

const CONTEXT_MODE_LABELS: Record<AppContextMode, string> = {
  normal: 'Normal',
  large: 'Large',
  throws: 'Throws',
  never: 'Never resolves',
};

/**
 * Các hàng của app trong panel, đủ bốn kiểu hàng lib hỗ trợ:
 *
 * - các hàng **chọn-một** (chip): đổi ngôn ngữ, theme và (chỉ Android) chế độ bàn phím của panel
 *   ngay khi panel đang mở, và chọn thứ `bugReport.appContext` trả (xem `app-context.ts`);
 * - một hàng bấm **không đóng** panel (`dismissOnPress: false`): bắn request mẫu rồi nhìn huy hiệu
 *   lỗi của hàng "Logs" tăng tại chỗ;
 * - một hàng bấm thường: xoá các phiên đã lưu, đúng việc app thật gọi lúc đăng xuất.
 *
 * Nhãn là chuỗi đã dịch sẵn của app. Example chỉ có tiếng Anh nên viết thẳng.
 */
export const useExampleActions = ({
  locale,
  onLocaleChange,
  theme,
  onThemeChange,
  keyboardMode,
  onKeyboardModeChange,
  contextMode,
  onContextModeChange,
}: ExampleActionsInput): DevToolsAction[] =>
  useMemo(() => {
    const rows: DevToolsAction[] = [
      {
        id: 'locale',
        label: 'Panel language',
        choices: [
          { id: 'en', label: 'English' },
          { id: 'vi', label: 'Tiếng Việt' },
        ],
        selectedId: locale,
        onSelect: id => {
          if (isLocale(id)) onLocaleChange(id);
        },
      },
      {
        id: 'theme',
        label: 'Panel theme',
        choices: [
          { id: 'system', label: 'System' },
          { id: 'light', label: 'Light' },
          { id: 'dark', label: 'Dark' },
        ],
        selectedId: theme,
        onSelect: id => {
          if (isTheme(id)) onThemeChange(id);
        },
      },
    ];

    if (Platform.OS === 'android') {
      rows.push({
        id: 'keyboard-mode',
        label: 'Keyboard mode (Android)',
        hint: 'Must match how this build’s window reacts to the keyboard. Try it in Logs › search.',
        choices: KEYBOARD_MODES.map(mode => ({ id: mode, label: mode })),
        selectedId: keyboardMode,
        onSelect: id => {
          if (isKeyboardMode(id)) onKeyboardModeChange(id);
        },
      });
    }

    rows.push(
      {
        id: 'app-context',
        label: 'App context (example)',
        hint: 'What bugReport.appContext returns. Read once when a draft is created: send or discard the current draft to see a new mode.',
        choices: APP_CONTEXT_MODES.map(mode => ({
          id: mode,
          label: CONTEXT_MODE_LABELS[mode],
        })),
        selectedId: contextMode,
        onSelect: id => {
          if (isContextMode(id)) onContextModeChange(id);
        },
      },
      {
        id: 'sample-traffic',
        label: 'Fire sample requests',
        hint: '200 · 404 · 500 · POST with secrets · network error',
        onPress: sampleTraffic,
        dismissOnPress: false,
      },
      {
        id: 'clear-sessions',
        label: 'Clear saved sessions',
        hint: 'What a real app calls on logout',
        onPress: () => {
          clearPersistedLogs().catch(() => undefined);
        },
      },
    );
    return rows;
  }, [
    locale,
    onLocaleChange,
    theme,
    onThemeChange,
    keyboardMode,
    onKeyboardModeChange,
    contextMode,
    onContextModeChange,
  ]);
