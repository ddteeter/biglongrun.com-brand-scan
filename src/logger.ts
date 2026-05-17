import pino, { type Logger } from "pino";

const REDACT_PATHS = [
  "anthropicApiKey",
  "firecrawlApiKey",
  "pushoverUserKey",
  "pushoverAppToken",
  "blogApiToken",
  "adminPasswordHash",
  "sessionSecret",
  "password",
  "*.password",
  "headers.authorization",
  "headers.cookie",
  "req.headers.authorization",
  "req.headers.cookie",
];

interface CreateLoggerOptions {
  level: pino.Level;
  write?: (line: string) => void;
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const { write } = options;
  return pino(
    {
      level: options.level,
      redact: { paths: REDACT_PATHS, censor: "[Redacted]" },
      base: null,
    },
    write
      ? {
          write: (msg: string) => {
            write(msg);
          },
        }
      : pino.destination(1)
  );
}
