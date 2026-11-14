import pino, { type Logger, type LoggerOptions } from "pino";
import type { LoggingConfig } from "./config.js";
import { SERVER_NAME, serverVersion } from "./version.js";

export type { Logger };

/**
 * Flush pending log writes before exit. Resolves within a bounded time so a
 * stalled transport can never block shutdown indefinitely.
 */
export function flushLogger(logger: Logger): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timer = setTimeout(done, 500);
    timer.unref?.();
    try {
      logger.flush?.(done);
    } catch {
      done();
    }
  });
}

/**
 * Create the process-wide logger. All logs are written to stderr so that stdio
 * transport remains a clean JSON-RPC channel on stdout.
 */
export function createLogger(config: LoggingConfig): Logger {
  const base: LoggerOptions = {
    name: SERVER_NAME,
    level: config.level,
    base: { pid: process.pid, version: serverVersion() },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ["config.http.authToken", "token", "authorization", "req.headers.authorization"],
      censor: "[redacted]",
    },
  };

  if (config.format === "pretty") {
    const transport = pino.transport({
      target: "pino-pretty",
      options: {
        destination: 2,
        colorize: true,
        translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
        ignore: "pid,hostname,version",
        singleLine: false,
      },
    });
    return pino(base, transport);
  }

  return pino(base, pino.destination({ dest: 2, sync: false }));
}
