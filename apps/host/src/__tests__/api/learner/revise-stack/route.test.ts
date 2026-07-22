/**
 * GET /api/learner/revise-stack — REG-303: dead-flag-gate regression guard.
 *
 * Production incident (2026-07-21, discovered during Master Action Plan
 * Phase 6 mobile-parity work): this route gated on
 * `isFeatureEnabled('ff_revise_route_v1')`, but migration
 * `20260603120000_remove_ff_revise_route_v1.sql` DELETED that flag row once
 * the standalone /revise page was folded into /refresh's "Chapter Refresh"
 * section (Study Menu v2 consolidation). `isFeatureEnabled()` returns
 * `false` for any nonexistent flag row, so the route started returning 404
 * UNCONDITIONALLY for every student in production. Both the web /refresh
 * page's Chapter Refresh section and the mobile Refresh screen swallow a
 * 404 into a silent empty state (`setItems([])`), so nobody saw an error —
 * the section just quietly never rendered.
 *
 * Fix: the dead `isFeatureEnabled('ff_revise_route_v1')` gate was removed
 * from the route entirely (matching the permanent-default pattern used for
 * `ff_study_menu_v2`) instead of re-seeding the deleted flag, which would
 * only recreate the same "flag lifecycle drifts from code" fragility.
 *
 * This suite pins the fix and the regression class: even if a collaborator
 * mocks `isFeatureEnabled` to return `false` for every flag (simulating the
 * exact "flag row doesn't exist" production state), the route must still
 * serve real data — proving the route no longer reads that flag at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const USER_ID = '11111111-1111-4111-8111-111111111111';

// Auth: always a signed-in student, unless a test overrides it.
let authUser: { id: string } | null = { id: USER_ID };
vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: authUser },
        error: authUser ? null : new Error('no session'),
      })),
    },
  })),
}));

// Feature flags: EVERY flag (including the deleted ff_revise_route_v1)
// resolves to `false` — this is byte-for-byte the production state after
// the flag row was dropped. The route must NOT consult this at all.
const isFeatureEnabled = vi.fn(async () => false);
vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: (...args: unknown[]) => isFeatureEnabled(...(args as [])),
}));

// State builder: returns a minimal StudentState. Individual tests can
// swap `stateOverride` to drive decayedChapters() into different branches.
let stateOverride: unknown = { mastery: [] };
vi.mock('@alfanumrik/lib/state/student-state-builder', () => ({
  createStudentStateBuilder: vi.fn(() => vi.fn(async () => stateOverride)),
}));

// Logger: inert.
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Import the route AFTER the mocks are registered.
import { GET } from '@/app/api/learner/revise-stack/route';

function mkReq(): Request {
  return new Request('http://localhost/api/learner/revise-stack', { method: 'GET' });
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe('GET /api/learner/revise-stack — REG-303 dead-flag-gate regression', () => {
  beforeEach(() => {
    authUser = { id: USER_ID };
    isFeatureEnabled.mockClear();
    isFeatureEnabled.mockResolvedValue(false);
    stateOverride = { mastery: [] };
  });

  it('returns REAL data (200, not 404) for an eligible student even when every feature flag — including the deleted ff_revise_route_v1 — resolves to false', async () => {
    // A decayed chapter: mastery above the revise floor, last touched well
    // past the retention window, so decayedChapters() surfaces it.
    stateOverride = {
      mastery: [
        {
          subjectCode: 'math',
          chapters: [
            {
              chapterNumber: 3,
              mastery: 0.72,
              lastUpdatedAt: isoDaysAgo(60),
            },
          ],
        },
      ],
    };

    const res = await GET(mkReq());

    // The core regression assertion: the route must NOT 404 just because
    // isFeatureEnabled() says every flag (including the now-nonexistent
    // ff_revise_route_v1) is off.
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.schemaVersion).toBe(1);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBe(1);
    expect(body.items[0]).toMatchObject({
      subjectCode: 'math',
      chapterNumber: 3,
      mastery: 0.72,
    });
    expect(typeof body.items[0].daysSinceLastTouch).toBe('number');
    expect(body.items[0].url).toBe('/learn/math/3?mode=read&from=revise');
  });

  it('never reads any feature flag at all (isFeatureEnabled is not called)', async () => {
    stateOverride = {
      mastery: [
        {
          subjectCode: 'science',
          chapters: [{ chapterNumber: 1, mastery: 0.9, lastUpdatedAt: isoDaysAgo(90) }],
        },
      ],
    };

    const res = await GET(mkReq());

    expect(res.status).toBe(200);
    // The route was fixed by deleting the gate, not by hardcoding it to
    // true — this asserts the collaborator is genuinely unused, so no
    // future refactor can quietly reintroduce a flag dependency without a
    // test noticing.
    expect(isFeatureEnabled).not.toHaveBeenCalled();
  });

  it('401 when unauthenticated', async () => {
    authUser = null;
    const res = await GET(mkReq());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthenticated');
  });

  it('404 no_decayed_topics when the student has nothing decayed (not a flag-off 404)', async () => {
    stateOverride = { mastery: [] };
    const res = await GET(mkReq());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('no_decayed_topics');
  });
});
