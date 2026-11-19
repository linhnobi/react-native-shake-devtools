import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { useMemo, useState } from 'react';
import { StatusBar, StyleSheet, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  DevToolsGate,
  type DevToolsKeyboardInputMode,
  type DevToolsLocale,
} from 'react-native-shake-devtools';
import {
  type AppContextMode,
  DEFAULT_APP_CONTEXT_MODE,
} from './devtools/app-context';
import {
  buildDevToolsConfig,
  DEFAULT_KEYBOARD_MODE,
  type ThemeChoice,
} from './devtools/devtools-config';
import { useExampleActions } from './devtools/use-example-actions';
import { HomeScreen } from './HomeScreen';

/**
 * Gốc app example. Thứ tự provider là điều kiện của lib:
 * `GestureHandlerRootView` → `SafeAreaProvider` → `BottomSheetModalProvider` → `DevToolsGate`.
 * Thiếu `BottomSheetModalProvider` thì panel không mở được; thiếu `SafeAreaProvider` thì sheet
 * vẫn chạy nhưng không chừa status bar / home indicator.
 */
export default function App() {
  const [locale, setLocale] = useState<DevToolsLocale>('en');
  const [theme, setTheme] = useState<ThemeChoice>('system');
  const [keyboardMode, setKeyboardMode] = useState<DevToolsKeyboardInputMode>(
    DEFAULT_KEYBOARD_MODE,
  );
  const [contextMode, setContextMode] = useState<AppContextMode>(
    DEFAULT_APP_CONTEXT_MODE,
  );
  const isDark = useColorScheme() === 'dark';

  const config = useMemo(
    () => buildDevToolsConfig(locale, theme, keyboardMode, contextMode),
    [locale, theme, keyboardMode, contextMode],
  );
  const actions = useExampleActions({
    locale,
    onLocaleChange: setLocale,
    theme,
    onThemeChange: setTheme,
    keyboardMode,
    onKeyboardModeChange: setKeyboardMode,
    contextMode,
    onContextModeChange: setContextMode,
  });

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <BottomSheetModalProvider>
          <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
          <DevToolsGate config={config} actions={actions}>
            <HomeScreen />
          </DevToolsGate>
        </BottomSheetModalProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
