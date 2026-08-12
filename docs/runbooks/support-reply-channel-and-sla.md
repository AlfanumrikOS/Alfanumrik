# Runbook — Support reply channel + the open SLA decision

**Owner:** ops · **Created:** 2026-08-11

This is the operator-facing record of two things that are **not decided yet** and
must not be guessed at by any agent or contributor.

---

## OD-A — Support SLA

**Status: DECIDED 2026-08-11 by the user (CEO). Implemented in product copy.**

### The decision

| | Value |
|---|---|
| Published first-response promise | **within 2 business days** |
| Coverage window | **Monday–Saturday, 10:00–19:00 IST**, excluding Indian public holidays |
| Internal target | 1 business day — **NOT published**, it is a goal, not a commitment |
| Per-category / per-plan SLAs | **None.** One promise, one number, until first-response time is measured |

**Single source of truth: `packages/lib/src/support/response-sla.ts`.** The
numbers appear nowhere else — every surface composes its copy from
`supportSlaLine()` / `supportSlaFull()` / `supportFirstResponseText()` /
`supportCoverageText()`. Changing the promise is a one-line edit in that file.
Do not inline a number in a page, and do not add a per-category entry.

The promise is never rendered without the coverage window beside it (a student
filing at 21:00 on a Saturday has to be able to work out when to expect a
reply), and nothing derives a countdown or deadline timestamp from it.

Surfaces carrying the promise: `/help` (ticket card, ticket-form header,
post-submit confirmation), `/support` (list), `/support/[ticket_id]` (only on a
genuinely-empty thread), `/support/new`, `/parent/support` (creation toast +
"Need Help?" card), `/contact`.

**Still open for ops:** items 3 and 4 below (rota, breach path) and the
measurement gap — the promise is now published but first-response time is still
not computed anywhere. Closing that gap is the next ops step, not a blocker on
the copy.

### Historical record — why it was blocked until now

`/help` used to promise students, in three places:

> "We'll respond within 24 hours" / "हम 24 घंटे में जवाब देंगे"

That promise was **provably undeliverable**. Until 2026-08-11 there was no reply
channel in the schema at all — `/api/support/tickets/[id]` returned
`replies: []` as a hardcoded literal, and the only operator-writable text field
was `support_tickets.admin_notes`, which is internal and was never shown to the
requester. A student could file a ticket and could not, mechanically, receive a
written answer.

The frontend agent removed the "24 hours" claim from all three sites, leaving the
copy SLA-free until a promise could actually be kept. Those three sites now carry
the decided 2-business-day promise + coverage window (see the table at the top of
this file), composed from `response-sla.ts`.

### What now exists (so an SLA is finally *possible*)

The reply channel landed the same day:

- **Schema** — `supabase/migrations/20260814000012_support_ticket_replies.sql`.
  Additive only. One row = one message from either side. `is_internal`
  separates operator working notes from student-visible replies. RLS enabled in
  the same migration; ownership mirrors `support_tickets_self_select`. No PII
  columns — author is an id + a role.
- **Requester APIs** — `GET/POST /api/support/tickets/[id]`. Scoped by
  `student_id` **and** `user_role` via the shared `resolveTicketScope()` in
  `apps/host/src/app/api/support/_lib/ticket-auth.ts`, so a student cannot open
  a ticket their parent filed about them. Student-visible replies are filtered
  with an explicit `.eq('is_internal', false)` (the route uses `supabaseAdmin`,
  which bypasses RLS — that filter, not the policy, is the enforcement).
  Reply payload is `{ id, author_role, body, created_at }` only.
  Rate limit: 20 replies/hour/user.
- **Operator APIs** — `GET ?ticket_id=` (full thread incl. internal notes) and
  `POST { ticket_id, body, is_internal? }` on
  `/api/internal/admin/support`, behind `support.view_tickets` /
  `support.manage_tickets`. No new permission codes.
- **UI** — student thread at `/support/[ticket_id]`; operator console in
  `apps/host/src/app/internal/admin/_components/SupportTab.tsx`.

### What the decision answered, and what it did not

The four questions this section originally posed:

1. **Target first-response time** — ANSWERED: 2 business days, published;
   uniform across every ticket category and plan tier.
2. **Coverage window** — ANSWERED: Mon–Sat, 10:00–19:00 IST, excluding Indian
   public holidays.
3. **Who is on rota** — STILL OPEN (ops).
4. **What happens on breach** — STILL OPEN (ops), and currently unmeasurable.

### Standing rules

- **Never inline a response-time number in product copy**, English or Hindi.
  The only place any of these values may exist is
  `packages/lib/src/support/response-sla.ts`. A page that hardcodes "2 business
  days" is a defect even while the number happens to be correct — it is how the
  five surfaces drifted apart last time.
- **Never publish the internal target.** It is deliberately absent from
  `response-sla.ts`; adding it there would leak it into product copy.
- **No per-category or per-plan SLAs** until first-response time is measured.
- **No countdown or deadline UI.** A visible timer that runs out is worse than
  no promise; `response-sla.ts` exposes copy only, never a target `Date`.
- **The measurement gap is still open and is now the priority.** There is no
  first-response-time metric: `support_ticket_replies` makes it computable
  (first `author_role IN ('operator','admin')` reply minus ticket `created_at`),
  but nothing computes or surfaces it. The promise is live without a way to tell
  whether it is being met — surfacing this in the super-admin support metrics is
  the next ops task, and the conservative 2-day figure was chosen precisely
  because of this gap. Tighten it only once the data supports it.

---

## OD-B — P13: operator note text is written into `admin_audit_log`

**Status: OPEN follow-up. Pre-existing; untouched by today's work.**
**Owner: ops (raise) + architect (P13 ruling).**

`PATCH /api/internal/admin/support` audits the free-text operator note verbatim:

```ts
// apps/host/src/app/api/internal/admin/support/route.ts:121
await logAdminAction({
  action: 'update_support_ticket',
  entity_type: 'support_ticket',
  entity_id: id,
  details: { status, admin_note },   // ← free-text note body into admin_audit_log
  ip,
});
```

**Why it matters.** `admin_note` is unstructured operator prose about a specific
student's support case. It can contain anything an operator types — a parent's
phone number, a refund dispute, a safeguarding concern, a child's name. Once in
`admin_audit_log.details` it is retained under audit-log retention and is
readable by every role granted audit-log access, which is a broader audience than
those cleared to read support-case contents. That is the P13 boundary
("student data accessible only to: the student, their linked parent, their
assigned teacher, or admin via service role") applied to the wrong container.

**It also contradicts this file's own header**, which states:

> P13: reply/note BODIES are never written to the audit log or the logger —
> only ids, the is_internal flag, and a length.

That is true of the **POST reply** path added today (`:215` audits
`{ reply_id, is_internal, body_length }` — correct), and false of the **PATCH**
path. Documentation contradicting behaviour is itself a defect: either the code
comes to match the doc, or the doc is corrected.

**Proposed resolution** (needs architect sign-off before implementing): make
PATCH match the POST path already established in the same file —

```ts
details: { status, admin_note_length: admin_note?.length ?? 0 }
```

The note text itself remains in `support_tickets.admin_notes`, which is the
access-controlled place for it. The audit log keeps proving *that* a note was
written, by whom, and when — which is what an audit log is for — without
duplicating the content into a wider-read store.

**Deliberately not changed today.** It is pre-existing, it is not a regression
from this session's work, and altering audit-log contents is architect-reviewable.
Recorded here so it is not lost.

---

## Related

- `docs/ADMIN_OPERATIONS.md` — admin panel operations
- `docs/RBAC_MATRIX.md` — who can read support tickets and audit logs
- `docs/runbooks/super-admin-pii-export-notification.md` — adjacent P13 posture
