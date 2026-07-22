# Monthly Synthesis — On-Call + Rollback Runbook

**Audience:** on-call ops responding to a Monthly Synthesis incident (kill switch, hallucination report, or WhatsApp template rejection). This is a triage + rollback runbook, not a rollout plan.
**Flag:** `ff_pedagogy_v2_monthly_synthesis` (`PEDAGOGY_V2_FLAGS.MONTHLY_SYNTHESIS`)
**Owner:** ops · **escalation targets:** assessment (educational accuracy / hallucination), backend (WhatsApp/template + delivery), ai-engineer (Claude summary generation)
**Last updated:** 2026-07-22

## How Monthly Synthesis actually works (the mental model for triage)

Unlike the adaptive loops, Monthly Synthesis is **NOT a multi-day verify state machine** — it is a once-per-month artifact pipeline. Three stages:

1. **Build (Edge Function, cron-triggered).** On the **1st of each UTC month**, `daily-cron`'s `triggerMonthlySynthesis` step (only fires when `now.getUTCDate() === 1`) checks `ff_pedagogy_v2_monthly_synthesis` is globally enabled, then POSTs each active student to the `monthly-synthesis-builder` Edge Function with `synthesis_month = previous calendar month`. The builder computes a structured `bundle` from `concept_mastery` + `curriculum_topics` and inserts a `monthly_synthesis_runs` row with **empty** `summary_text_en/hi`. **No LLM runs in the builder.** It is idempotent on `(student_id, synthesis_month)` (unique constraint), so retries are safe.
2. **Generate (Next.js, lazy on first view).** When the student first opens `/synthesis`, `GET /api/synthesis/state` lazily fills the bilingual summary via Claude Haiku, running the fabrication oracle (`validateSynthesisSummary` + `checkNumberFabrication` / `checkTopicFabrication` from `packages/lib/src/ai/validation/synthesis-oracle.ts`) **before** any Claude text is persisted to the row. A circuit breaker (`synthesisClaudeCircuitBreaker`) and a deterministic template fallback (`buildSynthesisFallbackSummary`) protect this path.
3. **Share (Next.js → WhatsApp).** `POST /api/synthesis/parent-share` re-runs the fabrication checks as a pre-send defense-in-depth gate (item 4.5), then calls the `whatsapp-notify` Edge Function with the `monthly_synthesis` template.

`parent_share_status` lifecycle on `monthly_synthesis_runs`: `pending` → `sent` | `failed` | `opted_out` | `flagged` (fabrication held-for-review; added by `20260722098000_monthly_synthesis_flagged_status.sql`) | `suppressed`.

**Companion dashboards (built in parallel this session):** `synthesis-health` (pipeline/delivery status) and `synthesis-quality` (backed by the new `synthesis_quality_scores` table). Reference these for at-a-glance state; the SQL below is the break-glass path.

---

## Kill switch — `ff_pedagogy_v2_monthly_synthesis` OFF = FREEZE, not drain

**This is different from the adaptive loops. Confirm you understand it before flipping.** Read directly from the code:

- The **build** step (`triggerMonthlySynthesis`) early-returns `0` when the flag is missing/disabled — **no new `monthly_synthesis_runs` rows are created.**
- The **generate** route (`GET /api/synthesis/state`) returns `404 not_found` when the flag is off — students can't view (or trigger lazy-fill of) a synthesis.
- The **share** route (`POST /api/synthesis/parent-share`) returns `404` when the flag is off — no WhatsApp sends.

So flag OFF **freezes**: existing `monthly_synthesis_runs` rows persist untouched but become inert and inaccessible; nothing new is built, generated, or sent. There is **no drain horizon** to wait out (there's no active-verify sweep) — the effect is immediate on the ≤5-min flag cache TTL. This is safe precisely because a synthesis is a static artifact, not an open loop.

```sql
-- Kill switch (prefer the super-admin console for the audit trail).
UPDATE feature_flags SET is_enabled = false, updated_at = now()
WHERE flag_name = 'ff_pedagogy_v2_monthly_synthesis';
```

`ff_pedagogy_v2_monthly_synthesis` is a protected/constitution-pinned flag — flip it through the console with the protected-flag procedure.

---

## Incident A — Hallucination report ("the synthesis said something false / fabricated")

Monthly Synthesis is parent-facing and educational, so a fabricated number or invented topic is a P11/P13-adjacent, brand-and-trust incident. The oracle is supposed to catch fabrication before send — a report reaching you means either the oracle missed a case, or a row predates the oracle, or a bypass path wrote the summary.

**Triage order:**
1. **Pull the offending run.**
   ```sql
   SELECT id, student_id, synthesis_month, parent_share_status, parent_share_sent_at,
          summary_text_en, summary_text_hi, bundle
   FROM monthly_synthesis_runs
   WHERE id = ':synthesis_run_id';   -- or WHERE student_id = ':id' ORDER BY created_at DESC
   ```
   Compare `summary_text_en/hi` against the structured `bundle` — the bundle is ground truth (chapters touched, topics mastered/improved counts). A number or topic in the text that isn't backed by the bundle is a fabrication.
2. **Was it already sent to a parent?** Check `parent_share_status = 'sent'` and `parent_share_sent_at`. If sent, this needs a **parent correction/retraction** decision (Step 5).
3. **Check the quality signal** (parallel `synthesis_quality_scores` table / `synthesis-quality` dashboard) for this run and for a spike across recent runs — a cluster means a systemic oracle gap or a bad Claude generation batch, not a one-off.
   ```sql
   -- If synthesis_quality_scores is live (parallel work), scope the blast radius:
   SELECT synthesis_run_id, overall_score, oracle_findings, scored_at FROM synthesis_quality_scores
   WHERE scored_at >= now() - interval '7 days' ORDER BY overall_score ASC LIMIT 50;
   ```
4. **Look for other rows already caught by the pre-send gate** — these are held, not sent, and are your early warning that the generation path is producing fabrications:
   ```sql
   SELECT id, student_id, synthesis_month, created_at FROM monthly_synthesis_runs
   WHERE parent_share_status = 'flagged' ORDER BY created_at DESC;
   ```
   A rising `flagged` count is the leading indicator — treat it as an active generation-quality problem even before a human reports one that slipped through.
5. **Contain + decide.**
   - **Stop further exposure:** if the pattern is systemic (multiple runs, a quality-score cluster, or a rising `flagged` count), **flip `ff_pedagogy_v2_monthly_synthesis` OFF** (freeze — immediate; no new generation or send) while it's investigated.
   - **Neutralize the specific bad row** so it can't be re-shared: set its status to `flagged` (held-for-review, never re-sent):
     ```sql
     UPDATE monthly_synthesis_runs SET parent_share_status = 'flagged' WHERE id = ':synthesis_run_id';
     ```
   - **If it was already sent to a parent:** this is a correction/retraction decision — **notify assessment** (owns educational accuracy) to confirm the falsehood and draft the correct message, and **notify backend** to action the parent-facing correction/retraction over the existing WhatsApp channel. Do NOT ops-improvise a parent message.
6. **Notify assessment** in all hallucination cases — they own content accuracy and must review whether the oracle rule needs tightening. Notify **ai-engineer** if the root cause is the Claude generation/prompt (`packages/lib/src/ai/workflows/synthesis-summary.ts`) rather than a missed oracle check. Per the constitution, CMS/educational content reaching students/parents requires assessment review — a hallucination correction is exactly that.

---

## Incident B — WhatsApp template rejection (Meta-approval failure path)

The `monthly_synthesis` WhatsApp template must be approved by Meta before the WhatsApp Cloud API will accept it. Until approved (or if Meta later rejects/pauses it), the `whatsapp-notify` call returns non-OK and `parent-share` records `parent_share_status = 'failed'` and returns `502 whatsapp_delivery_failed`. This is a **delivery** failure, not a content or safety failure — do NOT kill the flag for it (that would also block the student-facing view, which is fine).

**Triage order:**
1. **Confirm the failure signature.**
   ```sql
   SELECT parent_share_status, count(*) FROM monthly_synthesis_runs
   WHERE created_at >= now() - interval '7 days' GROUP BY parent_share_status;
   -- a spike in 'failed' concentrated right after a template change points at Meta approval.
   ```
   Cross-check the `synthesis-health` dashboard (parallel) and the `whatsapp-notify` Edge Function logs for the Meta API error code (template not approved / paused / parameter mismatch).
2. **Distinguish causes:**
   - **Template not yet approved / rejected / paused by Meta** → this is a Meta-console action, not a code fix. **Notify backend** (owns `whatsapp-notify` + the template definition) to check/resubmit the template in the Meta Business Manager. Nothing to flip on our side.
   - **Template approved but parameter mismatch** (the send payload's variables don't match the approved template shape) → code/config bug in `parent-share` → `whatsapp-notify`. **Page backend.**
   - **Guardian opt-out / missing phone**, not a template problem: `parent_share_status = 'opted_out'` (guardian `monthly_synthesis_optin = false`) or a `422 guardian_phone_missing`. These are expected, not incidents.
3. **No data loss** — a `failed` row keeps its generated summary; once the template is approved, the student can re-trigger `parent-share` (the route short-circuits `already sent` but retries a `failed`/`pending` row). No kill switch, no rollback needed. If the whole cohort failed on a template issue, coordinate a re-share sweep with backend after Meta approval.

---

## Rollback

| Situation | Action |
|---|---|
| **Systemic hallucination / quality collapse** | `ff_pedagogy_v2_monthly_synthesis` OFF (freeze — immediate; blocks build + view + send). Investigate with assessment + ai-engineer before re-enabling. |
| **A single bad run** | Set that run's `parent_share_status = 'flagged'` (held; never re-sent). No flag flip. |
| **WhatsApp/template delivery failure** | Do NOT flip the flag. Route to backend (Meta template). `failed` rows are re-sendable after approval. |
| **Schema** | No reversal needed — `monthly_synthesis_runs` + the `flagged` status are additive. The flag row can be deleted (a missing flag resolves OFF and freezes the feature). |

The build step is idempotent on `(student_id, synthesis_month)`, so re-enabling after a freeze does not duplicate rows; a re-run on a later day of the month is a no-op unless it's the 1st (the `getUTCDate() === 1` gate).

---

## References (do not duplicate)

- Builder Edge Function: `supabase/functions/monthly-synthesis-builder/index.ts`
- Cron trigger: `supabase/functions/daily-cron/index.ts` (`triggerMonthlySynthesis`, `monthly_synthesis_triggered` step)
- Generate route (lazy-fill + oracle): `apps/host/src/app/api/synthesis/state/route.ts`
- Share route (pre-send gate + WhatsApp): `apps/host/src/app/api/synthesis/parent-share/route.ts`
- Fabrication oracle: `packages/lib/src/ai/validation/synthesis-oracle.ts`
- Summary prompt/parse: `packages/lib/src/ai/workflows/synthesis-summary.ts`; orchestrator: `packages/lib/src/learn/monthly-synthesis-orchestrator.ts`
- Flagged-status migration: `supabase/migrations/20260722098000_monthly_synthesis_flagged_status.sql`
- Companion dashboards (parallel): `synthesis-health`, `synthesis-quality` (+ `synthesis_quality_scores` table)
- Flag registry: `PEDAGOGY_V2_FLAGS.MONTHLY_SYNTHESIS` in `packages/lib/src/feature-flags.ts`
</content>
