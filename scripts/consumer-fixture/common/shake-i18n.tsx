// Consumer fixture (scripts/check-consumer.mjs). The headless entries: `./shake` (the app's own
// UI on shake) and `./i18n` (string tables, overrides).
import { useCallback, useState } from 'react';
import { Text } from 'react-native';
import {
  DEFAULT_SHAKE_CONFIG,
  SAMPLE_INTERVAL_MS,
  createShakeState,
  resolveShakeConfig,
  stepShake,
  useShake,
  type ShakeConfig,
  type ShakeSample,
  type ShakeState,
  type ShakeStep,
} from 'react-native-shake-devtools/shake';
import {
  devtoolsEn,
  devtoolsStrings,
  devtoolsVi,
  useDevToolsT,
  type DeepPartial,
  type DevToolsKey,
  type DevToolsLocale,
  type DevToolsStrings,
  type TVars,
} from 'react-native-shake-devtools/i18n';

const config: ShakeConfig = resolveShakeConfig({ threshold: 9, cooldownMs: 1500 });

export const ShakeToReport = () => {
  const [count, setCount] = useState(0);
  const onShake = useCallback(() => setCount((c) => c + 1), []);
  const listening: boolean = useShake(onShake, config);
  return <Text>{`${listening ? 'on' : 'off'} ${count}`}</Text>;
};

export const replay = (samples: readonly ShakeSample[]): number => {
  let state: ShakeState = createShakeState();
  let fired = 0;
  for (const sample of samples) {
    const step: ShakeStep = stepShake(state, sample, DEFAULT_SHAKE_CONFIG);
    state = step.state;
    if (step.fired) fired += 1;
  }
  return fired * SAMPLE_INTERVAL_MS;
};

// @ts-expect-error ShakeConfig fields are readonly
DEFAULT_SHAKE_CONFIG.threshold = 1;

export const overrides: DeepPartial<DevToolsStrings> = {};
export const pick = (locale: DevToolsLocale): DevToolsStrings => devtoolsStrings[locale];
export const both: readonly DevToolsStrings[] = [devtoolsVi, devtoolsEn];

export const useLabel = (key: DevToolsKey, vars?: TVars): string => {
  const t = useDevToolsT();
  return t(key, vars);
};
