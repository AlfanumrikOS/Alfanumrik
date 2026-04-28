/**
 * rbac.ts — unit tests.
 *
 * Server-side RBAC. Tests focus on the testable pure-fn surface and the
 * Supabase-coupled paths that are exercisable with a mocked admin client.
 *
 * Covered:
 *   - PERMISSIONS registry stability (presence + canonical codes)
 *   - getUserPermissions: cached read, RPC write-through, error path
 *   - hasPermission / hasAnyPermission / hasAllPermissions: super_admin bypass,
 *     positive + negative for ordinary roles
 *   - hasRole: positive + negative
 *   - canAccessStudent: own-student match, admin bypass, parent-link match,
 *     no-access fallthrough
 *   - canAccessImage: image-not-found short-circuit
 *   - canAccessReport: thin alias of canAccessStudent
 *   - logAudit: inserts into audit_logs with default status; swallows errors
 *   - invalidatePermissionCache: clears local cache entries
 *   - authorizeRequest: 401 (no token), 500 (perm lookup failure), 403 (no roles),
 *     403 (missing permission), 200 happy path with student studentId resolution
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Build a flexible Supabase admin mock ─────────────────────

type DbResult = { data: unknown; error: { message: string } | null };

const queueState = {
  rpcResults: [] as DbResult[],
  studentsResults: [] as DbResult[],     // single() / maybeSingle() on students
  imageResults: [] as DbResult[],        // maybeSingle() on image_uploads
  guardiansResults: [] as DbResult[],    // .eq().select() chain on guardians
  guardianLinksResults: [] as DbResult[], // .in()...limit() on guardian_student_links
  auditInsertResults: [] as DbResult[],
  schoolStudentResults: [] as DbResult[],
  schoolMembershipResults: [] as DbResult[],
  isTeacherOfStudentResults: [] as DbResult[],
};

function nextOr(arr: DbResult[], fallback: DbResult): DbResult {
  return arr.shift() ?? fallback;
}

const mockSupabaseAdmin = {
  rpc: vi.fn(async (rpcName: string, _params: any) => {
    if (rpcName === 'is_teacher_of_student') {
      return nextOr(queueState.isTeacherOfStudentResults, { data: false, error: null });
    }
    return nextOr(queueState.rpcResults, { data: null, error: null });
  }),
  auth: {
    getUser: vi.fn(async () => ({ data: { user: { id: 'auth-user-1' } } })),
  },
  from: vi.fn((table: string) => {
    if (table === 'students') {
      return makeStudentsChain();
    }
    if (table === 'image_uploads') {
      return makeImageChain();
    }
    if (table === 'guardians') {
      return makeGuardiansChain();
    }
    if (table === 'guardian_student_links') {
      return makeGuardianLinksChain();
    }
    if (table === 'school_memberships') {
      return makeSchoolMembershipChain();
    }
    if (table === 'audit_logs') {
      return {
        insert: (..._args: any[]) =>
          nextOr(queueState.auditInsertResults, { data: null, error: null }),
      };
    }
    // Default: empty
    return makeEmptyChain();
  }),
};

function makeStudentsChain() {
  // canAccessStudent issues two queries:
  //  1. `select('school_id').eq('id', studentId).maybeSingle()` for institution_admin
  //  2. `select('id').eq('auth_user_id', uid).eq('id', studentId).maybeSingle()` for own-student
  // Plus authorizeRequest issues `select('id').eq('auth_user_id', uid).maybeSingle()` for studentId
  const chain: any = {};
  chain.select = vi.fn((cols: string) => {
    chain._cols = cols;
    return chain;
  });
  chain.eq = vi.fn((_col: string, _val: any) => chain);
  chain.maybeSingle = vi.fn(async () => {
    if (chain._cols === 'school_id') {
      return nextOr(queueState.schoolStudentResults, { data: null, error: null });
    }
    return nextOr(queueState.studentsResults, { data: null, error: null });
  });
  return chain;
}

function makeImageChain() {
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => nextOr(queueState.imageResults, { data: null, error: null }));
  return chain;
}

function makeGuardiansChain() {
  // .from('guardians').select('id').eq('auth_user_id', uid)  → returns array
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(async () => nextOr(queueState.guardiansResults, { data: [], error: null }));
  return chain;
}

function makeGuardianLinksChain() {
  // .select('id').eq('student_id', sid).in('status', [...]).in('guardian_id', ids).limit(1)
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.limit = vi.fn(async () =>
    nextOr(queueState.guardianLinksResults, { data: [], error: null }),
  );
  return chain;
}

function makeSchoolMembershipChain() {
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () =>
    nextOr(queueState.schoolMembershipResults, { data: null, error: null }),
  );
  return chain;
}

function makeEmptyChain() {
  const chain: any = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.in = vi.fn(() => chain);
  chain.limit = vi.fn(async () => ({ data: [], error: null }));
  chain.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  chain.single = vi.fn(async () => ({ data: null, error: null }));
  chain.insert = vi.fn(async () => ({ data: null, error: null }));
  return chain;
}

vi.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: vi.fn(() => mockSupabaseAdmin),
}));

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Avoid pulling in the real audit pipeline (used by invalidateForSecurityEvent)
vi.mock('@/lib/audit-pipeline', () => ({
  writeAuditEvent: vi.fn(async () => undefined),
}));

// Mock @upstash/redis so getRedis() returns null in dev mode
vi.mock('@upstash/redis', () => ({
  Redis: class {
    constructor() {}
    get = vi.fn(async () => null);
    set = vi.fn(async () => 'OK');
    del = vi.fn(async () => 1);
  },
}));

// Now import the SUT
import {
  PERMISSIONS,
  getUserPermissions,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  hasRole,
  canAccessStudent,
  canAccessImage,
  canAccessReport,
  logAudit,
  invalidatePermissionCache,
  authorizeRequest,
} from '@/lib/rbac';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  // Reset queues
  queueState.rpcResults = [];
  queueState.studentsResults = [];
  queueState.imageResults = [];
  queueState.guardiansResults = [];
  queueState.guardianLinksResults = [];
  queueState.auditInsertResults = [];
  queueState.schoolStudentResults = [];
  queueState.schoolMembershipResults = [];
  queueState.isTeacherOfStudentResults = [];

  // Make sure no Redis env -> use local cache
  process.env = { ...ORIGINAL_ENV };
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
});

// ─── PERMISSIONS registry ────────────────────────────────────

describe('PERMISSIONS registry', () => {
  it('exposes the canonical quiz permissions in dot.notation', () => {
    expect(PERMISSIONS.QUIZ_ATTEMPT).toBe('quiz.attempt');
    expect(PERMISSIONS.QUIZ_VIEW_RESULTS).toBe('quiz.view_results');
  });

  it('exposes the foxy chat permission', () => {
    expect(PERMISSIONS.FOXY_CHAT).toBe('foxy.chat');
    expect(PERMISSIONS.FOXY_INTERACT).toBe('foxy.interact');
  });

  it('exposes the parent (child-scoped) permissions', () => {
    expect(PERMISSIONS.CHILD_VIEW_PERFORMANCE).toBe('child.view_performance');
    expect(PERMISSIONS.CHILD_DOWNLOAD_REPORT).toBe('child.download_report');
  });

  it('exposes admin governance codes', () => {
    expect(PERMISSIONS.SYSTEM_AUDIT).toBe('system.audit');
    expect(PERMISSIONS.SUPER_ADMIN_SUBJECTS_MANAGE).toBe('super_admin.subjects.manage');
  });

  it('every code is unique', () => {
    const values = Object.values(PERMISSIONS);
    expect(new Set(values).size).toBe(values.length);
  });
});

// ─── getUserPermissions ──────────────────────────────────────

describe('getUserPermissions', () => {
  it('returns the RPC payload (roles + permissions) on first call and caches it', async () => {
    queueState.rpcResults.push({
      data: {
        roles: [{ name: 'student' }],
        permissions: ['quiz.attempt', 'foxy.chat'],
      },
      error: null,
    });

    const r = await getUserPermissions('uid-1');
    expect(r.roles).toEqual([{ name: 'student' }]);
    expect(r.permissions).toEqual(['quiz.attempt', 'foxy.chat']);

    // Second call: served from cache → no new RPC
    const r2 = await getUserPermissions('uid-1');
    expect(r2.roles).toEqual([{ name: 'student' }]);
    expect(mockSupabaseAdmin.rpc).toHaveBeenCalledTimes(1);
  });

  it('throws when the RPC returns an error', async () => {
    queueState.rpcResults.push({ data: null, error: { message: 'rpc broken' } });
    await expect(getUserPermissions('uid-rpc-fail')).rejects.toThrow(/Permission lookup failed/);
  });

  it('handles empty roles + permissions arrays gracefully', async () => {
    queueState.rpcResults.push({ data: { roles: null, permissions: null }, error: null });
    const r = await getUserPermissions('uid-empty');
    expect(r.roles).toEqual([]);
    expect(r.permissions).toEqual([]);
  });
});

// ─── hasPermission / hasAnyPermission / hasAllPermissions ────

describe('hasPermission family', () => {
  it('hasPermission returns true on direct match', async () => {
    queueState.rpcResults.push({
      data: { roles: [{ name: 'student' }], permissions: ['quiz.attempt'] },
      error: null,
    });
    await expect(hasPermission('uid-perm', 'quiz.attempt')).resolves.toBe(true);
  });

  it('hasPermission returns false when missing', async () => {
    queueState.rpcResults.push({
      data: { roles: [{ name: 'student' }], permissions: ['quiz.attempt'] },
      error: null,
    });
    await expect(hasPermission('uid-perm-2', 'admin.manage_users')).resolves.toBe(false);
  });

  it('super_admin bypass: hasPermission true even when code not in list', async () => {
    queueState.rpcResults.push({
      data: { roles: [{ name: 'super_admin' }], permissions: [] },
      error: null,
    });
    await expect(hasPermission('uid-sa', 'anything.any')).resolves.toBe(true);
  });

  it('hasAnyPermission true on first match', async () => {
    queueState.rpcResults.push({
      data: { roles: [{ name: 'teacher' }], permissions: ['class.manage'] },
      error: null,
    });
    await expect(hasAnyPermission('uid-any', ['quiz.attempt', 'class.manage'])).resolves.toBe(true);
  });

  it('hasAnyPermission false when none match', async () => {
    queueState.rpcResults.push({
      data: { roles: [{ name: 'teacher' }], permissions: ['class.manage'] },
      error: null,
    });
    await expect(hasAnyPermission('uid-any-2', ['admin.manage_users', 'system.audit'])).resolves.toBe(false);
  });

  it('hasAllPermissions: true when every code present', async () => {
    queueState.rpcResults.push({
      data: { roles: [{ name: 'teacher' }], permissions: ['class.manage', 'student.provide_feedback'] },
      error: null,
    });
    await expect(
      hasAllPermissions('uid-all', ['class.manage', 'student.provide_feedback']),
    ).resolves.toBe(true);
  });

  it('hasAllPermissions: false when any code missing', async () => {
    queueState.rpcResults.push({
      data: { roles: [{ name: 'teacher' }], permissions: ['class.manage'] },
      error: null,
    });
    await expect(
      hasAllPermissions('uid-all-2', ['class.manage', 'admin.manage_users']),
    ).resolves.toBe(false);
  });

  it('super_admin bypass for hasAllPermissions even with empty perms array', async () => {
    queueState.rpcResults.push({
      data: { roles: [{ name: 'super_admin' }], permissions: [] },
      error: null,
    });
    await expect(hasAllPermissions('uid-sa-all', ['x', 'y', 'z'])).resolves.toBe(true);
  });
});

describe('hasRole', () => {
  it('returns true when the user has the role', async () => {
    queueState.rpcResults.push({
      data: { roles: [{ name: 'parent' }], permissions: [] },
      error: null,
    });
    await expect(hasRole('uid-role', 'parent')).resolves.toBe(true);
  });

  it('returns false when role not present', async () => {
    queueState.rpcResults.push({
      data: { roles: [{ name: 'student' }], permissions: [] },
      error: null,
    });
    await expect(hasRole('uid-role-2', 'admin')).resolves.toBe(false);
  });
});

// ─── invalidatePermissionCache ───────────────────────────────

describe('invalidatePermissionCache', () => {
  it('clears the local cache so the next lookup re-runs the RPC', async () => {
    queueState.rpcResults.push({
      data: { roles: [{ name: 'student' }], permissions: [] },
      error: null,
    });
    await getUserPermissions('uid-inv');
    expect(mockSupabaseAdmin.rpc).toHaveBeenCalledTimes(1);

    await invalidatePermissionCache('uid-inv');

    queueState.rpcResults.push({
      data: { roles: [{ name: 'admin' }], permissions: [] },
      error: null,
    });
    const r = await getUserPermissions('uid-inv');
    expect(r.roles).toEqual([{ name: 'admin' }]);
    expect(mockSupabaseAdmin.rpc).toHaveBeenCalledTimes(2);
  });
});

// ─── canAccessStudent ────────────────────────────────────────

describe('canAccessStudent', () => {
  it('returns true when caller owns the student record', async () => {
    queueState.rpcResults.push({
      data: { roles: [{ name: 'student' }], permissions: [] },
      error: null,
    });
    // institution_admin school-id query happens first; both maybeSingle calls
    // for students table consult studentsResults — the school_id one is
    // routed via schoolStudentResults. With the student role, only the second
    // (own-student) lookup runs.
    queueState.studentsResults.push({ data: { id: 'student-1' }, error: null });

    await expect(canAccessStudent('uid-own', 'student-1')).resolves.toBe(true);
  });

  it('returns true for admin role regardless of ownership', async () => {
    queueState.rpcResults.push({
      data: { roles: [{ name: 'admin' }], permissions: [] },
      error: null,
    });
    await expect(canAccessStudent('uid-admin', 'student-99')).resolves.toBe(true);
  });

  it('returns true for super_admin role', async () => {
    queueState.rpcResults.push({
      data: { roles: [{ name: 'super_admin' }], permissions: [] },
      error: null,
    });
    await expect(canAccessStudent('uid-sa', 'student-99')).resolves.toBe(true);
  });

  it('returns true for a parent linked to the child via guardian_student_links', async () => {
    queueState.rpcResults.push({
      data: { roles: [{ name: 'parent' }], permissions: [] },
      error: null,
    });
    // Own-student lookup: not a student.
    queueState.studentsResults.push({ data: null, error: null });
    // Guardians lookup
    queueState.guardiansResults.push({ data: [{ id: 'guardian-1' }], error: null });
    // Linked-child match
    queueState.guardianLinksResults.push({
      data: [{ id: 'link-1' }],
      error: null,
    });

    await expect(canAccessStudent('uid-parent', 'student-2')).resolves.toBe(true);
  });

  it('returns false when caller is unrelated to the student', async () => {
    queueState.rpcResults.push({
      data: { roles: [{ name: 'parent' }], permissions: [] },
      error: null,
    });
    queueState.studentsResults.push({ data: null, error: null });
    queueState.guardiansResults.push({ data: [], error: null });
    queueState.isTeacherOfStudentResults.push({ data: false, error: null });

    await expect(canAccessStudent('uid-stranger', 'student-x')).resolves.toBe(false);
  });
});

describe('canAccessImage', () => {
  it('returns false when image not found', async () => {
    queueState.imageResults.push({ data: null, error: null });
    await expect(canAccessImage('uid-anything', 'image-missing')).resolves.toBe(false);
  });

  it('delegates to canAccessStudent when image exists (admin bypass case)', async () => {
    queueState.imageResults.push({ data: { student_id: 'student-3' }, error: null });
    queueState.rpcResults.push({
      data: { roles: [{ name: 'super_admin' }], permissions: [] },
      error: null,
    });
    await expect(canAccessImage('uid-sa-img', 'img-1')).resolves.toBe(true);
  });
});

describe('canAccessReport', () => {
  it('is a thin alias of canAccessStudent', async () => {
    queueState.rpcResults.push({
      data: { roles: [{ name: 'admin' }], permissions: [] },
      error: null,
    });
    await expect(canAccessReport('uid-admin-rpt', 'student-zzz')).resolves.toBe(true);
  });
});

// ─── logAudit ────────────────────────────────────────────────

describe('logAudit', () => {
  it('inserts an audit_logs row with the provided shape', async () => {
    queueState.auditInsertResults.push({ data: null, error: null });
    await logAudit('uid-1', {
      action: 'permission_denied',
      resourceType: 'quiz',
      resourceId: 'q-1',
      details: { x: 1 },
      status: 'denied',
      ipAddress: '203.0.113.1',
      userAgent: 'curl/8',
    });

    expect(mockSupabaseAdmin.from).toHaveBeenCalledWith('audit_logs');
  });

  it('never throws when Supabase insert rejects (logs error instead)', async () => {
    // Override insert to throw
    const original = mockSupabaseAdmin.from;
    mockSupabaseAdmin.from = vi.fn((table: string) => {
      if (table === 'audit_logs') {
        return { insert: () => { throw new Error('boom'); } };
      }
      return original(table);
    });

    await expect(
      logAudit('uid-x', { action: 'a', resourceType: 't' }),
    ).resolves.toBeUndefined();

    mockSupabaseAdmin.from = original;
  });
});

// ─── authorizeRequest ────────────────────────────────────────

describe('authorizeRequest', () => {
  function reqWith(headers: Record<string, string>): Request {
    return new Request('https://app.test/api/x', { headers });
  }

  it('returns 401 AUTH_REQUIRED when there is no Bearer token and cookies fail', async () => {
    // No Bearer header; cookie path will throw inside dynamic import (no
    // Next.js context) and authUserId stays null.
    const r = await authorizeRequest(reqWith({}));
    expect(r.authorized).toBe(false);
    expect(r.errorResponse?.status).toBe(401);
  });

  it('returns 500 PERM_LOOKUP_ERROR when the perms RPC throws', async () => {
    mockSupabaseAdmin.auth.getUser.mockResolvedValueOnce({
      data: { user: { id: 'uid-perm-throw' } },
    } as any);
    queueState.rpcResults.push({ data: null, error: { message: 'rpc down' } });

    const r = await authorizeRequest(reqWith({ Authorization: 'Bearer good' }));
    expect(r.authorized).toBe(false);
    expect(r.errorResponse?.status).toBe(500);
  });

  it('returns 403 NO_ROLES when the user has zero roles', async () => {
    mockSupabaseAdmin.auth.getUser.mockResolvedValueOnce({
      data: { user: { id: 'uid-no-roles' } },
    } as any);
    queueState.rpcResults.push({ data: { roles: [], permissions: [] }, error: null });

    const r = await authorizeRequest(reqWith({ Authorization: 'Bearer good' }));
    expect(r.authorized).toBe(false);
    expect(r.errorResponse?.status).toBe(403);
  });

  it('returns 403 PERMISSION_DENIED when the required permission is absent', async () => {
    mockSupabaseAdmin.auth.getUser.mockResolvedValueOnce({
      data: { user: { id: 'uid-perm-deny' } },
    } as any);
    queueState.rpcResults.push({
      data: { roles: [{ name: 'student' }], permissions: ['quiz.attempt'] },
      error: null,
    });
    // logAudit inserts on denial — provide a no-op result.
    queueState.auditInsertResults.push({ data: null, error: null });

    const r = await authorizeRequest(reqWith({ Authorization: 'Bearer good' }), 'admin.manage_users');
    expect(r.authorized).toBe(false);
    expect(r.errorResponse?.status).toBe(403);
  });

  it('returns authorized=true with studentId for a student on the happy path', async () => {
    mockSupabaseAdmin.auth.getUser.mockResolvedValueOnce({
      data: { user: { id: 'uid-happy' } },
    } as any);
    queueState.rpcResults.push({
      data: { roles: [{ name: 'student' }], permissions: ['quiz.attempt'] },
      error: null,
    });
    // students lookup for studentId resolution
    queueState.studentsResults.push({ data: { id: 'student-happy' }, error: null });

    const r = await authorizeRequest(reqWith({ Authorization: 'Bearer good' }), 'quiz.attempt');
    expect(r.authorized).toBe(true);
    expect(r.userId).toBe('uid-happy');
    expect(r.studentId).toBe('student-happy');
    expect(r.roles).toEqual(['student']);
  });

  it('grants super_admin bypass even without the listed permission', async () => {
    mockSupabaseAdmin.auth.getUser.mockResolvedValueOnce({
      data: { user: { id: 'uid-sa-bypass' } },
    } as any);
    queueState.rpcResults.push({
      data: { roles: [{ name: 'super_admin' }], permissions: [] },
      error: null,
    });

    const r = await authorizeRequest(reqWith({ Authorization: 'Bearer good' }), 'doesnt.exist');
    expect(r.authorized).toBe(true);
  });
});
