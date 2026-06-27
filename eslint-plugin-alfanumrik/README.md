# eslint-plugin-alfanumrik

Local ESLint plugin consolidating Alfanumrik-specific rules. Rules live
in sibling files in this package, plus in the repo-level `eslint-rules/`
directory (the grounding-boundary rules, kept there so the ESLint
config-parity script can co-locate config + rule definition).

The plugin is wired up via `package.json`:

```json
"devDependencies": {
  "eslint-plugin-alfanumrik": "file:./eslint-plugin-alfanumrik"
}
```

and activated in `.eslintrc.json` under the `alfanumrik/` prefix.

## Rules

### `no-raw-subject-imports`

Forbids named imports of `GRADE_SUBJECTS` / `SUBJECT_META` /
`getSubjectsForGrade` / `SUBJECT_BY_GRADE` from `@/lib/constants` (and
any local `./constants` variant) outside the subjects service, the
compat shim, and tests. Also forbids local function / variable
declarations that shadow those names. See file header for the full
allowlist.

**Rationale.** Subjects must be resolved at runtime from
`get_available_subjects` RPC via `useAllowedSubjects()` so grade /
stream / plan gating, locale, and admin-curated master list are
respected. Hardcoded arrays drift from the DB truth.

### `no-canonical-write-outside-projector`

Forbids Supabase writes (`.insert` / `.update` / `.upsert` / `.delete`)
to canonical learner-state tables from any file outside the projector
subscribers directory.

- **Canonical tables (sourced from
  [`DATA_OWNERSHIP_MATRIX.md`](../docs/architecture/DATA_OWNERSHIP_MATRIX.md)
  and explicitly enumerated in ADR-005):**
  - `concept_mastery`
  - `adaptive_mastery`
  - `daily_schedule`
  - `scheduled_actions`
  - `entitlements`
  - `notification_sends`

- **Allowlist:**
  - `src/lib/state/subscribers/**` — the projector subscribers, the
    legitimate canonical writers. New projectors land here.
  - `src/lib/state/services/quiz-completion-service.ts` — single legacy
    file that orchestrates the P4 `atomic_quiz_profile_update` RPC plus
    targeted writes that predate the projector substrate. Documented
    exception; see
    [`docs/architecture/EXCEPTIONS.md`](../docs/architecture/EXCEPTIONS.md).

- **Test fixtures are out of scope.** `src/__tests__/**`, `*.test.*`,
  and `*.spec.*` are turned OFF for this rule via an `.eslintrc.json`
  override (not via the in-rule allowlist). Tests legitimately seed and
  clean canonical tables as E2E setup — there is no projector in a test.
  The rule governs the production write path; scoping it out of tests at
  the config layer mirrors every other src-scoped rule in the config.

- **Severity:**
  - `warn` in `.eslintrc.json` (default lint config — ratcheting in).
  - `error` in `.eslintrc.ai-boundary.json` (stricter parity config).

**Rationale.**
[`ADR-005 §"The enforceable rule"`](../docs/architecture/ADR-005-concept-first-adaptive-learning-spine.md)
declares: *"No API route is a canonical writer of learner state. Routes
may compute and return optimistic results, but the canonical write to
`concept_mastery`, `daily_schedule`, `scheduled_actions`,
`entitlements`, `notification_sends`, etc. happens in a projector
subscribing to a durable `state_events` row."* This rule makes that
contract enforceable at PR-review time.

#### Examples

**Invalid** — API route writing a canonical table:

```ts
// src/app/api/tutor/answer/route.ts
export async function POST(req: Request) {
  // ...
  await supabase.from('concept_mastery').upsert({ student_id: sid, mastery_mean: m });
  //                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^ canonical write outside projector — rule fires
}
```

**Invalid** — non-allowlisted library helper updating entitlements:

```ts
// src/lib/billing/helper.ts
await supabaseAdmin.from('entitlements').update({ active: true }).eq('id', e);
//                       ^^^^^^^^^^^^^^^^^^^^^^^^ rule fires
```

**Valid** — projector subscriber writes the table it owns:

```ts
// src/lib/state/subscribers/concept-mastery-projector.ts
await supabaseAdmin.from('concept_mastery').upsert({ student_id: sid, mastery_mean: m });
// allowlisted directory — no error
```

**Valid** — legacy P4 orchestrator (single-file allowlist):

```ts
// src/lib/state/services/quiz-completion-service.ts
await supabaseAdmin.from('concept_mastery').upsert(rows);
// allowlisted file — no error
```

**Valid** — reads are always fine:

```ts
// src/app/api/dashboard/route.ts
const { data } = await supabase
  .from('concept_mastery')
  .select('mastery_mean')
  .eq('student_id', sid);
// `.select` is not a mutating method — no error
```

**Valid** — writes to non-canonical tables are not flagged:

```ts
// src/app/api/concept-attempts/route.ts
await supabase.from('concept_attempts').insert({ ... });
// concept_attempts is operational/route-owned per ADR-005 — no error
```

#### Suppression

If a write is intentional and cannot be moved to a projector (e.g. a
new documented exception), add a one-line disable comment with an
explicit reason and an EXCEPTIONS.md entry:

```ts
// eslint-disable-next-line alfanumrik/no-canonical-write-outside-projector -- REASON: see EXCEPTIONS.md E<n>
await supabase.from('concept_mastery').upsert(rows);
```

Reviewer convention: if there's no EXCEPTIONS.md entry referenced in
the disable comment, the disable does not land.

## Rules hosted in `eslint-rules/` (repo root)

These rules are part of the same `alfanumrik/` namespace but live at
repo root so the AI-boundary config-parity script can validate them
without crossing into this package:

- `no-direct-ai-calls` — forbids direct Anthropic / Voyage SDK imports
  and direct provider URLs outside the grounded-answer service.
- `no-direct-rag-rpc` — forbids direct `.rpc('match_rag_chunks*')`
  calls outside the grounded-answer service.

See `eslint-rules/*.js` for their headers.

## Adding a new rule

1. Drop a new `<rule-name>.js` file in this directory (or, for
   boundary rules, in `eslint-rules/`). Export an ESLint rule object
   under `module.exports.rules[<rule-name>]`.
2. Register it in `index.js` under the `alfanumrik/` namespace.
3. Add a test file under `eslint-plugin-alfanumrik/tests/<rule-name>.test.js`
   using ESLint's `RuleTester`. Run with
   `node eslint-plugin-alfanumrik/tests/<rule-name>.test.js`.
4. Activate it in `.eslintrc.json` (severity `warn` for ratcheting,
   `error` if the rule is strict from day one).
5. If the rule should be stricter under the AI-boundary config, set
   it to `error` in `.eslintrc.ai-boundary.json`.
6. Document the rule in this README with rationale + valid/invalid
   examples.

## Tests

The rules use ESLint's built-in `RuleTester`. To run all tests in this
package:

```sh
node eslint-plugin-alfanumrik/tests/no-canonical-write-outside-projector.test.js
```

Each test file prints `"<rule>: all RuleTester cases passed."` on
success and throws on failure.
