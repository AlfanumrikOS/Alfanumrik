/**
 * src/lib/dpdp/consent.ts — Phase D.1 unit tests.
 *
 * Pins:
 *   - recordConsent inserts a row with the right shape, returns its id.
 *   - recordConsent rejects unknown scopes (INVALID_INPUT).
 *   - recordConsent surfaces the unique-active conflict as CONFLICT.
 *   - revokeConsent flips revoked_at on the active row, returns the id.
 *   - revokeConsent returns NOT_FOUND when no active row exists.
 *   - hasActiveConsent returns TRUE for a fresh grant, FALSE after revoke,
 *     FALSE when consent_version does not match the requiredVersion.
 *   - listActiveConsentForGuardian only returns un-revoked rows.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Logger silencer ────────────────────────────────────────────────────
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── In-memory supabaseAdmin mock ───────────────────────────────────────
// The consent helpers chain .from('parental_consent').insert/.update/.select.
// We model a single table row[] with chainable builders.

type Row = {
  id: string;
  guardian_id: string;
  student_id: string;
  consent_version: string;
  granted_at: string;
  revoked_at: string | null;
  consent_payload: unknown;
  ip_address: string | null;
  user_agent: string | null;
};

let table: Row[] = [];
let nextId = 1;

// Used in tests to force the unique-constraint error path.
let nextInsertError: { code: string; message: string } | null = null;

function makeBuilder() {
  type Pred = (r: Row) => boolean;
  const filters: Pred[] = [];
  let pendingPatch: Partial<Row> | null = null;
  let pendingInsert: Partial<Row> | null = null;
  let selectCols: string | null = null;

  const chain = {
    select(cols?: string) {
      selectCols = cols ?? null;
      return chain;
    },
    insert(values: Partial<Row>) {
      pendingInsert = values;
      return chain;
    },
    update(patch: Partial<Row>) {
      pendingPatch = patch;
      return chain;
    },
    eq(col: string, val: unknown) {
      filters.push((r) => (r as Record<string, unknown>)[col] === val);
      return chain;
    },
    is(col: string, val: unknown) {
      filters.push((r) => (r as Record<string, unknown>)[col] === val);
      return chain;
    },
    async single() {
      if (pendingInsert) {
        if (nextInsertError) {
          const e = nextInsertError;
          nextInsertError = null;
          return { data: null, error: e };
        }
        // Enforce unique constraint on (guardian_id, student_id, revoked_at)
        const newRow: Row = {
          id: `c-${nextId++}`,
          guardian_id: String(pendingInsert.guardian_id ?? ''),
          student_id: String(pendingInsert.student_id ?? ''),
          consent_version: String(pendingInsert.consent_version ?? ''),
          granted_at: new Date().toISOString(),
          revoked_at: (pendingInsert.revoked_at as string | null) ?? null,
          consent_payload: pendingInsert.consent_payload ?? {},
          ip_address: (pendingInsert.ip_address as string | null) ?? null,
          user_agent: (pendingInsert.user_agent as string | null) ?? null,
        };
        const dup = table.find(
          (r) =>
            r.guardian_id === newRow.guardian_id &&
            r.student_id === newRow.student_id &&
            r.revoked_at === newRow.revoked_at,
        );
        if (dup) {
          return { data: null, error: { code: '23505', message: 'unique_violation' } };
        }
        table.push(newRow);
        return { data: { id: newRow.id }, error: null };
      }
      // Plain SELECT … .single()
      const r = table.filter((row) => filters.every((p) => p(row)));
      return { data: r[0] ?? null, error: null };
    },
    async maybeSingle() {
      if (pendingPatch) {
        const matched = table.filter((r) => filters.every((p) => p(r)));
        for (const m of matched) Object.assign(m, pendingPatch);
        return { data: matched[0] ? { id: matched[0].id } : null, error: null };
      }
      const r = table.filter((row) => filters.every((p) => p(row)));
      return { data: r[0] ?? null, error: null };
    },
    then(...args: Parameters<Promise<unknown>['then']>) {
      // Bare await on the chain (used by listActiveConsentForGuardian)
      const r = table.filter((row) => filters.every((p) => p(row)));
      // Project the columns the helper requested
      const data = selectCols
        ? r.map((row) => {
            const out: Record<string, unknown> = {};
            for (const c of selectCols!.split(',').map((s) => s.trim())) {
              out[c] = (row as unknown as Record<string, unknown>)[c];
            }
            return out;
          })
        : r;
      return Promise.resolve({ data, error: null }).then(...args);
    },
  };
  return chain;
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from(tbl: string) {
      if (tbl !== 'parental_consent') {
        throw new Error(`unexpected table: ${tbl}`);
      }
      return makeBuilder();
    },
  },
}));

import {
  recordConsent,
  revokeConsent,
  hasActiveConsent,
  listActiveConsentForGuardian,
  CURRENT_CONSENT_VERSION,
} from '@alfanumrik/lib/dpdp/consent';

const G1 = '11111111-1111-1111-1111-111111111111';
const G2 = '22222222-2222-2222-2222-222222222222';
const S1 = '33333333-3333-3333-3333-333333333333';
const S2 = '44444444-4444-4444-4444-444444444444';

beforeEach(() => {
  table = [];
  nextId = 1;
  nextInsertError = null;
});

describe('recordConsent', () => {
  it('inserts a row and returns the new id', async () => {
    const r = await recordConsent({
      guardianId: G1,
      studentId: S1,
      consentVersion: CURRENT_CONSENT_VERSION,
      scopes: { curriculum_access: true },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toMatch(/^c-/);
    expect(table).toHaveLength(1);
    expect(table[0].guardian_id).toBe(G1);
    expect(table[0].student_id).toBe(S1);
    expect(table[0].revoked_at).toBeNull();
  });

  it('rejects unknown scope keys with INVALID_INPUT', async () => {
    const r = await recordConsent({
      guardianId: G1,
      studentId: S1,
      consentVersion: CURRENT_CONSENT_VERSION,
      scopes: { curriculum_access: true, hacker_scope: true } as never,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INVALID_INPUT');
    expect(table).toHaveLength(0);
  });

  it('rejects empty guardianId / studentId with INVALID_INPUT', async () => {
    const r1 = await recordConsent({
      guardianId: '',
      studentId: S1,
      consentVersion: 'v',
      scopes: {},
    });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.code).toBe('INVALID_INPUT');

    const r2 = await recordConsent({
      guardianId: G1,
      studentId: '',
      consentVersion: 'v',
      scopes: {},
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.code).toBe('INVALID_INPUT');
  });

  it('surfaces unique-active conflict as CONFLICT', async () => {
    // First insert succeeds.
    await recordConsent({
      guardianId: G1,
      studentId: S1,
      consentVersion: 'v1',
      scopes: { curriculum_access: true },
    });
    // Second insert (same guardian + student, both with revoked_at=null)
    // collides on the unique constraint.
    const r = await recordConsent({
      guardianId: G1,
      studentId: S1,
      consentVersion: 'v1',
      scopes: { curriculum_access: true },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('CONFLICT');
  });
});

describe('revokeConsent', () => {
  it('flips revoked_at on the active row and returns its id', async () => {
    const granted = await recordConsent({
      guardianId: G1,
      studentId: S1,
      consentVersion: 'v1',
      scopes: { curriculum_access: true },
    });
    expect(granted.ok).toBe(true);

    const revoked = await revokeConsent({ guardianId: G1, studentId: S1 });
    expect(revoked.ok).toBe(true);
    expect(table[0].revoked_at).not.toBeNull();
  });

  it('returns NOT_FOUND when there is no active row', async () => {
    const r = await revokeConsent({ guardianId: G1, studentId: S1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NOT_FOUND');
  });

  it('rejects empty inputs with INVALID_INPUT', async () => {
    const r = await revokeConsent({ guardianId: '', studentId: S1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INVALID_INPUT');
  });
});

describe('hasActiveConsent', () => {
  it('returns TRUE for a freshly granted row', async () => {
    await recordConsent({
      guardianId: G1,
      studentId: S1,
      consentVersion: 'v1',
      scopes: { curriculum_access: true },
    });
    const r = await hasActiveConsent({ guardianId: G1, studentId: S1 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toBe(true);
  });

  it('returns FALSE after revoke', async () => {
    await recordConsent({
      guardianId: G1,
      studentId: S1,
      consentVersion: 'v1',
      scopes: { curriculum_access: true },
    });
    await revokeConsent({ guardianId: G1, studentId: S1 });
    const r = await hasActiveConsent({ guardianId: G1, studentId: S1 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toBe(false);
  });

  it('returns FALSE when requiredVersion does not match', async () => {
    await recordConsent({
      guardianId: G1,
      studentId: S1,
      consentVersion: 'v1',
      scopes: { curriculum_access: true },
    });
    const r = await hasActiveConsent({
      guardianId: G1,
      studentId: S1,
      requiredVersion: 'v2',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toBe(false);
  });

  it('returns TRUE when requiredVersion matches the stored version', async () => {
    await recordConsent({
      guardianId: G1,
      studentId: S1,
      consentVersion: 'v9',
      scopes: { curriculum_access: true },
    });
    const r = await hasActiveConsent({
      guardianId: G1,
      studentId: S1,
      requiredVersion: 'v9',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toBe(true);
  });
});

describe('listActiveConsentForGuardian', () => {
  it('returns only un-revoked rows for the given guardian', async () => {
    await recordConsent({
      guardianId: G1,
      studentId: S1,
      consentVersion: 'v1',
      scopes: { curriculum_access: true },
    });
    await recordConsent({
      guardianId: G1,
      studentId: S2,
      consentVersion: 'v1',
      scopes: { curriculum_access: true },
    });
    // A different guardian's row must not surface.
    await recordConsent({
      guardianId: G2,
      studentId: S1,
      consentVersion: 'v1',
      scopes: { curriculum_access: true },
    });
    await revokeConsent({ guardianId: G1, studentId: S2 });

    const r = await listActiveConsentForGuardian(G1);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toHaveLength(1);
      expect(r.data[0].studentId).toBe(S1);
    }
  });

  it('returns INVALID_INPUT for empty guardianId', async () => {
    const r = await listActiveConsentForGuardian('');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INVALID_INPUT');
  });
});
