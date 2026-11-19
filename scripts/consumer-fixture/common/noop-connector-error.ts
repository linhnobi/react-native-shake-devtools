// Consumer fixture (scripts/check-consumer.mjs). An app that type-checks against a no-op entry
// (for example through a `paths` alias in a production tsconfig) and uses the class name as a
// type, as it can with the real entry.
import { ConnectorError } from 'react-native-shake-devtools/noop';
import { ConnectorError as PlainConnectorError } from 'react-native-shake-devtools/noop/plain';

export let lastError: ConnectorError | undefined;
export const remember = (e: unknown): void => {
  if (e instanceof ConnectorError) lastError = e;
};
export const plainError: PlainConnectorError = new PlainConnectorError('auth', 'expired', {
  status: 401,
});
