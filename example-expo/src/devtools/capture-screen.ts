import { Dimensions, PixelRatio } from 'react-native';
import { captureScreen as viewShot } from 'react-native-view-shot';
import type { DevToolsCapturedImage } from 'react-native-shake-devtools/plain';

/**
 * Screenshot of the app with `react-native-view-shot`, for `bugReport.captureScreen`. The library
 * calls it before the panel covers the screen (shake or `open()`) and on "Retake".
 *
 * JPEG at 0.7 in the app cache (`result: 'tmpfile'`); the library only keeps the `uri`.
 *
 * 🔴 Blocking a screen is the app's rule: return `null` on sensitive screens (PIN, OTP, card
 * number) and the form says the screen cannot be captured. `FLAG_SECURE`
 * (`expo-screen-capture`) does not stop view-shot (measured on Android 14 with the bare example),
 * so such screens must be blocked here too. The example allows every screen.
 *
 * A throw, or more than 1.5 s, shows "couldn't capture" and the panel still opens, so no
 * `try/catch` is needed. Not verified on device.
 */
export const captureScreen = async (): Promise<DevToolsCapturedImage | null> => {
  const uri = await viewShot({ format: 'jpg', quality: 0.7, result: 'tmpfile' });
  const { width, height } = Dimensions.get('window');
  const ratio = PixelRatio.get();
  return {
    uri,
    mimeType: 'image/jpeg',
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  };
};
