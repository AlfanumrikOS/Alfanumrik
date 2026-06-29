# FOX-4 — OpenAI "MoL Shadow" Governance Design

**Item:** FOX-4 (engineering-audit / foxy-ai-rag workflow)
**Author:** ai-engineer
**Date:** 2026-06-29
**Type:** Governance design — read-only analysis + design. No code changes in this pass.
**CEO directive:** Unblock for "betterment" — GOVERN (confirm safe + documented + gated), or recommend removal if dead weight.

> **Scope guardrail (stated explicitly):** This design does **NOT** change the student-facing model or
> provider. **Claude (Anthropic Haiku) remains the sole student-facing model.** The OpenAI usage in scope
> is a telemetry-only *shadow* comparator whose output is discarded. This is a governance exercise, not a
> provider change. A provider change would require user approval per the constitution (P12 / "AI model or
> provider changes"); nothing here triggers that gate.

---

## 1. Where OpenAI is used (file:line map)

The OpenAI usage lives entirely inside the `grounded-answer` Edge Function and the shared MoL (Model
Orchestration Layer) layer it calls. It is a **fire-and-forget shadow** that runs *in parallel* with the
real Claude call so an offline grader can compare provider quality. The shadow response is thrown away.

| Concern | Location | What it does |
|---|---|---|
| OpenAI model constants | `supabase/functions/grounded-answer/claude.ts:22-23` (`GPT_MINI_MODEL='gpt-4o-mini'`, `GPT_FULL_MODEL='gpt-4o'`) | Model ids for the OpenAI leg of the MoL provider router. |
| Provider routing to OpenAI | `supabase/functions/grounded-answer/claude.ts:153-168` (`callOpenAIOnce` when `target.provider === 'openai'`) | The low-level cross-provider attempt path. |
| Shadow caller (core) | `supabase/functions/grounded-answer/mol-shadow.ts` (`shadowFireOpenAI` L357, `fireShadowAndForget` L568, `recordShadowTextFromStash` L628) | Builds a `GenerateRequest` pinned to `provider='openai'`, races it against a 10s timeout, discards the response, records telemetry. |
| Wire-up (non-streaming) | `supabase/functions/grounded-answer/pipeline.ts:1077` (primary answer) and `pipeline.ts:1182` (grounding-check leg) | Fires the shadow **after** the baseline Claude call has already succeeded and been captured. |
| Wire-up (streaming) | `supabase/functions/grounded-answer/pipeline-stream.ts:669` (fire) + `:859` (`recordShadowTextFromStash` after stream completes) | Same, for the streaming path. |
| Telemetry adapter (Claude-side) | `supabase/functions/grounded-answer/mol-telemetry-adapter.ts` | Logs the **baseline** Claude call into `mol_request_logs` tagged `shadow_role='baseline'`. Claude-only; no OpenAI call here. |
| Telemetry writers | `supabase/functions/_shared/mol/telemetry.ts` (`recordMolRequest` L~110, `recordShadowText` L223) | Write the metadata row (`mol_request_logs`) and the redacted text row (`mol_shadow_text_buffer`). |
| Offline grader | `supabase/functions/_shared/mol/grader-cron.ts`, `python/services/ai/mol/grader_cron.py`, `daily-cron` `gradeMolShadowPairs` step | Samples shadow↔baseline pairs and scores them with a Sonnet grader (offline, nightly). |
| Super-admin surface | `src/app/super-admin/mol-shadow/page.tsx`, `src/app/api/super-admin/mol-shadow/route.ts` | Read-only dashboard for shadow pairs / quality. |

**Data-flow confirmation (telemetry-only):**

```
student question
   → grounded-answer pipeline
   → Claude (Anthropic) call  ──────────►  claude.content  ──►  SCREENED  ──►  STUDENT  (sole answer)
   → [if flag ON + sampled] fireShadowAndForget(OpenAI)
        → shadowFireOpenAI  →  generateResponse(provider='openai')
        → molResult.text  ──►  DISCARDED  (never returned, never streamed)
        → telemetry only:
             • mol_request_logs row   (metadata: tokens, latency, cost, role='shadow')
             • mol_shadow_text_buffer (PII-redacted text, 7-day TTL, deleted after grading)
```

The shadow fires **after** `claude` has returned and `claude.content` is what the pipeline serves
(`pipeline.ts:1101` passes `claude.content` as `baseline_response_text` purely for the grader). There is
**no fallback path** by which the shadow's output substitutes for Claude — `shadowFireOpenAI` returns
`void` and its `molResult` is consumed only by the telemetry/stash writer.

---

## 2. Current governance posture

| Question | Finding | Evidence |
|---|---|---|
| **Flag-gated?** | **YES** — and seeded **OFF**. | Routing flag `ff_grounded_answer_mol_shadow_v1` seeded `is_enabled=false`, `metadata.enabled=false`, `rollout_pct=0` (`supabase/migrations/20260519000002_mol_shadow_flag_seed.sql`). Text-capture flag `ff_mol_shadow_text_capture_v1` seeded `is_enabled=false` (`20260520000002_mol_shadow_text_capture_flag.sql`). |
| **Default ON or OFF?** | **OFF** on staging + production. | Both seeds insert `false`; both have a `DO $verify$` block that `RAISE WARNING` if found enabled. `shadowFireOpenAI` short-circuits with zero side effects when `enabled !== true`, `kill_switch === true`, `task_type` not allow-listed, or sample-bucket miss (`mol-shadow.ts:381-384`). |
| **Can output reach a student?** | **NO.** Re-confirms quality's finding. | Fire-and-forget (`void Promise.allSettled([...])`, `mol-shadow.ts:569`); response discarded; baseline `claude.content` is the only thing returned/streamed; no fallback wiring from shadow → student. Independent 10s timeout so it can never block the student path. Skips entirely when baseline is already OpenAI (`mol-shadow.ts:359`). |
| **PII logged to telemetry?** | **Text fields redacted; one residual identifier noted.** | `recordShadowText` (`telemetry.ts:223-262`) runs `redactPIIInText` over every text field (question, both system prompts, both responses) for email / Indian phone / Razorpay-ID, persisting `redaction_applied[]`. Text capture is itself behind a **second** default-OFF flag. **Residual:** `mol_request_logs.student_id` stores the student UUID (not name/email/phone). Per P13 the redacted set is password/token/email/phone/API-keys; a UUID is a pseudonymous key, not PII, and is required for the baseline↔shadow JOIN. Buffer rows have a 7-day TTL and are deleted after grading. |
| **Cost exposure — every turn or gated?** | **Gated + sampled, not every turn.** | Fires only when: flag enabled AND `task_type` in the allow-list (`explanation`, `concept_explanation`, `doubt_solving`, `step_by_step`) AND `hash(request_id+':'+task_type) % 100 < rollout_pct` (default `rollout_pct=0` ⇒ zero calls even if flag flipped without a ramp). Auto kill-switch flips `metadata.kill_switch=true` at ₹10,000/day shadow spend (`gradeMolShadowPairs`); separate grader cap ₹5,000/day. Runbook documents manual kill + rollback. |
| **Documented?** | **YES** — comprehensive. | `docs/MOL_C4_SHADOW_RUNBOOK.md` (owners, pre-flip checklist, ramp gates G1-G6, monitoring SQL, kill switch, rollback, known gaps). |

**Net posture:** The shadow is already a *well-governed*, default-OFF, sampled, kill-switchable,
PII-redacted, documented dependency. It is **not** an ungoverned shadow dependency in the sense FOX-4
feared. The main gap is that this governance is not yet reflected in the engineering-audit remediation
record or pinned as a permanent regression invariant.

---

## 3. Recommendation: GOVERN-WITH-FLAG (do **not** remove)

### Rationale (not dead weight)

Removal was considered and **rejected**:

- It is **purposeful dormant infrastructure** for the MoL C5 provider-cost/quality decision (the eventual
  data-driven call on whether a cheaper provider can match Claude quality). Removing it deletes the only
  apples-to-apples comparator and forces a from-scratch rebuild when that decision comes up.
- It has **live consumers**: the Sonnet grader cron, `mol_shadow_pairs_v1` / `mol_request_health_24h`
  views, the super-admin `mol-shadow` dashboard + API route, and a Python grader. This is wired
  operational tooling, not orphan code.
- It is **already inert at zero cost** when flagged OFF (the default and current production state), so it
  carries no runtime or spend risk in its dormant state.
- It is **already isolated** from the student path (P12-safe) and **PII-redacted** (P13-safe).

Given the CEO directive ("GOVERN — confirm safe + documented + gated"), the correct, lowest-risk outcome
is to **formalize and pin** the existing governance, not to add new flags (they exist) and not to remove
working infra.

### The betterment delta (what FOX-4 should actually do)

1. **Record FOX-4 closure in the engineering-audit** with this doc as the governance artifact: provider =
   OpenAI gpt-4o-mini/gpt-4o, role = telemetry-only shadow, flags = `ff_grounded_answer_mol_shadow_v1` +
   `ff_mol_shadow_text_capture_v1` (both default OFF), owner = ai-engineer (code) / ops (flag + kill
   switch), kill switch + rollback = `docs/MOL_C4_SHADOW_RUNBOOK.md §6-7`, student-facing = NO, PII = redacted.
2. **Pin the two safety invariants as a permanent regression entry** in `.claude/regression-catalog.md`
   (testing-owned follow-up): (a) shadow output is never student-facing; (b) flag-OFF (or kill-switch, or
   sample-miss) yields zero shadow side effects. The behaviors are already tested
   (`__vitest__/mol-shadow.vitest-harness.ts`) — this promotes them to a catalogued invariant so a future
   refactor cannot silently regress them.
3. **Test-lane enforcement — VERIFIED already-enforced (was open question O1; corrected 2026-06-29):** the
   shadow safety tests are NOT integration-only. `mol-shadow.vitest-harness.ts` is enumerated at
   `vitest.config.ts:66` inside the DEFAULT-lane `else` branch (lines 53-92), so they ALREADY run on every
   `npm test` — the hard per-PR gate at `ci.yml:232`. The secret-gated integration job (`ci.yml:386-398`)
   skips without STAGING secrets, so default-lane placement is exactly what enforces flag-OFF /
   never-student-facing on every PR. **No lane change is required.** (The original O1 premise was a
   misattributed ternary branch — it read line 66 as integration-only; see the corrected O1 in §7 for the
   audit trail.)

No new flag is required — the gating, kill switch, cost cap, redaction, and runbook all already exist.

---

## 4. Code / flag sketch (outline only — not applied this pass)

This pass changes **no application code**. The betterment is documentation + test-pinning. For
completeness, the (already-present) governance surfaces a future PR would reference:

```
# Flags (already seeded OFF — no migration needed):
ff_grounded_answer_mol_shadow_v1   -> { enabled:false, kill_switch:false, task_types:[...], rollout_pct:0 }
ff_mol_shadow_text_capture_v1      -> { enabled:false }

# Instant disable (runbook §6):
UPDATE public.feature_flags
   SET metadata = metadata || jsonb_build_object('kill_switch', true), updated_at = now()
 WHERE flag_name = 'ff_grounded_answer_mol_shadow_v1';   -- 5-min cache TTL

# Full off (runbook §7):
UPDATE public.feature_flags
   SET is_enabled = false,
       metadata   = metadata || jsonb_build_object('enabled',false,'kill_switch',true,'rollout_pct',0)
 WHERE flag_name = 'ff_grounded_answer_mol_shadow_v1';
```

Regression-pin sketch (testing-owned, default lane):

```
describe('FOX-4 OpenAI shadow governance', () => {
  it('flag OFF → zero side effects (no generateResponse, no telemetry row)', ...);  // exists in harness
  it('shadow molResult is discarded — never returned to caller / never streamed', ...); // contract pin
  it('kill_switch=true short-circuits even when enabled=true', ...);                // exists in harness
  it('baseline_provider=openai → shadow skips (no redundant OpenAI call)', ...);    // exists in harness
});
```

---

## 5. Rollback

The betterment is doc + test additions only, so rollback is trivial: revert the doc/catalog/test commit.
No runtime behavior changes, no migration, no flag flip. The shadow stays OFF throughout (its production
state today), so there is no operational rollback to plan. The *operational* kill switch / rollback for the
shadow itself (if it were ever ramped) already lives in `docs/MOL_C4_SHADOW_RUNBOOK.md §6-7`.

---

## 6. Verification plan

| Check | How | Pass criterion |
|---|---|---|
| Shadow output never student-facing | Unit pin: assert `shadowFireOpenAI` returns `void` and no code path routes `molResult.text` to the response/stream; existing `__vitest__/mol-shadow.vitest-harness.ts` "single-row contract" + "failure isolation" suites | Green; student answer is always `claude.content` |
| Flag-OFF disables it | Unit pin: with envelope `enabled:false` (and separately `kill_switch:true`, and sample-miss), assert `generateResponse` and `recordMolRequest` are never called | Green (already asserted in "short-circuits (no side effects)" suite) |
| PII redaction fires | `supabase/functions/_shared/mol/__tests__/recordShadowText.test.ts` + `redact-pii.test.ts` | Email/phone/RZP redacted; `redaction_applied[]` populated |
| Default-OFF seed intact | `20260519000002` + `20260520000002` `DO $verify$` blocks | `RAISE WARNING` if ever enabled |
| CI actually runs the safety tests | VERIFIED: `mol-shadow.vitest-harness.ts` is in the DEFAULT-lane `else` branch at `vitest.config.ts:66`, run by `npm test` — the HARD per-PR gate at `ci.yml:232`. The integration job (`ci.yml:386-398`) is secret-gated and skips without STAGING secrets, so default-lane placement is what enforces them. | PASS — safety tests run on every PR (no lane change needed; original O1 corrected, see §7) |
| Claude unchanged | Diff review | No change to `claude.ts` baseline call, model id, system prompt, temperature, or streaming |

---

## 7. Open questions

- **O1 (test lane) — RESOLVED / CORRECTED (2026-06-29):** The original O1 premise was **stale and incorrect**.
  It claimed the MoL-shadow safety tests are in `vitest.config.ts`'s integration-only include, so `npm test`
  (the default lane) does not run them. **In fact `mol-shadow.vitest-harness.ts` is enumerated at
  `vitest.config.ts:66`, which sits INSIDE the DEFAULT-lane branch of the `isIntegrationRun` ternary** (the
  `else` arm, lines 53-92) — **NOT** the integration-only branch (lines 48-52, which contains only the
  suffix-mapped `INTEGRATION_TEST_PATTERNS` + the narrow `INTEGRATION_TEST_FILE_GLOBS`). The shadow safety
  tests therefore **ALREADY run on every `npm test`**, which is the **hard per-PR gate** at
  `.github/workflows/ci.yml:232` ("This job is therefore a HARD GATE: any failure blocks CI"). The
  secret-gated integration job (`ci.yml:386-398`) **skips** when the `STAGING_SUPABASE_*` secrets are absent
  (`if: steps.check-secrets.outputs.secrets_present == 'true'`) — so default-lane placement is *precisely*
  what makes the never-student-facing + flag-OFF invariants reliably enforced per-PR. **No lane change is
  needed; the safety subset is already in the enforced lane.** This reframes O1 from a "gap to close" into a
  **verified already-enforced** posture.
  **Audit-trail note (do NOT silently delete the original premise):** the stale O1 was a *misattributed
  ternary branch* — the author read the right file and the right line numbers but attributed line 66 to the
  integration-only include rather than to the default-lane `else` arm where it actually lives. Recorded here
  so the correction is traceable rather than erased.
- **O2 (student_id in telemetry):** `mol_request_logs.student_id` stores the student UUID (not P13 PII, but
  a pseudonymous identifier). Confirm with assessment/architect whether the baseline↔shadow JOIN can use
  the synthetic `request_id` alone (it already does — `student_id` is not the JOIN key), allowing
  `student_id` to be nulled on shadow rows for defense-in-depth. Low priority; current state is P13-compliant.
- **O3 (review chain):** Per P14, an "AI tutor behavior / RAG" touch routes to assessment + testing. This
  doc changes no behavior, but the regression-pin + any test-lane change is testing-owned, and confirming
  the OpenAI leg stays out of the student path is an assessment-adjacent safety review. Route to testing
  (pin + lane) and assessment (confirm shadow scope) when the betterment PR is raised.

---

## 8. Decision summary

- **Recommendation:** **GOVERN-WITH-FLAG** — confirm + document + pin. Do **not** remove (purposeful,
  consumed, already inert when OFF).
- **Currently flag-gated:** YES (two flags, both default OFF, seeded OFF on staging + production).
- **Currently student-facing:** NO (fire-and-forget, discarded, no fallback to student).
- **Currently PII-safe:** YES (text redacted at write time; second flag gates text capture; 7-day TTL;
  only residual is the student UUID, which is not P13 PII and is required for correlation).
- **Cost:** sampled + allow-listed + auto kill-switch at ₹10,000/day; default `rollout_pct=0`.
- **Student-facing provider unchanged:** **Claude (Anthropic) remains the sole student-facing model.** This
  design does not switch or change the model/provider.
