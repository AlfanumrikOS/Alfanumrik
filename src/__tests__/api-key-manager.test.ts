import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';

// ── Hoisted mocks ──
const {
  mockInsert,
  mockSingle,
  mockSelect,
  mockEq,
  mockUpdate,
  mockOrder,
  mockFrom,
  mockSupabaseAdmin,
  mockLoggerError,
  mockWriteAuditEvent,
} = vi.hoisted(() => {
  const mockSingle = vi.fn().mockResolvedValue({ data: { id: 'key-1' }, error: null });
  const mockOrder = vi.fn().mockResolvedValue({ data: [], error: null });

  // Build a chainable query builder that supports .eq().eq().single(), .eq().order(), etc.
  // Also thenable so fire-and-forget .then().catch() patterns work.
  const mockEq: any = vi.fn();
  const queryResult = {
    single: mockSingle,
    eq: mockEq,
    order: mockOrder,
    // Support .then().catch() patterns for fire-and-forget PostgREST builders
    then: (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve),
    catch: (fn: any) => Promise.resolve().catch(fn),
  };
  mockEq.mockReturnValue(queryResult);

  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq, single: mockSingle });
  const mockInsert = vi.fn().mockReturnValue({ select: mockSelect });
  const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
  const mockFrom = vi.fn().mockReturnValue({
    insert: mockInsert,
    select: mockSelect,
    update: mockUpdate,
  });
  const mockSupabaseAdmin = { from: mockFrom };
  const mockLoggerError = vi.fn();
  const mockWriteAuditEvent = vi.fn().mockResolvedValue(undefined);
  return {
    mockInsert, mockSingle, mockSelect, mockEq, mockUpdate, mockOrder,
    mockFrom, mockSupabaseAdmin, mockLoggerError, mockWriteAuditEvent,
  };
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

vi.mock('@/lib/audit-pipeline', () => ({
  writeAuditEvent: mockWriteAuditEvent,
}));

// ── Import after mocks ──
import {
  createApiKey,
  validateApiKey,
  revokeApiKey,
  listApiKeys,
} from '@/lib/api-key-manager';

describe('API Key Manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSingle.mockResolvedValue({ data: { id: 'key-1' }, error: null });
    mockOrder.mockResolvedValue({ data: [], error: null });
  });

  // ── createApiKey ──

  describe('createApiKey', () => {
    it('should return raw key with alfnk_ prefix', async () => {
      const result = await createApiKey({
        schoolId: 'school-1',
        name: 'Test Key',
        scopes: ['student.read'],
        createdBy: 'admin-1',
      });

      expect(result.success).toBe(true);
      expect(result.apiKey).toBeDefined();
      expect(result.apiKey!.startsWith('alfnk_')).toBe(true);
      expect(result.keyId).toBe('key-1');
    });

    it('should store hash not raw key in the database', async () => {
      const result = await createApiKey({
        schoolId: 'school-1',
        name: 'Test Key',
        scopes: ['student.read'],
        createdBy: 'admin-1',
      });

      expect(result.success).toBe(true);

      // Verify the insert call contains a hash, not the raw key
      const insertedRow = mockInsert.mock.calls[0][0];
      expect(insertedRow.key_hash).toBeDefined();
      expect(insertedRow.key_hash).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex

      // Verify the hash matches the returned raw key
      const expectedHash = createHash('sha256').update(result.apiKey!).digest('hex');
      expect(insertedRow.key_hash).toBe(expectedHash);
    });
  });

  // ── validateApiKey ──

  describe('validateApiKey', () => {
    it('should validate an active key successfully', async () => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      const validKeyData = {
        id: 'key-1',
        school_id: 'school-1',
        scopes: ['student.read'],
        ip_allowlist: null,
        expires_at: futureDate,
        is_active: true,
      };
      mockSingle.mockResolvedValue({ data: validKeyData, error: null });

      const result = await validateApiKey('alfnk_testkey123');

      expect(result.valid).toBe(true);
      expect(result.schoolId).toBe('school-1');
      expect(result.scopes).toEqual(['student.read']);
      expect(result.keyId).toBe('key-1');
    });

    it('should reject an expired key', async () => {
      const pastDate = new Date(Date.now() - 3600000).toISOString();
      const expiredKeyData = {
        id: 'key-1',
        school_id: 'school-1',
        scopes: ['student.read'],
        ip_allowlist: null,
        expires_at: pastDate,
        is_active: true,
      };
      mockSingle.mockResolvedValue({ data: expiredKeyData, error: null });

      const result = await validateApiKey('alfnk_expired');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('expired');
    });
  });

  // ── revokeApiKey ──

  describe('revokeApiKey', () => {
    it('should deactivate the key and write audit event', async () => {
      await revokeApiKey('key-1');

      expect(mockFrom).toHaveBeenCalledWith('school_api_keys');
      expect(mockUpdate).toHaveBeenCalledWith({ is_active: false });
      expect(mockWriteAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'admin_action',
          action: 'revoke',
          resourceType: 'school_api_key',
          resourceId: 'key-1',
        }),
      );
    });
  });

  // ── listApiKeys ──

  describe('listApiKeys', () => {
    it('should return keys without key_hash field', async () => {
      const mockKeys = [
        {
          id: 'key-1',
          school_id: 'school-1',
          name: 'Key One',
          scopes: ['student.read'],
          created_by: 'admin-1',
          ip_allowlist: null,
          expires_at: null,
          is_active: true,
          created_at: '2026-04-17T00:00:00Z',
          last_used_at: null,
        },
      ];
      mockOrder.mockResolvedValueOnce({ data: mockKeys, error: null });

      const result = await listApiKeys('school-1');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Key One');
      // Verify the SELECT call does not include key_hash
      const selectCall = mockSelect.mock.calls[0]?.[0] as string;
      expect(selectCall).not.toContain('key_hash');
    });
  });
});
