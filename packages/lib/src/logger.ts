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
 *   import { logger } from '@alfanumrik/lib/logger';
 *   logger.info('Quiz submitted', { studentId, score, duration });
 *   logger.error('AI response failed', { error, studentId });
 */

import { redactPII } from '@alfanumrik/lib/ops-events-redactor';

declare global {
  interface Window {
    /** Installed by apps/host/instrumentation-client.ts: force-loads and
     * initializes the deferred browser Sentry SDK (memoized). */
    __alfSentryReady?: () => Promise<void>;
  }
}

/**
 * Lazy Sentry transport (P10, 2026-08-03). The logger sits in the first-paint
 * client graph (root layout → AuthContext → analytics → logger), so a STATIC
 * `import { captureException } from '@sentry/nextjs'` kept ~10 kB gzipped of
 * @sentry/core in the shared first-load bundle and breached CAP_SHARED_KB
 * (scripts/check-bundle-size.mjs). The dynamic import moves it to an async
 * chunk while preserving behavior:
 *  - SERVER/EDGE: '@sentry/nextjs' is already module-cached at boot
 *    (instrumentation.ts imports it statically), so `import()` resolves
 *    immediately and capture happens one microtask later — Sentry's transport
 *    was always async anyway.
 *  - CLIENT: awaits the deferred-init bridge (instrumentation-client.ts)
 *    first, so an error logged before the idle-time init still initializes
 *    the SDK and is delivered through the P13 beforeSend redaction chain.
 *  - Fail-open, exactly like the try/catch it replaces: a Sentry failure
 *    never breaks the logger.
 */
function withSentry(capture: (sentry: typeof import('@sentry/nextjs')) => void): void {
  const ready =
    typeof window !== 'undefined' && window.__alfSentryReady
      ? window.__alfSentryReady()
      : Promise.resolve();
  ready
    .then(() => import('@sentry/nextjs'))
    .then(capture)
    .catch(() => {
      // Sentry failed — don't break the logger
    });
}

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
      // eslint-disable-next-line no-console
      console.error(output);
      break;
    case 'warn':
      // eslint-disable-next-line no-console
      console.warn(output);
      break;
    case 'debug':
      // eslint-disable-next-line no-console
      console.debug(output);
      break;
    default:
      // eslint-disable-next-line no-console
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

    // Capture to Sentry for centralized error aggregation. Lazy transport
    // (see withSentry above) — payloads are byte-identical to the previous
    // static captureException/captureMessage calls, and failures still never
    // break the logger.
    {
      const originalError = meta?.error instanceof Error ? meta.error : undefined;
      const metaSnapshot = meta ? { ...meta } : undefined;
      if (originalError) {
        withSentry((sentry) => {
          sentry.captureException(originalError, {
            extra: { ...metaSnapshot, logMessage: message },
          });
        });
      } else {
        withSentry((sentry) => {
          sentry.captureMessage(message, {
            level: 'error',
            extra: metaSnapshot,
          });
        });
      }
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
