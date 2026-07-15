/**
 * ensureSchoolAdminOnboarding() — Phase 6 self-serve subdomain-slug generation.
 *
 * The self-serve email onboarding path (complete-signup.ts →
 * ensureSchoolAdminOnboarding, packages/lib/src/identity/school-admin-bootstrap.ts)
 * previously left `schools.slug` NULL, so a freshly-signed-up school was matched
 * by NO subdomain and was unreachable at <slug>.alfanumrik.com. Phase 6 wires
 * resolveUniqueSchoolSlug() + patchSchoolDetails() so the helper now derives a
 * UNIQUE slug from the (server-normalized) school name and folds it into the same
 * `schools` UPDATE as city/state/principal_name.
 *
 * These tests pin the four Phase-6 guarantees, exercising the REAL helper with
 * only the Supabase admin-client seam mocked:
 *
 *   (a) NEW school (slug NULL) → a normalized, unique slug is written;
 *   (b) IDEMPOTENT — an existing non-null slug is NEVER overwritten (P15 re-run /
 *       operator-set values survive);
 *   (c) COLLISION — a taken candidate is suffixed until a free one is found;
 *   (d) FAIL-SOFT (P15) — a slug write failure (or resolution failure) does NOT
 *       throw or block onboarding; the helper still returns ok=true.
 *
 * Mock strategy (mirrors school-admin-bootstrap.test.ts): mock ONLY
 * @alfanumrik/lib/supabase-admin::getSupabaseAdmin and the fire-and-forget
 * tenant-claim dispatcher; the business logic under test (slug read → normalize →
 * collision probe → patch) runs for real. A per-table fake admin client captures
 * every slug probe + school UPDATE so we assert on OUTPUTS, not internal state.
 * Each test builds its own fake — no shared mutable state.
 *
 * This file is authored in packages/lib and reaches the apps/host vitest lane via
 * the apps/host/src/lib/identity/school-admin-slug.test.ts re-export stub (the same
 * mirror mechanism REG-243 used for school-claim{,-wiring}.test.ts).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Admin-client seam (read at CALL time inside ensureSchoolAdminOnboarding) ──
let currentAdmin: unknown;
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => currentAdmin,
}));

// The Phase-4 tenant-claim dispatch is fire-and-forget and orthogonal to the
// slug behaviour under test — stub it to a no-op so it adds no seam noise.
vi.mock('@alfanumrik/lib/identity/school-claim-wiring', () => ({
  dispatchSingleSchoolAdminClaim: () => {},
}));

import { ensureSchoolAdminOnboarding } from '@alfanumrik/lib/identity/school-admin-bootstrap';

// ── Fake admin client ─────────────────────────────────────────────────

interface Captured {
  /** Every candidate probed for collision (schools.select('id').eq('slug', X)). */
  slugProbes: string[];
  /** Count of current-slug reads (schools.select('slug').eq('id', X)). */
  currentSlugReads: number;
  /** Every patch passed to schools.update(...). */
  schoolUpdates: Array<Record<string, unknown>>;
}

interface Result {
  data: unknown;
  error: unknown;
}

interface SlugScenario {
  /** The current `schools.slug` value the idempotency read returns. Default null. */
  existingSlug?: string | null;
  /** Slugs that already collide when probed (schools.select('id').eq('slug', X)). */
  takenSlugs?: Set<string>;
  /** patchSchoolDetails: schools.update(...).eq('id', X) error (fail-soft). */
  updateError?: { message: string } | null;
  /** If true, the current-slug read throws → resolveUniqueSchoolSlug catches it. */
  slugReadThrows?: boolean;
  /** resolveSchoolIdForAdmin: school_admins.select('school_id').eq('id', X) result. */
  schoolId?: string | null;
  /** profile_id the bootstrap_user_profile RPC returns. Default 'sa-1'. */
  rpcProfileId?: string;
}

function makeAdmin(scenario: SlugScenario) {
  const captured: Captured = {
    slugProbes: [],
    currentSlugReads: 0,
    schoolUpdates: [],
  };
  const takenSlugs = scenario.takenSlugs ?? new Set<string>();

  const admin = {
    rpc: vi.fn(async (_name: string, _args: Record<string, unknown>) => ({
      data: { status: 'success', profile_id: scenario.rpcProfileId ?? 'sa-1' },
      error: null,
    })),
    from: (table: string) => ({
      select: (cols: string) => {
        // resolveSchoolIdForAdmin: school_admins.select('school_id').eq('id',X).maybeSingle()
        if (table === 'school_admins' && cols === 'school_id') {
          return {
            eq: () => ({
              maybeSingle: async (): Promise<Result> => ({
                data:
                  scenario.schoolId != null
                    ? { school_id: scenario.schoolId }
                    : null,
                error: null,
              }),
            }),
          };
        }
        // resolveUniqueSchoolSlug idempotency read: schools.select('slug').eq('id',X).maybeSingle()
        if (table === 'schools' && cols === 'slug') {
          return {
            eq: () => ({
              maybeSingle: async (): Promise<Result> => {
                captured.currentSlugReads += 1;
                if (scenario.slugReadThrows) throw new Error('slug read blew up');
                return {
                  data: { slug: scenario.existingSlug ?? null },
                  error: null,
                };
              },
            }),
          };
        }
        // resolveUniqueSchoolSlug collision probe: schools.select('id').eq('slug',cand).maybeSingle()
        if (table === 'schools' && cols === 'id') {
          return {
            eq: (_col: string, candidate: unknown) => ({
              maybeSingle: async (): Promise<Result> => {
                const value = String(candidate);
                captured.slugProbes.push(value);
                return {
                  data: takenSlugs.has(value) ? { id: 'other-school' } : null,
                  error: null,
                };
              },
            }),
          };
        }
        // Unused select shapes fall through to an empty terminal.
        return {
          eq: () => ({ maybeSingle: async (): Promise<Result> => ({ data: null, error: null }) }),
        };
      },
      update: (patch: Record<string, unknown>) => {
        if (table === 'schools') captured.schoolUpdates.push(patch);
        return {
          eq: async (): Promise<Result> => ({
            data: null,
            error: scenario.updateError ?? null,
          }),
        };
      },
      upsert: async (): Promise<Result> => ({ data: null, error: null }),
      // Not reached on the RPC-success path, present for safety.
      insert: () => ({ select: () => ({ single: async (): Promise<Result> => ({ data: null, error: null }) }) }),
    }),
  };

  return { admin, captured };
}

function params(overrides: Partial<Record<string, string | null>> = {}) {
  return {
    authUserId: 'auth-sa-1',
    name: 'Priya Menon',
    email: 'principal@dps.example.com',
    schoolName: 'Delhi Public School',
    city: 'Jaipur',
    state: 'Rajasthan',
    board: 'CBSE',
    principalName: 'Priya Menon',
    phone: '+919876500000',
    ...overrides,
  };
}

beforeEach(() => {
  // Keep expected fail-soft console.error/warn noise out of the reporter.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── (a) NEW school (slug NULL) → normalized unique slug written ─────────

describe('ensureSchoolAdminOnboarding — Phase 6 slug: new school (NULL slug)', () => {
  it('writes a normalized, unique slug derived from the school name', async () => {
    const { admin, captured } = makeAdmin({
      existingSlug: null, // fresh school has slug=NULL
      schoolId: 'school-1',
    });
    currentAdmin = admin;

    const result = await ensureSchoolAdminOnboarding(params());

    // It read the current slug once (found NULL) then probed exactly one free
    // candidate — the normalized name.
    expect(captured.currentSlugReads).toBe(1);
    expect(captured.slugProbes).toEqual(['delhi-public-school']);

    // The slug was folded into the SAME schools UPDATE as city/state.
    expect(captured.schoolUpdates).toHaveLength(1);
    const patch = captured.schoolUpdates[0];
    expect(patch.slug).toBe('delhi-public-school');
    // Server-derived + normalized: lowercase, hyphen-delimited, url-safe.
    expect(patch.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    // Patched alongside the other RPC-uncarried columns (single round-trip).
    expect(patch).toMatchObject({ city: 'Jaipur', state: 'Rajasthan' });

    expect(result.ok).toBe(true);
    expect(result.schoolId).toBe('school-1');
  });

  it("falls back to the 'school' base when the name normalizes to empty", async () => {
    const { admin, captured } = makeAdmin({
      existingSlug: null,
      schoolId: 'school-1',
    });
    currentAdmin = admin;

    // '###' is a non-empty (so not defaulted to 'My School') name that
    // normalizeSlug() strips to '' → base falls back to 'school'.
    const result = await ensureSchoolAdminOnboarding(params({ schoolName: '###' }));

    expect(captured.slugProbes).toEqual(['school']);
    expect(captured.schoolUpdates[0].slug).toBe('school');
    expect(result.ok).toBe(true);
  });
});

// ── (b) IDEMPOTENT — an existing non-null slug is NEVER overwritten ──────

describe('ensureSchoolAdminOnboarding — Phase 6 slug: idempotent (never overwrites)', () => {
  it('does NOT overwrite an existing non-null slug and never even probes for a new one', async () => {
    const { admin, captured } = makeAdmin({
      existingSlug: 'my-school-original', // operator-set / prior-run value
      schoolId: 'school-1',
    });
    currentAdmin = admin;

    const result = await ensureSchoolAdminOnboarding(params());

    // The idempotency read short-circuits: no collision probe, no slug candidate.
    expect(captured.currentSlugReads).toBe(1);
    expect(captured.slugProbes).toEqual([]);

    // The schools UPDATE still runs for the other columns, but carries NO slug key
    // — the pre-existing slug is left untouched.
    expect(captured.schoolUpdates).toHaveLength(1);
    const patch = captured.schoolUpdates[0];
    expect(patch).not.toHaveProperty('slug');
    expect(patch).toMatchObject({ city: 'Jaipur', state: 'Rajasthan' });

    expect(result.ok).toBe(true);
  });
});

// ── (c) COLLISION — suffix the candidate until a free slug is found ─────

describe('ensureSchoolAdminOnboarding — Phase 6 slug: collision suffixing', () => {
  it('suffixes -1 when the base slug is already taken', async () => {
    const { admin, captured } = makeAdmin({
      existingSlug: null,
      takenSlugs: new Set(['delhi-public-school']),
      schoolId: 'school-1',
    });
    currentAdmin = admin;

    const result = await ensureSchoolAdminOnboarding(params());

    // Probed the base (taken), then base-1 (free).
    expect(captured.slugProbes).toEqual([
      'delhi-public-school',
      'delhi-public-school-1',
    ]);
    expect(captured.schoolUpdates[0].slug).toBe('delhi-public-school-1');
    expect(result.ok).toBe(true);
  });

  it('increments the numeric suffix across multiple consecutive collisions', async () => {
    const { admin, captured } = makeAdmin({
      existingSlug: null,
      takenSlugs: new Set([
        'delhi-public-school',
        'delhi-public-school-1',
        'delhi-public-school-2',
      ]),
      schoolId: 'school-1',
    });
    currentAdmin = admin;

    const result = await ensureSchoolAdminOnboarding(params());

    // base, -1, -2 all taken → resolves the first free candidate -3.
    expect(captured.slugProbes).toEqual([
      'delhi-public-school',
      'delhi-public-school-1',
      'delhi-public-school-2',
      'delhi-public-school-3',
    ]);
    expect(captured.schoolUpdates[0].slug).toBe('delhi-public-school-3');
    expect(result.ok).toBe(true);
  });
});

// ── (d) FAIL-SOFT (P15) — a slug write/resolve failure never blocks signup ──

describe('ensureSchoolAdminOnboarding — Phase 6 slug: fail-soft (P15)', () => {
  it('does not throw and still returns ok=true when the slug UPDATE hits a unique-violation', async () => {
    const { admin, captured } = makeAdmin({
      existingSlug: null,
      schoolId: 'school-1',
      // Residual TOCTOU collision surfaces as a 23505 on the write — must be
      // swallowed, never surfaced into the auth flow.
      updateError: {
        message:
          'duplicate key value violates unique constraint "schools_slug_key"',
      },
    });
    currentAdmin = admin;

    const result = await ensureSchoolAdminOnboarding(params());

    // The write was attempted (slug resolved + patched)...
    expect(captured.schoolUpdates).toHaveLength(1);
    expect(captured.schoolUpdates[0].slug).toBe('delhi-public-school');
    // ...but its failure did NOT block signup.
    expect(result.ok).toBe(true);
    expect(result.schoolAdminId).toBe('sa-1');
  });

  it('does not throw when slug RESOLUTION fails (read throws); still patches other details, no slug', async () => {
    const { admin, captured } = makeAdmin({
      existingSlug: null,
      slugReadThrows: true, // resolveUniqueSchoolSlug catches → returns null slug
      schoolId: 'school-1',
    });
    currentAdmin = admin;

    const result = await ensureSchoolAdminOnboarding(params());

    // Resolution bailed before any collision probe.
    expect(captured.slugProbes).toEqual([]);
    // The schools UPDATE still runs for city/state, but carries NO slug.
    expect(captured.schoolUpdates).toHaveLength(1);
    expect(captured.schoolUpdates[0]).not.toHaveProperty('slug');
    expect(captured.schoolUpdates[0]).toMatchObject({ city: 'Jaipur' });
    // Onboarding completes regardless.
    expect(result.ok).toBe(true);
  });
});
