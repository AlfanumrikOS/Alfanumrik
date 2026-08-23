---
name: alfanumrik-student-safety
description: Student data, minors, Foxy conversations, SEL, messaging, analytics, content generation, and AI safety governance across both AI and non-AI student-facing surfaces. Use when a feature touches student PII, consent, retention/deletion, safeguarding escalation, or age-appropriate content — not only inside AI Edge Functions.
user-invocable: false
---

# Skill: Student Safety

Governs how student data and student-facing content are handled — by AI features and by ordinary product features (messaging, analytics, notifications, CMS-authored content) alike. If a task only concerns *how* an AI model is called (gateway, prompts, retrieval), that's `ai-integration`; if it concerns *whether a student should be exposed to something* or *what happens to their data*, it's here.

## 1. Minors-first treatment

Every student account is a minor by default, regardless of grade or age field. Do not gate safety behavior on a self-reported age or grade — a wrong grade entry must never relax a safety rule.

## 2. Data minimisation

Collect and expose only what a feature needs. Before adding a new student-data field or export, ask: does the requesting surface (teacher, parent, admin) need this specific field, or a coarser aggregate? Prefer counts/buckets over row-level PII exposure (mirrors the re-present/re-compute discipline in `student-frontend`).

## 3. Tenant isolation

A student's data must never be readable across school/tenant boundaries. Every new query path touching student rows must be checked against `alfanumrik-identity-rbac`'s tenant-isolation rules; this skill does not restate RLS mechanics (see `supabase-patterns`) — it owns the *policy* that isolation is required, not the SQL that enforces it.

## 4. Consent-aware processing

Parent consent is a first-class, auditable state, not an implicit default. Real implementation: `apps/host/src/app/api/parent/consent/route.ts`, `apps/host/src/app/parent/consent/page.tsx`. Any new data use (a new analytics export, a new AI feature touching a minor's data) must state which existing consent record it relies on, or that it needs a new one — do not assume consent transfers across features silently.

## 5. Retention and deletion

`supabase/migrations/20260505120000_account_deletion_flow.sql` is the canonical account-deletion path. Any new table holding student data must have a stated deletion story (cascades through this flow, or an explicit documented exception) before it ships — this is the same discipline `supabase-patterns` requires for RLS: retention is not optional and is not a follow-up ticket.

## 6. PII redaction — logs, traces, monitoring

- `packages/lib/src/logger.ts` redacts password/token/email/phone/API keys. Never log student-identifiable data (name, email, phone, raw IP, message text) to console or a structured log.
- `packages/lib/src/sentry-client-redact.ts` + `apps/host/{sentry-client-init.ts,sentry.server.config.ts,sentry.edge.config.ts}` — the `beforeSend` redactors are the enforcement point for Sentry. A new client-side error path must go through the existing Sentry init, not a bespoke `console.error`/reporter.
- AI-specific traces (retrieval traces, model call logs) must carry session/request identifiers only — never a student's name or message text verbatim in a trace payload. See `ai-integration` → `references/foxy-pedagogy-and-learner-state.md` for the trace-content rule on the AI side specifically.

## 7. Safe messaging and content generation

Any feature that lets a student receive free-form content — from a teacher, from another user, or from a model — is in scope here even if no AI is involved. Apply the same age-appropriateness and escalation bar to teacher→student messaging, CMS-authored content, and AI output alike. Do not assume "a human wrote it" makes content automatically safe for the youngest grade it could reach.

## 8. Safeguarding classification and escalation

- `packages/lib/src/ai/validation/safeguarding-classify.ts` and `packages/lib/src/ai/validation/safeguarding-screen.ts` classify/screen content for safeguarding risk.
- `apps/host/src/app/api/foxy/_lib/safeguarding-escalate.ts` is the escalation path when a concern is detected.
- **Human review for serious risk is mandatory.** A safeguarding classifier may flag and route, but must never be the terminal decision-maker for a serious concern (self-harm, abuse disclosure, safety threat) — it escalates to a human reviewer. Treat any change that removes or bypasses the escalation call as a blocking defect.

## 9. No deterministic medical, psychological, or life-outcome claims

Neither Foxy nor any student-facing surface may state or imply a medical diagnosis, a psychological diagnosis, or a deterministic life/career/academic-outcome prediction ("you will fail", "you have ADHD", "you will never pass this exam"). Mastery/BoardScore-style predictions are probabilistic and scoped to CBSE academic performance (see `student-frontend` → Learner Data Semantics for the denominator/N=5 discipline that keeps these honest) — they are not life-outcome claims and must not be worded as such.

## 10. Negative authorisation and cross-tenant tests

Every feature that reads or writes student data must have a test that proves the *wrong* actor is denied, not just that the right actor succeeds. Existing examples to follow: `apps/host/src/__tests__/school-admin-auth-rbac-narrowing.test.ts`, `apps/host/src/__tests__/rbac-b2b-b2c-gaps.test.ts`, `eval/tenant-isolation/run.ts` (+ `eval/tenant-isolation/baseline.json`). A PR that adds a new student-data read path without an accompanying negative test is incomplete, not merely under-tested.

## Checklist before shipping a student-data or student-content feature

- [ ] Treated the student as a minor regardless of stated age/grade
- [ ] New fields/exports are minimal for the requesting surface
- [ ] Tenant isolation verified (delegates SQL detail to `alfanumrik-identity-rbac`/`supabase-patterns`)
- [ ] Consent basis identified or a new consent flow proposed
- [ ] Deletion story stated for any new student-data table
- [ ] No student PII in logs, Sentry events, or AI traces
- [ ] Free-form content (human or AI) reviewed against the same age-appropriateness bar
- [ ] Safeguarding classification wired to human escalation, not a silent auto-decision
- [ ] No medical/psychological/deterministic-outcome wording anywhere in copy
- [ ] A negative/cross-tenant test exists for the new data path

## What this skill does not own

Provider mechanics, prompt structure, gateway/adapter behavior, RAG retrieval correctness, and AI evaluation live in `ai-integration` (+ its `references/foxy-pedagogy-and-learner-state.md`). RLS policy syntax and migration templates live in `supabase-patterns`. Roster/tenant/privilege model questions live in `alfanumrik-identity-rbac`.

## Review chain

Making agent: whichever agent implements the feature (frontend/backend/ai-engineer). Required reviewers: assessment (if learner-facing content/claims), architect (if new table or consent/deletion path), ai-engineer (if AI-generated content), testing (negative/cross-tenant coverage), quality. Escalate to the user before shipping anything that could plausibly need a new consent flow or that changes the deletion story for existing student data.
