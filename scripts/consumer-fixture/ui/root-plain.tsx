// Consumer fixture (scripts/check-consumer.mjs). README step 3 for entry `./plain`: no gorhom,
// no gesture-handler.
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Gate } from './plain.js';

export default function App() {
  return (
    <SafeAreaProvider>
      <Gate>
        <Text>app</Text>
      </Gate>
    </SafeAreaProvider>
  );
}
