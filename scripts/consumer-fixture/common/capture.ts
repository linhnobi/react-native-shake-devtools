// Consumer fixture (scripts/check-consumer.mjs). README step 2, the `startCapture(options)`
// reference and persistence through an app-supplied `LogStore`.
import {
  clearPersistedLogs,
  formatLog,
  logBuffer,
  markScreen,
  markUser,
  previousSession,
  redactBody,
  redactHeaders,
  runUncaptured,
  startCapture,
  toCurl,
  type CaptureOptions,
  type LogEntry,
  type LogStore,
  type LogStoreFile,
  type NetworkEntry,
} from 'react-native-shake-devtools/capture';
import { DEVTOOLS_ENABLED } from './devtools-config.js';

const files = new Map<string, { content: string; modifiedAt: number }>();

export const memoryLogStore: LogStore = {
  list: async (): Promise<readonly LogStoreFile[]> =>
    [...files].map(([name, f]) => ({ name, modifiedAt: f.modifiedAt })),
  read: async (name) => {
    const f = files.get(name);
    if (f === undefined) throw new Error(`missing ${name}`);
    return f.content;
  },
  write: async (name, content) => {
    files.set(name, { content, modifiedAt: Date.now() });
  },
  remove: async (name) => {
    files.delete(name);
  },
};

const options: CaptureOptions = {
  enabled: DEVTOOLS_ENABLED,
  redactKeys: ['customerRef', 'x-session-token'],
  capacity: 500,
  persist: { store: memoryLogStore, ttlHours: 24, build: 'UAT · 1.0.2' },
};

export const stopCapture: () => void = startCapture(options);

// `enabled` is required: leaving it out must be a type error.
// @ts-expect-error enabled is required
startCapture({});

markScreen('Home');
const n: number = markUser();

export const lastNetwork = (): NetworkEntry | undefined => {
  const entries: readonly LogEntry[] = logBuffer.snapshot();
  const net = entries.filter((e): e is NetworkEntry => e.kind === 'network');
  // noUncheckedIndexedAccess: element access is `T | undefined`.
  return net[net.length - 1];
};

export const debugText = (): string => {
  const last = lastNetwork();
  const curl = last ? toCurl(last) : '';
  const headers: Record<string, string> = redactHeaders({ Authorization: 'Bearer x' });
  const body: string | undefined = redactBody('{"password":"x"}');
  return [
    formatLog(logBuffer.snapshot()),
    curl,
    JSON.stringify(headers),
    body ?? '',
    String(n),
  ].join('\n');
};

export const internalPing = (): Promise<Response> =>
  runUncaptured(() =>
    fetch('https://example.invalid', { headers: { 'X-Shake-Devtools': 'internal' } }),
  );

export const onLogout = async (): Promise<void> => {
  await clearPersistedLogs();
  const prev = previousSession.get();
  if (prev !== null) console.log(prev.entries.length, prev.build ?? 'no build');
};
