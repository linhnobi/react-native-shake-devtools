// Consumer fixture (scripts/check-consumer.mjs). README step 3 for entry `.`:
// GestureHandlerRootView, then SafeAreaProvider, then BottomSheetModalProvider, then DevToolsGate.
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { Text } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Gate } from './gorhom.js';

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <BottomSheetModalProvider>
          <Gate>
            <Text>app</Text>
          </Gate>
        </BottomSheetModalProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
