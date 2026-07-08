import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * RLS boundary regression for `public.system_metrics` (P8/P9/P13 — monitoring
 * data boundary). Catalogued as REG-143.
 *
 * Migration under test:
 *   supabase/migrations/20260615122659_create_system_metrics.sql
 *
 * system_metrics is the platform-telemetry table. Its security contract:
 *   1. SELECT is restricted to admin / super_admin via a user_roles × roles
 *      join (carrying the active + expired-grant guard). Teachers, students,
 *      and anon read 0 rows, no error.
 *   2. There is NO INSERT policy — the service_role bypasses RLS and is the
 *      ONLY writer. An authenticated non-admin INSERT is rejected (no policy
 *      → no rows / error). The file therefore contains exactly ONE CREATE
 *      POLICY and it is FOR SELECT only.
 *   3. The empty-string guard for metric_name is an APP-LEVEL guard inside
 *      logSystemMetric() (src/lib/monitoring/log-event.ts), NOT a DB
 *      constraint — asserted by reading that source read-only.
 *
 * Test strategy — STRUCTURAL (always-on, source-level over the migration .sql
 * + the app guard source) + LIVE (describe.skipIf(!LIVE_DB), real per-role
 * authenticated clients + a service-role client). Mirrors the repo's RLS-test
 * pattern and the live-DB skipIf gate.
 *
 * No hardcoded UUIDs — every id is crypto.randomUUID(). auth.uid() is never
 * hardcoded — live tests authenticate real users per role.
 */

// -----------------------------------------------------------------------------
// Migration source resolution + whitespace-tolerant normalisation
// -----------------------------------------------------------------------------

const MIGRATION_FILE =
  'supabase/migrations/20260615122659_create_system_metrics.sql';

const LOG_EVENT_FILE = 'src/lib/monitoring/log-event.ts';

function resolveRepoFile(rel: string): string | null {
  const candidates = [
    path.resolve(process.cwd(), rel),
    path.resolve(process.cwd(), '..', rel),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

const MIGRATION_PATH = resolveRepoFile(MIGRATION_FILE);
const MIGRATION_PRESENT = MIGRATION_PATH !== null;
const LOG_EVENT_PATH = resolveRepoFile(LOG_EVENT_FILE);
const LOG_EVENT_PRESENT = LOG_EVENT_PATH !== null;

function readFile(p: string | null): string {
  if (!p) return '';
  return fs.readFileSync(p, 'utf-8');
}

function normalisedSql(): string {
  const sql = readFile(MIGRATION_PATH);
  const noLineComments = sql.replace(/^\s*--.*$/gm, '');
  const noBlockComments = noLineComments.replace(/\/\*[\s\S]*?\*\//g, '');
  return noBlockComments.replace(/\s+/g, ' ');
}

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

describe('REG-143 — system_metrics migration presence & structure (source-level)', () => {
  it(`${MIGRATION_FILE} exists`, () => {
    expect(MIGRATION_PRESENT).toBe(true);
  });

  it('enables Row Level Security on the table', () => {
    expect(normalisedSql()).toMatch(
      /ALTER TABLE public\.system_metrics ENABLE ROW LEVEL SECURITY/,
    );
  });

  it('does NOT drop any tables or columns (P8: non-destructive)', () => {
    const sql = normalisedSql();
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/DROP COLUMN/i);
  });

  it('recorded_at defaults to now()', () => {
    expect(normalisedSql()).toMatch(
      /recorded_at timestamptz NOT NULL DEFAULT now\(\)/i,
    );
  });

  it('declares the expected indexes (name+time, route+time)', () => {
    const sql = normalisedSql();
    expect(sql).toContain('idx_system_metrics_name_time');
    expect(sql).toContain('idx_system_metrics_route_time');
  });
});

describe('REG-143 — system_metrics admin-only read, service-role-only write (source-level)', () => {
  it('SELECT policy is gated on roles admin/super_admin via user_roles join', () => {
    const sql = normalisedSql();
    expect(sql).toMatch(
      /CREATE POLICY "admin_system_metrics_select" ON public\.system_metrics FOR SELECT/i,
    );
    expect(sql).toContain("r.name IN ('admin','super_admin')");
  });

  it('the role join carries the active + expired-grant guard', () => {
    const sql = normalisedSql();
    expect(sql).toContain('ur.is_active = true');
    expect(sql).toContain('ur.expires_at IS NULL OR ur.expires_at > now()');
  });

  it('NO policy uses an open predicate (USING (true) / WITH CHECK (true))', () => {
    const sql = normalisedSql();
    expect(sql).not.toMatch(/USING\s*\(\s*true\s*\)/i);
    expect(sql).not.toMatch(/WITH CHECK\s*\(\s*true\s*\)/i);
  });

  // [7 — structural half] exactly ONE CREATE POLICY, and it is FOR SELECT only.
  it('contains EXACTLY ONE CREATE POLICY and it is FOR SELECT (no INSERT/UPDATE/DELETE policy)', () => {
    const sql = normalisedSql();
    const policyCount = (sql.match(/CREATE POLICY/g) || []).length;
    expect(policyCount).toBe(1);
    expect(sql).toMatch(/CREATE POLICY[^;]*FOR SELECT/i);
    expect(sql).not.toMatch(/CREATE POLICY[^;]*FOR INSERT/i);
    expect(sql).not.toMatch(/CREATE POLICY[^;]*FOR UPDATE/i);
    expect(sql).not.toMatch(/CREATE POLICY[^;]*FOR DELETE/i);
    expect(sql).not.toMatch(/CREATE POLICY[^;]*FOR ALL/i);
  });
});

// [8] metric_name empty-string guard is APP-LEVEL in logSystemMetric — NOT a
// DB constraint. We assert the guard exists by reading the source read-only.
describe('REG-143 — system_metrics metric_name guard is APP-LEVEL (source-level)', () => {
  it(`${LOG_EVENT_FILE} exists`, () => {
    expect(LOG_EVENT_PRESENT).toBe(true);
  });

  it('logSystemMetric early-returns on empty / whitespace-only metric_name', () => {
    // NOTE: this guard lives in application code, NOT in the migration — the DB
    // column is plain `metric_name text NOT NULL` with no length/blank CHECK, so
    // the empty-string defense is asserted against the app source here.
    const src = readFile(LOG_EVENT_PATH).replace(/\s+/g, ' ');
    expect(src).toContain('export async function logSystemMetric');
    // The guard checks falsy OR trimmed-empty, then returns before the insert.
    expect(src).toMatch(
      /if \(!metric\.metric_name \|\| metric\.metric_name\.trim\(\) === ''\)/,
    );
    // It must short-circuit (return) before the supabaseAdmin insert.
    const guardIdx = src.indexOf("metric.metric_name.trim() === ''");
    const insertIdx = src.indexOf(".from('system_metrics')");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(insertIdx);
    // A `return;` must appear between the guard and the insert.
    const between = src.slice(guardIdx, insertIdx);
    expect(between).toContain('return;');
  });
});

// -----------------------------------------------------------------------------
// LIVE assertions — real database, real per-role authenticated users + service role
// -----------------------------------------------------------------------------

describe.skipIf(!LIVE_DB)('REG-143 — system_metrics live RLS', () => {
  let admin: SupabaseClient; // service role — RLS bypass writer + setup/teardown

  let adminRoleClient: SupabaseClient;
  let superAdminClient: SupabaseClient;
  let teacherClient: SupabaseClient;
  let studentClient: SupabaseClient;
  let anon: SupabaseClient;

  const created: string[] = [];
  const userIds: string[] = [];
  const password = `Pw-${crypto.randomUUID()}`;

  let seededMetricId: string;

  async function grantRole(authUserId: string, roleName: string) {
    const { data: role, error: roleErr } = await admin
      .from('roles')
      .select('id')
      .eq('name', roleName)
      .single();
    if (roleErr) throw new Error(`role lookup '${roleName}' failed: ${roleErr.message}`);
    const { error } = await admin.from('user_roles').insert({
      auth_user_id: authUserId,
      role_id: role!.id,
      is_active: true,
      expires_at: null,
    });
    if (error) throw new Error(`grantRole '${roleName}' failed: ${error.message}`);
  }

  async function makeUser(): Promise<{ id: string; client: SupabaseClient }> {
    const { createClient } = await import('@supabase/supabase-js');
    const email = `sm-${crypto.randomUUID()}@test.invalid`;
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

    const adminUser = await makeUser();
    adminRoleClient = adminUser.client;
    await grantRole(adminUser.id, 'admin');

    const superAdmin = await makeUser();
    superAdminClient = superAdmin.client;
    await grantRole(superAdmin.id, 'super_admin');

    const teacher = await makeUser();
    teacherClient = teacher.client;
    await grantRole(teacher.id, 'teacher');

    const student = await makeUser();
    studentClient = student.client;

    anon = createClient(SUPABASE_URL!, ANON_KEY!, {
      auth: { persistSession: false },
    });

    // Seed one metric via service role (RLS bypass).
    seededMetricId = crypto.randomUUID();
    created.push(seededMetricId);
    const { error } = await admin.from('system_metrics').insert({
      id: seededMetricId,
      metric_name: `test.metric.${crypto.randomUUID()}`,
      value: 1,
    });
    if (error) throw new Error(`seed metric failed: ${error.message}`);
  });

  afterAll(async () => {
    if (!admin) return;
    for (const id of created) {
      await admin.from('system_metrics').delete().eq('id', id);
    }
    for (const uid of userIds) {
      await admin.from('user_roles').delete().eq('auth_user_id', uid);
      await admin.auth.admin.deleteUser(uid);
    }
  });

  // [1] Admin can SELECT
  it('admin CAN select metrics', async () => {
    const { data, error } = await adminRoleClient
      .from('system_metrics')
      .select('id')
      .eq('id', seededMetricId);
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });

  // [2] Super_admin can SELECT
  it('super_admin CAN select metrics', async () => {
    const { data, error } = await superAdminClient
      .from('system_metrics')
      .select('id')
      .eq('id', seededMetricId);
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });

  // [3] Teacher cannot SELECT → 0 rows, no error
  it('teacher CANNOT select metrics (0 rows, no error)', async () => {
    const { data, error } = await teacherClient
      .from('system_metrics')
      .select('id')
      .eq('id', seededMetricId);
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(0);
  });

  // [4] Student cannot SELECT → 0 rows, no error
  it('student CANNOT select metrics (0 rows, no error)', async () => {
    const { data, error } = await studentClient
      .from('system_metrics')
      .select('id')
      .eq('id', seededMetricId);
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(0);
  });

  // [5] Unauthenticated cannot SELECT → 0 rows or error
  it('unauthenticated CANNOT select metrics (0 rows or error)', async () => {
    const { data, error } = await anon
      .from('system_metrics')
      .select('id')
      .eq('id', seededMetricId);
    const blocked = error !== null || (data?.length ?? 0) === 0;
    expect(blocked).toBe(true);
  });

  // [6] Service-role client can INSERT (RLS bypass) → succeeds
  it('service-role client CAN insert a metric (RLS bypass)', async () => {
    const id = crypto.randomUUID();
    created.push(id);
    const { error } = await admin.from('system_metrics').insert({
      id,
      metric_name: `test.metric.${crypto.randomUUID()}`,
      value: 42,
    });
    expect(error).toBeNull();
  });

  // [7 — live half] authenticated non-admin INSERT → rejected (no INSERT policy)
  it('authenticated non-admin (admin-role read user) INSERT is rejected (no INSERT policy)', async () => {
    const id = crypto.randomUUID();
    created.push(id);
    // Even the admin-ROLE user (who CAN read) has no INSERT policy — writes are
    // service-role-only. So this insert must be rejected (error or 0 rows).
    const { data, error } = await adminRoleClient
      .from('system_metrics')
      .insert({
        id,
        metric_name: `test.metric.${crypto.randomUUID()}`,
        value: 7,
      })
      .select('id');
    const rejected = error !== null || (data?.length ?? 0) === 0;
    expect(rejected).toBe(true);

    // Confirm nothing landed (service-role re-SELECT).
    const { data: after } = await admin
      .from('system_metrics')
      .select('id')
      .eq('id', id);
    expect(after?.length ?? 0).toBe(0);
  });

  // A plain student INSERT is likewise rejected (no policy at all).
  it('student INSERT is rejected (no INSERT policy)', async () => {
    const id = crypto.randomUUID();
    created.push(id);
    const { data, error } = await studentClient
      .from('system_metrics')
      .insert({
        id,
        metric_name: `test.metric.${crypto.randomUUID()}`,
        value: 3,
      })
      .select('id');
    const rejected = error !== null || (data?.length ?? 0) === 0;
    expect(rejected).toBe(true);
  });
});

// Always-on guard against a path/rename regression silently greening the live block.
describe('REG-143 — system_metrics migration must be locatable', () => {
  it('migration is present at the expected path', () => {
    expect(MIGRATION_PRESENT).toBe(true);
  });
});
