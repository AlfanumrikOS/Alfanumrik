# Runbook — Support reply channel + the open SLA decision

**Owner:** ops · **Created:** 2026-08-11

This is the operator-facing record of two things that are **not decided yet** and
must not be guessed at by any agent or contributor.

---

## OD-A — There is no support SLA. Someone has to set one.

**Status: OPEN. Blocks putting any response-time number back into product copy.**
**Decision owner: the user (CEO). This is a staffing question, not a code question.**

### What changed

`/help` used to promise students, in three places:

> "We'll respond within 24 hours" / "हम 24 घंटे में जवाब देंगे"

That promise was **provably undeliverable**. Until 2026-08-11 there was no reply
channel in the schema at all — `/api/support/tickets/[id]` returned
`replies: []` as a hardcoded literal, and the only operator-writable text field
was `support_tickets.admin_notes`, which is internal and was never shown to the
requester. A student could file a ticket and could not, mechanically, receive a
written answer.

The frontend agent removed the "24 hours" claim from all three sites. The copy is
now **SLA-free** and truthful:

| Site (`apps/host/src/app/help/page.tsx`) | Current copy |
|---|---|
| Ticket card subtitle (~:426) | "Describe your issue and we'll get back to you as soon as we can" |
| Ticket form header (~:592) | "We'll get back to you as soon as we can" |
| Post-submit confirmation (~:715) | "We've received your issue. Our team will reply as soon as we can — you'll see the response under 'My Tickets'." |

Each site carries an inline comment saying not to reintroduce a number.

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

### The decision required

**A real SLA is a function of operator staffing, which only the user can answer.**
Do not invent a number. Nothing in the codebase should be treated as implying one.

To close this, the user needs to state:

1. **Target first-response time** — and whether it differs by ticket category
   (`packages/lib/src/support/ticket-categories.ts`) or by plan tier.
2. **Coverage window** — business hours IST? 7 days? Which holidays?
3. **Who is on rota** — which humans watch the operator console, and how often.
4. **What happens on breach** — escalation path, and whether breach is even
   measurable yet (see the instrumentation gap below).

### Rules until it is decided

- **Do not** reintroduce "24 hours" or any other number into student-facing copy,
  English or Hindi.
- Any number that goes back in must be one the rota can actually hit, and must be
  bilingual (P7).
- Ops must be able to *measure* it before it is promised. There is currently no
  first-response-time metric: `support_ticket_replies` now makes it computable
  (first `author_role IN ('operator','admin')` reply minus ticket `created_at`),
  but nothing computes or surfaces it yet. Adding it to the super-admin support
  metrics is an ops follow-up, and should land **before** a public SLA, not after.

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
