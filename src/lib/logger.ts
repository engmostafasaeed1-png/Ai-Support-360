type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  timestamp: string;
}

function logEntry(level: LogLevel, message: string, context?: Record<string, unknown>) {
  const entry: LogEntry = { level, message, context, timestamp: new Date().toISOString() };
  if (level === 'error') console.error('[ERROR]', entry);
  else if (level === 'warn') console.warn('[WARN]', entry);
  else if (import.meta.env.DEV) console.log(`[${level.toUpperCase()}]`, entry);
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => logEntry('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => logEntry('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => logEntry('warn', message, context),
  error: (message: string, error?: unknown, context?: Record<string, unknown>) => {
    const errorContext = error instanceof Error
      ? { errorMessage: error.message, stack: error.stack, ...context }
      : context;
    logEntry('error', message, errorContext);
  },
};
