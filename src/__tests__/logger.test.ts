import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Logger Tests — src/lib/logger.ts
 *
 * Tests structured logging with:
 * - PII redaction (P13 compliance)
 * - Log level filtering
 * - Child logger context inheritance
 * - Safe serialization
 * - Error object handling (stack truncation)
 * - Correct console method routing
 */

// We need to control NODE_ENV and mock Sentry before importing logger
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

// ─── PII Redaction ──────────────────────────────────────────

describe('PII redaction', () => {
  let logger: typeof import('@/lib/logger').logger;

  beforeEach(async () => {
    vi.resetModules();
    // Force development mode so all levels log
    vi.stubEnv('NODE_ENV', 'development');
    const mod = await import('@/lib/logger');
    logger = mod.logger;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('redacts password field', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('test', { password: 'secret123' });
    expect(spy).toHaveBeenCalledTimes(1);
    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output.password).toBe('[REDACTED]');
    spy.mockRestore();
  });

  it('redacts email field', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('test', { email: 'user@example.com' });
    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output.email).toBe('[REDACTED]');
    spy.mockRestore();
  });

  it('redacts token field', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('test', { token: 'abc123' });
    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output.token).toBe('[REDACTED]');
    spy.mockRestore();
  });

  it('redacts api_key field', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('test', { api_key: 'sk-abc123' });
    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output.api_key).toBe('[REDACTED]');
    spy.mockRestore();
  });

  it('redacts phone field', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('test', { phone: '+919876543210' });
    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output.phone).toBe('[REDACTED]');
    spy.mockRestore();
  });

  it('redacts authorization field', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('test', { authorization: 'Bearer xyz' });
    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output.authorization).toBe('[REDACTED]');
    spy.mockRestore();
  });

  it('redacts service_role_key field', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('test', { service_role_key: 'eyJsecret' });
    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output.service_role_key).toBe('[REDACTED]');
    spy.mockRestore();
  });

  it('redacts nested PII fields', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('test', {
      user: {
        email: 'user@test.com',
        name: 'Test User',
        password: 'secret',
      },
    });
    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output.user.email).toBe('[REDACTED]');
    expect(output.user.password).toBe('[REDACTED]');
    expect(output.user.name).toBe('Test User'); // non-PII preserved
    spy.mockRestore();
  });

  it('preserves non-PII fields', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('test', { studentId: 'abc', score: 85, grade: '9' });
    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output.studentId).toBe('abc');
    expect(output.score).toBe(85);
    expect(output.grade).toBe('9');
    spy.mockRestore();
  });
});

// ─── Log Level Filtering ────────────────────────────────────

describe('Log level filtering', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('suppresses debug in production mode', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    const { logger } = await import('@/lib/logger');
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    logger.debug('debug message');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('allows info in production mode', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    const { logger } = await import('@/lib/logger');
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('info message');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('allows debug in development mode', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'development');
    const { logger } = await import('@/lib/logger');
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    logger.debug('debug message');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('allows warn in production mode', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    const { logger } = await import('@/lib/logger');
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logger.warn('warning');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('allows error in production mode', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    const { logger } = await import('@/lib/logger');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logger.error('error message');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

// ─── Console Method Routing ─────────────────────────────────

describe('Console method routing', () => {
  let logger: typeof import('@/lib/logger').logger;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'development');
    const mod = await import('@/lib/logger');
    logger = mod.logger;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('routes info to console.log', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('test');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('routes error to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logger.error('test');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('routes warn to console.warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logger.warn('test');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('routes debug to console.debug', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    logger.debug('test');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

// ─── Log Entry Structure ────────────────────────────────────

describe('Log entry structure', () => {
  let logger: typeof import('@/lib/logger').logger;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'development');
    const mod = await import('@/lib/logger');
    logger = mod.logger;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('includes level, message, timestamp, environment', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('test message');
    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output.level).toBe('info');
    expect(output.message).toBe('test message');
    expect(output.timestamp).toBeTruthy();
    expect(output.environment).toBeTruthy();
    spy.mockRestore();
  });

  it('timestamp is valid ISO string', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('test');
    const output = JSON.parse(spy.mock.calls[0][0] as string);
    const parsed = new Date(output.timestamp);
    expect(parsed.getTime()).not.toBeNaN();
    spy.mockRestore();
  });

  it('includes version field', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('test');
    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output.version).toBeTruthy();
    spy.mockRestore();
  });
});

// ─── Child Logger ───────────────────────────────────────────

describe('Child logger', () => {
  let logger: typeof import('@/lib/logger').logger;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'development');
    const mod = await import('@/lib/logger');
    logger = mod.logger;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('inherits parent context in log output', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const child = logger.child({ requestId: 'req-123' });
    child.info('child log');
    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output.requestId).toBe('req-123');
    expect(output.message).toBe('child log');
    spy.mockRestore();
  });

  it('merges child context with per-call meta', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const child = logger.child({ requestId: 'req-456' });
    child.info('test', { action: 'quiz_submit' });
    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output.requestId).toBe('req-456');
    expect(output.action).toBe('quiz_submit');
    spy.mockRestore();
  });

  it('child has all four log methods', () => {
    const child = logger.child({ requestId: 'req-789' });
    expect(typeof child.debug).toBe('function');
    expect(typeof child.info).toBe('function');
    expect(typeof child.warn).toBe('function');
    expect(typeof child.error).toBe('function');
  });

  it('child error routes to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const child = logger.child({ requestId: 'req-err' });
    child.error('child error');
    expect(spy).toHaveBeenCalledTimes(1);
    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output.requestId).toBe('req-err');
    spy.mockRestore();
  });

  it('child redacts PII in inherited context', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // PII in per-call meta should be redacted
    const child = logger.child({ requestId: 'req-pii' });
    child.info('test', { email: 'secret@test.com' });
    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output.email).toBe('[REDACTED]');
    spy.mockRestore();
  });
});

// ─── Error Object Handling ──────────────────────────────────

describe('Error object handling', () => {
  let logger: typeof import('@/lib/logger').logger;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'development');
    const mod = await import('@/lib/logger');
    logger = mod.logger;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('extracts error name and message from Error objects', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('something went wrong');
    logger.error('operation failed', { error: err });
    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output.error.name).toBe('Error');
    expect(output.error.message).toBe('something went wrong');
    spy.mockRestore();
  });

  it('truncates error stack to 5 lines', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('deep stack error');
    logger.error('failed', { error: err });
    const output = JSON.parse(spy.mock.calls[0][0] as string);
    const stackLines = output.error.stack.split('\n');
    expect(stackLines.length).toBeLessThanOrEqual(5);
    spy.mockRestore();
  });
});

// ─── Safe Serialization ─────────────────────────────────────

describe('Safe serialization', () => {
  let logger: typeof import('@/lib/logger').logger;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'development');
    const mod = await import('@/lib/logger');
    logger = mod.logger;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('handles undefined meta gracefully', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(() => logger.info('no meta')).not.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('handles empty object meta', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(() => logger.info('empty meta', {})).not.toThrow();
    spy.mockRestore();
  });

  it('handles numeric and boolean values in meta', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('test', { count: 42, active: true, ratio: 0.75 });
    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output.count).toBe(42);
    expect(output.active).toBe(true);
    expect(output.ratio).toBe(0.75);
    spy.mockRestore();
  });

  it('handles array values in meta', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('test', { tags: ['quiz', 'math'] });
    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output.tags).toEqual(['quiz', 'math']);
    spy.mockRestore();
  });
});
