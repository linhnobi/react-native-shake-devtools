// Start capture BEFORE anything else of the app: ES imports run in the order they are written, so
// this line first means even the earliest request is logged (see the JSDoc of `startCapture`).
import './src/devtools/capture';

import { registerRootComponent } from 'expo';
import App from './src/App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App) and sets the
// environment up the same way in Expo Go and in a native build.
registerRootComponent(App);
