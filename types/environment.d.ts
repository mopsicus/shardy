// @ts-nocheck

export {};

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      ENV: 'development' | 'production';

      SERVICE_NAME: string;
      SERVICE_HOST: string;
      SERVICE_PORT: number;
      SERVICE_TRANSPORT: 'tcp' | 'websocket';

      PULSE_LIMIT: number;
      PULSE_INTERVAL: number;

      REQUEST_TIMEOUT: number;

      LOGS_DIR: string;
    }
  }
}
