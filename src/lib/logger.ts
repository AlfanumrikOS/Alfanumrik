/**
 * ALFANUMRIK — Structured Logging
 *
 * Production-grade logging with:
 * - JSON structured output for log aggregation
 * - Request ID correlation across middleware → API → edge functions
 * - Log levels: debug, info, warn, error
 * - Automatic metadata (timestamp, environment, version)
 * - Safe serialization (no circular refs, PII redaction)
 *
 * Usage:
 *   import { logger } from '@/lib/logger';
 *   logger.info('Quiz submitted', { studentId, score, duration });
 *   logger.error('AI response failed', { error, studentId });
 */

import { captureException, captureMessage } from '@sentry/nextjs';
import { redactPII } from '@/lib/ops-events-redactor';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  environment: string;
  version: string;
  requestId?: string;
  [key: string]: unknown;
}

function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LEVEL = process.env.NODE_ENV === 'production' ? 'info' : 'debug';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[MIN_LEVEL];
}

function createEntry(
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>,
): LogEntry {
  const entry: LogEntry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version || '2.0.0',
  };

  if (meta) {
    const safe = redactPII(meta) as Record<string, unknown>;
    Object.assign(entry, safe);
  }

  return entry;
}

function emit(entry: LogEntry): void {
  const output = safeStringify(entry);

  switch (entry.level) {
    case 'error':
      console.error(output);
      break;
    case 'warn':
      console.warn(output);
      break;
    case 'debug':
      console.debug(output);
      break;
    default:
      console.log(output);
  }
}

export const logger = {
  debug(message: string, meta?: Record<string, unknown>): void {
    if (!shouldLog('debug')) return;
    emit(createEntry('debug', message, meta));
  },

  info(message: string, meta?: Record<string, unknown>): void {
    if (!shouldLog('info')) return;
    emit(createEntry('info', message, meta));
  },

  warn(message: string, meta?: Record<string, unknown>): void {
    if (!shouldLog('warn')) return;
    emit(createEntry('warn', message, meta));
  },

  error(message: string, meta?: Record<string, unknown>): void {
    if (!shouldLog('error')) return;

    // Capture to Sentry for centralized error aggregation.
    // Wrapped in try-catch so a Sentry failure never breaks the logger itself.
    try {
      const originalError = meta?.error instanceof Error ? meta.error : undefined;
      if (originalError) {
        captureException(originalError, {
          extra: { ...meta, logMessage: message },
        });
      } else {
        captureMessage(message, {
          level: 'error',
          extra: meta,
        });
      }
    } catch {
      // Sentry failed — don't break the logger
    }

    // Extract error details if an Error object is passed
    if (meta?.error instanceof Error) {
      meta = {
        ...meta,
        error: {
          name: meta.error.name,
          message: meta.error.message,
          stack: meta.error.stack?.split('\n').slice(0, 5).join('\n'),
        },
      };
    }

    emit(createEntry('error', message, meta));
  },

  /** Create a child logger with pre-set context (e.g., requestId) */
  child(context: Record<string, unknown>) {
    return {
      debug: (msg: string, meta?: Record<string, unknown>) =>
        logger.debug(msg, { ...context, ...meta }),
      info: (msg: string, meta?: Record<string, unknown>) =>
        logger.info(msg, { ...context, ...meta }),
      warn: (msg: string, meta?: Record<string, unknown>) =>
        logger.warn(msg, { ...context, ...meta }),
      error: (msg: string, meta?: Record<string, unknown>) =>
        logger.error(msg, { ...context, ...meta }),
    };
  },
};
