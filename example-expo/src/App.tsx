import { StatusBar } from 'expo-status-bar';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DevToolsGate } from 'react-native-shake-devtools/plain';
import { type AppContextMode, DEFAULT_APP_CONTEXT_MODE } from './devtools/app-context';
import { buildDevToolsConfig } from './devtools/devtools-config';
import { useExampleActions } from './devtools/use-example-actions';
import { HomeScreen } from './HomeScreen';

/**
 * Root of the Expo example, on the `./plain` entry (`docs/recipes/expo.md` § 2): the sheet is
 * built with React Native core, so neither `@gorhom/bottom-sheet` nor
 * `react-native-gesture-handler` is needed.
 *
 * The `./plain` gate draws its sheet as an overlay where it stands, so it wraps the whole screen,
 * inside a view that fills it. `SafeAreaProvider` lets the sheet keep clear of the status bar and
 * home indicator.
 *
 * The app context mode is state because the panel row **App context (example)** changes it while
 * the panel is open; the config is memoised on it.
 */
export default function App() {
  const [contextMode, setContextMode] = useState<AppContextMode>(DEFAULT_APP_CONTEXT_MODE);
  const config = useMemo(() => buildDevToolsConfig(contextMode), [contextMode]);
  const actions = useExampleActions({ contextMode, onContextModeChange: setContextMode });

  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        <StatusBar style="auto" />
        <DevToolsGate config={config} actions={actions}>
          <HomeScreen />
        </DevToolsGate>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
