// Minimal structured logger (OPS-050.1/.2). No third-party dependency: a
// single JSON line per call, written to stdout, captured by journald per
// reference/systemd's StandardOutput=journal. Aggregation beyond the host
// (OPS-050.6) and log-shipping configuration are reference/monitoring's
// concern, not this module's.

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export function createLogger(serviceName: string): Logger {
  function write(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    // SEC-010.5: callers pass structured fields, never a raw secret value --
    // this module has no way to redact what it isn't given, so the
    // discipline belongs to call sites, same as any logger.
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      service: serviceName,
      message,
      ...fields,
    };
    process.stdout.write(JSON.stringify(entry) + "\n");
  }

  return {
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
  };
}
