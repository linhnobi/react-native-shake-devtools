import { useMemo } from 'react';
import { clearPersistedLogs, type DevToolsAction } from 'react-native-shake-devtools/plain';
import { APP_CONTEXT_MODES, type AppContextMode } from './app-context';

interface ExampleActionsInput {
  contextMode: AppContextMode;
  onContextModeChange: (mode: AppContextMode) => void;
}

const isContextMode = (id: string): id is AppContextMode =>
  (APP_CONTEXT_MODES as readonly string[]).includes(id);

const CONTEXT_MODE_LABELS: Record<AppContextMode, string> = {
  normal: 'Normal',
  large: 'Large',
  throws: 'Throws',
  never: 'Never resolves',
};

/**
 * The app's own panel rows, the same shape as `example/src/devtools/use-example-actions.ts`:
 *
 * - a **pick-one** row (chips) choosing what `bugReport.appContext` returns (see
 *   `app-context.ts`), with the same label and choices as the bare example;
 * - a plain row clearing the saved sessions, what a real app calls on logout.
 *
 * Labels are the app's own, already translated strings. The example is English only.
 */
export const useExampleActions = ({
  contextMode,
  onContextModeChange,
}: ExampleActionsInput): DevToolsAction[] =>
  useMemo(
    () => [
      {
        id: 'app-context',
        label: 'App context (example)',
        hint: 'What bugReport.appContext returns. Read once when a draft is created: send or discard the current draft to see a new mode.',
        choices: APP_CONTEXT_MODES.map((mode) => ({ id: mode, label: CONTEXT_MODE_LABELS[mode] })),
        selectedId: contextMode,
        onSelect: (id) => {
          if (isContextMode(id)) onContextModeChange(id);
        },
      },
      {
        id: 'clear-sessions',
        label: 'Clear saved sessions',
        hint: 'What a real app calls on logout',
        onPress: () => {
          clearPersistedLogs().catch(() => undefined);
        },
      },
    ],
    [contextMode, onContextModeChange],
  );
