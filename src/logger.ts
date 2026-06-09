import type { LogLevel } from "./types.js";

type LogContext = Record<string, unknown>;

const levelPriority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50
};

const secretKeyPattern = /(token|authorization|password|secret|cookie|access[_-]?token)/i;

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

export function createLogger(level: LogLevel): Logger {
  return {
    debug: (message, context) => writeLog(level, "debug", message, context),
    info: (message, context) => writeLog(level, "info", message, context),
    warn: (message, context) => writeLog(level, "warn", message, context),
    error: (message, context) => writeLog(level, "error", message, context)
  };
}

function writeLog(
  configuredLevel: LogLevel,
  entryLevel: Exclude<LogLevel, "silent">,
  message: string,
  context: LogContext = {}
): void {
  if (levelPriority[entryLevel] < levelPriority[configuredLevel]) {
    return;
  }

  const entry = {
    timestamp: new Date().toISOString(),
    level: entryLevel,
    message: sanitizeString(message),
    ...sanitizeContext(context)
  };
  const serialized = JSON.stringify(entry);

  if (entryLevel === "error") {
    console.error(serialized);
    return;
  }
  if (entryLevel === "warn") {
    console.warn(serialized);
    return;
  }
  console.log(serialized);
}

function sanitizeContext(context: LogContext): LogContext {
  return sanitizeValue(context) as LogContext;
}

function sanitizeValue(value: unknown, key = ""): unknown {
  if (key && secretKeyPattern.test(key)) {
    return "[redacted]";
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeString(value.message),
      stack: value.stack ? sanitizeString(value.stack) : undefined
    };
  }

  if (typeof value === "string") {
    return sanitizeString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  if (value && typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      sanitized[entryKey] = sanitizeValue(entryValue, entryKey);
    }
    return sanitized;
  }

  return value;
}

function sanitizeString(value: string): string {
  return value
    .replace(/([?&]access_token=)[^&\s]+/gi, "$1[redacted]")
    .replace(/(authorization:\s*bearer\s+)[^\s,;]+/gi, "$1[redacted]")
    .replace(/(authorization:\s*bot\s+)[^\s,;]+/gi, "$1[redacted]")
    .replace(/(bearer\s+)[^\s,;]+/gi, "$1[redacted]")
    .replace(/(cookie:\s*)[^\n\r]+/gi, "$1[redacted]")
    .replace(/([?&](?:token|secret|password)=)[^&\s]+/gi, "$1[redacted]");
}
