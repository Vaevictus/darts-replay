// Minimal leveled logger — timestamp + level + tag, controlled by LOG_LEVEL
// (debug|info|warn|error, default info). Deliberately dependency-free; swap for
// pino/winston if structured logging is ever needed.

export type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = ORDER[(process.env.LOG_LEVEL as Level) ?? "info"] ?? ORDER.info;

function emit(level: Level, tag: string, args: unknown[]): void {
  if (ORDER[level] < threshold) return;
  const prefix = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${tag}]`;
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  sink(prefix, ...args);
}

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

/** Create a logger bound to a short tag, e.g. logger("ring"). */
export function logger(tag: string): Logger {
  return {
    debug: (...a) => emit("debug", tag, a),
    info: (...a) => emit("info", tag, a),
    warn: (...a) => emit("warn", tag, a),
    error: (...a) => emit("error", tag, a),
  };
}
