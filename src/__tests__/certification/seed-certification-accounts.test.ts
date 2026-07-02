import { describe, it, expect, vi } from 'vitest';
import {
  MISSION_ROLES,
  CERTIFICATION_EMAIL_DOMAIN,
  SCHOOL_NAME_PREFIX,
  runIdShortOf,
  buildAccountShape,
  buildSchoolShape,
  buildBaseTableRow,
  buildDemoAccountsRow,
  findOrCreateAuthUser,
  upsertBaseTableRow,
  upsertDemoAccountsRow,
  upsertSchoolRow,
  seedCertificationAccounts,
  type SupabaseLike,
  type QueryResult,
} from '../../../scripts/seed-certification-accounts';

/**
 * REG-228 — certification-account seeding script: shape conventions +
 * idempotency (Environment Readiness remediation wave, 2026-07-02).
 *
 * Verifies `scripts/seed-certification-accounts.ts` against the exact
 * traceability convention specified in
 * `docs/runbooks/certification-traffic-traceability.md`:
 *   - email:  cert-<run_id_short>-<role>-<n>@certification.alfanumrik.invalid
 *   - name:   cert-<run_id_short>-<role>-<n>
 *   - school: [CERTIFICATION] cert-<run_id_short>-school-<n>
 *   - is_demo = true on every base-table row
 *   - one demo_accounts registry row per top-level account, EXCEPT the two
 *     roles (content_author, support_staff) that have no CHECK-legal
 *     demo_accounts.role value — a documented, deliberate limitation, not
 *     an oversight (see the module doc in the script).
 *
 * No live database is used — this suite is entirely PURE-FUNCTION +
 * FAKE-CLIENT (an in-memory object satisfying the script's narrow
 * `SupabaseLike` surface), consistent with how the rest of this codebase's
 * Vitest suite avoids live DB calls in the default (non-integration) lane.
 * This file intentionally lives OUTSIDE `src/__tests__/scripts/` because
 * that directory is bound to the `RUN_INTEGRATION_TESTS=1` lane in
 * `vitest.config.ts` — these tests must run on every normal `npm test`.
 *
 * REGRESSION CATALOG: REG-228.
 */

// ─── A minimal in-memory fake satisfying SupabaseLike ──────────────────────
// Table state is a plain array of rows; `insert` appends, `select().eq().
// maybeSingle()` finds the first match. This is intentionally simple — it
// exists to prove find-or-create semantics, not to emulate PostgREST.

function makeFakeSupabase(): { sb: SupabaseLike; tables: Record<string, Record<string, unknown>[]> } {
  const tables: Record<string, Record<string, unknown>[]> = {};
  let nextId = 1;

  function tableRows(name: string): Record<string, unknown>[] {
    if (!tables[name]) tables[name] = [];
    return tables[name];
  }

  const sb: SupabaseLike = {
    from(table: string) {
      return {
        select(_cols: string) {
          return {
            eq(col: string, val: string) {
              return {
                async maybeSingle(): Promise<QueryResult<Record<string, unknown>>> {
                  const row = tableRows(table).find((r) => r[col] === val);
                  return { data: row ?? null, error: null };
                },
              };
            },
          };
        },
        insert<T extends object>(row: T) {
          return {
            select(_cols: string) {
              return {
                async single(): Promise<QueryResult<Record<string, unknown>>> {
                  const id = `id-${nextId++}`;
                  const stored = { ...row, id } as Record<string, unknown>;
                  tableRows(table).push(stored);
                  return { data: { id }, error: null };
                },
              };
            },
          };
        },
      };
    },
    auth: {
      admin: {
        async createUser(params: { email: string }) {
          const id = `auth-${nextId++}`;
          return { data: { user: { id } }, error: null };
        },
      },
    },
  };

  return { sb, tables };
}

describe('REG-228 — account-shape helpers match the runbook marker conventions exactly', () => {
  it('runIdShortOf extracts the first 8 lowercase hex chars, hyphens stripped', () => {
    expect(runIdShortOf('A1B2C3D4-e5f6-7890-abcd-ef1234567890')).toBe('a1b2c3d4');
  });

  it('buildAccountShape produces cert-<run_id_short>-<role>-<n>@certification.alfanumrik.invalid', () => {
    const shape = buildAccountShape('a1b2c3d4', 'student', 1);
    expect(shape.email).toBe('cert-a1b2c3d4-student-001@certification.alfanumrik.invalid');
    expect(shape.name).toBe('cert-a1b2c3d4-student-001');
  });

  it('the email local-part and name marker match byte-for-byte (runbook requirement)', () => {
    const shape = buildAccountShape('deadbeef', 'teacher', 7);
    const [localPart] = shape.email.split('@');
    expect(localPart).toBe(shape.name);
  });

  it('the email domain is the exact reserved .invalid marker', () => {
    const shape = buildAccountShape('deadbeef', 'parent', 1);
    expect(shape.email.endsWith(`@${CERTIFICATION_EMAIL_DOMAIN}`)).toBe(true);
    expect(CERTIFICATION_EMAIL_DOMAIN).toBe('certification.alfanumrik.invalid');
  });

  it('sequence numbers are zero-padded to 3 digits so same-role accounts never collide', () => {
    expect(buildAccountShape('deadbeef', 'student', 1).email).toContain('-student-001@');
    expect(buildAccountShape('deadbeef', 'student', 42).email).toContain('-student-042@');
  });

  it('buildSchoolShape produces "[CERTIFICATION] cert-<run_id_short>-school-<n>"', () => {
    const school = buildSchoolShape('deadbeef', 1);
    expect(school.name).toBe('[CERTIFICATION] cert-deadbeef-school-001');
    expect(school.name.startsWith(SCHOOL_NAME_PREFIX)).toBe(true);
  });

  it('buildBaseTableRow always stamps is_demo = true regardless of role/table', () => {
    for (const def of MISSION_ROLES) {
      const shape = buildAccountShape('deadbeef', def.role, 1);
      const row = buildBaseTableRow(def, shape, 'auth-1', def.schoolScoped ? 'school-1' : null);
      expect(row.is_demo).toBe(true);
      expect(row.email).toBe(shape.email);
      expect(row.name).toBe(shape.name);
    }
  });

  it('admin_users-backed roles carry the correct admin_level', () => {
    const superAdminDef = MISSION_ROLES.find((d) => d.role === 'super_admin')!;
    const contentDef = MISSION_ROLES.find((d) => d.role === 'content_author')!;
    const supportDef = MISSION_ROLES.find((d) => d.role === 'support_staff')!;

    const shapeSuper = buildAccountShape('deadbeef', 'super_admin', 1);
    const shapeContent = buildAccountShape('deadbeef', 'content_author', 1);
    const shapeSupport = buildAccountShape('deadbeef', 'support_staff', 1);

    expect(buildBaseTableRow(superAdminDef, shapeSuper, 'a', null).admin_level).toBe('super_admin');
    expect(buildBaseTableRow(contentDef, shapeContent, 'a', null).admin_level).toBe('content_manager');
    expect(buildBaseTableRow(supportDef, shapeSupport, 'a', null).admin_level).toBe('support');
  });

  it('7 mission roles are declared, matching the certification plan exactly', () => {
    const roles = MISSION_ROLES.map((d) => d.role).sort();
    expect(roles).toEqual(
      ['content_author', 'parent', 'school_admin', 'student', 'super_admin', 'support_staff', 'teacher'].sort(),
    );
  });

  it('content_author and support_staff are marked hasPortal=false (Wave 1 finding, seeded anyway)', () => {
    const content = MISSION_ROLES.find((d) => d.role === 'content_author')!;
    const support = MISSION_ROLES.find((d) => d.role === 'support_staff')!;
    expect(content.hasPortal).toBe(false);
    expect(support.hasPortal).toBe(false);
    // Every other role DOES have a portal today.
    for (const def of MISSION_ROLES) {
      if (def.role === 'content_author' || def.role === 'support_staff') continue;
      expect(def.hasPortal).toBe(true);
    }
  });
});

describe('REG-228 — demo_accounts registry row shape + the documented CHECK-constraint limitation', () => {
  it('buildDemoAccountsRow produces the exact runbook shape for CHECK-legal roles', () => {
    const def = MISSION_ROLES.find((d) => d.role === 'student')!;
    const shape = buildAccountShape('deadbeef', 'student', 1);
    const row = buildDemoAccountsRow(def, shape, 'auth-1', 'school-1', 'operator-1');
    expect(row).toEqual({
      auth_user_id: 'auth-1',
      role: 'student',
      persona: null,
      display_name: shape.name,
      email: shape.email,
      school_id: 'school-1',
      is_active: true,
      created_by: 'operator-1',
    });
  });

  it('display_name and email match the base-table row byte-for-byte (runbook requirement)', () => {
    const def = MISSION_ROLES.find((d) => d.role === 'teacher')!;
    const shape = buildAccountShape('deadbeef', 'teacher', 3);
    const baseRow = buildBaseTableRow(def, shape, 'auth-2', 'school-1');
    const demoRow = buildDemoAccountsRow(def, shape, 'auth-2', 'school-1', null);
    expect(demoRow!.display_name).toBe(baseRow.name);
    expect(demoRow!.email).toBe(baseRow.email);
  });

  it('returns null for content_author and support_staff (no CHECK-legal role value) — never mislabels them super_admin', () => {
    const contentDef = MISSION_ROLES.find((d) => d.role === 'content_author')!;
    const supportDef = MISSION_ROLES.find((d) => d.role === 'support_staff')!;
    const shapeContent = buildAccountShape('deadbeef', 'content_author', 1);
    const shapeSupport = buildAccountShape('deadbeef', 'support_staff', 1);

    expect(buildDemoAccountsRow(contentDef, shapeContent, 'auth-3', null, null)).toBeNull();
    expect(buildDemoAccountsRow(supportDef, shapeSupport, 'auth-4', null, null)).toBeNull();
  });

  it('only registers a demo_accounts role value that is CHECK-legal (student|teacher|parent|school_admin|super_admin)', () => {
    const legal = new Set(['student', 'teacher', 'parent', 'school_admin', 'super_admin']);
    for (const def of MISSION_ROLES) {
      const shape = buildAccountShape('deadbeef', def.role, 1);
      const row = buildDemoAccountsRow(def, shape, 'auth-x', null, null);
      if (row) {
        expect(legal.has(row.role)).toBe(true);
      }
    }
  });
});

describe('REG-228 — idempotent find-or-create primitives (fake client, no live DB)', () => {
  it('upsertBaseTableRow: second call with the same email reuses the row, does not duplicate', async () => {
    const { sb, tables } = makeFakeSupabase();
    const email = 'cert-deadbeef-student-001@certification.alfanumrik.invalid';
    const row = { email, name: 'x', is_demo: true, is_active: true };

    const first = await upsertBaseTableRow(sb, 'students', email, row);
    const second = await upsertBaseTableRow(sb, 'students', email, row);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
    expect(tables.students).toHaveLength(1);
  });

  it('findOrCreateAuthUser: second call with the same email reuses the existing auth_user_id', async () => {
    const { sb, tables } = makeFakeSupabase();
    const email = 'cert-deadbeef-teacher-001@certification.alfanumrik.invalid';

    // First call: no existing row -> creates a fresh auth user.
    const first = await findOrCreateAuthUser(sb, 'teachers', email, 'pw');
    expect(first.created).toBe(true);

    // Simulate the base-table row now existing with that auth_user_id (as the
    // real orchestrator would have written via upsertBaseTableRow).
    tables.teachers = [{ email, auth_user_id: first.authUserId, id: 'row-1' }];

    const second = await findOrCreateAuthUser(sb, 'teachers', email, 'pw');
    expect(second.created).toBe(false);
    expect(second.authUserId).toBe(first.authUserId);
  });

  it('upsertDemoAccountsRow: second call with the same email does not duplicate the registry row', async () => {
    const { sb, tables } = makeFakeSupabase();
    const row = {
      auth_user_id: 'auth-1',
      role: 'student' as const,
      persona: null,
      display_name: 'cert-deadbeef-student-001',
      email: 'cert-deadbeef-student-001@certification.alfanumrik.invalid',
      school_id: null,
      is_active: true as const,
      created_by: null,
    };

    await upsertDemoAccountsRow(sb, row);
    await upsertDemoAccountsRow(sb, row);

    expect(tables.demo_accounts).toHaveLength(1);
  });

  it('upsertSchoolRow: second call with the same name does not duplicate the school', async () => {
    const { sb, tables } = makeFakeSupabase();
    const name = '[CERTIFICATION] cert-deadbeef-school-001';

    const first = await upsertSchoolRow(sb, name);
    const second = await upsertSchoolRow(sb, name);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(tables.schools).toHaveLength(1);
  });
});

describe('REG-228 — seedCertificationAccounts end-to-end orchestration is idempotent per run id', () => {
  it('calling the full orchestrator twice with the SAME run id creates rows once, reuses them the second time', async () => {
    const { sb, tables } = makeFakeSupabase();
    const runId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

    const first = await seedCertificationAccounts(sb, { runId });
    const second = await seedCertificationAccounts(sb, { runId });

    // Every account is present both times, same run id/short.
    expect(first.runId).toBe(runId);
    expect(second.runId).toBe(runId);
    expect(first.accounts).toHaveLength(MISSION_ROLES.length);
    expect(second.accounts).toHaveLength(MISSION_ROLES.length);

    // First call created every row; second call created none.
    expect(first.accounts.every((a) => a.baseRowCreated)).toBe(true);
    expect(second.accounts.every((a) => a.baseRowCreated === false)).toBe(true);

    // No table has duplicate rows after the second call.
    expect(tables.students).toHaveLength(1);
    expect(tables.teachers).toHaveLength(1);
    expect(tables.guardians).toHaveLength(1);
    expect(tables.school_admins).toHaveLength(1);
    // admin_users holds 3 rows: super_admin, content_author, support_staff.
    expect(tables.admin_users).toHaveLength(3);
    expect(tables.schools).toHaveLength(1);

    // demo_accounts only gets the 5 CHECK-legal roles, never content_author/support_staff.
    expect(tables.demo_accounts).toHaveLength(5);
    const demoRoles = tables.demo_accounts.map((r) => r.role).sort();
    expect(demoRoles).toEqual(['parent', 'school_admin', 'student', 'super_admin', 'teacher']);
  });

  it('calling the orchestrator with a DIFFERENT run id creates an entirely independent, non-colliding row set', async () => {
    const { sb, tables } = makeFakeSupabase();

    await seedCertificationAccounts(sb, { runId: '11111111-1111-1111-1111-111111111111' });
    await seedCertificationAccounts(sb, { runId: '22222222-2222-2222-2222-222222222222' });

    // Two independent schools, two independent students, etc. — no collision.
    expect(tables.schools).toHaveLength(2);
    expect(tables.students).toHaveLength(2);
    expect(tables.demo_accounts).toHaveLength(10);

    const emails = tables.students.map((r) => r.email);
    expect(new Set(emails).size).toBe(2); // both unique
  });

  it('every seeded account role appears exactly once per run', async () => {
    const { sb } = makeFakeSupabase();
    const result = await seedCertificationAccounts(sb, { runId: 'cccccccc-cccc-cccc-cccc-cccccccccccc' });
    const roles = result.accounts.map((a) => a.role).sort();
    expect(roles).toEqual(MISSION_ROLES.map((d) => d.role).slice().sort());
  });

  it('seedSchool: false skips school seeding and leaves every account school_id null even for school-scoped roles', async () => {
    const { sb, tables } = makeFakeSupabase();
    const result = await seedCertificationAccounts(sb, {
      runId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      seedSchool: false,
    });
    expect(result.schoolId).toBeNull();
    expect(tables.schools ?? []).toHaveLength(0);

    const student = tables.students[0];
    expect(student.school_id).toBeNull();
  });

  it('runId defaults to a fresh UUID when not supplied (no crash, distinct across calls)', async () => {
    const { sb: sb1 } = makeFakeSupabase();
    const { sb: sb2 } = makeFakeSupabase();
    const r1 = await seedCertificationAccounts(sb1, {});
    const r2 = await seedCertificationAccounts(sb2, {});
    expect(r1.runId).toBeTruthy();
    expect(r2.runId).toBeTruthy();
    expect(r1.runId).not.toBe(r2.runId);
  });
});
