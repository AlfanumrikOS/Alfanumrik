# Runbook — Post-Rollout Decision Template (5-Day Review)

**Audience:** super-admin operator (Pradeep) deciding what to do 5 days after flipping a feature flag for one pilot school via the companion pre-flight runbook.
**Time:** 30–45 min review.
**Output:** a written decision (expand / hold / fix-first / revert) appended to operator notes, plus the SQL or PR action that implements it.

---

## How to use this template

1. Open your operator notes file for this rollout (`docs/operator-notes/<date>-<flag>-rollout.md`).
2. Fill in the **Quantitative gates** table from real numbers (PostHog, Sentry, support).
3. Fill in the **Qualitative inputs** section from at least one human conversation.
4. Apply the **Decision matrix** to score the rollout.
5. Run the **Action rubric** SQL or open the **Action rubric** PR for whichever decision the matrix produces.
6. Append the decision + reason + chosen action as the final entry in operator notes.

Keep it discipline-driven: do not skip any of steps 2/3/4 just because the eyeball test "looks fine." Five days isn't enough data for an eyeball judgement.

---

## Quantitative gates

Compare each metric to the baseline you captured in pre-flight Step 1.5–1.6 of the companion runbook. Numbers below are starting thresholds; tighten with experience.

| Metric | Source | Baseline (pre-flip) | Day-5 (post-flip) | Threshold | Verdict |
|---|---|---|---|---|---|
| Sentry new issues (school-tagged) | Sentry | — | _fill in_ | 0 issues with >5 occurrences | _ok / fail_ |
| Sentry aggregate error rate | Sentry | _fill in_ | _fill in_ | ≤ 1.2 × baseline | _ok / fail_ |
| Vercel 5xx rate (canonical paths) | Vercel logs | _fill in_ | _fill in_ | ≤ 0.5% | _ok / fail_ |
| PostHog: target event fires | PostHog | n/a | _fill in_ | At least 1 fire per active user per session | _ok / fail_ |
| PostHog: target event vs baseline DAU at the school | PostHog | _fill in_ | _fill in_ | Active-user count not lower than baseline | _ok / fail_ |
| Support tickets from target school | super-admin/support | _fill in (last 5 days)_ | _fill in (rollout 5 days)_ | ≤ 2× baseline AND none with severity = high | _ok / fail_ |
| Payment flags only: failed Razorpay webhooks | payments table | _fill in_ | _fill in_ | 0 unverified-signature; ≤ 1 unexpected-status | _ok / fail_ |
| Performance: p95 page load on the rollout surface | Vercel analytics / PostHog perf | _fill in_ | _fill in_ | ≤ 1.3 × baseline | _ok / fail_ |

If any row reads `fail`, the rollout has a quantitative concern. The **Decision matrix** below covers what to do about it depending on which row failed.

### Engagement deltas (specific to UX-improving flags)

For flags whose purpose is to lift engagement (Read mode, study plan changes, etc.), also capture:

| Metric | Pre-flip | Post-flip | Direction expected | Verdict |
|---|---|---|---|---|
| Sessions per active user per day | _fill in_ | _fill in_ | up or flat | _ok / fail_ |
| Time on relevant surface | _fill in_ | _fill in_ | up | _ok / fail_ |
| Completion rate of the relevant flow | _fill in_ | _fill in_ | up or flat | _ok / fail_ |

5 days is short for engagement signals — don't over-read these. A flat result is acceptable; a clearly negative result (down >20%) is a real signal.

### Revenue deltas (specific to billing-related flags)

For `ff_school_self_service_billing_v1` and similar:

| Metric | Pre-flip | Post-flip | Verdict |
|---|---|---|---|
| Plan changes initiated (target school) | _fill in_ | _fill in_ | At least 1 to confirm flow works |
| Plan changes completed | _fill in_ | _fill in_ | Conversion ≥ 50% of initiated |
| Razorpay subscription state matches DB | _verify via reconciliation_ | — | Must match exactly |

A revenue-flag rollout that produces zero plan changes in 5 days is a non-event, not a success. Either the school wasn't ready to change plans, or the surface isn't discoverable. Treat as `extend-watch` or `talk-to-school` rather than `expand`.

---

## Qualitative inputs

Quant alone is not enough. Capture at least one of each:

### One teacher conversation
- Question: "Did you notice [feature] this week? What did you think?"
- Capture: their wording, not yours. Specifically log surprises ("I didn't know it was different"), confusions ("I thought it would do X"), and asks ("Can it also Y?").

### One student observation (if learner-facing)
- Watch one student use the surface for 5 minutes
- What did they hesitate on?
- What did they skip?
- What did they ask for help with?

### One principal / school admin sign-off (if billing or admin-surface)
- Direct ask: "Are you happy continuing with this enabled?"
- Yes / No / "Not sure, see issue X"

If any qualitative input cannot be obtained in 5 days, that itself is a signal: either the school isn't engaged enough to validate, or the feature isn't visible enough to provoke a reaction. Treat as `extend-watch` or `talk-to-school`.

---

## Decision matrix

Apply in order; first matching row wins.

| Quant signals | Qual signals | Decision | Rationale |
|---|---|---|---|
| Any **payment-related** quant `fail` (Razorpay/reconciliation) | any | **revert immediately** | P11 invariant — never let payment integrity drift |
| Aggregate Sentry rate `fail` AND school-tagged issues `fail` | any | **revert + investigate** | New error class introduced by this rollout |
| 1 quant `fail` (non-payment) AND qual is positive | any | **fix-first** | Real defect, but users want it. Ship the fix on a feature branch, retest on staging, re-flip after fix lands. |
| Quant all `ok` AND qual all positive | yes | **expand** | Move flag to 10% rollout across paying schools (per the migration's rollout strategy block). |
| Quant all `ok` AND qual mixed / unclear | mixed | **extend-watch** | Run another 7-day window before deciding. Tighten the qual signals — schedule a 30-min call with the principal if not done yet. |
| Quant flat / no usage AND qual flat | both flat | **talk-to-school** | The feature isn't being used. Reach out to find out why before assuming success or failure. |
| Quant ok AND qual negative | negative | **fix-first** | Users tell you something is wrong even though metrics look fine. Trust the human signal. |
| Anything else | any | **extend-watch** | Default to caution when matrix doesn't fit; document why and re-review in 7 days. |

---

## Action rubric

Run the SQL or open the PR for whichever decision applies:

### Revert immediately (or after fix lands)

```sql
UPDATE feature_flags
SET is_enabled = false, target_institutions = NULL, updated_at = now()
WHERE flag_name = '<flag_name>';
```

Append to operator notes: timestamp, reason, link to Sentry issues / payment incident if applicable.

### Expand to 10% rollout

```sql
UPDATE feature_flags
SET is_enabled         = true,
    rollout_percentage = 10,
    target_environments = ARRAY['production']::text[],
    target_institutions = NULL,
    updated_at         = now()
WHERE flag_name = '<flag_name>';
```

Then **rerun the pre-flight runbook against the broader 10% population** — same checks, but use aggregate data instead of one school's. Watch for 7 days, then decide: 50% or back to 10% or hold.

### Fix-first

1. Open a feature branch off main: `fix/<flag>-<short-description>`.
2. Implement the fix.
3. Staging burn-in (push to `develop`).
4. Open draft PR; user merges.
5. Re-run the **pre-flight runbook** Step 1 (especially 1.5 Sentry baseline) and re-flip the flag for the SAME school.

### Extend-watch

```sql
-- No SQL change required. Flag stays at current state.
```

Update operator notes with the 7-day plan: which signals to tighten, which conversations to have, which thresholds will trigger which next decision.

### Talk-to-school

No SQL change. Schedule a 30-min call with the school principal AND a teacher who logs in regularly. Specific questions:
- "Did you notice anything new this week?"
- "What's the biggest thing slowing your team down on Alfanumrik right now?" (open-ended; don't bias toward the rolled-out flag)
- "If we could change one thing for you next week, what would it be?"

Document answers literally (their words). The third answer is gold — it might tell you to roll out a different flag instead of expanding this one.

---

## Final write-up

After running the action, append to operator notes:

```markdown
## Decision: <date>

- Flag: `<flag_name>`
- School: `<school_name>` (`<uuid>`)
- Quant verdict: <ok | mixed | fail (which rows)>
- Qual verdict: <positive | mixed | negative | not obtained>
- Decision: <revert | expand | fix-first | extend-watch | talk-to-school>
- Rationale: <one or two sentences>
- Action taken: <SQL run / PR opened / call scheduled>
- Next review date: <date + 7 days unless reverted>
```

Keep these entries terse and chronological. Future rollouts use them as priors — when the next flag is up for decision, the prior decisions inform the thresholds.

---

## What this template intentionally does NOT do

- Decide for you. The matrix is a starting point; trust the qual signals when they conflict with quant.
- Optimise for speed. Five days is the minimum window for most non-trivial flags. Resist pressure (internal or external) to move faster on the strength of "it looks fine."
- Replace a real product manager. If the flag's outcome is high-stakes (revenue at risk, regulatory exposure, etc.), this template is necessary but not sufficient — get a second pair of eyes.
