import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * RLS boundary regression for `public.intervention_alerts` (P8/P9/P13 —
 * monitoring data boundary). Catalogued as REG-143.
 *
 * Migration under test:
 *   supabase/migrations/20260615122658_create_intervention_alerts.sql
 *
 * intervention_alerts is the staff-facing at-risk-student alert feed. Its
 * security contract:
 *   1. SELECT is restricted to teacher / admin / super_admin via a user_roles ×
 *      roles join — students (and anon) read 0 rows, no error.
 *   2. UPDATE (resolve / acknowledge) is restricted to the same staff roles.
 *   3. The role join carries the A1 expired-grant guard
 *      `(ur.expires_at IS NULL OR ur.expires_at > now())` so a lapsed grant
 *      (is_active = true but expires_at in the past) does NOT grant access.
 *   4. alert_type is constrained to exactly 5 values; severity to exactly 3
 *      (watch / act / urgent).
 *
 * Test strategy — STRUCTURAL (always-on, source-level over the migration .sql)
 * + LIVE (describe.skipIf(!LIVE_DB), real per-role authenticated clients so
 * auth.uid() is the genuine session user). Mirrors the repo's RLS-test pattern
 * (`rls-student-id-policies.test.ts`, `teacher/remediation-rls-policies.test.ts`)
 * and the live-DB skipIf gate (`observability-migration-1a/1b.test.ts`).
 *
 * No hardcoded UUIDs — every id is crypto.randomUUID(). auth.uid() is never
 * hardcoded — live tests authenticate real users per role.
 */

// -----------------------------------------------------------------------------
// Migration source resolution + whitespace-tolerant normalisation
// -----------------------------------------------------------------------------

const MIGRATION_FILE =
  'supabase/migrations/20260615122658_create_intervention_alerts.sql';

function resolveMigrationPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), MIGRATION_FILE),
    path.resolve(process.cwd(), '..', MIGRATION_FILE),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

const MIGRATION_PATH = resolveMigrationPath();
const MIGRATION_PRESENT = MIGRATION_PATH !== null;

function readMigration(): string {
  if (!MIGRATION_PATH) return '';
  return fs.readFileSync(MIGRATION_PATH, 'utf-8');
}

function normalisedSql(): string {
  const sql = readMigration();
  const noLineComments = sql.replace(/^\s*--.*$/gm, '');
  const noBlockComments = noLineComments.replace(/\/\*[\s\S]*?\*\//g, '');
  return noBlockComments.replace(/\s+/g, ' ');
}

// Must stay in lockstep with AlertType / AlertSeverity in src/types/monitoring.ts
// (cross-checked by REG-143's parity assertions in the catalog).
const ALERT_TYPES = [
  'consecutive_wrong',
  'session_gap',
  'mastery_declining',
  'high_hint_usage',
  'time_on_task_low',
] as const;
const SEVERITIES = ['watch', 'act', 'urgent'] as const;

// -----------------------------------------------------------------------------
// Live-DB gate
// -----------------------------------------------------------------------------

const LIVE_DB = process.env.TEST_SUPABASE_URL !== undefined;
const SUPABASE_URL = process.env.TEST_SUPABASE_URL;
const ANON_KEY = process.env.TEST_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

// -----------------------------------------------------------------------------
// STRUCTURAL assertions — always run
// -----------------------------------------------------------------------------

describe('REG-143 — intervention_alerts migration presence & structure (source-level)', () => {
  it(`${MIGRATION_FILE} exists`, () => {
    expect(MIGRATION_PRESENT).toBe(true);
  });

  it('enables Row Level Security on the table', () => {
    expect(normalisedSql()).toMatch(
      /ALTER TABLE public\.intervention_alerts ENABLE ROW LEVEL SECURITY/,
    );
  });

  it('does NOT drop any tables or columns (P8: non-destructive)', () => {
    const sql = normalisedSql();
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/DROP COLUMN/i);
  });

  it('created_at / updated_at default to now()', () => {
    const sql = normalisedSql();
    expect(sql).toMatch(/created_at timestamptz NOT NULL DEFAULT now\(\)/i);
    expect(sql).toMatch(/updated_at timestamptz NOT NULL DEFAULT now\(\)/i);
  });
});

describe('REG-143 — intervention_alerts staff-only policies (source-level)', () => {
  it('SELECT policy is gated on roles teacher/admin/super_admin via user_roles join', () => {
    const sql = normalisedSql();
    expect(sql).toMatch(
      /CREATE POLICY "teachers_intervention_alerts_select" ON public\.intervention_alerts FOR SELECT/i,
    );
    expect(sql).toContain("r.name IN ('teacher','admin','super_admin')");
  });

  it('UPDATE policy is gated on the same staff roles', () => {
    const sql = normalisedSql();
    expect(sql).toMatch(
      /CREATE POLICY "teachers_intervention_alerts_update" ON public\.intervention_alerts FOR UPDATE/i,
    );
  });

  it('NO policy uses an open predicate (USING (true) / WITH CHECK (true))', () => {
    const sql = normalisedSql();
    expect(sql).not.toMatch(/USING\s*\(\s*true\s*\)/i);
    expect(sql).not.toMatch(/WITH CHECK\s*\(\s*true\s*\)/i);
  });

  // [8 — structural half] the A1 expired-grant guard must be present.
  it('carries the A1 expired-grant guard (ur.expires_at IS NULL OR ur.expires_at > now())', () => {
    const sql = normalisedSql();
    expect(sql).toContain('ur.expires_at IS NULL OR ur.expires_at > now()');
    // Guard must appear on BOTH staff policies (SELECT + UPDATE).
    const occurrences =
      sql.split('ur.expires_at IS NULL OR ur.expires_at > now()').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it('also requires the grant to be active (ur.is_active = true)', () => {
    expect(normalisedSql()).toContain('ur.is_active = true');
  });
});

describe('REG-143 — intervention_alerts CHECK lists (source-level)', () => {
  // [9 — structural half] alert_type CHECK = exactly the 5 values.
  it('alert_type CHECK contains all 5 canonical values and no extras', () => {
    const sql = normalisedSql();
    for (const t of ALERT_TYPES) {
      expect(sql).toContain(`'${t}'`);
    }
    const m = sql.match(/alert_type text NOT NULL CHECK \(alert_type IN \(([^)]*)\)/i);
    expect(m).not.toBeNull();
    const literals = (m![1].match(/'[^']+'/g) || []).map((s) => s.replace(/'/g, ''));
    expect(literals.sort()).toEqual([...ALERT_TYPES].sort());
    expect(literals.length).toBe(5);
  });

  // [10 — structural half] severity CHECK = exactly watch/act/urgent.
  it('severity CHECK contains exactly watch / act / urgent', () => {
    const sql = normalisedSql();
    for (const s of SEVERITIES) {
      expect(sql).toContain(`'${s}'`);
    }
    const m = sql.match(/severity text NOT NULL CHECK \(severity IN \(([^)]*)\)/i);
    expect(m).not.toBeNull();
    const literals = (m![1].match(/'[^']+'/g) || []).map((s) => s.replace(/'/g, ''));
    expect(literals.sort()).toEqual([...SEVERITIES].sort());
    expect(literals.length).toBe(3);
  });
});

// -----------------------------------------------------------------------------
// LIVE assertions — real database, real per-role authenticated users
// -----------------------------------------------------------------------------

describe.skipIf(!LIVE_DB)('REG-143 — intervention_alerts live RLS', () => {
  let admin: SupabaseClient; // service role — setup/teardown + RLS-bypass re-SELECT

  // Authenticated per-role clients. Each gets its real auth.uid() from sign-in.
  let teacherClient: SupabaseClient;
  let adminRoleClient: SupabaseClient;
  let superAdminClient: SupabaseClient;
  let studentClient: SupabaseClient;
  let expiredTeacherClient: SupabaseClient;
  let anon: SupabaseClient;

  const created: { table: string; id: string }[] = [];
  const userIds: string[] = [];

  // A student_id for alert rows — a real auth user so the FK to auth.users holds.
  let alertStudentId: string;
  let activeAlertId: string;

  const password = `Pw-${crypto.randomUUID()}`;

  /** Grant a role to a user via user_roles. expiresInPast=true creates the
   *  lapsed-grant case (is_active=true but expires_at in the past). */
  async function grantRole(
    authUserId: string,
    roleName: string,
    opts: { expiresInPast?: boolean } = {},
  ) {
    const { data: role, error: roleErr } = await admin
      .from('roles')
      .select('id')
      .eq('name', roleName)
      .single();
    if (roleErr) throw new Error(`role lookup '${roleName}' failed: ${roleErr.message}`);
    const expires_at = opts.expiresInPast
      ? new Date(Date.now() - 24 * 60 * 60_000).toISOString()
      : null;
    const { error } = await admin.from('user_roles').insert({
      auth_user_id: authUserId,
      role_id: role!.id,
      is_active: true,
      expires_at,
    });
    if (error) throw new Error(`grantRole '${roleName}' failed: ${error.message}`);
  }

  async function makeUser(): Promise<{ id: string; client: SupabaseClient }> {
    const { createClient } = await import('@supabase/supabase-js');
    const email = `ia-${crypto.randomUUID()}@test.invalid`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw new Error(`createUser failed: ${error.message}`);
    userIds.push(data.user!.id);
    const client = createClient(SUPABASE_URL!, ANON_KEY!, {
      auth: { persistSession: false },
    });
    const signIn = await client.auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error(`signIn failed: ${signIn.error.message}`);
    return { id: data.user!.id, client };
  }

  beforeAll(async () => {
    const { createClient } = await import('@supabase/supabase-js');
    admin = createClient(SUPABASE_URL!, SERVICE_KEY!, {
      auth: { persistSession: false },
    });

    const teacher = await makeUser();
    teacherClient = teacher.client;
    await grantRole(teacher.id, 'teacher');

    const adminUser = await makeUser();
    adminRoleClient = adminUser.client;
    await grantRole(adminUser.id, 'admin');

    const superAdmin = await makeUser();
    superAdminClient = superAdmin.client;
    await grantRole(superAdmin.id, 'super_admin');

    const expiredTeacher = await makeUser();
    expiredTeacherClient = expiredTeacher.client;
    await grantRole(expiredTeacher.id, 'teacher', { expiresInPast: true });

    // Student gets no staff grant (default student posture).
    const student = await makeUser();
    studentClient = student.client;
    alertStudentId = student.id;

    anon = createClient(SUPABASE_URL!, ANON_KEY!, {
      auth: { persistSession: false },
    });

    // Seed one active alert row (service role bypasses RLS for setup).
    activeAlertId = crypto.randomUUID();
    created.push({ table: 'intervention_alerts', id: activeAlertId });
    const { error } = await admin.from('intervention_alerts').insert({
      id: activeAlertId,
      student_id: alertStudentId,
      alert_type: 'consecutive_wrong',
      severity: 'act',
    });
    if (error) throw new Error(`seed alert failed: ${error.message}`);
  });

  afterAll(async () => {
    if (!admin) return;
    for (const c of created) {
      await admin.from(c.table).delete().eq('id', c.id);
    }
    for (const uid of userIds) {
      await admin.from('user_roles').delete().eq('auth_user_id', uid);
      await admin.auth.admin.deleteUser(uid);
    }
  });

  // [1] Teacher can SELECT
  it('teacher CAN select alerts', async () => {
    const { data, error } = await teacherClient
      .from('intervention_alerts')
      .select('id')
      .eq('id', activeAlertId);
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });

  // [2] Admin can SELECT
  it('admin CAN select alerts', async () => {
    const { data, error } = await adminRoleClient
      .from('intervention_alerts')
      .select('id')
      .eq('id', activeAlertId);
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });

  // [3] Super_admin can SELECT
  it('super_admin CAN select alerts', async () => {
    const { data, error } = await superAdminClient
      .from('intervention_alerts')
      .select('id')
      .eq('id', activeAlertId);
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });

  // [4] Student cannot SELECT → 0 rows, no error
  it('student CANNOT select alerts (0 rows, no error)', async () => {
    const { data, error } = await studentClient
      .from('intervention_alerts')
      .select('id')
      .eq('id', activeAlertId);
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(0);
  });

  // [5] Unauthenticated cannot SELECT → 0 rows or error
  it('unauthenticated CANNOT select alerts (0 rows or error)', async () => {
    const { data, error } = await anon
      .from('intervention_alerts')
      .select('id')
      .eq('id', activeAlertId);
    const blocked = error !== null || (data?.length ?? 0) === 0;
    expect(blocked).toBe(true);
  });

  // [6] Teacher can UPDATE (resolve) — set resolved_at
  it('teacher CAN update (resolve) an alert', async () => {
    const resolvedAt = new Date().toISOString();
    const { data, error } = await teacherClient
      .from('intervention_alerts')
      .update({ resolved_at: resolvedAt })
      .eq('id', activeAlertId)
      .select('id, resolved_at');
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
    expect(data?.[0]?.resolved_at).toBeTruthy();

    // Reset for downstream independence (service role).
    await admin
      .from('intervention_alerts')
      .update({ resolved_at: null })
      .eq('id', activeAlertId);
  });

  // [7] Student UPDATE → 0 rows affected (row unchanged)
  it('student UPDATE affects 0 rows and the alert is unchanged', async () => {
    const { data, error } = await studentClient
      .from('intervention_alerts')
      .update({ severity: 'urgent' })
      .eq('id', activeAlertId)
      .select('id');
    // No row visible to the student → 0 rows, no error (NOT an error case).
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(0);

    const { data: after } = await admin
      .from('intervention_alerts')
      .select('severity')
      .eq('id', activeAlertId)
      .single();
    expect(after?.severity).toBe('act');
  });

  // [8 — live half] Expired role grant does NOT grant access → 0 rows
  it('expired teacher grant (expires_at in the past) does NOT grant SELECT (0 rows, no error)', async () => {
    const { data, error } = await expiredTeacherClient
      .from('intervention_alerts')
      .select('id')
      .eq('id', activeAlertId);
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(0);
  });

  // [9 — live half] alert_type CHECK rejects invalid value → error.
  // Driven through the service role so the failure is the CHECK constraint, not RLS.
  it('inserting an invalid alert_type errors (CHECK constraint)', async () => {
    const id = crypto.randomUUID();
    created.push({ table: 'intervention_alerts', id });
    const { error } = await admin.from('intervention_alerts').insert({
      id,
      student_id: alertStudentId,
      alert_type: 'not_a_real_alert',
      severity: 'act',
    } as never);
    expect(error).not.toBeNull();
  });

  // [10 — live half] severity CHECK rejects invalid value → error.
  it('inserting an invalid severity errors (CHECK constraint)', async () => {
    const id = crypto.randomUUID();
    created.push({ table: 'intervention_alerts', id });
    const { error } = await admin.from('intervention_alerts').insert({
      id,
      student_id: alertStudentId,
      alert_type: 'consecutive_wrong',
      severity: 'catastrophic',
    } as never);
    expect(error).not.toBeNull();
  });
});

// Always-on guard against a path/rename regression silently greening the live block.
describe('REG-143 — intervention_alerts migration must be locatable', () => {
  it('migration is present at the expected path', () => {
    expect(MIGRATION_PRESENT).toBe(true);
  });
});
