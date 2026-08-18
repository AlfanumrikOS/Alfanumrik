/**
 * Pins the first-response-time definition and the business-hours arithmetic.
 *
 * The whole point of this metric is that the published SLA is falsifiable, so
 * the metric itself has to be falsifiable first. Every exclusion in the
 * definition (internal notes, requester replies, bare resolve-without-reply)
 * gets an explicit test here — those are the three ways the number could be
 * quietly inflated to make us look compliant.
 */

import { describe, expect, it } from 'vitest';
import {
  BUSINESS_MINUTES_PER_DAY,
  FRT_DEFINITION,
  INTERNAL_TARGET_FIRST_RESPONSE_BUSINESS_MINUTES,
  OPERATOR_AUTHOR_ROLES,
  SLA_FIRST_RESPONSE_BUSINESS_MINUTES,
  buildNoResponseQueue,
  businessMinutesBetween,
  percentileCont,
  summarizeByCategory,
  summarizeFirstResponse,
  wallClockMinutesBetween,
  type FrtTicketInput,
} from '@alfanumrik/lib/support/first-response-metrics';
import { SUPPORT_RESPONSE_SLA } from '@alfanumrik/lib/support/response-sla';

/** Build an IST instant as epoch ms. IST = UTC+05:30, no DST. */
function ist(y: number, m: number, d: number, hh: number, mm = 0): number {
  return Date.UTC(y, m - 1, d, hh, mm) - 330 * 60_000;
}
const iso = (ms: number) => new Date(ms).toISOString();

// 2026-08-10 is a Monday; 2026-08-15 Saturday; 2026-08-16 Sunday.
const MON = 10;
const TUE = 11;
const SAT = 15;
const SUN = 16;

describe('business-hours arithmetic', () => {
  it('counts one full covered day as 540 minutes', () => {
    expect(BUSINESS_MINUTES_PER_DAY).toBe(540);
    expect(businessMinutesBetween(ist(2026, 8, MON, 10), ist(2026, 8, MON, 19))).toBe(540);
  });

  it('ignores time before the window opens and after it closes', () => {
    // 08:00 -> 21:00 on one day is 13 wall-clock hours but only the 9 covered.
    expect(businessMinutesBetween(ist(2026, 8, MON, 8), ist(2026, 8, MON, 21))).toBe(540);
    // Entirely outside the window.
    expect(businessMinutesBetween(ist(2026, 8, MON, 20), ist(2026, 8, MON, 23))).toBe(0);
  });

  it('skips Sunday but counts Saturday', () => {
    // Sat 18:00 -> Mon 11:00: 60m Sat tail + 0 Sun + 60m Mon head.
    expect(businessMinutesBetween(ist(2026, 8, SAT, 18), ist(2026, 8, 17, 11))).toBe(120);
    // A whole Sunday is worth nothing.
    expect(businessMinutesBetween(ist(2026, 8, SUN, 0), ist(2026, 8, SUN, 23, 59))).toBe(0);
  });

  it('spans multiple days with the closed-form middle', () => {
    // Mon 10:00 -> Sat 19:00 = Mon..Sat inclusive = 6 covered days.
    expect(businessMinutesBetween(ist(2026, 8, MON, 10), ist(2026, 8, SAT, 19))).toBe(6 * 540);
    // Mon 10:00 -> next Mon 10:00 = 6 covered days (one Sunday skipped).
    expect(businessMinutesBetween(ist(2026, 8, MON, 10), ist(2026, 8, 17, 10))).toBe(6 * 540);
  });

  it('is exactly the SLA at 2 covered days', () => {
    expect(SLA_FIRST_RESPONSE_BUSINESS_MINUTES).toBe(2 * 540);
    expect(businessMinutesBetween(ist(2026, 8, MON, 10), ist(2026, 8, TUE, 19))).toBe(
      SLA_FIRST_RESPONSE_BUSINESS_MINUTES,
    );
  });

  it('clamps reversed and equal instants to zero rather than going negative', () => {
    expect(businessMinutesBetween(ist(2026, 8, TUE, 12), ist(2026, 8, MON, 12))).toBe(0);
    expect(businessMinutesBetween(ist(2026, 8, MON, 12), ist(2026, 8, MON, 12))).toBe(0);
    expect(wallClockMinutesBetween(ist(2026, 8, TUE, 12), ist(2026, 8, MON, 12))).toBe(0);
  });

  it('measures business time strictly below wall-clock time across a weekend', () => {
    const from = ist(2026, 8, SAT, 18);
    const to = ist(2026, 8, 17, 11);
    expect(businessMinutesBetween(from, to)).toBeLessThan(wallClockMinutesBetween(from, to));
  });
});

describe('SLA constants derive from the CEO-set promise, never hardcoded', () => {
  it('reads the published number out of response-sla.ts', () => {
    expect(SLA_FIRST_RESPONSE_BUSINESS_MINUTES).toBe(
      SUPPORT_RESPONSE_SLA.firstResponseBusinessDays * BUSINESS_MINUTES_PER_DAY,
    );
    expect(BUSINESS_MINUTES_PER_DAY).toBe(
      (SUPPORT_RESPONSE_SLA.coverage.endHour - SUPPORT_RESPONSE_SLA.coverage.startHour) * 60,
    );
  });

  it('keeps the internal target strictly tighter than the published promise', () => {
    expect(INTERNAL_TARGET_FIRST_RESPONSE_BUSINESS_MINUTES).toBeLessThan(
      SLA_FIRST_RESPONSE_BUSINESS_MINUTES,
    );
  });

  it('states the holiday omission rather than inventing a calendar', () => {
    expect(FRT_DEFINITION.clock).toBe('business_hours');
    expect(FRT_DEFINITION.known_inaccuracy).toMatch(/public holidays are NOT excluded/i);
    expect(FRT_DEFINITION.unanswered_tickets_count_as_breach).toBe(true);
  });
});

describe('percentileCont matches percentile_cont semantics', () => {
  it('returns null on empty and the value on a singleton', () => {
    expect(percentileCont([], 0.5)).toBeNull();
    expect(percentileCont([7], 0.9)).toBe(7);
  });

  it('interpolates linearly', () => {
    expect(percentileCont([0, 10], 0.5)).toBe(5);
    expect(percentileCont([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentileCont([0, 100], 0.9)).toBe(90);
  });
});

/* ── The definition itself ─────────────────────────────────────────────── */

function ticket(over: Partial<FrtTicketInput> & { id: string }): FrtTicketInput {
  return {
    category: 'bug',
    status: 'open',
    created_at: iso(ist(2026, 8, MON, 10)),
    resolved_at: null,
    first_response_at: null,
    first_response_author_role: null,
    ...over,
  };
}

const NOW = ist(2026, 8, TUE, 12); // Tuesday noon IST

describe('FRT definition — what counts as a first response', () => {
  it('counts an operator-authored student-visible reply', () => {
    const s = summarizeFirstResponse(
      [
        ticket({
          id: 't1',
          first_response_at: iso(ist(2026, 8, MON, 12)),
          first_response_author_role: 'operator',
        }),
      ],
      NOW,
    );
    expect(s.responded_count).toBe(1);
    expect(s.business_hours.median_minutes).toBe(120);
    expect(s.business_hours.breach_count).toBe(0);
  });

  it('treats all three operator-side roles as a response', () => {
    expect([...OPERATOR_AUTHOR_ROLES]).toEqual(['operator', 'admin', 'system']);
    const s = summarizeFirstResponse(
      OPERATOR_AUTHOR_ROLES.map((role, i) =>
        ticket({
          id: `t${i}`,
          first_response_at: iso(ist(2026, 8, MON, 12)),
          first_response_author_role: role,
        }),
      ),
      NOW,
    );
    expect(s.responded_count).toBe(3);
    expect(s.first_response_by_author_role).toEqual({ operator: 1, admin: 1, system: 1 });
  });

  it('does NOT count a ticket whose only activity is a resolve with no reply', () => {
    // The silent-treatment failure mode. It must read as unanswered AND, once
    // past the SLA, as a breach — never as a response.
    const s = summarizeFirstResponse(
      [
        ticket({
          id: 'silent',
          created_at: iso(ist(2026, 8, 3, 10)), // a week earlier
          status: 'resolved',
          resolved_at: iso(ist(2026, 8, 4, 10)),
        }),
      ],
      NOW,
    );
    expect(s.responded_count).toBe(0);
    expect(s.awaiting_first_response_count).toBe(1);
    expect(s.silent_resolutions).toBe(1);
    expect(s.business_hours.breach_count).toBe(1);
    expect(s.business_hours.breach_of_unanswered).toBe(1);
  });

  it('counts an unanswered open ticket past the SLA as a breach, not a gap', () => {
    // Never-replying must not be the highest-scoring strategy.
    const s = summarizeFirstResponse(
      [ticket({ id: 'stale', created_at: iso(ist(2026, 8, 3, 10)) })],
      NOW,
    );
    expect(s.business_hours.breach_count).toBe(1);
    expect(s.business_hours.median_minutes).toBeNull(); // no latency to average
    expect(s.response_rate_pct).toBe(0);
  });

  it('does not breach a fresh unanswered ticket still inside the window', () => {
    const s = summarizeFirstResponse(
      [ticket({ id: 'fresh', created_at: iso(ist(2026, 8, TUE, 11)) })],
      NOW,
    );
    expect(s.business_hours.breach_count).toBe(0);
    expect(s.awaiting_first_response_count).toBe(1);
  });

  it('flags a late reply as a breach at 2 business days + 1 minute', () => {
    const created = ist(2026, 8, MON, 10);
    const onTime = summarizeFirstResponse(
      [
        ticket({
          id: 'edge-ok',
          created_at: iso(created),
          first_response_at: iso(ist(2026, 8, TUE, 19)),
          first_response_author_role: 'operator',
        }),
      ],
      NOW,
    );
    expect(onTime.business_hours.breach_count).toBe(0);

    const late = summarizeFirstResponse(
      [
        ticket({
          id: 'edge-late',
          created_at: iso(created),
          first_response_at: iso(ist(2026, 8, 12, 10, 1)), // Wed 10:01
          first_response_author_role: 'operator',
        }),
      ],
      NOW,
    );
    expect(late.business_hours.breach_count).toBe(1);
    expect(late.business_hours.breach_of_responded).toBe(1);
  });

  it('reports wall-clock alongside business hours, clearly separated', () => {
    // Filed Saturday 18:00, answered Monday 11:00: 2h business, 41h wall-clock.
    const s = summarizeFirstResponse(
      [
        ticket({
          id: 'weekend',
          created_at: iso(ist(2026, 8, SAT, 18)),
          first_response_at: iso(ist(2026, 8, 17, 11)),
          first_response_author_role: 'operator',
        }),
      ],
      ist(2026, 8, 17, 12),
    );
    expect(s.business_hours.median_minutes).toBe(120);
    expect(s.wall_clock.median_minutes).toBe(41 * 60);
  });
});

describe('no-first-response work queue', () => {
  const tickets: FrtTicketInput[] = [
    ticket({ id: 'oldest', created_at: iso(ist(2026, 8, 3, 10)), category: 'billing' }),
    ticket({ id: 'newer', created_at: iso(ist(2026, 8, MON, 11)), category: 'bug' }),
    ticket({
      id: 'answered',
      created_at: iso(ist(2026, 8, 3, 10)),
      first_response_at: iso(ist(2026, 8, 3, 11)),
      first_response_author_role: 'operator',
    }),
    ticket({ id: 'closed', created_at: iso(ist(2026, 8, 3, 10)), status: 'resolved' }),
  ];

  it('lists only unanswered still-open tickets, oldest first', () => {
    const q = buildNoResponseQueue(tickets, NOW);
    expect(q.map((r) => r.ticket_id)).toEqual(['oldest', 'newer']);
    expect(q[0].breached).toBe(true);
    expect(q[1].breached).toBe(false);
  });

  it('respects the limit', () => {
    expect(buildNoResponseQueue(tickets, NOW, 1)).toHaveLength(1);
  });

  it('emits no PII field — ticket id, category, status, age only (P13)', () => {
    const q = buildNoResponseQueue(tickets, NOW);
    expect(Object.keys(q[0]).sort()).toEqual([
      'age_business_minutes',
      'age_wall_clock_minutes',
      'at_risk',
      'breached',
      'category',
      'created_at',
      'status',
      'ticket_id',
    ]);
    const serialised = JSON.stringify(q);
    for (const banned of ['email', 'phone', 'name', 'subject', 'message', 'admin_notes']) {
      expect(serialised).not.toMatch(new RegExp(banned, 'i'));
    }
  });
});

describe('per-category breakdown', () => {
  it('groups by category and sorts worst-breaching first', () => {
    const rows = summarizeByCategory(
      [
        ticket({ id: 'a', category: 'billing', created_at: iso(ist(2026, 8, 3, 10)) }),
        ticket({ id: 'b', category: 'billing', created_at: iso(ist(2026, 8, 3, 10)) }),
        ticket({
          id: 'c',
          category: 'bug',
          first_response_at: iso(ist(2026, 8, MON, 11)),
          first_response_author_role: 'operator',
        }),
      ],
      NOW,
    );
    expect(rows[0].category).toBe('billing');
    expect(rows[0].breach_count).toBe(2);
    expect(rows[1].category).toBe('bug');
    expect(rows[1].breach_count).toBe(0);
    expect(rows[1].median_business_minutes).toBe(60);
  });

  it('buckets a null category without inventing one', () => {
    const rows = summarizeByCategory([ticket({ id: 'x', category: null })], NOW);
    expect(rows[0].category).toBe('uncategorised');
  });
});

describe('empty input', () => {
  it('returns nulls rather than a fake 0 median', () => {
    const s = summarizeFirstResponse([], NOW);
    expect(s.tickets_total).toBe(0);
    expect(s.business_hours.median_minutes).toBeNull();
    expect(s.business_hours.breach_count).toBe(0);
    expect(s.response_rate_pct).toBeNull();
  });
});
