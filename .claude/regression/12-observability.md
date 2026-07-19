## Engineering-Audit Cycle 6 — Super-Admin & Observability (P9/P13) — 2026-06-29

Source: engineering-audit program, Cycle 6 (Super-Admin & Observability). The
admin surface is large (super-admin 119 + v1/admin 2 + internal/admin 13 = 134
`route.ts` files) and any single ungated handler is a privilege-escalation hole;
the audit also found that the key-based `redactPII` redactor only scrubs values
it can match by KEY, so a `logger.*` call that passes a bare `name`/`email`/`phone`
object key would leak PII into the observability/analytics pipeline (SAO-4
caller-discipline gap). This cycle adds two mechanical breadth sweeps: REG-186
proves every admin route carries a canonical authorization gate token placed
BEFORE its first DB marker, and REG-187 canaries the admin + observability emit
libs for bare PII-shaped log keys the redactor would NOT catch.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-186 | `admin_route_gate_sweep` | P9: every admin `route.ts` across the full surface (super-admin 119 + v1/admin 2 + internal/admin 13 = 134) carries a canonical authorization gate token (`authorizeAdmin(` / `authorizeRequest(` / `requireAdminSecret(`), and every DB-touching handler places the gate BEFORE its first DB marker (`.from(`/`.rpc(`/service-client) — proven locally for 207/207 handlers; `super-admin/login` is the only documented self-auth exception (allowlisted). A NEW ungated admin route turns this red. Mechanical breadth complement to REG-116/REG-119 behavioral pins. | `src/__tests__/api/super-admin/admin-route-auth-gate-sweep.test.ts` | E |
| REG-187 | `bare_name_log_canary` | P13: no `logger.{info,warn,error,debug}` call across the super-admin surface + observability/analytics emit libs passes a bare `name`/`email`/`phone` object key (which the key-based `redactPII` would NOT redact); conservative anchor excludes safe `*_name` keys (full_name/flag_name/school_name/event_name). Closes the SAO-4 caller-discipline gap. | `src/__tests__/api/super-admin/bare-name-log-canary.test.ts` | E |

### Invariants covered by this section

- P9 (RBAC enforcement — every admin `route.ts` across the full 134-file surface
  carries a canonical authorization gate token, placed before the first DB marker
  on every DB-touching handler; `super-admin/login` is the only allowlisted
  self-auth exception; a new ungated admin route fails the sweep)
- P13 (data privacy — no `logger.*` call on the admin/observability surface emits
  a bare `name`/`email`/`phone` key the key-based `redactPII` cannot scrub;
  safe `*_name` keys excluded; closes the SAO-4 caller-discipline gap)

### Catalog total

Pre-REG-186: 152 entries (through Engineering-Audit Cycle 5's REG-184/REG-185
teacher-dashboard tenant scoping + students teacher-assigned RLS backstop).
Engineering-Audit Cycle 6 adds REG-186 (admin route auth-gate sweep — all 134
admin routes carry a canonical gate token before their first DB marker, closing
the P9 breadth gap) and REG-187 (bare-name log canary — no admin/observability
`logger.*` call leaks a bare PII-shaped key past the key-based redactor, closing
the SAO-4 caller-discipline gap).
**Total catalog: 154 entries (target: 35 — TARGET EXCEEDED).**

---

## EU PostHog analytics turn-on — identity + funnel-event PII boundary (P13) — 2026-07-18 — REG-270

Source: EU-analytics turn-on on branch `feat/instrument-b2c-funnel-analytics`
(frontend commit `d545287f` + architect commit `e68916f5`). The PostHog clients
were consolidated onto EU project 159341, all three `identify()` call sites were
made to hash before dispatch (P13), `autocapture` was set to `false` everywhere,
a second client-side PII redaction pass was added, and the `quiz_started` funnel
event was wired.

> **ID note (2026-07-18).** The turn-on task asked for "REG-176", a number
> chosen from the constitution's then-current claim that REG-175 was the latest
> id. In this worktree REG-176 was already consumed (Foxy prompt-template
> routing, 2026-06-26) and the catalog had advanced to REG-269. Following the
> catalog's own "next free id after the highest" convention, this entry is
> allocated **REG-270** to avoid an id collision. No existing entry was
> renumbered or removed.

**Area:** Analytics / PostHog (client-side) — P13 Data Privacy, P5 Grade Format
**Risk:** HIGH — turning analytics on inception-dark. A raw `student_id` /
`auth_user_id` UUID reaching `posthog.identify`, or PII leaking through a funnel
event property, would ship minors' identifiers to a third-party analytics
backend. Autocapture flipping back on would re-introduce implicit DOM capture.

**What it pins:**
- **(a) Identity hashing — all three paths.** `posthog.identify` ALWAYS receives
  the 16-hex SHA-256 prefix from `hashUserIdForAnalytics()`, NEVER a raw
  UUID (`/^[0-9a-f]{8}-[0-9a-f]{4}-/i`), across `PostHogProvider.tsx`
  (`posthogIdentify({student_id})`), `packages/lib/src/posthog/client.ts`
  (`identify(rawUserId)` — hashes internally), and `packages/lib/src/analytics.ts`
  (`identifyUser(authUserId)`). The person-property `distinct_id_hash` mirror is
  the hash, not the UUID; the raw UUID never appears in any identify argument.
- **(b) Funnel-event PII boundary.** The 7 B2C funnel events (`signup_complete`,
  `onboarding_complete`, `quiz_started`, `quiz_completed`, `foxy_message_sent`,
  `payment_success`, `daily_return`) emit no property KEY matching
  `/name|email|phone|token|card|signature/i` and no PII-shaped VALUE (email
  address, bare 10-digit phone, raw UUID). `foxy_message_sent` carries ONLY
  `{subject, mode, language}` — no message text. The two-pass redactor
  (`redactPII` + `redactEventPropertyPII`) scrubs injected PII VALUES
  (email/phone/full_name/name/card_number/razorpay_signature/token) before
  either backend sees them.
- **(c) `quiz_started` fan-out + P5.** `track('quiz_started', {subject, grade})`
  fans out to BOTH Vercel Analytics (`window.va`) and PostHog `capture`, and
  `grade` stays a STRING (`'8'`, `'12'` — never coerced to a number).
- **Autocapture posture (updated pin).** `posthog/client.ts` init passes
  `autocapture: false` (zero implicit DOM capture for minors), `api_host: '/ingest'`
  (same-origin EU reverse proxy), `ui_host: 'https://eu.posthog.com'` (EU project
  159341), `person_profiles: 'identified_only'`, and `disable_session_recording: true`.
  The obsolete `mask_all_text` / `mask_all_element_attributes` guards are gone
  (moot with autocapture off) and their absence is asserted so the drop is not silent.

**Tests:**
- `src/__tests__/analytics/posthog-identity-p13.test.ts` (15 tests — identity across 3 paths, 7-event PII sweep, foxy no-message-text, injected-PII scrub, quiz_started fan-out + P5 grade string)
- `src/__tests__/analytics/posthog-autocapture-config.test.ts` (7 tests — updated to the new EU-host + `autocapture:false` contract)

### Invariants covered by this section

- P13 (data privacy — no raw UUID to `identify`; no PII in funnel event properties; autocapture off for a minors' product)
- P5 (grade format — `quiz_started.grade` stays a string end-to-end)

### Catalog total

Pre-REG-270: 236 entries (through the curriculum-version + response-cache-v2
merge, REG-269). The EU PostHog analytics turn-on adds REG-270: the identity
hashing + funnel-event PII boundary + `autocapture:false` EU-host posture.
**Total catalog: 237 entries (target: 35 — TARGET EXCEEDED).**

---

