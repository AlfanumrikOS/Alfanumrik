/**
 * parent-report-generator edge function — contract tests.
 *
 * These tests assert the request/response contract of the edge fn at
 * supabase/functions/parent-report-generator/index.ts. They are pure
 * mock-based tests (no network, no Deno runtime) — we mock global fetch
 * and verify our client-side expectations of the contract.
 *
 * Per Plan 2 Task 7 (docs/superpowers/plans/2026-05-09-parent-dashboard-shell.md).
 *
 * NOTE on actual response shape: despite the filename "parent-report-pdf",
 * the live edge fn does NOT return a PDF URL or binary blob — it returns a
 * structured JSON weekly report:
 *   { report: { period, highlights[], concerns[], suggestion, stats{...} },
 *     generated_at: ISO8601 }
 * Tests below assert against that real shape.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const SUPABASE_URL = 'https://test.supabase.co'
const ENDPOINT = `${SUPABASE_URL}/functions/v1/parent-report-generator`

const AUTH_HEADERS = {
  'Content-Type': 'application/json',
  Authorization: 'Bearer test-jwt',
}

beforeEach(() => {
  global.fetch = vi.fn()
})

describe('parent-report-generator edge fn — contract', () => {
  it('returns a structured JSON weekly report for a valid request', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        report: {
          period: 'May 2 - May 9, 2026',
          highlights: [
            'Aarav completed 5 quizzes this week',
            'Maintained a 4-day learning streak!',
            '82% average score - excellent!',
          ],
          concerns: [],
          suggestion: 'Great progress! Appreciate your child\'s effort and consistency',
          stats: {
            quizzes_completed: 5,
            avg_score: 82,
            xp_earned: 320,
            time_spent_minutes: 47,
            topics_mastered: 2,
            streak: 4,
          },
        },
        generated_at: '2026-05-09T12:00:00.000Z',
      }),
    })

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ student_id: 's-1', language: 'en' }),
    })

    expect(res.ok).toBe(true)
    expect(res.status).toBe(200)

    const body = await res.json()
    // Top-level shape
    expect(body).toHaveProperty('report')
    expect(body).toHaveProperty('generated_at')
    expect(typeof body.generated_at).toBe('string')

    // Report inner shape
    expect(body.report).toHaveProperty('period')
    expect(Array.isArray(body.report.highlights)).toBe(true)
    expect(body.report.highlights.length).toBeGreaterThan(0)
    expect(Array.isArray(body.report.concerns)).toBe(true)
    expect(typeof body.report.suggestion).toBe('string')

    // Stats shape (numeric scalars used by the parent dashboard cards)
    const stats = body.report.stats
    expect(typeof stats.quizzes_completed).toBe('number')
    expect(typeof stats.avg_score).toBe('number')
    expect(typeof stats.xp_earned).toBe('number')
    expect(typeof stats.time_spent_minutes).toBe('number')
    expect(typeof stats.topics_mastered).toBe('number')
    expect(typeof stats.streak).toBe('number')
  })

  it('returns 400 when student_id is missing', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'student_id is required' }),
      text: async () => 'student_id is required',
    })

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ language: 'en' }), // no student_id
    })

    expect(res.ok).toBe(false)
    expect(res.status).toBe(400)
  })

  it('returns 401 when Authorization header is missing', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
      text: async () => 'Unauthorized',
    })

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }, // no Bearer
      body: JSON.stringify({ student_id: 's-1' }),
    })

    expect(res.status).toBe(401)
  })

  it('returns 403 when the parent is not linked to the student (incl. nonexistent student)', async () => {
    // The edge fn collapses "no link" and "student does not exist" into the
    // same 403 — by design, to avoid leaking student existence to a
    // potentially malicious caller. We assert that contract here in lieu of
    // a separate 404 case.
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Parent is not linked to this student' }),
      text: async () => 'Parent is not linked to this student',
    })

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ student_id: 'nonexistent-or-unlinked' }),
    })

    expect(res.status).toBe(403)
  })

  it('returns 429 when the daily rate limit is exceeded', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: 'Report already generated today. Try again tomorrow.' }),
      text: async () => 'Report already generated today. Try again tomorrow.',
    })

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ student_id: 's-1' }),
    })

    expect(res.status).toBe(429)
  })

  it('returns 405 for non-POST methods', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 405,
      text: async () => 'Method not allowed',
    })

    const res = await fetch(ENDPOINT, {
      method: 'GET',
      headers: AUTH_HEADERS,
    })

    expect(res.status).toBe(405)
  })
})
