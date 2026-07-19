## Engineering-Audit Cycle 3 — Student Learning Core (P1/P2) — 2026-06-29

Source: engineering-audit program, Cycle 3 (Student Learning Core). P1 fixes the
score formula `score_percent = Math.round((correct / total) * 100)` and P2 fixes
the quiz-XP earning literals (per-correct=10, high-score-bonus=20,
perfect-bonus=50). Both invariants are duplicated across a TypeScript source and
one-or-more SQL RPC bodies, so the risk is silent drift between the layers. This
cycle gave both guarantees executable, cross-layer parity coverage: the score
formula is proven identical at all three sites (TS + SQL v1/v2 RPC + the
display component that only consumes it), and the XP literals are extracted from
every root migration's quiz-XP PL/pgSQL body and pinned equal to `XP_RULES`.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-180 | `score_formula_three_way_parity` | P1 `score_percent = round((correct/total)*100)` is identical at the TS site (`scoring.ts`), the SQL v1+v2 RPC bodies (canonical `ROUND` present, no precision variant), and is property-proven `Math.round ≡ PG ROUND` on non-negative operands; `QuizResults.tsx` consumes `results.score_percent` and never recomputes the overall score. Drift at any of the three sites (formula change, precision-variant ROUND, or a recompute reintroduced into the display component) fails CI. | `src/__tests__/score-formula-three-way-parity.test.ts` | E |
| REG-181 | `xp_sql_literal_parity` | P2 quiz-XP earning literals (per-correct=10, high-score-bonus=20, perfect-bonus=50) extracted from every root migration's quiz-XP PL/pgSQL body equal `XP_RULES` (`src/lib/xp-config.ts`). Drift in any v1/v2/trigger or a future RPC redefinition that hardcodes a different literal than the single TS source of truth fails CI. | `src/__tests__/xp-sql-literal-parity.test.ts` | E |

### Invariants covered by this section

- P1 (score accuracy — `Math.round((correct/total)*100)` identical at the TS
  `scoring.ts` site, the SQL v1+v2 RPC bodies, and the `QuizResults.tsx` display
  component which only consumes the server `score_percent`, never recomputes)
- P2 (XP economy — the three quiz-XP earning literals live only in `XP_RULES`;
  every SQL PL/pgSQL body must match the single TS source of truth)

### Catalog total

Pre-REG-180: 146 entries (through Engineering-Audit Cycle 2's REG-178/REG-179
payment-funnel pins). Engineering-Audit Cycle 3 adds REG-180 (score-formula
three-way parity — TS + SQL v1/v2 + display-component consume-only) and REG-181
(XP SQL-literal parity — quiz-XP earning literals extracted from every root
migration equal `XP_RULES`).
**Total catalog: 148 entries (target: 35 — TARGET EXCEEDED).**

---

## Engineering-Audit Cycle 8 — Cross-cutting (P7/P10/P1-P2/P11-adjacent) — 2026-06-29

Source: engineering-audit program, Cycle 8 (Cross-cutting). The web and mobile
(Flutter) clients duplicate three classes of constant that have historically been
kept in sync by comment ("keep in sync with…") rather than by a test. Comment-sync
silently rots: the next edit that touches only one side ships a divergence that no
gate catches. This cycle converts three of those comment-sync seams into
contract-sync — a CI failure on the next unsynced edit. (1) Subscription plan
prices: Flutter `subscription.dart` mirrors web `plans.ts` PRICING; a drift is a
P11-adjacent brand/billing-trust risk (the app would quote a price the checkout
won't honor). (2) Score-config constants: the 41 weights/ceilings/floors/thresholds
that drive P1 scoring and P2 XP exist on both clients; a one-sided edit would make
the mobile scorecard disagree with the server. (3) The bundle-size caps in
`check-bundle-size.mjs`: a silent cap-raise is how P10 erodes, so the caps are
pinned to a test that forces any future raise into the same P10-approved PR. All
three entries are parity/pin-only — they do NOT assert any rupee value, constant,
or kB number is "correct"; they assert the two sides agree (and, for the caps, that
a raise is deliberate).

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-191 | `mobile_web_price_parity` | P11-adjacent: Flutter `mobile/lib/data/models/subscription.dart` plan prices EQUAL web `src/lib/plans.ts` PRICING for every plan, in BOTH directions (no web plan missing from mobile, no mobile plan missing from web); parity-only — does NOT pin any rupee value as "correct"; non-vacuous (asserts >= 2 plans present on each side so an empty parse can't pass); converts the historical comment-sync ("keep in sync with plans.ts") into contract-sync — the next unsynced price edit on either side fails CI. | `src/__tests__/cross-cutting/mobile-web-subscription-price-drift.test.ts` | E |
| REG-192 | `mobile_web_score_config_parity` | P1/P2: all 41 score-config constants (component weights, Bloom ceilings, retention floors, behavior weights + windows, level thresholds) are identical across web `src/lib/score-config.ts` and Flutter `mobile/lib/core/constants/score_config.dart`; parity-only (does not assert any value is "correct", only that the two clients agree so the mobile scorecard cannot diverge from the server-authoritative P1 score / P2 XP); non-vacuous (asserts >= 20 shared keys so a failed parse can't pass silently). | `src/__tests__/cross-cutting/mobile-web-score-config-drift.test.ts` | E |
| REG-193 | `bundle_cap_pin` | P10 (anti cap-creep): pins the four caps in `scripts/check-bundle-size.mjs` — `CAP_SHARED_KB=284`, `CAP_PAGE_KB=260`, `CAP_MIDDLEWARE_KB=120`, `SHARED_THRESHOLD_PCT=95` — so any future cap raise must update this pin in the same PR, keeping every P10 budget change deliberate and CEO/P10-approved rather than a silent drift. Pin-only — does NOT itself measure bundle size (CI's bundle-size step does that); it guards the guardrail's own numbers. | `src/__tests__/cross-cutting/bundle-cap-pin.test.ts` | E |

### Invariants covered by this section

- P1 (score accuracy) / P2 (XP economy) — REG-192 pins the mobile score-config
  twin to the web source so the Flutter client's score/XP math cannot silently
  diverge from the server-authoritative formula; parity-only, the server remains
  the single re-deriver.
- P10 (bundle budget) — REG-193 pins the four bundle caps so a raise is always a
  deliberate, reviewed edit in the same PR rather than a silent erosion.
- P11-adjacent (billing trust) — REG-191 pins mobile↔web plan-price parity so the
  app can never quote a price the Razorpay checkout won't honor; parity-only, no
  rupee value is asserted "correct".
- P7 (bilingual UI) — covered indirectly: the cross-cutting drift sweep keeps the
  mobile and web client constants that feed user-facing surfaces from diverging.

### Catalog total

Pre-REG-191: 157 entries (through Engineering-Audit Cycle 7's REG-188..REG-190
parent-portal cluster). Engineering-Audit Cycle 8 adds REG-191 (mobile↔web
subscription-price parity — comment-sync → contract-sync), REG-192 (mobile↔web
score-config parity — all 41 constants), and REG-193 (bundle-cap pin —
anti cap-creep on the four `check-bundle-size.mjs` caps).
**Total catalog: 160 entries (target: 35 — TARGET EXCEEDED).**

---

## Remediation — Tier-2 PR D: Grade Read-Coercion + normalizeGrade Extraction (P5) — 2026-06-30

The Tier-2 PR D slice fixes a P5 grade-format bug at the read boundary. Previously
`normalizeGrade` (in `src/lib/identity/constants.ts`) only handled bare valid
strings (`"6".."12"`) and in-range numbers; any legacy/prefixed value such as
`"Grade 11"`, `"Class 7"`, or `"11th"` fell through to the `"9"` safe default —
silently MIS-GRADING a grade-11 student as grade 9 in the UI. The function now
EXTRACTS the first 1–2 digit run via `/\d{1,2}/`, range-validates it to 6..12, and
keeps it; bare valid strings stay idempotent, in-range numbers stringify, and only
genuinely invalid / out-of-range / null / undefined / empty input reaches the `"9"`
default. `AuthContext.tsx` now wraps the loaded grade in `normalizeGrade(studentData.grade)`
on the `setStudent({ ...studentData, ... })` object-spread at BOTH student-profile
read paths (the metadata path already had it), so a stored legacy value can never
surface in the dashboard as `"Grade 9"` or mis-grade the learner.

The extraction truth-table is asserted with direct behavioral unit calls (the
pre-existing 7 normalizeGrade tests still pass unweakened): `"9"`→`"9"`,
`"Grade 11"`→`"11"`, `"grade 6"`→`"6"`, `"Class 7"`→`"7"`, `"Grade-12"`→`"12"`,
`"11th"`→`"11"`, `" 8 "`→`"8"`, `12`(num)→`"12"`, `"5"`→`"9"`, `"13"`→`"9"`,
`"0"`→`"9"`, `null`→`"9"`, `undefined`→`"9"`, `""`→`"9"`. Idempotency
(`normalizeGrade(normalizeGrade("Grade 11")) === "11"`) and the P5 no-integer-leak
invariant (output is always a string in `VALID_GRADES`, even for objects/arrays)
are pinned. The AuthContext application is pinned as a comment-stripped static-source
assertion: ≥2 `grade: normalizeGrade(studentData.grade)` occurrences on `setStudent`
spreads, and a guard that EVERY `setStudent({ ...studentData ... } as Student)` spread
carries the `normalizeGrade(` override (no raw-grade leak path).

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-203 | `normalize_grade_extracts_legacy_prefixed_grade` | P5: `normalizeGrade` extracts the real grade digit from legacy `"Grade N"`/`"Class N"`/`"Nth"` formats (range-validated 6..12) instead of defaulting non-9 prefixed grades to `"9"` (the prior bug), bare `"6".."12"` idempotent, invalid/out-of-range/null → `"9"`; AuthContext applies it at the student-profile read paths so the UI never shows `"Grade 9"` and never mis-grades a grade-N student | `src/__tests__/identity-constants.test.ts` | U | P5 |

### Invariants covered by this section

- P5 (grade format) — REG-203 pins the extraction truth-table (legacy-prefixed
  formats yield the real digit, range-validated 6..12), idempotency on already-valid
  grades, the no-integer-leak guarantee (output always a `VALID_GRADES` string), and
  the AuthContext source pin that the loaded grade is coerced through `normalizeGrade`
  on every `setStudent` student-profile-read spread.

### Catalog total

Pre-Tier-2-PR-D: 169 entries (through Tier-2 PR B's REG-202 super-admin export
message redaction). Tier-2 PR D adds REG-203 (grade read-coercion + normalizeGrade
legacy-extraction — the P5 extraction truth-table + idempotency + no-integer-leak +
AuthContext read-path source pin).
**Total catalog: 170 entries (target: 35 — TARGET EXCEEDED).**

---

## Remediation — AO-10b: Historical Grade Backfill + Write-Path Default Fix (P5) — 2026-06-30

The AO-10b migration `20260702070000_ao10b_backfill_student_grade_p5.sql` closes the P5
grade-format gap at the DATA layer (the read layer was already coerced by PR D / AO-10).
**Part A (data backfill)** rewrites legacy/prefixed `students.grade` values
("Grade 9", "Class 11", "Grade-7", "11th", " 8 ", …) to the bare in-range digit string using
`substring(grade from '\d{1,2}')::int::text` — the SAME first-1-2-digit-[6,12] extraction as
the TypeScript `normalizeGrade` read-coercion (`src/lib/identity/constants.ts:170-191`). It is
FAIL-SAFE: the UPDATE is gated on `grade NOT IN ('6'..'12')` AND the embedded number
`BETWEEN 6 AND 12`, so already-bare rows AND ambiguous / out-of-range / no-digit rows
("Grade 5", "Grade 13", "Grade", NULL-ish) are LEFT UNTOUCHED. It NEVER invents the TS '9'
safe default at the data layer (that default only applies at read time), and never writes an
integer (`::int::text` → string). A read-only COUNT pre-flight runs first; an RLS-enabled,
service-role-only backup table (`_ao10b_grade_backfill_backup`) snapshots every changed row
for exact rollback; the snapshot INSERT is `NOT EXISTS`-guarded for replay-safety.
**Part B (write-path fix)** `CREATE OR REPLACE`s the two onboarding RPCs whose baseline
default literal re-accrued the "Grade N" shape — `create_student_profile` ('Grade 9' → '9')
and `get_or_create_student` ('Grade 6' → '6') — so new rows are P5-conformant at write time
and the backfill does not re-accrue. No DROP TABLE/COLUMN; fully idempotent
(`IF NOT EXISTS`, `DROP POLICY IF EXISTS`, `CREATE OR REPLACE`, snapshot `NOT EXISTS` guard).

| # | Test name | Asserts | Location | Status | Invariants |
|---|---|---|---|---|---|
| REG-209 | `ao10b_grade_backfill_extraction_and_writepath_defaults` | P5: the AO-10b migration backfills `students.grade` legacy "Grade N"→"N" using the SAME first-1-2-digit-[6,12] extraction as the TS normalizeGrade read-coercion (fail-safe — only clearly-parseable rows touched, ambiguous/out-of-range LEFT untouched, never an integer, RLS-protected reversible backup), and fixes the two onboarding write-path defaults (create_student_profile 'Grade 9'→'9', get_or_create_student 'Grade 6'→'6') so new rows are P5-conformant at write time and the backfill does not re-accrue; no DROP, idempotent | `src/__tests__/ao10b-grade-backfill.test.ts` | E | P5 |

### Invariants covered by this section

- P5 (grade format) — REG-209 source-pins (comment-tolerant) the SHAPE of the migration:
  (1) EXTRACTION PARITY — the backfill UPDATE writes `substring(grade from '\d{1,2}')::int::text`
  gated on `grade NOT IN ('6'..'12')` AND the embedded number `BETWEEN 6 AND 12` (already-bare,
  out-of-range, and no-digit rows excluded), with a read-only two-bucket COUNT pre-flight;
  (2) NO FORCED DEFAULT AT THE DATA LAYER — no constant `SET grade = '9'`/`'6'`/`'Grade N'`,
  no COALESCE/CASE fallback that injects a default digit; (3) BACKUP TABLE RLS —
  `_ao10b_grade_backfill_backup` is `CREATE TABLE IF NOT EXISTS` + `ENABLE ROW LEVEL SECURITY`
  + service-role-only policy in the same migration; (4) WRITE-PATH DEFAULTS — both RPCs are
  `CREATE OR REPLACE`d with the bare default and the OLD `'Grade 9'`/`'Grade 6'` literals are
  gone from executable SQL; (5) NO DROP / IDEMPOTENT; (6) P5 — the SET target ends in `::text`,
  no bare `::int` write. A behavioural-parity block exercises the live `normalizeGrade`
  (the read-coercion the SQL mirrors) on the canonical legacy formats.
- Lane note: SOURCE pin in the normal `npm test` lane (sibling to REG-200/REG-208's TSB-4
  source pins), NOT the live-DB integration lane — the SQL's actual row-rewrite is proven in
  the integration lane and deferred.

### Catalog total

AO-10b historical grade backfill + write-path default fix adds REG-209 (P5 data-layer grade
normalization mirroring the TS normalizeGrade extraction, fail-safe + reversible + idempotent,
plus the two onboarding RPC default flips that stop re-accrual).
**Total catalog: 176 entries (target: 35 — TARGET EXCEEDED).**

---

## 2026-07-02 — Stage 2/3 preparation quality-review follow-up — REG-230

Source: `docs/audit/2026-07-02-certification/evidence/wave-2-environment-readiness/04-stage2-3-preparation-quality-review.md`
Finding Q-3 (MAJOR). Quality reviewed the Stage 2/3 preparation artifacts
(REG-228/229's scripts plus the new certification Playwright specs) and
proved both scripts' production-reference fail-closed guards correct by
running adversarial inputs (uppercase project ref, surrounding whitespace, a
port suffix, and a subdomain-masquerade shape) against a disposable,
non-committed Vitest scratch file — then deleted it. That verdict was
APPROVE WITH CONDITIONS: the manual proof had to become permanent, committed
regression coverage before either script is trusted for a real invocation.
This entry closes that condition. It also closes the companion Finding Q-2
(MAJOR): `scripts/teardown-certification-tenant.ts` had no importer anywhere
in the codebase and `tsconfig.json` excludes `scripts` wholesale, so
`npm run type-check` never actually compiled the file carrying the
safety-critical guard — importing from it in the new test file pulls it into
the compiled program, the same mechanism that already covered
`seed-certification-accounts.ts` via `e2e/certification/helpers/cert-gate.ts`.
Also applied the accompanying MINOR fix (Q-1): the teardown script's
`extractProjectRef` now calls `.toLowerCase()` explicitly on the returned ref
instead of relying on the WHATWG URL API's implicit hostname lowercasing —
correct either way, but now auditable-parity with its sibling in the seed
script.

| # | Test name | Asserts | Location | Status |
|---|---|---|---|---|
| REG-230 | `production_reference_guard_fail_closed` | Both certification scripts' production-reference guards — `assertNotProductionProjectRef`/`extractProjectRef` in `scripts/seed-certification-accounts.ts` and `extractProjectRef` (+ the identical inline equality predicate `main()` applies) in `scripts/teardown-certification-tenant.ts` — against the exact adversarial set quality used, for BOTH implementations independently (they are not byte-identical parsers): an uppercase production ref is blocked (case-normalized before compare); a production ref with surrounding whitespace is blocked (trimmed/stripped before compare); a production ref with a nonstandard port is blocked — the seed script's stricter https-only regex fails closed via "unparseable" for this input while the teardown script's URL-API parser still positively extracts and matches the ref, a confirmed behavioral difference that is pinned explicitly rather than glossed over; a different, non-prod ref that merely contains the prod ref as a substring/prefix (`my-shktyoxqhundlvkiwguu-staging`) is correctly NOT blocked by either parser (no false-positive over-block of a legitimate staging URL); the literal subdomain-suffix masquerade shape quality used (`shktyoxqhundlvkiwguu.supabase.co.evil.com`) fails closed (returns null — unparseable, not a positive prod match) on both parsers; a genuine non-prod staging-shaped URL passes cleanly on both; and a fully unparseable/ambiguous URL (`https://supabase.co`, `not-a-url`) fails closed on both, never "probably fine". Also pins that both scripts share the byte-identical `PROD_PROJECT_REF`/`KNOWN_PROD_PROJECT_REF` literal. | `src/__tests__/certification/production-reference-guard.test.ts` (18 tests) | E |

### Invariants covered by this section

- Operational-integrity (certification-specific, same class as REG-227..229)
  — REG-230 closes the last open condition on the Stage 2/3 preparation
  artifacts' APPROVE WITH CONDITIONS verdict: the guard mechanism explicitly
  billed as the thing standing between a certification run and a live write
  to production now has committed, adversarial-input regression coverage
  instead of a one-off manual check that was deleted after use.
- P8-adjacent (fail-closed boundary posture) — both guards are proven to
  treat "cannot positively confirm this is not production" identically to
  "confirmed production" (never "probably fine"), and proven to NOT
  over-block a legitimately different non-prod project ref merely because it
  shares a substring with the production ref.

### Catalog total

Pre-REG-230: 196 entries (through REG-229, certification-tenant teardown).
Today's follow-up wave adds REG-230 (production-reference fail-closed guard
coverage for both certification scripts).
**Total catalog: 197 entries (target: 35 — TARGET EXCEEDED).**

---

