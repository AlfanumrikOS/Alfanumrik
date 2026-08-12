## Subject Governance (Phase H — 2026-04-15)

Source: `docs/superpowers/specs/2026-04-15-subject-governance-design.md` §11.3

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| SG-1 | `class_6_free_plan_no_senior_subjects` | Grade 6 free-plan student never sees Physics/Chemistry/Biology/Accountancy in API, hook, picker, or PATCH preferences | `src/__tests__/regression-subject-leak.test.tsx` | E |
| SG-2 | `api_never_returns_global_subject_list` | `GET /api/student/subjects` returns a strict subset of the canonical 17 for every student profile | `src/__tests__/regression-subject-leak.test.tsx` | E |
| SG-3 | `grade_11_commerce_excludes_physics` | Grade 11 commerce stream RPC + validator excludes physics/chemistry/biology | `src/__tests__/regression-subject-leak.test.tsx` | E |
| SG-4 | `grade_11_science_excludes_accountancy` | Grade 11 science stream RPC + validator excludes accountancy/business_studies | `src/__tests__/regression-subject-leak.test.tsx` | E |
| SG-5 | `plan_downgrade_clamps_selected_subjects` | Downgrading pro → starter surfaces previously-allowed subjects as `is_locked=true` and `validateSubjectWrite` rejects with reason='plan' | `src/__tests__/regression-subject-leak.test.tsx` | E |
| SG-6 | `admin_delete_flags_without_deleting_enrollments` | Admin DELETE on `plan_subject_access` flags affected students in the violations report; `student_subject_enrollment` rows are preserved until ops repair | `src/__tests__/regression-subject-leak.test.tsx` | E |

### E2E coverage

Playwright spec `e2e/subject-governance.spec.ts` — three scenarios from §11.5:

- Grade 11 science onboarding: stream capture → subject picker excludes accountancy → dashboard shows only stream-valid subjects.
- Legacy user with invalid enrollment: ReselectBanner visible → reselect → no invalid subjects surface.
- Plan downgrade: post-refresh dashboard has no unlocked physics/chemistry/biology chips.

### Invariants covered by this section

- P5 (grade format — strings)
- P8 (RLS boundary — governance service on server)
- P9 (RBAC enforcement — 422 on write, 200 on read-only allowed intersection)

---

## Subject denial contract on the /v2 read surface (2026-08-12, E2E Batch 2 P2-7 + P2-8) — REG-398

Source: the 2026-08-12 production E2E report, findings P2-7a/b/c and P2-8. Three
defect shapes on the /v2 student read surface, all variants of "a denial that
lies about itself":

- **P2-7a — the 403 named the wrong variable.** `GET /v2/quiz/questions`
  interpolated `subjectValidation.error.reason` — the `'grade' | 'plan'` CAUSE
  enum — so a display-name mistake (`?subject=Mathematics`) produced
  `"Subject not allowed: grade"`, which reads as if the (valid) `grade` query
  param were the problem.
- **P2-7b — governance outage served questions UNGATED.** The
  `validateSubjectWrite` call was wrapped in a soft-fail catch ("migrations may
  not be applied" — a fossil: `get_available_subjects` ships in the baseline
  migration), so a real RPC outage silently disabled subject gating entirely.
- **P2-7c — unknown subject masqueraded as success/content-gap.**
  `GET /v2/learn/curriculum?subject=Mathematics` returned the empty-success
  `200 {subjects: []}` (indistinguishable from "this grade has no curriculum
  loaded", the symptom of a content-integrity incident);
  `GET /v2/learn/concept` fell through to `404 NO_CONTENT` (indistinguishable
  from a genuine content gap).
- **P2-8 — the OpenAPI spec omitted the already-enforced `Idempotency-Key`
  header** on `postQuizSubmit`, `details` on `ErrorResponse`, and the
  code-vs-display-name distinction on subject params — so a generated client
  could not know any of it.

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-398a | `quiz_questions_structured_403_names_subject` | The governance 403 names the rejected SUBJECT (`'Mathematics'` / `'sanskrit'` in the message), is NEVER the old wrong-variable shape (`not.toBe('Subject not allowed: grade')`), and carries top-level `details: { subject, reason, allowed }` for both `reason:'grade'` and `reason:'plan'`. **Denial-vs-outage separation:** the 403 denial NEVER carries `retryable:true` (`not.toHaveProperty('retryable')`) — a denial that invites retry loops a client forever — and never reaches the questions RPC (no `question_id` in the body, `select_quiz_questions_rag` not in the call log). | `apps/host/src/__tests__/api/v2/quiz-questions.test.ts` → `describe('subject governance …')` (3 of 5 tests) | E | P9 |
| REG-398b | `quiz_questions_governance_fail_closed_503` | Governance-RPC failure → `503 SUBJECT_GOVERNANCE_UNAVAILABLE` with top-level `retryable:true` (the #1526 transient idiom, so the mobile drain retries instead of discarding) and the questions RPC is **NEVER called** — pinned via the RPC call log (`_rpcCalls` must not contain `select_quiz_questions_rag`) plus a no-`question_id`-in-body sweep. **The fail-closed DIRECTION is pinned as total over throw shapes** (REG-391 style): an `Error` rejection and a bare-string rejection (`'ETIMEDOUT'` — the shape an `instanceof Error` narrowing refactor drops) both land on the same 503, never ungated questions. The concept route's subjects-RPC outage is pinned to the same 503 + never-reads-content contract. | `apps/host/src/__tests__/api/v2/quiz-questions.test.ts` (2 of 5) + `apps/host/src/__tests__/api/v2/learn-concept.test.ts` (503 test) | E | P9 |
| REG-398c | `learn_routes_unknown_subject_400_never_silent` | Curriculum: an unknown `subject` filter (display name `"Mathematics"`, or a code outside the student's tree) → `400 UNKNOWN_SUBJECT` with `details: { subject, reason:'unknown_subject', allowed[] }` — NEVER the empty-success 200. **The empty-success shape is reserved for zero subjects + NO filter** (pinned as a 200), and the boundary is pinned as a BRANCH-ORDER test: zero subjects + a filter is `400` with `allowed: []`, so flipping the two branches fails. A LOCKED subject is a VALID filter value (param validation, not plan gating) on BOTH routes — curriculum renders it with `is_locked`, concept still serves prose. Concept: unknown subject → `400 UNKNOWN_SUBJECT` (the `404 NO_CONTENT` is reserved for a KNOWN subject's genuine content gap; content reader never consulted on the 400), and the subjects lookup is pinned to key by the AUTH user id (`get_available_subjects(p_student_id: auth.userId)` — the curriculum precedent; silently swapping to `students.id` would turn every request into a spurious 400). | `apps/host/src/__tests__/api/v2/learn-curriculum.test.ts` (6 tests) + `apps/host/src/__tests__/api/v2/learn-concept.test.ts` (4 tests) | E | P9 |
| REG-398d | `error_details_contract_and_openapi_sync` | `ErrorResponse` (Zod → openapi/v2.json → Dart) accepts the three new wire shapes (`subject_not_allowed` + details, `UNKNOWN_SUBJECT` + details, `SUBJECT_GOVERNANCE_UNAVAILABLE` + `retryable:true`); `SubjectNotAllowedDetails` is registered in components.schemas and **REJECTS a missing `allowed[]`** (the actionable half — dropping it re-creates "rejected, but with what valid values?"). The `Idempotency-Key` header is now a REQUIRED `in:header` UUID parameter on `postQuizSubmit` in the generated spec. Sync between `contract.ts` and the committed `openapi/v2.json` is enforced by `npm run gen:openapi:check` (CI: `.github/workflows/openapi-contract.yml`; run green in this session). | `apps/host/src/__tests__/api/v2/contract-conformance.test.ts` (5 new tests) + `gen:openapi:check` | E | P9, mobile contract |

### Honest limits of this entry

- **Sibling inconsistency, reported not fixed:** `GET /v2/learn/curriculum`
  still answers `500 INTERNAL_ERROR` when `get_available_subjects` errors
  (pre-existing), while concept and quiz/questions now answer
  `503 SUBJECT_GOVERNANCE_UNAVAILABLE retryable:true` for the SAME dependency
  outage. A retrying client treats the curriculum failure as permanent. Owed
  follow-up for backend; deliberately not silently "fixed" from the test side.
- All doubles — no live Postgres. `validateSubjectWrite`'s own DB behaviour is
  covered by the SG-1..SG-6 suite above; this entry pins the ROUTE contract
  around it.
- P2-8's spec additions document already-enforced route behaviour; the enforcing
  mechanism for the spec file itself is the `--check` regeneration diff, not a
  vitest assertion.

### Invariants covered by this section

- P9 (subject gating fails CLOSED on outage; denials are structured and honest;
  unknown params can never masquerade as success or content gaps)
- Mobile /v2 contract (ErrorResponse.details + Idempotency-Key are now in the
  generated spec the Dart client is built from)

### Catalog total

Pre-REG-398: 397 entries (REG-396 in `06-auth-onboarding.md`, REG-397 in
`10-rbac-rls.md`, same batch — E2E Batch 2, branch
`Alfanumrik/e2e-batch2-denial-contract`). This section adds REG-398 (a–d count
as ONE entry).
**Total catalog: 398 entries (target: 35 — TARGET EXCEEDED). REG-399 is the next
free id** (REG-371..REG-377 remain RESERVED).

