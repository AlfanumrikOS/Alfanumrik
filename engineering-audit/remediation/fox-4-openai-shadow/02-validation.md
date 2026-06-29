# FOX-4 — Validation & Closure

**Item:** FOX-4 (engineering-audit / foxy-ai-rag workflow, Cycle 4)
**Author:** ai-engineer
**Date:** 2026-06-29
**Type:** Closure — documentation only. No application code changed.
**Companion:** `01-design.md` (governance design + file:line map).

---

## 1. Disposition

**GOVERN-WITH-FLAG** — keep the OpenAI MoL shadow; do **NOT** remove it.

The shadow is already a well-governed, default-OFF, sampled, kill-switchable, PII-redacted, documented
dependency. FOX-4's correct outcome is to **formalize and pin** that existing governance, not to add new
flags (they already exist) and not to delete working, consumed infrastructure.

> **Scope guardrail (unchanged):** Claude (Anthropic Haiku) remains the **sole student-facing model**. The
> OpenAI usage in scope is a telemetry-only *shadow comparator* whose output is discarded. Nothing here is a
> provider change, so the constitution's "AI model or provider changes" user-approval gate (P12) is not
> triggered.

---

## 2. Rationale (why govern, not remove)

| Property | Status | Evidence (see `01-design.md` §1-2) |
|---|---|---|
| Double-flag-gated, default-OFF | YES | `ff_grounded_answer_mol_shadow_v1` (routing) + `ff_mol_shadow_text_capture_v1` (text capture) — both seeded `false` on staging + production with a `DO $verify$` warn-if-enabled guard. |
| Never student-facing | YES | `shadowFireOpenAI` returns `void`; `molResult.text` is discarded; baseline `claude.content` is the sole returned/streamed answer; fire-and-forget via `void Promise.allSettled([...])` with an independent 10s timeout; no fallback wiring shadow → student. |
| Zero side effects when gated | YES | flag-OFF / `kill_switch=true` / task not allow-listed / sample-miss (`rollout_pct=0`) / flag-read-throws ⇒ no `generateResponse`, no telemetry row. |
| PII-safe | YES | `recordShadowText` runs `redactPIIInText` over every text field (email / Indian phone / Razorpay-ID); text capture itself behind the second default-OFF flag; buffer rows have a 7-day TTL and are deleted after grading. Only residual is the pseudonymous `student_id` UUID (not P13 PII; required for the baseline↔shadow correlation). |
| Cost-capped | YES | allow-list (`explanation`, `concept_explanation`, `doubt_solving`, `step_by_step`) + `rollout_pct=0` default + auto kill-switch at ₹10,000/day shadow spend; separate ₹5,000/day grader cap. |
| Purposeful / consumed | YES | dormant infra for the MoL C5 provider cost/quality decision; live consumers = Sonnet grader cron, `mol_shadow_pairs_v1` / `mol_request_health_24h` views, super-admin `mol-shadow` dashboard + API, Python grader. Not orphan code. |
| Documented | YES | `docs/MOL_C4_SHADOW_RUNBOOK.md` (owners, pre-flip checklist, ramp gates G1-G6, monitoring SQL, kill switch §6, rollback §7). |

The two **governed safety invariants** carried verbatim into the regression pin:
1. **Never student-facing** — `shadowFireOpenAI` returns void, `molResult.text` is discarded, baseline Claude
   content is the sole returned/streamed answer, fire-and-forget via `void Promise.allSettled` with an
   independent timeout.
2. **Zero side effects when gated** — flag-OFF / kill-switch / task-not-allow-listed / sample-miss
   (`rollout_pct=0`) / flag-read-throws ⇒ no `generateResponse`, no telemetry.

---

## 3. O1 correction (stale design assumption — recorded, not erased)

`01-design.md` open question **O1** originally claimed the MoL-shadow safety tests are "integration-only, so
`npm test` does not run them." **That premise was stale and incorrect.**

| | Claim | Reality |
|---|---|---|
| Where the test is enumerated | "integration-only include, lines ~62-71" | `vitest.config.ts:66` — inside the **DEFAULT-lane `else` branch** (lines 53-92) of the `isIntegrationRun` ternary. |
| Whether `npm test` runs it | "does not run them" | **It DOES** — `mol-shadow.vitest-harness.ts` is in the default lane, run by `npm test`. |
| CI enforcement | "not mechanically enforced per-PR" | **Hard per-PR gate** at `ci.yml:232` ("any failure blocks CI"). |
| The integration job | (assumed to be the gate) | `ci.yml:386-398` is **secret-gated** (`if: …secrets_present == 'true'`) and **skips** when STAGING secrets are absent. |

**Net:** default-lane placement is exactly what makes the never-student-facing + flag-OFF invariants reliably
enforced on every PR. No lane change is needed. The error was a **misattributed ternary branch** — the author
read the right file and right line numbers but assigned line 66 to the integration include rather than the
default-lane `else` arm. O1 is now reframed in `01-design.md` §7 from a "gap to close" into a **verified
already-enforced** posture, with the original premise preserved as an audit-trail note.

---

## 4. Betterment delta actually shipped

**No application code changed** — `mol-shadow.ts`, `claude.ts`, `pipeline.ts`, `pipeline-stream.ts`, the
telemetry writers, and the two feature-flag seeds are all untouched. The conclusion is GOVERN-WITH-FLAG, not
remove. The delta is documentation + a regression pin:

1. **Regression pin (testing-owned, concurrent):** the two safety invariants (§2) promoted to a permanent
   catalogued entry — **REG-197** (catalog → 164). They were already tested in
   `supabase/functions/grounded-answer/__vitest__/mol-shadow.vitest-harness.ts`; the pin promotes them to a
   catalogued invariant so a future refactor cannot silently regress them. Authoritative source remains
   `.claude/regression-catalog.md`.
2. **Optional thin governance test (testing-owned):** a contract assertion that `shadowFireOpenAI` returns
   `void` and no code path routes `molResult.text` to the response/stream — additive to the existing harness,
   default lane.
3. **This doc correction:** the O1 fix above + the consistent updates to `01-design.md` §3 and §6.

No new flag is required — gating, kill switch, cost cap, redaction, and runbook all already exist.

---

## 5. Residual deferrals

- **assessment — P12 scope confirm (design O3):** per P14, confirming the OpenAI leg stays out of the
  student path is an assessment-adjacent safety review. The shadow changes no student-facing behavior, but
  route to assessment to formally confirm shadow scope when the testing pin PR is raised. Tracked as
  `01-design.md` §7 **O3**.
- **O2 (defense-in-depth, low priority):** `mol_request_logs.student_id` stores the pseudonymous student
  UUID (not P13 PII, and not the baseline↔shadow JOIN key — `request_id` is). Confirm with
  assessment/architect whether `student_id` can be nulled on shadow rows for defense-in-depth. Current state
  is already P13-compliant.
- **Operational runbook reference:** the manual kill switch + rollback + ramp gates for the shadow (if it
  were ever ramped beyond `rollout_pct=0`) live in `docs/MOL_C4_SHADOW_RUNBOOK.md §6-7`. No operational
  rollback is needed for this closure — the shadow stays OFF (its current production state).

---

## 6. Closure decision

| Field | Value |
|---|---|
| Disposition | **GOVERN-WITH-FLAG** (keep; already well-governed) |
| Student-facing model | **Claude (Anthropic Haiku)** — unchanged, sole student-facing model |
| Provider change? | **NO** — telemetry-only shadow; no P12 model/provider gate triggered |
| Flags | `ff_grounded_answer_mol_shadow_v1` + `ff_mol_shadow_text_capture_v1` — both default OFF, seeded OFF |
| App code changed | **NONE** |
| Regression pin | **REG-197** (catalog → 164) — testing-owned, concurrent |
| O1 | **Corrected** — safety tests already run in the default `npm test` lane per-PR (`vitest.config.ts:66` + `ci.yml:232`) |
| Deferrals | assessment P12 scope confirm (O3); O2 defense-in-depth (low); runbook `MOL_C4_SHADOW_RUNBOOK §6-7` |
| Status | **FOX-4 LANDED — govern-with-flag** |
