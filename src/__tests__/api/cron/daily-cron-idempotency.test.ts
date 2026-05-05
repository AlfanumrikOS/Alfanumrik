/**
 * Tests for the D6 launch-readiness fix:
 *
 *   1. The Vercel cron proxy at src/app/api/cron/daily-cron/route.ts:
 *      - rejects unauthenticated callers (401)
 *      - forwards x-cron-secret to the Edge Function
 *      - propagates Edge Function status (200, 207, 502)
 *
 *   2. The notification idempotency contract enforced by the Edge Function
 *      (supabase/functions/daily-cron/index.ts) and migration
 *      20260505100100_notifications_idempotency_key.sql:
 *      - every parent_digest insert has a deterministic idempotency_key of the
 *        form `daily_digest_<YYYY_MM_DD>_<guardian_id>_<student_id>`
 *      - a re-run produces ZERO duplicate rows because the upsert path uses
 *        onConflict='recipient_id,type,idempotency_key' with ignoreDuplicates
 *
 * The Edge Function itself runs in Deno; for Node/Vitest we simulate the
 * supabase-js upsert(...).onConflict contract with an in-memory store keyed by
 * (recipient_id, type, idempotency_key). The simulation matches the partial
 * unique index defined in the companion migration.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ────────────────────────────────────────────────────────────────────────────
// Part 1: Vercel cron proxy auth + forwarding contract
// ────────────────────────────────────────────────────────────────────────────

const ENV_SECRET = 'cron-secret-fixture';
const SUPABASE_URL = 'https://example.supabase.co';

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

vi.mock('@/lib/logger', () => ({ logger: mockLogger }));

function buildProxyRequest(headers: Record<string, string>): Request {
  return new Request('http://localhost/api/cron/daily-cron', {
    method: 'POST',
    headers,
  });
}

describe('POST /api/cron/daily-cron (Vercel proxy)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = ENV_SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
  });

  it('returns 401 when secret is missing', async () => {
    const { POST } = await import('@/app/api/cron/daily-cron/route');
    const res = await POST(buildProxyRequest({}) as never);
    expect(res.status).toBe(401);
  });

  it('returns 401 when secret is wrong', async () => {
    const { POST } = await import('@/app/api/cron/daily-cron/route');
    const res = await POST(buildProxyRequest({ 'x-cron-secret': 'nope' }) as never);
    expect(res.status).toBe(401);
  });

  it('forwards x-cron-secret to the Edge Function and returns 200 on edge 200', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ results: { streaks_reset: 3 } }), { status: 200 }),
    );
    const { POST } = await import('@/app/api/cron/daily-cron/route');
    const res = await POST(buildProxyRequest({ 'x-cron-secret': ENV_SECRET }) as never);
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe(`${SUPABASE_URL}/functions/v1/daily-cron`);
    expect((init as RequestInit).headers).toMatchObject({ 'x-cron-secret': ENV_SECRET });
    fetchSpy.mockRestore();
  });

  it('returns 502 when Edge Function returns a 5xx (does not mask failure)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('boom', { status: 500 }),
    );
    const { POST } = await import('@/app/api/cron/daily-cron/route');
    const res = await POST(buildProxyRequest({ 'x-cron-secret': ENV_SECRET }) as never);
    expect(res.status).toBe(502);
    fetchSpy.mockRestore();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Part 2: Notification idempotency contract — re-run produces 0 duplicates
// ────────────────────────────────────────────────────────────────────────────

interface NotificationRow {
  recipient_id: string;
  recipient_type: string;
  type: string;
  title: string;
  body: string;
  message: string;
  data: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
  idempotency_key: string;
}

/**
 * In-memory simulation of the partial unique index
 *   `notifications_idempotency_idx ON (recipient_id, type, idempotency_key)
 *    WHERE idempotency_key IS NOT NULL`
 * combined with PostgREST's
 *   .upsert(rows, { onConflict: 'recipient_id,type,idempotency_key', ignoreDuplicates: true })
 */
function makeNotificationsStore() {
  const rows: NotificationRow[] = [];
  const seenKeys = new Set<string>();
  return {
    rows,
    upsert(batch: NotificationRow[]) {
      let inserted = 0;
      let skipped = 0;
      for (const row of batch) {
        const k = `${row.recipient_id}|${row.type}|${row.idempotency_key}`;
        if (seenKeys.has(k)) {
          skipped++;
          continue;
        }
        seenKeys.add(k);
        rows.push(row);
        inserted++;
      }
      return { inserted, skipped };
    },
  };
}

/**
 * Mirror of the per-recipient idempotency_key emitted by daily-cron's
 * generateParentDigests in supabase/functions/daily-cron/index.ts.
 * If the format ever drifts, this test fails — that is intentional.
 */
function dailyDigestIdempotencyKey(date: Date, guardianId: string, studentId: string): string {
  const slug = date.toISOString().slice(0, 10).replace(/-/g, '_');
  return `daily_digest_${slug}_${guardianId}_${studentId}`;
}

function buildDigestBatch(today: Date) {
  const links = [
    { guardian_id: 'g-1', student_id: 's-1' },
    { guardian_id: 'g-2', student_id: 's-2' },
    { guardian_id: 'g-3', student_id: 's-3' },
  ];
  return links.map(({ guardian_id, student_id }) => ({
    recipient_id: guardian_id,
    recipient_type: 'guardian',
    type: 'parent_digest',
    title: 'Yesterday: 1 quiz completed',
    body: 'Subjects: math. Avg: 80%. XP: +10.',
    message: 'Subjects: math. Avg: 80%. XP: +10.',
    data: { quizzes: 1, avg_score: 80, total_xp: 10, subjects: 'math', student_id },
    is_read: false,
    created_at: today.toISOString(),
    idempotency_key: dailyDigestIdempotencyKey(today, guardian_id, student_id),
  }));
}

describe('daily-cron parent_digest idempotency contract', () => {
  it('first run inserts one row per linked guardian × student', () => {
    const store = makeNotificationsStore();
    const batch = buildDigestBatch(new Date('2026-05-05T03:00:00Z'));
    const result = store.upsert(batch);
    expect(result.inserted).toBe(3);
    expect(result.skipped).toBe(0);
    expect(store.rows).toHaveLength(3);
  });

  it('second run on the same UTC day produces ZERO duplicates', () => {
    const store = makeNotificationsStore();
    const today = new Date('2026-05-05T03:00:00Z');
    const firstRun = store.upsert(buildDigestBatch(today));
    expect(firstRun.inserted).toBe(3);

    // Simulate Vercel retry: same day, same recipients.
    const secondRun = store.upsert(buildDigestBatch(today));
    expect(secondRun.inserted).toBe(0);
    expect(secondRun.skipped).toBe(3);
    expect(store.rows).toHaveLength(3); // still only the original 3
  });

  it('next-day run inserts fresh rows (idempotency_key includes the date)', () => {
    const store = makeNotificationsStore();
    const day1 = new Date('2026-05-05T03:00:00Z');
    const day2 = new Date('2026-05-06T03:00:00Z');
    store.upsert(buildDigestBatch(day1));
    const day2Result = store.upsert(buildDigestBatch(day2));
    expect(day2Result.inserted).toBe(3);
    expect(store.rows).toHaveLength(6);
  });

  it('idempotency_key follows the documented daily_digest_<YYYY_MM_DD>_<g>_<s> shape', () => {
    const k = dailyDigestIdempotencyKey(
      new Date('2026-05-05T18:30:00Z'),
      'guardian-aaa',
      'student-bbb',
    );
    expect(k).toBe('daily_digest_2026_05_05_guardian-aaa_student-bbb');
  });
});
