/**
 * GET /api/rhythm/today — Phase A Loop A remediation lane (SERVER half).
 *
 * The client half of this contract is pinned in
 * src/__tests__/components/dashboard/DailyRhythmQueue.remediation.test.tsx
 * (flag-OFF shape, card rendering, malformed-card drops). These tests pin the
 * route-side guarantees the component relies on:
 *
 *   1. FLAG-OFF BYTE-IDENTICAL QUEUE: ff_adaptive_remediation_v1 OFF ⇒ the
 *      lane builder short-circuits BEFORE the adaptive_interventions read
 *      (zero lane I/O) and the response carries no 'remediation_review' kind —
 *      the base 7-item Wave 1B queue object is returned untouched.
 *
 *   2. CAPS + ORDERING AT THE ROUTE LAYER: ≤ max_remediation_cards_per_day
 *      (3) cards even with more active interventions; deepest
 *      trigger_snapshot.largestDrop first via the adapter's EXPORTED
 *      compareBySeverity (null/corrupt snapshots sort last); priority is
 *      1-based over injected cards only; the lane is spliced AFTER the SRS
 *      block (index min(5, base length)) and the base items around it are
 *      UNCHANGED element-for-element vs the flag-OFF run.
 *
 *   3. FROZEN ITEM CONTRACT: each card is exactly
 *      { kind: 'remediation_review', subjectCode, chapterNumber,
 *        interventionId, priority } — what the dashboard component consumes.
 *
 *   4. ENHANCEMENT, NEVER A 500: a lane query error AND a lane-builder
 *      exception both degrade to the base queue (200), never an error status.
 *
 *   5. P8 SCOPING: the lane reads adaptive_interventions through the
 *      RLS-scoped server client filtered eq(student_id) + eq(status,'active').
 *
 * Real modules on purpose: composeDailyRhythm, dueReviewsToCards,
 * resolveGoalProfile, compareBySeverity, ADAPTIVE_REMEDIATION_RULES — the
 * route must agree with the frozen adapter math; only I/O seams are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ADAPTIVE_REMEDIATION_RULES } from '@/lib/learn/remediation-queue-adapter';

// ── Mocks (I/O seams only) ───────────────────────────────────────────────────

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Pass-through cache: the module-level Map in @/lib/cache would pin the first
// test's queue for every later test (same userId + day bucket key).
vi.mock('@/lib/cache', () => ({
  CACHE_TTL: { USER: 30_000 },
  cacheFetchAsync: async <T,>(
    _key: string,
    _ttl: number,
    fn: () => Promise<T>,
  ): Promise<T> => fn(),
}));

const flagState: Record<string, boolean | (() => boolean)> = {};
const isFeatureEnabledMock = vi.fn(async (flag: string) => {
  const v = flagState[flag];
  return typeof v === 'function' ? v() : Boolean(v);
});
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...a: unknown[]) =>
    isFeatureEnabledMock(...(a as [string])),
  PEDAGOGY_V2_FLAGS: { DAILY_RHYTHM: 'ff_pedagogy_v2_daily_rhythm' },
  ADAPTIVE_REMEDIATION_FLAGS: { V1: 'ff_adaptive_remediation_v1' },
}));

// ── Recording supabase-server client ─────────────────────────────────────────

interface LaneQuery {
  eqs: Array<[string, unknown]>;
}

const dbState = {
  studentRow: {
    id: 'stu-1',
    grade: '9',
    academic_goal: null as string | null,
    preferred_subject: 'math' as string | null,
  } as Record<string, unknown> | null,
  interventions: { data: [] as unknown, error: null as unknown },
  laneQueries: [] as LaneQuery[],
};

function makeClient() {
  return {
    auth: {
      getUser: async () => ({
        data: { user: { id: 'auth-user-1' } },
        error: null,
      }),
    },
    from(table: string) {
      if (table === 'students') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({ data: dbState.studentRow, error: null }),
        };
        return chain;
      }
      if (table === 'adaptive_interventions') {
        const q: LaneQuery = { eqs: [] };
        dbState.laneQueries.push(q);
        const chain = {
          select: () => chain,
          eq(col: string, val: unknown) {
            q.eqs.push([col, val]);
            return chain;
          },
          then(
            resolve: (v: unknown) => unknown,
            reject: (e: unknown) => unknown,
          ) {
            return Promise.resolve(dbState.interventions).then(resolve, reject);
          },
        };
        return chain;
      }
      // subjects / question_bank / curriculum_topics are unreachable with the
      // fixtures below (preferred_subject set, no due topics) — fail loudly.
      throw new Error(`unexpected table in rhythm lane test: ${table}`);
    },
    rpc: async (_name: string) => ({ data: [], error: null }),
  };
}

vi.mock('@/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => makeClient(),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

type Item = Record<string, unknown>;

function activeRow(
  id: string,
  chapter: number,
  largestDrop: number | null,
  subject = 'math',
) {
  return {
    id,
    subject_code: subject,
    chapter_number: chapter,
    trigger_snapshot: largestDrop === null ? null : { largestDrop },
  };
}

async function getItems(): Promise<{ status: number; items: Item[] }> {
  const { GET } = await import('@/app/api/rhythm/today/route');
  const res = await GET(new Request('http://localhost/api/rhythm/today'));
  const body = res.status === 200 ? await res.json() : {};
  return { status: res.status, items: (body.items ?? []) as Item[] };
}

const isRemediation = (i: Item) => i.kind === 'remediation_review';

/** The flag-OFF base queue, captured once — the byte-identical reference. */
async function captureBaseline(): Promise<Item[]> {
  flagState['ff_adaptive_remediation_v1'] = false;
  const { status, items } = await getItems();
  expect(status).toBe(200);
  return items;
}

beforeEach(() => {
  vi.clearAllMocks();
  dbState.laneQueries = [];
  dbState.interventions = { data: [], error: null };
  dbState.studentRow = {
    id: 'stu-1',
    grade: '9',
    academic_goal: null,
    preferred_subject: 'math',
  };
  flagState['ff_pedagogy_v2_daily_rhythm'] = true;
  flagState['ff_adaptive_remediation_v1'] = true;
});

// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/rhythm/today — flag OFF is byte-identical (kill switch)', () => {
  it('lane short-circuits before any adaptive_interventions read; no remediation kinds', async () => {
    flagState['ff_adaptive_remediation_v1'] = false;
    // Rows exist — they must remain invisible with the flag off.
    dbState.interventions = {
      data: [activeRow('iv-1', 4, 0.4)],
      error: null,
    };
    const { status, items } = await getItems();
    expect(status).toBe(200);
    expect(items.some(isRemediation)).toBe(false);
    expect(dbState.laneQueries).toHaveLength(0); // zero lane I/O — flag gates first
  });

  it('daily-rhythm outer gate still 404s when ff_pedagogy_v2_daily_rhythm is off', async () => {
    flagState['ff_pedagogy_v2_daily_rhythm'] = false;
    const { status } = await getItems();
    expect(status).toBe(404);
  });
});

describe('GET /api/rhythm/today — lane caps, ordering, splice position', () => {
  it('caps at 3 cards, deepest largestDrop first, corrupt snapshot last; base items unchanged around the splice', async () => {
    const baseline = await captureBaseline();
    expect(baseline.length).toBeGreaterThan(0);

    flagState['ff_adaptive_remediation_v1'] = true;
    dbState.interventions = {
      data: [
        activeRow('iv-shallow', 1, 0.1),
        activeRow('iv-deep', 2, 0.5),
        activeRow('iv-corrupt', 3, null), // null snapshot → sorts last
        activeRow('iv-mid', 4, 0.35),
        activeRow('iv-low', 5, 0.2),
      ],
      error: null,
    };
    const { status, items } = await getItems();
    expect(status).toBe(200);

    const lane = items.filter(isRemediation);
    expect(lane.length).toBe(
      ADAPTIVE_REMEDIATION_RULES.max_remediation_cards_per_day,
    ); // 3 of 5 — capped
    expect(lane.map((c) => c.interventionId)).toEqual([
      'iv-deep',
      'iv-mid',
      'iv-low',
    ]);
    expect(lane.map((c) => c.priority)).toEqual([1, 2, 3]);

    // Frozen item contract — exactly the keys the dashboard consumes.
    for (const card of lane) {
      expect(Object.keys(card).sort()).toEqual([
        'chapterNumber',
        'interventionId',
        'kind',
        'priority',
        'subjectCode',
      ]);
      expect(typeof card.subjectCode).toBe('string');
      expect(typeof card.chapterNumber).toBe('number');
    }

    // Splice position: a CONTIGUOUS block after the SRS block, and the base
    // items around it are element-for-element the flag-OFF queue.
    const spliceAt = Math.min(5, baseline.length);
    const first = items.findIndex(isRemediation);
    expect(first).toBe(spliceAt);
    expect(items.slice(first, first + lane.length).every(isRemediation)).toBe(true);
    expect(items.filter((i) => !isRemediation(i))).toEqual(baseline);
    expect(items).toHaveLength(baseline.length + lane.length);

    // P8: the lane read is scoped to this student's ACTIVE rows.
    expect(dbState.laneQueries).toHaveLength(1);
    expect(dbState.laneQueries[0].eqs).toEqual(
      expect.arrayContaining([
        ['student_id', 'stu-1'],
        ['status', 'active'],
      ]),
    );
  });

  it('zero active interventions → base queue exactly (no empty splice copy drift)', async () => {
    const baseline = await captureBaseline();
    flagState['ff_adaptive_remediation_v1'] = true;
    dbState.interventions = { data: [], error: null };
    const { status, items } = await getItems();
    expect(status).toBe(200);
    expect(items).toEqual(baseline);
  });
});

describe('GET /api/rhythm/today — lane failures degrade, never 500', () => {
  it('lane query error → 200 with the base queue', async () => {
    const baseline = await captureBaseline();
    flagState['ff_adaptive_remediation_v1'] = true;
    dbState.interventions = { data: null, error: { message: 'rls boom' } };
    const { status, items } = await getItems();
    expect(status).toBe(200);
    expect(items).toEqual(baseline);
  });

  it('lane flag-check exception is swallowed → 200 with the base queue', async () => {
    const baseline = await captureBaseline();
    flagState['ff_adaptive_remediation_v1'] = () => {
      throw new Error('flag service down');
    };
    const { status, items } = await getItems();
    expect(status).toBe(200);
    expect(items).toEqual(baseline);
  });
});
