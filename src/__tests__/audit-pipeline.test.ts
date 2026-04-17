import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks (vi.mock factories are hoisted, so refs must be too) ──
const {
  mockInsert,
  mockSingle,
  mockEq,
  mockSelect,
  mockFrom,
  mockSupabaseAdmin,
  mockLoggerError,
} = vi.hoisted(() => {
  const mockInsert = vi.fn().mockResolvedValue({ data: null, error: null });
  const mockSingle = vi.fn().mockResolvedValue({ data: { id: 'row-1' }, error: null });
  const mockEq = vi.fn().mockReturnValue({ single: mockSingle });
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
  const mockFrom = vi.fn().mockReturnValue({
    insert: mockInsert,
    select: mockSelect,
  });
  const mockSupabaseAdmin = { from: mockFrom };
  const mockLoggerError = vi.fn();
  return { mockInsert, mockSingle, mockEq, mockSelect, mockFrom, mockSupabaseAdmin, mockLoggerError };
});

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: vi.fn(() => mockSupabaseAdmin),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: mockLoggerError,
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Import after mocks ──
import {
  computeChainHash,
  writeAuditEvent,
  captureBeforeSnapshot,
  createAuditEventWithSnapshot,
  _resetChainHash,
  _getLastChainHash,
  type ChainHashInput,
  type AuditEventInput,
} from '@/lib/audit-pipeline';

describe('Audit Pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetChainHash();
    mockInsert.mockResolvedValue({ data: null, error: null });
  });

  // ── computeChainHash ──

  describe('computeChainHash', () => {
    const baseInput: ChainHashInput = {
      previousHash: 'GENESIS',
      eventId: 'evt-001',
      eventType: 'permission_check',
      actorUserId: 'user-123',
      action: 'evaluate',
      result: 'granted',
      createdAt: '2026-04-17T10:00:00.000Z',
    };

    it('should return a deterministic 64-char hex string', () => {
      const hash1 = computeChainHash(baseInput);
      const hash2 = computeChainHash(baseInput);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should produce different hashes for different inputs', () => {
      const hash1 = computeChainHash(baseInput);
      const hash2 = computeChainHash({ ...baseInput, eventId: 'evt-002' });
      const hash3 = computeChainHash({ ...baseInput, result: 'denied' });
      const hash4 = computeChainHash({ ...baseInput, actorUserId: 'user-999' });

      expect(hash1).not.toBe(hash2);
      expect(hash1).not.toBe(hash3);
      expect(hash1).not.toBe(hash4);
    });

    it('should handle null actorUserId by using "null" string', () => {
      const hashWithNull = computeChainHash({ ...baseInput, actorUserId: null });
      const hashWithString = computeChainHash({ ...baseInput, actorUserId: 'null' });

      // Both should produce the same hash since null is serialized as 'null'
      expect(hashWithNull).toBe(hashWithString);
      expect(hashWithNull).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should use GENESIS as default when previousHash is empty', () => {
      const hashEmpty = computeChainHash({ ...baseInput, previousHash: '' });
      const hashGenesis = computeChainHash({ ...baseInput, previousHash: 'GENESIS' });

      expect(hashEmpty).toBe(hashGenesis);
    });

    it('should chain correctly — different previousHash produces different output', () => {
      const hash1 = computeChainHash(baseInput);
      const hash2 = computeChainHash({ ...baseInput, previousHash: hash1 });

      expect(hash1).not.toBe(hash2);
      expect(hash2).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  // ── writeAuditEvent ──

  describe('writeAuditEvent', () => {
    const baseEvent: AuditEventInput = {
      eventType: 'permission_check',
      actorUserId: 'user-123',
      action: 'evaluate',
      result: 'granted',
      resourceType: 'api_route',
      permissionCode: 'quiz.attempt',
    };

    it('should insert into audit_events with correct fields', async () => {
      await writeAuditEvent(baseEvent);

      expect(mockFrom).toHaveBeenCalledWith('audit_events');
      expect(mockInsert).toHaveBeenCalledTimes(1);

      const insertedRow = mockInsert.mock.calls[0][0];
      expect(insertedRow).toMatchObject({
        event_type: 'permission_check',
        actor_user_id: 'user-123',
        action: 'evaluate',
        result: 'granted',
        resource_type: 'api_route',
        permission_code: 'quiz.attempt',
      });
      // Chain hash should be a 64-char hex
      expect(insertedRow.chain_hash).toMatch(/^[a-f0-9]{64}$/);
      // event_id should be a UUID
      expect(insertedRow.event_id).toBeDefined();
      expect(typeof insertedRow.event_id).toBe('string');
      // created_at should be an ISO string
      expect(insertedRow.created_at).toBeDefined();
    });

    it('should update the internal chain hash after writing', async () => {
      expect(_getLastChainHash()).toBe('GENESIS');

      await writeAuditEvent(baseEvent);

      const afterFirst = _getLastChainHash();
      expect(afterFirst).not.toBe('GENESIS');
      expect(afterFirst).toMatch(/^[a-f0-9]{64}$/);

      await writeAuditEvent({ ...baseEvent, action: 'read' });

      const afterSecond = _getLastChainHash();
      expect(afterSecond).not.toBe(afterFirst);
      expect(afterSecond).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should not throw on insert failure', async () => {
      mockInsert.mockRejectedValueOnce(new Error('DB connection failed'));

      // This should NOT throw
      await expect(writeAuditEvent(baseEvent)).resolves.toBeUndefined();

      // Should have logged the error
      expect(mockLoggerError).toHaveBeenCalledWith(
        'audit_pipeline_write_failed',
        expect.objectContaining({
          eventType: 'permission_check',
          action: 'evaluate',
        }),
      );
    });

    it('should handle null optional fields gracefully', async () => {
      await writeAuditEvent({
        eventType: 'cache_invalidation',
        actorUserId: null,
        action: 'revoke',
        result: 'granted',
        resourceType: 'permission_cache',
      });

      expect(mockInsert).toHaveBeenCalledTimes(1);
      const insertedRow = mockInsert.mock.calls[0][0];
      expect(insertedRow.actor_user_id).toBeNull();
      expect(insertedRow.effective_user_id).toBeNull();
      expect(insertedRow.school_id).toBeNull();
      expect(insertedRow.permission_code).toBeNull();
      expect(insertedRow.resource_id).toBeNull();
      expect(insertedRow.ip_address).toBeNull();
      expect(insertedRow.user_agent).toBeNull();
      expect(insertedRow.session_id).toBeNull();
      expect(insertedRow.request_id).toBeNull();
      expect(insertedRow.metadata).toBeNull();
    });

    it('should pass through all optional fields when provided', async () => {
      await writeAuditEvent({
        eventType: 'data_access',
        actorUserId: 'user-1',
        effectiveUserId: 'user-2',
        schoolId: 'school-1',
        permissionCode: 'report.view_own',
        resourceType: 'student_report',
        resourceId: 'report-42',
        action: 'read',
        result: 'granted',
        resolutionTrace: { steps: ['cache_miss', 'db_lookup'] },
        beforeSnapshot: { status: 'draft' },
        afterSnapshot: { status: 'viewed' },
        ipAddress: '10.0.0.1',
        userAgent: 'Mozilla/5.0',
        sessionId: 'sess-abc',
        requestId: 'req-xyz',
        metadata: { source: 'parent_portal' },
      });

      const row = mockInsert.mock.calls[0][0];
      expect(row.effective_user_id).toBe('user-2');
      expect(row.school_id).toBe('school-1');
      expect(row.resource_id).toBe('report-42');
      expect(row.resolution_trace).toEqual({ steps: ['cache_miss', 'db_lookup'] });
      expect(row.before_snapshot).toEqual({ status: 'draft' });
      expect(row.after_snapshot).toEqual({ status: 'viewed' });
      expect(row.ip_address).toBe('10.0.0.1');
      expect(row.user_agent).toBe('Mozilla/5.0');
      expect(row.session_id).toBe('sess-abc');
      expect(row.request_id).toBe('req-xyz');
      expect(row.metadata).toEqual({ source: 'parent_portal' });
    });
  });

  // ── captureBeforeSnapshot ──

  describe('captureBeforeSnapshot', () => {
    it('should query the database for the current row state', async () => {
      const snapshot = await captureBeforeSnapshot('students', 'stu-1');

      expect(mockFrom).toHaveBeenCalledWith('students');
      expect(mockSelect).toHaveBeenCalledWith('*');
      expect(snapshot.table).toBe('students');
      expect(snapshot.resourceId).toBe('stu-1');
      expect(snapshot.capturedAt).toBeDefined();
    });

    it('should pass specific fields when provided', async () => {
      await captureBeforeSnapshot('students', 'stu-1', ['name', 'grade', 'plan']);

      expect(mockSelect).toHaveBeenCalledWith('name, grade, plan');
    });

    it('should return null data on query error', async () => {
      mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'Not found' } });

      const snapshot = await captureBeforeSnapshot('students', 'nonexistent');

      expect(snapshot.data).toBeNull();
      expect(snapshot.table).toBe('students');
    });

    it('should return null data on exception', async () => {
      mockFrom.mockImplementationOnce(() => { throw new Error('DB down'); });

      const snapshot = await captureBeforeSnapshot('students', 'stu-1');

      expect(snapshot.data).toBeNull();
    });
  });

  // ── createAuditEventWithSnapshot ──

  describe('createAuditEventWithSnapshot', () => {
    it('should compose audit event with before/after snapshots', () => {
      const snapshot: import('@/lib/audit-pipeline').SnapshotCapture = {
        table: 'students',
        resourceId: 'stu-1',
        capturedAt: '2026-04-17T10:00:00.000Z',
        data: { plan: 'free', status: 'active' },
      };

      const after = { plan: 'pro', status: 'active' };

      const event = createAuditEventWithSnapshot(snapshot, after, {
        eventType: 'role_change',
        actorUserId: 'admin-1',
        action: 'write',
        result: 'granted',
        resourceType: 'student',
        resourceId: 'stu-1',
      });

      expect(event.beforeSnapshot).toEqual({ plan: 'free', status: 'active' });
      expect(event.afterSnapshot).toEqual({ plan: 'pro', status: 'active' });
      expect(event.eventType).toBe('role_change');
      expect(event.resourceId).toBe('stu-1');
    });

    it('should handle null snapshot data', () => {
      const snapshot: import('@/lib/audit-pipeline').SnapshotCapture = {
        table: 'students',
        resourceId: 'stu-1',
        capturedAt: '2026-04-17T10:00:00.000Z',
        data: null,
      };

      const event = createAuditEventWithSnapshot(snapshot, null, {
        eventType: 'data_access',
        action: 'read',
        result: 'error',
        resourceType: 'student',
      });

      expect(event.beforeSnapshot).toBeNull();
      expect(event.afterSnapshot).toBeNull();
    });
  });
});
