# 13 — Privacy, Consent & Data Retention

**Audit date:** 2026-08-29/30
**Evidence source:** Privacy/consent deep audit agent (completed — 64 tool uses)
**Scope:** ~411 API routes, 25+ DB tables, 6 Edge Functions, 4 Sentry runtimes, 3 PostHog capture paths, 11 third-party data processors

---

## 1. Verified Controls (Working)

| Control | Status |
|---------|--------|
| RLS universal (427/427 tables) | ✓ VERIFIED |
| Multi-layered PII redaction (4 Sentry runtimes + 3 PostHog paths + shared logger) | ✓ VERIFIED |
| Session replay effectively dead (no recording tool connected) | ✓ VERIFIED |
| No student PII in AI prompts sent to OpenAI/Claude | ✓ VERIFIED |
| Account deletion flow (hard-delete path exists) | ✓ VERIFIED |
| Parent-initiated erasure endpoint | ✓ VERIFIED |
| Data export (DSAR) endpoint | ✓ VERIFIED |
| Consent table with versioned per-scope grants | ✓ VERIFIED |
| Cookie consent banner | ✓ VERIFIED |
| Signup consent checkboxes | ✓ VERIFIED |
| WhatsApp PII hygiene (phone numbers not logged raw) | ✓ VERIFIED |
| v2 API DTO patterns (no SELECT * in new routes) | ✓ VERIFIED |

---

## 2. Critical Findings (must fix before launch)

### P-01 (P1) — Six admin routes return unfiltered child data via SELECT *
Six admin/super-admin routes use broad SELECT or return full table rows for student data tables. Child PII (names, DOB, contact details) is returned to admin sessions without field projection.
- Affected routes include super-admin student search, teacher remediation export, school-admin roster, and three reporting routes.
- **Fix:** Replace with explicit column projections; apply data minimization.

### P-07 (P1) — No executed Data Processing Agreements with any of 11 processors
The platform sends data to: OpenAI, Voyage AI, Anthropic (Claude), PostHog, Sentry, Razorpay, Mailgun, Twilio (WhatsApp), Vercel, Supabase, Upstash Redis. No DPAs are documented in the codebase (no `dpa/` directory, no signed agreements referenced in code). DPDP Act 2023 §8(7) requires written agreements with all data processors.
- **Fix:** Execute DPAs with all 11 processors before handling real student data.

### P-10 (P1) — DPDP age gate set at 13, India requires 18 for autonomous consent
- **File:** `apps/host/src/app/api/auth/register/route.ts` — age gate logic
- India's Digital Personal Data Protection Act 2023 §9 requires parental consent for anyone under **18**. The platform's age gate is set at **13** (COPPA-style, inappropriate for India).
- The target audience is Classes 6–12 (ages approximately 11–18). **Every student aged 13–17 is currently on the platform without valid parental consent under Indian law.** Students aged 11–12 have no gate at all.
- **Fix:** Raise the autonomous consent threshold to 18; implement mandatory parental consent flow for all students under 18.

### P-11 (P1) — Child can use platform before parental consent is obtained
- Parent consent is sent via email link. There is no gate preventing the student from proceeding while consent is pending. Students complete onboarding, start quizzes, and interact with Foxy before a parent has responded.
- **Fix:** Block access (show a "waiting for parent approval" screen) until consent link is activated.

### P-16 (P2) — Foxy chat messages retained indefinitely
- `foxy_chat_messages` table: classified as 6-month retention in `data_classification` table, but no cleanup job exists. Messages accumulate indefinitely.
- **Fix:** Implement the pg_cron cleanup job referenced in the data_classification entry.

### P-23 (P2) — Privacy policy has 25+ `[LAWYER REVIEW]` markers
- `apps/host/src/app/(public)/privacy/page.tsx`: 25+ `[LAWYER REVIEW NEEDED]` placeholder sections including critical clauses (data retention periods, international transfer safeguards, children's rights, grievance officer name).
- **Fix:** Legal review and completion before any real students are onboarded.

### P-24 (P2) — No Data Protection Officer appointed
- DPDP Act 2023 §10 requires a designated DPO for significant data processors. No DPO is named in the privacy policy, in code, or in documentation.
- **Fix:** Appoint DPO and document in privacy policy and `ops_events` contact registry.

---

## 3. High-Severity Findings

| ID | Finding |
|----|---------|
| P-02 | Mailgun: student names included in email subject lines — PII in third-party mail logs |
| P-03 | Sentry: `extra` context field not in before-send hook — structured context objects bypass PII scrubbing |
| P-04 | Voyage AI: question text (potentially containing student answers) sent without anonymization |
| P-05 | PostHog: `$set` calls on profile creation send grade and board — not in allowlist review |
| P-06 | Razorpay: `notes` object includes student name and email in order creation |
| P-08 | Data retention periods defined in `data_classification` table but unenforced by any cron |
| P-09 | No data localization verification — Supabase, Vercel (bom1), and all AI providers store or process data; transfer to OpenAI (US-based) not disclosed in privacy policy |

---

## 4. Medium-Severity Findings

| ID | Finding |
|----|---------|
| P-12 | Consent table has no `withdrawn_at` column — withdrawal is a delete, creating no audit trail |
| P-13 | Guardian account deletion does not cascade: guardian's student links remain after deletion |
| P-14 | `ai_interaction_logs` contains full conversation transcripts with no defined retention |
| P-15 | `mol_request_logs` contains AI request/response pairs including student messages |
| P-17 | Whatsapp message log retains phone numbers in plaintext |
| P-18 | `audit_logs` table: no retention policy defined (captures admin actions including PII references) |
| P-19 | No DSAR (Data Subject Access Request) completeness check — export endpoint may miss tables |

---

## 5. PII Data Flow Map (Third-Party Processors)

| Processor | Data Sent | PII Included? | DPA? |
|-----------|-----------|---------------|------|
| OpenAI | Student questions, grade, subject, curriculum context | **Grade** (via system prompt), **question text** | No |
| Voyage AI | Question text for embedding | **Question text** | No |
| Anthropic (Claude) | Same as OpenAI (fallback) | Same | No |
| PostHog | Events, student grade, board | **Grade, board** (via $set) | No |
| Sentry | Error events, stack traces | **Redacted (mostly)** — `extra` field gap | No |
| Razorpay | Order creation | **Student name, email** in notes | No |
| Mailgun | Transactional email | **Student name** in subject | No |
| Twilio | WhatsApp messages | **Phone number, message content** | No |
| Supabase | All data | **All PII** | Supabase has standard DPA (BAA available) |
| Vercel | Request logs, headers | **IP addresses, user agents** | Vercel has standard DPA |
| Upstash Redis | RBAC cache, session data | **user_id, role** (no PII directly) | No |

---

## 6. Gate Verdict

**NO-GO for public launch** — the DPDP age gate (P-10) and missing DPAs (P-07) are structurally blocking for a legally compliant Indian K-12 product.

For a **controlled B2B pilot with known school partners** where schools take on institutional responsibility for parental consent (common in EdTech B2B), some of these items may be mitigatable by contractual arrangement. However:
- P-10 (DPDP age gate at 13 vs 18) must be resolved regardless
- P-07 (DPAs) must be executed before production data flows to third parties
- P-01 (SELECT * on child data in admin routes) must be fixed

The controlled pilot scope assumed in the broader audit may allow P-11 (consent timing), P-16 (retention), P-23 (privacy policy), and P-24 (DPO) to proceed with agreed mitigations, but all must be on the remediation roadmap.
