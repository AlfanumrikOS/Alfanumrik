# PostHog Integration

**Status:** Wave 4 (ops) — project configuration scaffold drafted 2026-05-04. SDK wiring (Wave 4 backend/frontend/ai-engineer) lands in parallel PRs.

**Owner:** ops
**PostHog project:** `Default project` (id `159341`)
**PostHog org:** `Cusiosense Learning India Private Limited` (id `019d8d71-cec5-0000-885e-11c72bba7c4d`)
**Region:** US (matches Vercel `bom1`/Mumbai → US-East PostHog ingest pairing chosen by architect for latency + DPA alignment)
**Project timezone:** UTC
**Person properties model:** query-time (PostHog setting). `person.properties.*` on the events table always returns the person's *current* (latest) value, not the value at event time. Implication for forensic queries: when a student changes grade or plan, historical event filters by current `person.properties.grade` will surface ALL their past sessions, not just sessions during the active grade window. Use event-level properties (`student_id`, `grade_at_event`) for time-aware filters.

This document is the canonical reference for what events Alfanumrik emits, what properties carry which meaning, and how the PostHog project is configured. Every PostHog-side change must be reflected here in the same PR.

---

## Section 1 — Event Catalog (28 events, Wave 4 marking-authenticity remediation)

> Event-name discipline: `<noun>_<verb>` snake_case, past-tense verbs (`graded`, `submitted`, `blocked`). Wave 4 introduced these to give the founder operational visibility into the authenticity pipeline.

### Quiz lifecycle (8)
| Event | Emitted by | When |
|---|---|---|
| `quiz_session_started` | client (`src/app/quiz/page.tsx`) | First question rendered |
| `quiz_question_answered` | client | Per-question submit (timing for anti-cheat math) |
| `quiz_session_submitted` | client | User clicks Submit, before server roundtrip |
| `quiz_graded` | server (`/api/quiz/submit`) | After `atomic_quiz_profile_update` returns. **Highest-value event** — carries `marking_authenticity_path`, `score_percent`, `xp_earned` |
| `quiz_anti_cheat_flagged` | server | Any of the 3 P3 checks failed |
| `quiz_idempotent_replay` | server | Same `idempotency_key` seen twice; second submit was a no-op |
| `quiz_snapshot_missing` | server | Phase 1.2 silent-zero footprint hit (`quiz_session_shuffles` row absent) |
| `quiz_score_recomputed` | server | Defense-in-depth: server re-derived score and it matched (`grounding.scoring` canary in REG-52) |

### Marking-authenticity pipeline (6)
| Event | Emitted by | When |
|---|---|---|
| `marking_authenticity_violation` | server | `expected_is_correct` from snapshot disagrees with stored `is_correct`. **Goal: zero/day. Page on first event.** |
| `marking_authenticity_path_chosen` | server | At submit time, indicates which path scored: `oracle_v2`, `oracle_v1_legacy`, `client_fallback`, `foxy_freetext`, `unknown` |
| `oracle_verdict_emitted` | server | LLM-grader oracle returned a verdict. Carries `oracle_verdict` ∈ {CONSISTENT, AMBIGUOUS, REJECT} |
| `oracle_block_decision` | server | Oracle rejected/ambiguous result short-circuited a write to `question_bank` or `quiz_responses` |
| `daily_xp_cap_hit` | server (`atomic_quiz_profile_update` returns `xp_capped=true`) | Student earned XP that would exceed the 200/day P2 cap |
| `xp_drift_detected` | server (forensic script) | Manual run of `npm run forensic:quiz` found a session where stored `xp_earned` ≠ recomputed P2 formula |

### Foxy AI tutor (6)
| Event | Emitted by | When |
|---|---|---|
| `foxy_session_started` | client (`/foxy`) | First user message in a thread |
| `foxy_message_sent` | client | Each user message |
| `foxy_response_streamed` | client | Stream complete (carries `latency_ms`, `tokens`, `rag_chunks_used`) |
| `foxy_practice_question_emitted` | server (`src/app/api/foxy/route.ts`) | Foxy decided to render a practice MCQ inline |
| `foxy_oracle_blocked` | server | Practice question rejected by oracle before render |
| `foxy_freetext_marked` | server | Free-text answer scored by Foxy (Phase 3 cutover pending — currently emits `marking_authenticity_path=foxy_freetext`, the weakest path) |

### Subscription / payment (4)
| Event | Emitted by | When |
|---|---|---|
| `payment_initiated` | client | Razorpay checkout opened |
| `payment_succeeded` | server (`webhook/route.ts`) | Webhook signature verified, RPC succeeded |
| `payment_failed` | server | Webhook arrived with failure or RPC threw |
| `subscription_activated` | server | `activate_subscription` (or atomic fallback) returned successfully |

### System / ops (4)
| Event | Emitted by | When |
|---|---|---|
| `feature_flag_evaluated` | server (`src/lib/feature-flags.ts`) | First evaluation per request per flag |
| `health_check_degraded` | server (`/api/v1/health`) | Any subsystem reports degraded or down |
| `admin_action_logged` | server (`/api/super-admin/*`) | Mirrors writes to `admin_audit_log` (PostHog is the searchable index; the table is the source of truth) |
| `regression_canary_failed` | CI / runtime | Production canary (REG-52 `grounding.scoring`, etc.) detects drift |

---

## Section 2 — Event Property Definitions

These properties have non-obvious semantics. Definitions live here so PostHog UI labels match operational intent. (PostHog property definitions can be set via **Data management → Events → [event] → Properties → Edit description** or via the MCP / API.)

### Identity / context
| Property | Type | Meaning | PII? |
|---|---|---|---|
| `student_id` | UUID (string) | Pseudonymous learner id. Same as `students.id`. **Use as `distinct_id`** for student-side events. | No (pseudonymous) |
| `parent_id` | UUID | Same as `guardians.id` | No (pseudonymous) |
| `teacher_id` | UUID | Same as `teachers.id` | No (pseudonymous) |
| `role` | enum | `student` \| `parent` \| `teacher` \| `admin` | No |
| `grade_at_event` | string | `"6"`..`"12"` snapshotted at emit time (P5 — never integer) | No |
| `plan_at_event` | enum | `free` \| `monthly` \| `yearly` snapshotted at emit time | No |
| `institution_id` | UUID | Optional school binding | No (pseudonymous) |
| `request_id` | string | Middleware-injected request trace id | No |

### Quiz / scoring
| Property | Type | Meaning |
|---|---|---|
| `quiz_session_id` | UUID | Same as `quiz_sessions.id` |
| `marking_authenticity_path` | enum | One of `oracle_v2`, `oracle_v1_legacy`, `client_fallback`, `foxy_freetext`, `unknown`. **The single most important field for the Wave 4 program.** Goal: 100% of `quiz_graded` events carry `oracle_v2` once Phase 2.7 + Phase 3 cutovers complete. |
| `score_percent` | number (0-100) | Per P1: `Math.round((correct / total) * 100)`. Server-derived. |
| `correct_count` | integer | Server-derived |
| `total_questions` | integer | Server-derived |
| `xp_earned` | number | Per P2 formula. Capped at daily limit by `atomic_quiz_profile_update`. |
| `xp_capped` | boolean | True when daily 200-XP cap clamped the award |
| `oracle_verdict` | enum | `CONSISTENT` \| `AMBIGUOUS` \| `REJECT` (Wave 4 oracle outcome) |
| `idempotent_replay` | boolean | True if the submit was a duplicate of a previously-graded session |
| `options_version` | integer | Monotonic snapshot stamp from REG-53 |
| `snapshot_sha256` | string (hex) | SHA-256 of the snapshot row (REG-53 self-verification) |
| `snapshot_present` | boolean | False = Phase 1.2 silent-zero footprint hit |
| `subject` | string | CBSE subject |
| `topic_id` | UUID | Topic / chapter id |
| `bloom_level` | enum | `remember`, `understand`, `apply`, `analyze`, `evaluate`, `create` |
| `difficulty` | enum | `easy`, `medium`, `hard` |

### Foxy / AI
| Property | Type | Meaning |
|---|---|---|
| `latency_ms` | number | Streaming complete time |
| `tokens_in` / `tokens_out` | integer | Claude API token counts |
| `rag_chunks_used` | integer | Count of retrieval chunks rendered into the prompt (single-retrieval contract enforced by REG-50: ≤ 1 retrieval call per turn) |
| `model` | string | e.g. `claude-haiku-4-5`, `claude-sonnet-4-5` |
| `circuit_breaker_open` | boolean | True when Claude API was failing and we served a fallback |
| `practice_question_id` | UUID | When Foxy embedded an MCQ |

---

## Section 3 — PostHog Project Setup (manual steps required)

> **Status note (2026-05-04):** This section was authored by the ops agent during Wave 4. Direct PostHog MCP tool calls were not available in the agent's runtime tool list at authoring time — only the MCP server registration was visible. **Every PostHog-side configuration step below must be performed manually by the founder (or by a future agent run with the PostHog MCP tools exposed)** until that gap closes. When performed, append the actual outcome (insight URLs, confirmation that filters are live) below each subsection.

### 3.1 Verify region and ingestion baseline

**Manual check (PostHog UI):**
1. Visit https://app.posthog.com/project/159341/settings/project — confirm "Project region" = US.
2. **Activity → Live events** — should show zero of our Wave 4 event names (`quiz_graded`, `marking_authenticity_violation`, `foxy_oracle_blocked`, etc.) until backend/frontend SDK PRs land. Existing events from prior PostHog usage on the project (if any) are unrelated.

**Outcome (fill in after manual run):**
- Region confirmed: ☐
- Pre-existing events found: \_\_\_\_\_ (paste list or "none")
- Date checked: \_\_\_\_\_

### 3.2 Create event property definitions (so PostHog UI shows nice labels)

For each of the 7 high-value props, set a description in **Data management → Properties**:

| Property | Type to set | Description to paste |
|---|---|---|
| `student_id` | String (UUID) | Pseudonymous learner identifier. Same as `students.id`. Used as `distinct_id` for student events. Never join to email/phone in PostHog — they are denylisted. |
| `marking_authenticity_path` | String (enum) | Which scoring path graded the quiz: `oracle_v2` (target — server-side oracle, snapshot-grounded), `oracle_v1_legacy` (older oracle, deprecation pending), `client_fallback` (Phase 2.7 deprecation pending — weakest path), `foxy_freetext` (Phase 3 cutover pending), `unknown` (page immediately). |
| `score_percent` | Numeric (0-100) | Per P1: `Math.round((correct / total) * 100)`. Always server-derived; client value is informational only. |
| `xp_earned` | Numeric | Per P2 formula. Value is what was actually awarded after the daily 200-XP cap. |
| `xp_capped` | Boolean | True when the daily 200-XP cap clamped the award. Signals an engaged learner — operationally useful for plan-tier marketing. |
| `oracle_verdict` | String (enum) | LLM-grader oracle output: `CONSISTENT` (passes), `AMBIGUOUS` (held for review), `REJECT` (blocked from `question_bank` or `quiz_responses` write). |
| `idempotent_replay` | Boolean | True if the quiz submit was a duplicate of a previously-graded session (same `idempotency_key`). Expected non-zero baseline; a sudden spike means client retry storm or duplicate webhooks. |

**Outcome (fill after manual run):** ☐ all 7 set ☐ partial — remaining: \_\_\_\_\_

### 3.3 Create starter insights (4 dashboards for the founder)

> Save all four to a new dashboard called **"Marking Authenticity (Wave 4)"** so the founder has a single bookmark.

#### Insight 1 — "Quiz Marking Integrity (last 7d)"
- **Type:** Trends → Total count
- **Event:** `quiz_graded`
- **Breakdown by:** `marking_authenticity_path`
- **Time range:** Last 7 days, daily bucketing
- **Goal annotation (paste in chart description):** "100% should be `oracle_v2` once Phase 2.7 client-fallback deprecation and Phase 3 Foxy free-text cutover complete. Currently expect a mix while cutovers are staged. Any `unknown` slice is a P0 — page on-call."

#### Insight 2 — "Marking Authenticity Violations (last 7d)"
- **Type:** Trends → Total count
- **Event:** `marking_authenticity_violation`
- **Time range:** Last 7 days, daily bucketing
- **Alert:** Set a PostHog alert (Insights → Alerts) for `> 0` in any 1-hour window → notify ops on-call channel
- **Goal annotation:** "Target: zero/day. Each event represents one quiz where the per-session snapshot says the student's answer was correct (or incorrect) and we recorded the opposite. Backed by the `marking_audit_last_30d` SQL view as ground truth."

#### Insight 3 — "Oracle Block Rate"
- **Type:** Trends → Formula
- **Series A:** `foxy_oracle_blocked` (count)
- **Series B:** `foxy_practice_question_emitted` (count)
- **Formula:** `A / (A + B)`
- **Time range:** Last 30 days, daily bucketing
- **Goal annotation:** "Healthy range: 1-5% (oracle catches a small fraction of LLM-emitted MCQs that fail validation). > 20% in any hour = oracle is over-rejecting (likely model regression or prompt drift) — rollback the oracle prompt PR. < 0.1% sustained = oracle may be silently passing through hallucinated questions — audit a sample manually."

#### Insight 4 — "Daily XP Cap Hits"
- **Type:** Trends → Total count
- **Event:** `daily_xp_cap_hit`
- **Time range:** Last 30 days, daily bucketing
- **Breakdown by:** `plan_at_event`
- **Goal annotation:** "Each event = one student completed enough quizzes to hit the 200 XP/day cap. Founder uses this to gauge whether the cap is suppressing engagement on premium plans (signal to raise the cap for paid tiers) or whether the free tier needs a softer landing (signal to add a 'come back tomorrow' nudge)."

**Outcome (fill after manual run):**
- Insight 1 URL: \_\_\_\_\_
- Insight 2 URL: \_\_\_\_\_
- Insight 3 URL: \_\_\_\_\_
- Insight 4 URL: \_\_\_\_\_
- Dashboard URL: \_\_\_\_\_

### 3.4 Configure PII denylist (defense-in-depth, P13)

PostHog supports two relevant filters: **discard event properties** (per-property) and **discard events** (per-event). The SDK redactors (Wave 4 frontend/backend) are layer 1; this PostHog project setting is layer 2. We want defense-in-depth so a single SDK regression can't leak PII.

**Manual UI path (PostHog v1 setting name may vary — check current PostHog docs):**
- **Project settings → Data management → Privacy & PII → Properties to ignore** (or equivalent in current PostHog UI), add each of:
  - `email`
  - `phone`
  - `parent_phone`
  - `full_name`
  - `school_name`
  - `ip_address`
  - `razorpay_signature`
  - `password`
  - `auth_token`
  - `cookie`
  - `session_cookie`

**Behavior expected:** if any event arrives with one of these property keys, PostHog drops the property server-side before persistence. The SDK should never send these in the first place (REG-49 enforces this client-side via Sentry-style `beforeSend`); the denylist is the belt-and-suspenders.

**If PostHog does not expose this setting in the project UI:** fall back to an ingestion-time event transformation (Apps & integrations → Pipelines) using the "Property filter" or "PII data redactor" transformation if available on the current plan. Document the workaround inline below.

**Outcome (fill after manual run):**
- Denylist UI path used: \_\_\_\_\_
- Properties confirmed denylisted: \_\_\_\_\_
- Workaround needed (Y/N + details): \_\_\_\_\_

### 3.5 Person-property hygiene (query-time gotcha)

PostHog confirms (see system reminder): "Person properties are query-time in this project. `person.properties.*` on the events table always returns the person's current (latest) value, regardless of when the event occurred."

**Operational implication:** for any forensic query that needs the value of `grade` or `plan` *at the time the event was emitted*, do NOT use `person.properties.grade`. Use the event-level properties `grade_at_event` and `plan_at_event` (added to the catalog in §2). The forensic runbook (`docs/runbooks/forensic-quiz-investigation.md`) reflects this.

---

## Section 4 — Reproducibility note

If this PostHog project is ever destroyed or migrated:
1. The 28-event catalog (§1) is the contract; backend/frontend/ai-engineer SDK code is the source of truth for what's actually emitted.
2. The 7 property descriptions (§3.2) and 4 starter insights (§3.3) can be re-created from this document — they are intentionally minimal.
3. The PII denylist (§3.4) MUST be re-established before turning any SDK back on — it is the only mechanically-enforced server-side PII boundary on the PostHog side.
4. The region (US) MUST match for DPA continuity.

---

## Section 5 — Open questions for the founder

1. **PostHog plan tier** — which plan are we on? Some features above (alerts on insights, ingestion-time transformations) are scoped by tier. If we're on the free tier, the alert in Insight 2 may need to be replaced with a daily digest email or a Slack webhook driven from a `/api/cron/posthog-canary` route. Confirm tier so the runbook can finalize.
2. **Cardinality budget for `student_id`** — PostHog charges by event volume, not by distinct person count, but high-cardinality breakdowns (e.g., `marking_authenticity_path` × `student_id`) can degrade query performance. Confirm we're OK leaving `student_id` as a property on every event vs. relying on `distinct_id` only.
3. **Retention** — default PostHog retention varies by tier. For Wave 4 forensic work we need at least 90 days of `quiz_graded` and `marking_authenticity_violation`. Confirm or extend.
4. **DPA / India data residency** — US ingestion was architect's call for latency. If future regulatory guidance requires India-resident behavioral analytics, the migration target is PostHog Cloud EU + a self-hosted PostHog at our Mumbai DC; both are non-trivial. Flag if this is a near-term concern.
