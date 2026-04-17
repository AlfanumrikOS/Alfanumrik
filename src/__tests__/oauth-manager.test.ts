import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ──
const {
  mockInsert,
  mockSingle,
  mockSelect,
  mockIs,
  mockEq,
  mockUpdate,
  mockFrom,
  mockSupabaseAdmin,
  mockLoggerError,
  mockWriteAuditEvent,
} = vi.hoisted(() => {
  const mockSingle = vi.fn().mockResolvedValue({ data: { id: 'app-1' }, error: null });
  const mockIs = vi.fn().mockReturnValue({ single: mockSingle });
  const mockEq = vi.fn().mockReturnValue({ is: mockIs, single: mockSingle });
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
    mockInsert, mockSingle, mockSelect, mockIs, mockEq, mockUpdate,
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

vi.mock('@/lib/rbac', () => ({
  getUserPermissions: vi.fn(),
}));

// ── Import after mocks ──
import {
  registerApp,
  tripleIntersection,
  validateAccessToken,
  revokeAppTokens,
  type RegisterAppInput,
  type ScopeDefinition,
} from '@/lib/oauth-manager';

describe('OAuth Manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSingle.mockResolvedValue({ data: { id: 'app-1' }, error: null });
  });

  const validInput: RegisterAppInput = {
    name: 'Test App',
    developerId: 'dev-123',
    privacyPolicyUrl: 'https://example.com/privacy',
    redirectUris: ['https://example.com/callback'],
    requestedScopes: ['student.read', 'quiz.read'],
  };

  // ── registerApp ──

  describe('registerApp', () => {
    it('should return clientId and clientSecret on success', async () => {
      const result = await registerApp(validInput);

      expect(result.success).toBe(true);
      expect(result.clientId).toBeDefined();
      expect(typeof result.clientId).toBe('string');
      expect(result.clientId!.length).toBe(32); // 16 bytes hex = 32 chars
      expect(result.clientSecret).toBeDefined();
      expect(typeof result.clientSecret).toBe('string');
      expect(result.appId).toBe('app-1');
    });

    it('should reject without privacyPolicyUrl', async () => {
      const result = await registerApp({
        ...validInput,
        privacyPolicyUrl: '',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('privacyPolicyUrl');
    });

    it('should reject without redirectUris', async () => {
      const result = await registerApp({
        ...validInput,
        redirectUris: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('redirectUri');
    });
  });

  // ── tripleIntersection ──

  describe('tripleIntersection', () => {
    const scopeDefinitions: ScopeDefinition[] = [
      { code: 'student.read', permissions_required: ['student.view', 'profile.view_own'] },
      { code: 'quiz.read', permissions_required: ['quiz.view_results'] },
      { code: 'analytics.read', permissions_required: ['class.view_analytics'] },
    ];

    it('should compute correct intersection of 3 overlapping sets', () => {
      const appScopes = ['student.read', 'quiz.read', 'analytics.read'];
      const consentScopes = ['student.read', 'quiz.read'];
      const userPermissions = ['student.view', 'quiz.view_results', 'profile.view_own'];

      const result = tripleIntersection(appScopes, consentScopes, userPermissions, scopeDefinitions);

      // app intersect consent = student.read, quiz.read
      // permissions from those: student.view, profile.view_own, quiz.view_results
      // intersect with userPermissions: student.view, profile.view_own, quiz.view_results
      expect(result.sort()).toEqual(['profile.view_own', 'quiz.view_results', 'student.view']);
    });

    it('should return empty array for disjoint sets', () => {
      const appScopes = ['analytics.read'];
      const consentScopes = ['student.read'];
      const userPermissions = ['quiz.view_results'];

      const result = tripleIntersection(appScopes, consentScopes, userPermissions, scopeDefinitions);

      expect(result).toEqual([]);
    });

    it('should use only app scopes when app has subset of consent', () => {
      const appScopes = ['student.read'];
      const consentScopes = ['student.read', 'quiz.read', 'analytics.read'];
      const userPermissions = ['student.view', 'profile.view_own', 'quiz.view_results', 'class.view_analytics'];

      const result = tripleIntersection(appScopes, consentScopes, userPermissions, scopeDefinitions);

      // Only student.read is in appScopes
      // Permissions: student.view, profile.view_own
      // Both exist in userPermissions
      expect(result.sort()).toEqual(['profile.view_own', 'student.view']);
    });
  });

  // ── validateAccessToken ──

  describe('validateAccessToken', () => {
    it('should return valid result for a valid token', async () => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();
      mockSingle.mockResolvedValueOnce({
        data: {
          app_id: 'app-1',
          user_id: 'user-1',
          school_id: 'school-1',
          scopes: ['student.read'],
          access_token_expires_at: futureDate,
        },
        error: null,
      });

      const result = await validateAccessToken('raw-token-value');

      expect(result.valid).toBe(true);
      expect(result.appId).toBe('app-1');
      expect(result.userId).toBe('user-1');
      expect(result.schoolId).toBe('school-1');
      expect(result.scopes).toEqual(['student.read']);
    });

    it('should return invalid for an expired token', async () => {
      const pastDate = new Date(Date.now() - 3600000).toISOString();
      mockSingle.mockResolvedValueOnce({
        data: {
          app_id: 'app-1',
          user_id: 'user-1',
          school_id: 'school-1',
          scopes: ['student.read'],
          access_token_expires_at: pastDate,
        },
        error: null,
      });

      const result = await validateAccessToken('expired-token');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('expired');
    });
  });
});
