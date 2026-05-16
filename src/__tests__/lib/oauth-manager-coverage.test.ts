/**
 * Coverage closure tests for src/lib/oauth-manager.ts.
 *
 * The pre-existing suite at src/__tests__/oauth-manager.test.ts covers the
 * happy paths of registerApp, tripleIntersection, and validateAccessToken.
 * This file closes the named gap recorded in vitest.config.ts:105-110 —
 * "oauth-manager.ts (71% → push to 90%)" — by exercising every error /
 * exception / branch that the happy-path suite never enters.
 *
 * Branches covered (line numbers refer to src/lib/oauth-manager.ts):
 *   - registerApp requestedScopes validation (lines 74-76)
 *   - registerApp DB insert error path (lines 105-108)
 *   - registerApp try/catch on Supabase throw (lines 126-131)
 *   - registerApp optional fields take defaults (lines 91-99)
 *   - tripleIntersection scope present without scope definition (line 165)
 *   - tripleIntersection empty inputs / disjoint user perms (lines 153-176)
 *   - validateAccessToken token-not-found / null-data path (lines 196-198)
 *   - validateAccessToken try/catch on hash throw (lines 213-218)
 *   - revokeAppTokens entire function (lines 226-256) — was 0% before
 *     - with schoolId branch (line 236-238)
 *     - without schoolId branch (line 236 false)
 *     - try/catch on Supabase throw (lines 251-255)
 *
 * Discipline: no DB, no real Supabase client, no real network. Supabase
 * admin client is mocked via vi.hoisted so the import-order rule is
 * honoured. Pattern matches src/__tests__/lib/feature-flags-coverage.test.ts
 * (PR #767) for stylistic consistency with the Phase 6 coverage chain.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────
// Same pattern as the existing src/__tests__/oauth-manager.test.ts: build
// a query-chain mock so .from('x').insert(...).select(...).single() / etc.
// resolve to whatever the test sets. Each mock is reset per-test via
// vi.clearAllMocks() in beforeEach so state never bleeds across tests.

const {
  mockSingle,
  mockIs,
  mockEq,
  mockSelect,
  mockInsert,
  mockUpdate,
  mockFrom,
  mockSupabaseAdmin,
  mockLoggerError,
  mockWriteAuditEvent,
  mockGetSupabaseAdmin,
} = vi.hoisted(() => {
  const mockSingle = vi.fn();
  const mockIs = vi.fn();
  const mockEq = vi.fn();
  const mockSelect = vi.fn();
  const mockInsert = vi.fn();
  const mockUpdate = vi.fn();
  const mockFrom = vi.fn();
  const mockSupabaseAdmin = { from: mockFrom };
  const mockLoggerError = vi.fn();
  const mockWriteAuditEvent = vi.fn().mockResolvedValue(undefined);
  const mockGetSupabaseAdmin = vi.fn(() => mockSupabaseAdmin);
  return {
    mockSingle,
    mockIs,
    mockEq,
    mockSelect,
    mockInsert,
    mockUpdate,
    mockFrom,
    mockSupabaseAdmin,
    mockLoggerError,
    mockWriteAuditEvent,
    mockGetSupabaseAdmin,
  };
});

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: mockGetSupabaseAdmin,
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

import {
  registerApp,
  tripleIntersection,
  validateAccessToken,
  revokeAppTokens,
  type RegisterAppInput,
  type ScopeDefinition,
} from '@/lib/oauth-manager';

/**
 * Wire the chained-method mocks into a default INSERT happy path:
 *   from('oauth_apps').insert({...}).select('id').single() -> { data, error }
 */
function wireInsertChain(result: { data: { id: string } | null; error: { message: string } | null }): void {
  mockSingle.mockResolvedValue(result);
  mockSelect.mockReturnValue({ single: mockSingle });
  mockInsert.mockReturnValue({ select: mockSelect });
  mockFrom.mockReturnValue({ insert: mockInsert, select: mockSelect, update: mockUpdate });
}

/**
 * Wire the chained-method mocks into a SELECT happy path:
 *   from('oauth_tokens').select(...).eq(...).is(...).single() -> { data, error }
 */
function wireSelectChain(result: { data: unknown; error: { message: string } | null }): void {
  mockSingle.mockResolvedValue(result);
  mockIs.mockReturnValue({ single: mockSingle });
  mockEq.mockReturnValue({ is: mockIs, single: mockSingle });
  mockSelect.mockReturnValue({ eq: mockEq, single: mockSingle });
  mockFrom.mockReturnValue({ select: mockSelect, insert: mockInsert, update: mockUpdate });
}

/**
 * Wire the chained-method mocks into an UPDATE chain for revokeAppTokens:
 *   from('oauth_tokens').update({...}).eq(...).is(...).eq(?)  -> awaited
 *
 * The terminal node is an EQ call (with-school path) or an IS call
 * (no-school path); both must be awaitable thenables. We capture the
 * eq() / is() call counts via the underlying mocks.
 */
function wireUpdateChain(opts: { throwOn?: 'from' | 'update' | 'eq' | 'is' } = {}): void {
  // Make the terminal eq / is calls awaitable by returning a resolved promise-like.
  // The chain is: update(x).eq(appId).is(revoked_at, null) -> awaited
  // OR:          update(x).eq(appId).is(revoked_at, null).eq(schoolId) -> awaited
  const terminalThenable = Promise.resolve({ data: null, error: null });
  if (opts.throwOn === 'is') {
    mockIs.mockImplementation(() => {
      throw new Error('supabase is() blew up');
    });
  } else {
    // is() must be awaitable AND chain to another eq() for the schoolId branch.
    const isResult = Object.assign(terminalThenable, {
      eq: mockEq,
      then: terminalThenable.then.bind(terminalThenable),
    });
    mockIs.mockReturnValue(isResult);
  }
  if (opts.throwOn === 'eq') {
    mockEq.mockImplementation(() => {
      throw new Error('supabase eq() blew up');
    });
  } else {
    const eqResult = Object.assign(terminalThenable, {
      is: mockIs,
      eq: mockEq,
      then: terminalThenable.then.bind(terminalThenable),
    });
    mockEq.mockReturnValue(eqResult);
  }
  if (opts.throwOn === 'update') {
    mockUpdate.mockImplementation(() => {
      throw new Error('supabase update() blew up');
    });
  } else {
    mockUpdate.mockReturnValue({ eq: mockEq });
  }
  if (opts.throwOn === 'from') {
    mockFrom.mockImplementation(() => {
      throw new Error('supabase from() blew up');
    });
  } else {
    mockFrom.mockReturnValue({ update: mockUpdate, select: mockSelect, insert: mockInsert });
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: getSupabaseAdmin returns the stub object.
  mockGetSupabaseAdmin.mockReturnValue(mockSupabaseAdmin);
});

const validInput: RegisterAppInput = {
  name: 'Test App',
  developerId: 'dev-123',
  privacyPolicyUrl: 'https://example.com/privacy',
  redirectUris: ['https://example.com/callback'],
  requestedScopes: ['student.read'],
};

describe('registerApp — input validation (lines 71-76)', () => {
  it('returns error when requestedScopes is empty array', async () => {
    const result = await registerApp({ ...validInput, requestedScopes: [] });
    expect(result.success).toBe(false);
    expect(result.error).toBe('At least one scope is required');
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('returns error when requestedScopes is missing (undefined-cast)', async () => {
    // The function uses `!input.requestedScopes || .length === 0`, so an
    // undefined value (cast through the optional input) hits the same guard.
    const result = await registerApp({
      ...validInput,
      requestedScopes: undefined as unknown as string[],
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('At least one scope is required');
  });
});

describe('registerApp — DB error path (lines 105-108)', () => {
  it('returns the Supabase error message when insert returns error', async () => {
    wireInsertChain({ data: null, error: { message: 'duplicate key value violates unique constraint' } });
    const result = await registerApp(validInput);
    expect(result.success).toBe(false);
    expect(result.error).toBe('duplicate key value violates unique constraint');
    // Logger was called with the structured error (line 106).
    expect(mockLoggerError).toHaveBeenCalledWith(
      'oauth_register_app_failed',
      expect.objectContaining({ error: expect.any(Error) }),
    );
    // Audit event MUST NOT fire on a failed insert.
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });
});

describe('registerApp — exception path (lines 126-131)', () => {
  it('returns a generic internal-error message when getSupabaseAdmin throws', async () => {
    mockGetSupabaseAdmin.mockImplementation(() => {
      throw new Error('supabase client init failed');
    });
    const result = await registerApp(validInput);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Internal error during app registration');
    expect(mockLoggerError).toHaveBeenCalledWith(
      'oauth_register_app_exception',
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });

  it('coerces a non-Error throw into an Error before logging (line 128 String(err) branch)', async () => {
    // The catch wraps non-Error throws in `new Error(String(err))`. We
    // verify that branch fires by throwing a bare string.
    mockGetSupabaseAdmin.mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'plain string failure';
    });
    const result = await registerApp(validInput);
    expect(result.success).toBe(false);
    expect(mockLoggerError).toHaveBeenCalledWith(
      'oauth_register_app_exception',
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });
});

describe('registerApp — optional field defaults (lines 91-99)', () => {
  it('coerces missing optional fields to null / web defaults', async () => {
    wireInsertChain({ data: { id: 'app-2' }, error: null });
    const result = await registerApp(validInput);
    expect(result.success).toBe(true);

    // Inspect the row passed to insert() to confirm the ?? fallback fired
    // for every optional field. This is the only way to assert that the
    // nullish-coalescing branches (lines 91-95, 99) actually ran.
    const insertedRow = mockInsert.mock.calls[0]?.[0];
    expect(insertedRow).toMatchObject({
      description: null,
      developer_org: null,
      logo_url: null,
      homepage_url: null,
      app_type: 'web',
      review_status: 'pending',
    });
  });

  it('preserves explicit optional values when provided', async () => {
    wireInsertChain({ data: { id: 'app-3' }, error: null });
    const result = await registerApp({
      ...validInput,
      description: 'A test',
      developerOrg: 'acme',
      logoUrl: 'https://example.com/logo.png',
      homepageUrl: 'https://example.com',
      appType: 'mobile',
    });
    expect(result.success).toBe(true);
    const insertedRow = mockInsert.mock.calls[0]?.[0];
    expect(insertedRow).toMatchObject({
      description: 'A test',
      developer_org: 'acme',
      logo_url: 'https://example.com/logo.png',
      homepage_url: 'https://example.com',
      app_type: 'mobile',
    });
  });
});

describe('tripleIntersection — edge cases (lines 153-176)', () => {
  const defs: ScopeDefinition[] = [
    { code: 'student.read', permissions_required: ['student.view'] },
    { code: 'quiz.write', permissions_required: ['quiz.create', 'quiz.update'] },
  ];

  it('returns [] when consentScopes is empty (effectiveScopes is empty)', () => {
    const result = tripleIntersection(
      ['student.read'],
      [],
      ['student.view'],
      defs,
    );
    expect(result).toEqual([]);
  });

  it('returns [] when appScopes is empty', () => {
    const result = tripleIntersection(
      [],
      ['student.read'],
      ['student.view'],
      defs,
    );
    expect(result).toEqual([]);
  });

  it('skips an effective scope that has no definition (line 165 false branch)', () => {
    // 'unknown.scope' is in both app + consent, so it survives intersection,
    // but scopeDefMap.get('unknown.scope') returns undefined → the `if (perms)`
    // guard on line 166 takes the false branch and we add nothing.
    const result = tripleIntersection(
      ['unknown.scope', 'student.read'],
      ['unknown.scope', 'student.read'],
      ['student.view'],
      defs,
    );
    expect(result).toEqual(['student.view']);
  });

  it('returns [] when permissions resolve but user has none of them', () => {
    const result = tripleIntersection(
      ['quiz.write'],
      ['quiz.write'],
      ['student.view'], // disjoint with the scope's permissions
      defs,
    );
    expect(result).toEqual([]);
  });

  it('returns all derived permissions when user has them all', () => {
    const result = tripleIntersection(
      ['quiz.write'],
      ['quiz.write'],
      ['quiz.create', 'quiz.update', 'quiz.delete'],
      defs,
    );
    expect(result.sort()).toEqual(['quiz.create', 'quiz.update']);
  });

  it('handles duplicate permissions across multiple scopes (Set dedupes)', () => {
    const dupeDefs: ScopeDefinition[] = [
      { code: 'a', permissions_required: ['perm.x', 'perm.y'] },
      { code: 'b', permissions_required: ['perm.x', 'perm.z'] },
    ];
    const result = tripleIntersection(
      ['a', 'b'],
      ['a', 'b'],
      ['perm.x', 'perm.y', 'perm.z'],
      dupeDefs,
    );
    // perm.x appears in both 'a' and 'b' but the union Set should dedupe it.
    expect(result.sort()).toEqual(['perm.x', 'perm.y', 'perm.z']);
  });
});

describe('validateAccessToken — failure paths (lines 196-198, 213-218)', () => {
  it('returns invalid when token row is not found (data null, error set)', async () => {
    wireSelectChain({ data: null, error: { message: 'no rows returned' } });
    const result = await validateAccessToken('nonexistent-token');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Token not found or revoked');
  });

  it('returns invalid when data is null even without an error object (revoked row filtered by .is(null))', async () => {
    // Path: error is null but data is also null — the `error || !data`
    // short-circuit takes the !data branch.
    wireSelectChain({ data: null, error: null });
    const result = await validateAccessToken('revoked-token');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Token not found or revoked');
  });

  it('returns invalid + "Token validation failed" when getSupabaseAdmin throws', async () => {
    mockGetSupabaseAdmin.mockImplementation(() => {
      throw new Error('supabase init failed');
    });
    const result = await validateAccessToken('any-token');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Token validation failed');
    expect(mockLoggerError).toHaveBeenCalledWith(
      'oauth_validate_token_failed',
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });

  it('coerces non-Error throws in the validate catch (line 215 String(err) branch)', async () => {
    mockGetSupabaseAdmin.mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 42;
    });
    const result = await validateAccessToken('any-token');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Token validation failed');
    expect(mockLoggerError).toHaveBeenCalledWith(
      'oauth_validate_token_failed',
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });

  it('returns invalid for a token expiring exactly now (boundary on line 202 <=)', async () => {
    // The check is `expiresAt <= new Date()`. A timestamp 1ms in the past
    // exercises the <=, and the `valid=false` return on the same line as
    // the expiry message (line 203).
    wireSelectChain({
      data: {
        app_id: 'app-1',
        user_id: 'u-1',
        school_id: 's-1',
        scopes: ['student.read'],
        access_token_expires_at: new Date(Date.now() - 1).toISOString(),
      },
      error: null,
    });
    const result = await validateAccessToken('borderline-token');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Token expired');
  });
});

describe('revokeAppTokens — entire function (lines 226-256)', () => {
  it('revokes tokens for an app without filtering by school (line 236 false branch)', async () => {
    wireUpdateChain();
    await revokeAppTokens('app-xyz');
    // The function awaits the chain on line 240. We assert the audit event
    // was written with schoolId=null (line 249 fallback).
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ revoked_at: expect.any(String) }),
    );
    expect(mockEq).toHaveBeenCalledWith('app_id', 'app-xyz');
    expect(mockIs).toHaveBeenCalledWith('revoked_at', null);
    expect(mockWriteAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'oauth_consent',
        action: 'revoke',
        result: 'granted',
        resourceType: 'oauth_tokens',
        resourceId: 'app-xyz',
        metadata: { schoolId: null },
      }),
    );
  });

  it('scopes the revoke to a school when schoolId is provided (line 236 true branch)', async () => {
    wireUpdateChain();
    await revokeAppTokens('app-xyz', 'school-abc');
    // Both eq() calls fire: one for app_id, one for school_id. The second
    // eq() is the line-237 branch under test.
    expect(mockEq).toHaveBeenCalledWith('app_id', 'app-xyz');
    expect(mockEq).toHaveBeenCalledWith('school_id', 'school-abc');
    expect(mockWriteAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { schoolId: 'school-abc' },
      }),
    );
  });

  it('writes an audit event with actorUserId=null (system-initiated revoke, line 244)', async () => {
    wireUpdateChain();
    await revokeAppTokens('app-xyz');
    const auditCall = mockWriteAuditEvent.mock.calls[0]?.[0];
    expect(auditCall).toMatchObject({ actorUserId: null });
  });

  it('swallows exceptions and logs them (lines 251-255)', async () => {
    // Make the chain throw at .update(...) so we hit the catch.
    wireUpdateChain({ throwOn: 'update' });
    // Should NOT throw to caller.
    await expect(revokeAppTokens('app-zzz')).resolves.toBeUndefined();
    expect(mockLoggerError).toHaveBeenCalledWith(
      'oauth_revoke_tokens_failed',
      expect.objectContaining({ error: expect.any(Error) }),
    );
    // Audit event MUST NOT fire when the revoke failed.
    expect(mockWriteAuditEvent).not.toHaveBeenCalled();
  });

  it('coerces a non-Error throw in the revoke catch (line 253 String(err) branch)', async () => {
    mockGetSupabaseAdmin.mockImplementation(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw { code: 'WEIRD_OBJECT' };
    });
    await expect(revokeAppTokens('app-zzz')).resolves.toBeUndefined();
    expect(mockLoggerError).toHaveBeenCalledWith(
      'oauth_revoke_tokens_failed',
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });
});
