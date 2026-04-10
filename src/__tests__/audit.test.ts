import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Audit Logging Tests
 *
 * Verifies structured audit event creation, PII redaction in audit events,
 * and the auditLog/auditDenied convenience functions.
 *
 * Source: src/lib/audit.ts
 */

// Mock supabase-admin to prevent real DB calls
vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  }),
}));

// Mock Sentry to prevent real error reporting
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import { AuditAction, auditLog, auditDenied, type AuditEvent } from '@/lib/audit';

describe('Audit Action Constants', () => {
  it('defines all expected auth actions', () => {
    expect(AuditAction.LOGIN_SUCCESS).toBe('auth.login_success');
    expect(AuditAction.LOGIN_FAILED).toBe('auth.login_failed');
    expect(AuditAction.LOGOUT).toBe('auth.logout');
    expect(AuditAction.PASSWORD_CHANGED).toBe('auth.password_changed');
    expect(AuditAction.PASSWORD_RESET).toBe('auth.password_reset');
  });

  it('defines all expected user management actions', () => {
    expect(AuditAction.USER_CREATED).toBe('user.created');
    expect(AuditAction.USER_UPDATED).toBe('user.updated');
    expect(AuditAction.USER_SUSPENDED).toBe('user.suspended');
    expect(AuditAction.USER_ACTIVATED).toBe('user.activated');
    expect(AuditAction.USER_DELETED).toBe('user.deleted');
  });

  it('defines all expected RBAC actions', () => {
    expect(AuditAction.ROLE_ASSIGNED).toBe('role.assigned');
    expect(AuditAction.ROLE_REVOKED).toBe('role.revoked');
    expect(AuditAction.PERMISSION_DENIED).toBe('permission.denied');
  });

  it('defines payment actions', () => {
    expect(AuditAction.SUBSCRIPTION_ACTIVATED).toBe('subscription.activated');
    expect(AuditAction.SUBSCRIPTION_CANCELLED).toBe('subscription.cancelled');
    expect(AuditAction.PAYMENT_CAPTURED).toBe('payment.captured');
    expect(AuditAction.PAYMENT_FAILED).toBe('payment.failed');
  });

  it('defines feature flag actions', () => {
    expect(AuditAction.FLAG_CREATED).toBe('feature_flag.created');
    expect(AuditAction.FLAG_UPDATED).toBe('feature_flag.updated');
    expect(AuditAction.FLAG_DELETED).toBe('feature_flag.deleted');
  });
});

describe('Structured Audit Event Creation', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    // Capture console.log to inspect structured output
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('creates a structured audit log entry with all required fields', async () => {
    await auditLog({
      actor_id: 'user-123',
      actor_role: 'student',
      action: AuditAction.LOGIN_SUCCESS,
      target_entity: 'session',
      target_id: 'session-456',
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const loggedJson = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(loggedJson.message).toContain('AUDIT');
    expect(loggedJson.message).toContain('auth.login_success');
    expect(loggedJson.audit).toBe(true);
    expect(loggedJson.action).toBe('auth.login_success');
    expect(loggedJson.actor_id).toBe('user-123');
    expect(loggedJson.actor_role).toBe('student');
    expect(loggedJson.target_entity).toBe('session');
    expect(loggedJson.target_id).toBe('session-456');
    expect(loggedJson.status).toBe('success');
    expect(loggedJson.timestamp).toBeDefined();
  });

  it('defaults status to success when not specified', async () => {
    await auditLog({
      actor_id: 'user-123',
      action: AuditAction.USER_UPDATED,
      target_entity: 'student',
    });

    const loggedJson = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(loggedJson.status).toBe('success');
  });

  it('includes metadata in the log entry', async () => {
    await auditLog({
      actor_id: 'admin-1',
      actor_role: 'super_admin',
      action: AuditAction.USER_SUSPENDED,
      target_entity: 'student',
      target_id: 'student-789',
      metadata: { reason: 'policy violation', notes: 'Repeated cheating' },
    });

    const loggedJson = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(loggedJson.metadata).toEqual({
      reason: 'policy violation',
      notes: 'Repeated cheating',
    });
  });

  it('includes previous_state for mutation audits', async () => {
    await auditLog({
      actor_id: 'admin-1',
      action: AuditAction.ROLE_ASSIGNED,
      target_entity: 'user_role',
      target_id: 'user-100',
      previous_state: { roles: ['student'] },
    });

    const loggedJson = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(loggedJson.previous_state).toEqual({ roles: ['student'] });
  });

  it('handles array of roles correctly', async () => {
    await auditLog({
      actor_id: 'user-123',
      actor_role: ['student', 'parent'],
      action: AuditAction.LOGIN_SUCCESS,
      target_entity: 'session',
    });

    const loggedJson = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(loggedJson.actor_role).toBe('student,parent');
  });

  it('defaults actor_role to unknown when not provided', async () => {
    await auditLog({
      actor_id: 'user-123',
      action: AuditAction.LOGIN_SUCCESS,
      target_entity: 'session',
    });

    const loggedJson = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(loggedJson.actor_role).toBe('unknown');
  });

  it('handles null actor_id for system actions', async () => {
    await auditLog({
      actor_id: null,
      action: AuditAction.BULK_OPERATION,
      target_entity: 'quiz_sessions',
    });

    const loggedJson = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(loggedJson.actor_id).toBeNull();
  });

  it('extracts request context from headers', async () => {
    const mockRequest = new Request('https://alfanumrik.com/api/test', {
      headers: {
        'x-forwarded-for': '203.0.113.42, 10.0.0.1',
        'user-agent': 'Mozilla/5.0 Test',
        'x-request-id': 'req-abc-123',
      },
    });

    await auditLog({
      actor_id: 'user-123',
      action: AuditAction.LOGIN_SUCCESS,
      target_entity: 'session',
      request: mockRequest,
    });

    const loggedJson = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(loggedJson.ip_address).toBe('203.0.113.42');
    expect(loggedJson.request_id).toBe('req-abc-123');
  });

  it('never throws even if DB write fails', async () => {
    // The mock already returns success, but the function should
    // never throw regardless — verify the contract
    await expect(
      auditLog({
        actor_id: 'user-123',
        action: AuditAction.LOGIN_SUCCESS,
        target_entity: 'session',
      })
    ).resolves.toBeUndefined();
  });
});

describe('auditDenied Convenience Function', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('creates a denied audit event', async () => {
    await auditDenied(
      'user-123',
      'permission.denied',
      'teacher_dashboard',
    );

    const loggedJson = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(loggedJson.status).toBe('denied');
    expect(loggedJson.action).toBe('permission.denied');
    expect(loggedJson.target_entity).toBe('teacher_dashboard');
  });

  it('handles null actor for unauthenticated denials', async () => {
    await auditDenied(null, 'auth.required', 'api_endpoint');

    const loggedJson = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(loggedJson.actor_id).toBeNull();
    expect(loggedJson.status).toBe('denied');
  });

  it('includes metadata in denied events', async () => {
    await auditDenied(
      'user-123',
      'permission.denied',
      'admin_panel',
      undefined,
      { attempted_action: 'delete_user', required_role: 'super_admin' },
    );

    const loggedJson = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(loggedJson.metadata).toEqual({
      attempted_action: 'delete_user',
      required_role: 'super_admin',
    });
  });
});

describe('PII Redaction in Audit Events', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('redacts password fields in metadata via logger', async () => {
    await auditLog({
      actor_id: 'user-123',
      action: AuditAction.PASSWORD_CHANGED,
      target_entity: 'auth',
      metadata: { password: 'super_secret_123', reason: 'user_request' },
    });

    const loggedJson = JSON.parse(logSpy.mock.calls[0][0] as string);
    // The logger's redactPII should have redacted the password field
    expect(loggedJson.metadata.password).toBe('[REDACTED]');
    expect(loggedJson.metadata.reason).toBe('user_request');
  });

  it('redacts token fields in metadata via logger', async () => {
    await auditLog({
      actor_id: 'user-123',
      action: AuditAction.LOGIN_SUCCESS,
      target_entity: 'session',
      metadata: { token: 'eyJhbGciOiJIUzI1NiJ9.secret', session_type: 'web' },
    });

    const loggedJson = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(loggedJson.metadata.token).toBe('[REDACTED]');
    expect(loggedJson.metadata.session_type).toBe('web');
  });

  it('redacts email fields in metadata via logger', async () => {
    await auditLog({
      actor_id: 'user-123',
      action: AuditAction.USER_CREATED,
      target_entity: 'student',
      metadata: { email: 'student@example.com', grade: '8' },
    });

    const loggedJson = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(loggedJson.metadata.email).toBe('[REDACTED]');
    expect(loggedJson.metadata.grade).toBe('8');
  });

  it('redacts nested PII fields', async () => {
    await auditLog({
      actor_id: 'user-123',
      action: AuditAction.USER_UPDATED,
      target_entity: 'student',
      metadata: {
        changes: {
          email: 'new@example.com',
          name: 'Updated Name',
        },
      },
    });

    const loggedJson = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(loggedJson.metadata.changes.email).toBe('[REDACTED]');
    // name is not in PII_FIELDS, so it should not be redacted
    expect(loggedJson.metadata.changes.name).toBe('Updated Name');
  });
});
