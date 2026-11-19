/**
 * @format
 */

// Bật thu nhật ký TRƯỚC khi cây React render. Import ES chạy theo đúng thứ tự viết, nên dòng này
// đứng đầu thì request sớm nhất của app cũng vào nhật ký (xem JSDoc `startCapture`).
import './src/devtools/capture';

import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
