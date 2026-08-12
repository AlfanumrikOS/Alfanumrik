/**
 * GET /api/internal/admin/support/metrics — first-response-time (FRT) against
 * the published support SLA.
 *
 * ── WHY IT EXISTS ──────────────────────────────────────────────────────────
 * `docs/runbooks/support-reply-channel-and-sla.md` (OD-A) sets the rule: "Ops
 * must be able to *measure* it before it is promised… nothing computes or
 * surfaces it yet. Adding it to the support metrics is an ops follow-up, and
 * should land BEFORE a public SLA, not after." The CEO has now set the promise
 * (2 business days, Mon–Sat 10:00–19:00 IST) and `/help` is publishing it. This
 * route is what makes that promise falsifiable.
 *
 * ── WHY HERE ───────────────────────────────────────────────────────────────
 * It sits under `/api/internal/admin/support/` because that IS the support
 * operator console — the ticket list, thread view, status PATCH and operator
 * reply POST all live in the sibling `route.ts`. Putting the metric anywhere
 * else would split one operator surface across two auth conventions.
 *
 * Consequently the auth convention is this directory's, NOT `/api/super-admin`'s
 * `authorizeAdmin(request, level)`: the sibling route uses
 * `authorizeRequest(request, 'support.view_tickets')`, and the `support` role
 * already holds that code (migration 20260612123200_rbac_matrix_conformance.sql
 * :177, granted at :295). Read-only metric → the read permission, not
 * `support.manage_tickets`. No new permission code was invented (P9).
 *
 * ── SQL ACCESS (the ad-hoc path) ───────────────────────────────────────────
 * A route alone is not enough — ops needs to answer unanticipated questions in
 * SQL. The DDL for the matching read model is specified verbatim at the bottom
 * of this comment and is HANDED TO ARCHITECT: `supabase/migrations/**` is
 * architect-owned and was not touched here. This route is correct and shippable
 * without that view (it computes everything in TS from two narrow SELECTs); the
 * view is the ad-hoc-query convenience, and its numbers are defined to agree
 * with `packages/lib/src/support/first-response-metrics.ts` exactly.
 *
 * ── P13 ────────────────────────────────────────────────────────────────────
 * `support_tickets` carries `email`, `user_name`, `subject`, `message`,
 * `device_info` and `admin_notes`. NONE of them is selected here. The SELECT
 * list is pinned to `id, category, status, created_at, resolved_at` and the
 * reply SELECT to `ticket_id, created_at, author_role` — no message body, no
 * author identity, ever. Nothing is written to the logger or the audit log:
 * this is a read-only aggregate and there is no operator action to audit.
 * The response shape is aggregate counts plus a work queue of
 * (ticket_id, category, status, created_at, age) — verified field-by-field
 * against `FrtQueueItem`, which structurally has no PII field.
 *
 * ── QUERY PARAMS ───────────────────────────────────────────────────────────
 *   days=<1..365>   window for the SUMMARY, by ticket created_at. Default 30.
 *   queue_limit=<1..500>  work-queue rows. Default 100.
 *
 * The work queue is deliberately NOT windowed — a ticket that has been ignored
 * for six months is the single most important row an operator can see, and
 * windowing it would hide exactly the failure this metric exists to catch.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DDL HANDED TO ARCHITECT — do not apply from here, do not run `db push`.
 * Suggested file: supabase/migrations/<ts>_support_first_response_view.sql
 * Additive only: one function + one view + grants. No table, column or policy
 * is touched, so there is no RLS change to review — but note the view is
 * granted to service_role ONLY, matching 20260504100400_marking_audit_view.sql.
 *
 *   -- Elapsed BUSINESS minutes inside Mon–Sat 10:00–19:00 IST.
 *   -- Holidays NOT excluded (no calendar exists in-repo); see the metric
 *   -- module's block comment for why that is the conservative direction.
 *   -- ⚠ The 10:00 / 19:00 literals and the 1080 below duplicate
 *   -- SUPPORT_RESPONSE_SLA.coverage and SLA_FIRST_RESPONSE_BUSINESS_MINUTES in
 *   -- packages/lib/src/support/. If the CEO moves the SLA, BOTH move together;
 *   -- a drift test belongs on this pair (handed to testing).
 *   CREATE OR REPLACE FUNCTION public.support_business_minutes(
 *     p_from timestamptz, p_to timestamptz
 *   ) RETURNS numeric
 *   LANGUAGE sql STABLE SET search_path = public AS $fn$
 *     SELECT COALESCE(SUM(
 *              GREATEST(0, EXTRACT(EPOCH FROM (
 *                  LEAST(p_to,     (g.d + time '19:00') AT TIME ZONE 'Asia/Kolkata')
 *                - GREATEST(p_from, (g.d + time '10:00') AT TIME ZONE 'Asia/Kolkata')
 *              )) / 60.0)
 *            ), 0)::numeric
 *     FROM generate_series(
 *            ((p_from AT TIME ZONE 'Asia/Kolkata')::date)::timestamp,
 *            ((p_to   AT TIME ZONE 'Asia/Kolkata')::date)::timestamp,
 *            interval '1 day'
 *          ) AS g(d)
 *     WHERE p_to > p_from
 *       AND EXTRACT(ISODOW FROM g.d) <> 7;   -- Sunday is the only uncovered day
 *   $fn$;
 *
 *   -- One row per ticket. UUIDs + category + status + timestamps only (P13).
 *   CREATE OR REPLACE VIEW public.support_ticket_first_response
 *   WITH (security_invoker = true) AS
 *   SELECT
 *     t.id         AS ticket_id,
 *     t.category,
 *     t.status,
 *     t.created_at,
 *     t.resolved_at,
 *     fr.first_response_at,
 *     fr.first_response_author_role,
 *     public.support_business_minutes(t.created_at, fr.first_response_at)
 *                  AS first_response_business_minutes,
 *     CASE WHEN fr.first_response_at IS NOT NULL
 *          THEN EXTRACT(EPOCH FROM (fr.first_response_at - t.created_at)) / 60.0
 *     END          AS first_response_wall_clock_minutes,
 *     -- Elapsed-so-far for an unanswered ticket. Unanswered tickets breach on
 *     -- age; excluding them would make "never reply" the top-scoring strategy.
 *     public.support_business_minutes(
 *       t.created_at, COALESCE(fr.first_response_at, now())
 *     )            AS elapsed_business_minutes,
 *     (fr.first_response_at IS NULL
 *        AND COALESCE(t.status,'open') NOT IN ('resolved','closed'))
 *                  AS awaiting_first_response,
 *     -- Resolved with no written reply = the silent-treatment failure mode.
 *     (fr.first_response_at IS NULL
 *        AND (COALESCE(t.status,'') IN ('resolved','closed')
 *             OR t.resolved_at IS NOT NULL))
 *                  AS silent_resolution,
 *     (public.support_business_minutes(
 *        t.created_at, COALESCE(fr.first_response_at, now())) > 1080)
 *                  AS sla_breached   -- 1080 = 2 business days x 540 min
 *   FROM public.support_tickets t
 *   LEFT JOIN LATERAL (
 *     SELECT r.created_at AS first_response_at,
 *            r.author_role AS first_response_author_role
 *     FROM public.support_ticket_replies r
 *     WHERE r.ticket_id = t.id
 *       AND r.is_internal = false
 *       AND r.author_role IN ('operator','admin','system')
 *     ORDER BY r.created_at ASC
 *     LIMIT 1
 *   ) fr ON true;
 *
 *   -- Backed by idx_support_ticket_replies_visible (ticket_id, created_at)
 *   -- WHERE is_internal = false, created in 20260814000012. The LATERAL
 *   -- LIMIT 1 rides that partial index directly.
 *
 *   REVOKE ALL ON public.support_ticket_first_response FROM PUBLIC;
 *   REVOKE ALL ON public.support_ticket_first_response FROM anon;
 *   REVOKE ALL ON public.support_ticket_first_response FROM authenticated;
 *   GRANT SELECT ON public.support_ticket_first_response TO service_role;
 *
 *   COMMENT ON VIEW public.support_ticket_first_response IS
 *     'First-response-time read model for the published support SLA (2 business
 *      days, Mon-Sat 10:00-19:00 IST). FRT = created_at -> first
 *      is_internal=false reply by author_role IN (operator,admin,system).
 *      Internal notes, requester replies and bare resolve-without-reply do NOT
 *      count. Business hours exclude Sundays and out-of-window time but NOT
 *      Indian public holidays (no calendar in repo) — breach counts are an
 *      upper bound. UUIDs only, no PII (P13). service_role-only.';
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import {
  CLOSED_TICKET_STATUSES,
  FRT_DEFINITION,
  OPERATOR_AUTHOR_ROLES,
  buildNoResponseQueue,
  businessMinutesToDays,
  summarizeByCategory,
  summarizeFirstResponse,
  type FrtTicketInput,
} from '@alfanumrik/lib/support/first-response-metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 365;
const DEFAULT_QUEUE_LIMIT = 100;
const MAX_QUEUE_LIMIT = 500;

/**
 * Hard ceilings so one query cannot pull an unbounded table into memory. When
 * a cap bites we say so in `truncated` rather than silently reporting a median
 * over an arbitrary subset — a quietly-truncated SLA number is worse than none.
 */
const MAX_WINDOW_TICKETS = 5000;
const MAX_OPEN_TICKETS = 2000;
/** PostgREST `in.(…)` filters are URL-encoded; chunk to keep the URL sane. */
const REPLY_LOOKUP_CHUNK = 200;

/**
 * The ONLY ticket columns this route may read. Adding `email`, `user_name`,
 * `subject`, `message`, `device_info` or `admin_notes` here is a P13 violation.
 */
const TICKET_COLUMNS = 'id, category, status, created_at, resolved_at';

/**
 * PostgREST `not.in` filter for closed statuses, DERIVED from the metric
 * module's `CLOSED_TICKET_STATUSES` rather than re-typed. If a status is ever
 * added there, the work-queue query follows automatically instead of the two
 * silently disagreeing about what "still open" means.
 * Format matches the in-repo convention (diagnostic/start/route.ts:101): `(a,b)`.
 */
const CLOSED_STATUSES_SQL = `(${CLOSED_TICKET_STATUSES.join(',')})`;

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

type TicketRow = {
  id: string;
  category: string | null;
  status: string | null;
  created_at: string;
  resolved_at: string | null;
};

export async function GET(request: NextRequest) {
  const auth = await authorizeRequest(request, 'support.view_tickets');
  if (!auth.authorized) return auth.errorResponse!;

  const sp = new URL(request.url).searchParams;
  const windowDays = clampInt(sp.get('days'), DEFAULT_WINDOW_DAYS, 1, MAX_WINDOW_DAYS);
  const queueLimit = clampInt(sp.get('queue_limit'), DEFAULT_QUEUE_LIMIT, 1, MAX_QUEUE_LIMIT);

  const nowMs = Date.now();
  const windowFromIso = new Date(nowMs - windowDays * 86_400_000).toISOString();
  const nowIso = new Date(nowMs).toISOString();

  const supabase = getSupabaseAdmin();

  try {
    // ── 1. Tickets created inside the reporting window (the summary set) ────
    const { data: windowRows, error: windowError } = await supabase
      .from('support_tickets')
      .select(TICKET_COLUMNS)
      .gte('created_at', windowFromIso)
      .order('created_at', { ascending: false })
      .limit(MAX_WINDOW_TICKETS);
    if (windowError) throw windowError;

    // ── 2. Every still-open ticket, ANY age (the work-queue set) ────────────
    // Not windowed on purpose: the six-month-old ignored ticket is the whole
    // point of the queue. Excluding only the closed statuses (rather than
    // selecting `status='open'`) keeps unknown/legacy status strings IN the
    // queue — `support_tickets.status` is free TEXT with no CHECK, and a
    // ticket must never fall off the work queue because someone wrote an
    // unrecognised status onto it. Mirrors the metric module's fail-toward-open
    // posture in `CLOSED_TICKET_STATUSES`.
    const { data: openRows, error: openError } = await supabase
      .from('support_tickets')
      .select(TICKET_COLUMNS)
      .not('status', 'in', CLOSED_STATUSES_SQL)
      .order('created_at', { ascending: true })
      .limit(MAX_OPEN_TICKETS);
    if (openError) throw openError;

    const byId = new Map<string, TicketRow>();
    for (const r of (windowRows ?? []) as TicketRow[]) byId.set(r.id, r);
    for (const r of (openRows ?? []) as TicketRow[]) byId.set(r.id, r);
    const allTickets = [...byId.values()];

    // ── 3. First operator-authored, student-visible reply per ticket ────────
    // THE definition, expressed as a filter:
    //   is_internal = false  AND  author_role IN ('operator','admin','system')
    // Rows come back ascending by created_at, so the FIRST one seen per
    // ticket_id is the MIN — no client-side re-sort needed.
    const firstResponse = new Map<string, { at: string; role: string }>();
    const ids = allTickets.map((t) => t.id);
    for (let i = 0; i < ids.length; i += REPLY_LOOKUP_CHUNK) {
      const chunk = ids.slice(i, i + REPLY_LOOKUP_CHUNK);
      const { data: replies, error: replyError } = await supabase
        .from('support_ticket_replies')
        .select('ticket_id, created_at, author_role')
        .in('ticket_id', chunk)
        .eq('is_internal', false)
        .in('author_role', [...OPERATOR_AUTHOR_ROLES])
        .order('created_at', { ascending: true });
      if (replyError) throw replyError;

      for (const r of (replies ?? []) as Array<{
        ticket_id: string;
        created_at: string;
        author_role: string;
      }>) {
        if (!firstResponse.has(r.ticket_id)) {
          firstResponse.set(r.ticket_id, { at: r.created_at, role: r.author_role });
        }
      }
    }

    const toInput = (t: TicketRow): FrtTicketInput => {
      const fr = firstResponse.get(t.id);
      return {
        id: t.id,
        category: t.category,
        status: t.status,
        created_at: t.created_at,
        resolved_at: t.resolved_at,
        first_response_at: fr?.at ?? null,
        first_response_author_role: fr?.role ?? null,
      };
    };

    const windowInputs = ((windowRows ?? []) as TicketRow[]).map(toInput);
    const queueInputs = ((openRows ?? []) as TicketRow[]).map(toInput);

    const summary = summarizeFirstResponse(windowInputs, nowMs);
    const byCategory = summarizeByCategory(windowInputs, nowMs);
    const queue = buildNoResponseQueue(queueInputs, nowMs, queueLimit);

    const truncated =
      (windowRows?.length ?? 0) >= MAX_WINDOW_TICKETS ||
      (openRows?.length ?? 0) >= MAX_OPEN_TICKETS;

    return NextResponse.json({
      success: true,
      data: {
        // Self-describing: the number never travels without its definition.
        definition: FRT_DEFINITION,
        window: {
          from: windowFromIso,
          to: nowIso,
          days: windowDays,
          note: 'summary and by_category cover tickets CREATED in this window; no_first_response_queue is NOT windowed and spans all still-open tickets of any age',
        },
        summary,
        // The single number the promise is judged on, restated in the unit the
        // promise is written in.
        verdict: {
          published_sla_business_days: FRT_DEFINITION.published_sla_business_days,
          median_business_days:
            summary.business_hours.median_minutes === null
              ? null
              : businessMinutesToDays(summary.business_hours.median_minutes),
          p90_business_days:
            summary.business_hours.p90_minutes === null
              ? null
              : businessMinutesToDays(summary.business_hours.p90_minutes),
          breach_count: summary.business_hours.breach_count,
          breach_rate_pct: summary.business_hours.breach_rate_pct,
          meeting_promise:
            summary.tickets_total === 0 ? null : summary.business_hours.breach_count === 0,
        },
        by_category: byCategory,
        no_first_response_queue: queue,
        queue_total_returned: queue.length,
        truncated,
      },
    });
  } catch {
    // Generic body on purpose. A PostgREST error string echoes the failing
    // filter — including the ticket-id list — back to the caller and into any
    // client-side error reporter. The caller is an authorised operator, but
    // leaking raw DB errors is the habit that turns into a P13 incident
    // somewhere else. Nothing is logged here either: there is no operator
    // action to audit on a read-only aggregate.
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 });
  }
}
