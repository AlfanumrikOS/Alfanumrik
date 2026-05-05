# Platform Summary for Lawyer

A 1-page legal-context briefing for the engaged law firm. Read alongside `04-lawyer-review-categories.md` and the two scaffold files.

---

## What Alfanumrik does

Alfanumrik Learning OS is a B2C K-12 EdTech platform serving CBSE-curriculum students in grades 6 through 12 (typically aged 10-18) across India. The product offers adaptive quizzes, an AI tutor ("Foxy") grounded in NCERT curriculum content, a parent portal for progress visibility, and a teacher portal for class assignment and review. Subscriptions are sold directly to families on monthly recurring (RBI e-mandate) and yearly one-time bases, in INR, via Razorpay.

---

## User roles

| Role | Description | Account creation |
|---|---|---|
| Student | Learner, grades 6-12 | Self-signup with parent consent if minor |
| Parent / Guardian | Linked to one or more students | Self-signup or invited via student linking code |
| Teacher | School-affiliated educator | Self-signup with school code or admin-provisioned |
| School Administrator | School-level admin | Admin-provisioned only |
| Super Administrator | Internal Alfanumrik staff | Admin-provisioned only |

---

## Age range and minor classification

- **10-12** — minor under DPDP Act, additionally treated as "child" with strongest protections (no behavioural targeting, no AI training use, lower Foxy daily cap, parent-routed comms).
- **13-17** — minor under DPDP Act; verifiable parental consent required.
- **18+** — adult; may convert to "independent" mode and revoke parental access.

The DPDP Act treats anyone under 18 as a "child" and requires verifiable parental consent for processing of children's personal data.

---

## Data categories collected

Detailed list in `privacy-policy-scaffold.md` Section 2. High-level summary:

- Identity & contact (name, email, phone, DOB, optional photo)
- Education (grade, school, board, subjects, stream, language)
- Learning activity (quiz responses, scores, XP, mastery levels, error patterns, Foxy chat history)
- Parent / guardian information
- Payment & subscription metadata (no full PAN, no CVV, no UPI PIN)
- Technical & device data (truncated IP, device, session IDs, crash reports)
- Communications (support tickets, notifications)

Sensitive data flagging under SPDI Rules is one of the open `[LAWYER REVIEW]` items (see `04-lawyer-review-categories.md` A.2).

---

## Third parties with data access

| Provider | Role | Region |
|---|---|---|
| Supabase, Inc. | Database, auth, file storage | Mumbai (AWS ap-south-1) primary; metadata possibly US |
| Vercel, Inc. | Web hosting, serverless functions | Mumbai (bom1) primary; global edge for static assets |
| Razorpay Software Pvt Ltd | Payment processor | India |
| Anthropic, PBC | AI inference (Claude) for Foxy + related features | United States (cross-border) |
| Sentry (Functional Software, Inc.) | Error monitoring (PII redacted before send) | EU or US (TBD by engineering, see review category C.2) |
| PostHog Inc. | Product analytics (no PII per config) | EU Cloud or US Cloud (TBD, see C.3) |
| Vercel Analytics | Aggregate web analytics | United States |
| Email delivery provider | Transactional email | TBD per founder fill |
| WhatsApp BSP (if used) | Notifications | India |

PII redaction enforced before data leaves the user device or our servers for Sentry, PostHog, and the Anthropic Claude API. Implementation is regression-tested (`sentry-pii-redaction.test.ts`, REG-49 in our internal regression catalogue).

---

## Hosting region

- Vercel Mumbai (bom1) — primary application and serverless edge functions.
- Supabase Mumbai project (AWS ap-south-1) — primary database, auth, file storage.
- Cross-border processors (Anthropic, possibly Sentry, possibly PostHog) — see "Third parties" above.

---

## Payment model

- INR only.
- Monthly plans: Razorpay recurring mandate (RBI e-mandate framework). Pre-debit notification 24 hours before each charge.
- Yearly plans: one-time payment, no auto-renewal; manual renewal reminder 14 days before expiry.
- Webhook signature verification before processing any Razorpay event.
- Subscription state changes are written atomically with payment records via a single database RPC (no two-statement split).
- Idempotency key: Razorpay event ID, with a unique constraint in the `payment_webhook_events` table.
- Concurrency: per-student advisory lock to serialise verify-route and webhook contention.

---

## Existing compliance posture

- **PII redaction in logs.** Logger redacts password, token, email, phone, and API keys before write. Enforced for both server logs and Sentry events.
- **Row-Level Security (RLS).** Enforced in the database for all student, parent, and teacher data; users see only their own (or their authorised scope's) records.
- **Role-Based Access Control (RBAC).** 6 roles, 71 granular permissions, enforced server-side on every API endpoint via `authorizeRequest()`.
- **Service-role isolation.** Privileged database keys are server-only and never reach client devices.
- **Audit logs.** Admin actions and security events logged with restricted access.
- **Account deletion API.** Endpoint and parent-portal flow exist; aligned with DPDP §17 right-to-erasure subject to statutory carve-outs (see `04-lawyer-review-categories.md` I.1).
- **Webhook signature verification** for all payment events.
- **Anti-cheat and rate-limiting** in the quiz engine.
- **Backups** via Supabase scheduled snapshots.

---

## Active feature flags / kill switches

- `ff_atomic_subscription_activation` — gates the atomic subscription-activation fallback on the payment webhook.
- `ff_irt_question_selection` — dormant (off until calibration data accumulates).
- AI provider kill switches per Edge Function — operational, not user-facing.

These do not change the legal posture but are mentioned for completeness.

---

## Pending compliance work (honest gap list)

The lawyer should be aware that the following items are tracked but not yet shipped:

1. **Charge-skip behaviour on RBI pre-debit notification failure** — current behaviour is to attempt the charge regardless; ideal behaviour is to skip if the 24-hour notice did not deliver.
2. **AI prompt-construction unit test** asserting no PII keys reach the Anthropic payload — currently enforced by code review and the shared `redact-pii` helper, not by a regression test.
3. **In-app cookie banner** with granular consent choices — current implementation is a single accept/decline; granularity is in design.
4. **Parent-portal Foxy summary vs verbatim toggle** — currently parents see learning summaries, not chat verbatim; the lawyer's call (PP §7.3) will determine the final policy.
5. **DPO appointment** — the role exists in the policy but the named individual is one of the founder-fill items (`01-founder-fill-checklist.md` B.1-B.6).
6. **AI-training opt-out toggle in Settings** — exists for AI features as a whole (Settings → AI Preferences); a separate "do not use my conversations to improve AI" toggle is not yet shipped, pending the policy decision in PP §14.2.
7. **Cookie disclosure page** at the URL referenced in PP §13 — page does not exist yet; founder-fill item D.4.

---

## What we are NOT asking the lawyer to review

- The school-side institutional master service agreement (separate engagement scope).
- The teacher-platform terms (currently inherits the consumer ToS; a B2B variant will be a separate engagement).
- Razorpay's own merchant agreement (we accept it as-is).
- The internal employment / contractor / NDA suite.
- Investor / cap-table / fundraise documentation.

Engagement scope is the consumer-facing Privacy Policy and Terms of Service only.
