// Consumer fixture (scripts/check-consumer.mjs). One rule for capture and the panel, as the
// README quickstart (step 2) writes it.
declare const appEnv: 'dev' | 'uat' | 'prod';
declare const version: string;

export const APP_ENV = appEnv;
export const APP_VERSION = version;
export const DEVTOOLS_ENABLED: boolean = appEnv !== 'prod';
