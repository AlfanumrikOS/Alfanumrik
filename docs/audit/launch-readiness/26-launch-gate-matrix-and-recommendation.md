# 26 — Launch Gate Matrix & Final Recommendation

**Status:** PLANNING DELIVERABLE. Reflects **current, unremediated state** as of 2026-08-30 (nothing in the 12 remediation packets has been executed). Every gate is marked PASS, FAIL, or UNKNOWN per CEO instruction — **UNKNOWN is not treated as PASS anywhere in this document.**

---

## Part A — RAG Acceptance Gates (CEO-specified, must survive remediation)

| Gate | Bar | Current Status | Evidence |
|---|---|---|---|
| Recall@10 | ≥ 95% | **FAIL** | Baseline (2026-06-14, committed) = 82.2%. Cited "current" = 66.1%, but this number is **not reproducible from the repo** (uncommitted 2026-08-23 run, `eval/rag/reports/` gitignored). Either way, both the committed baseline and the cited current figure are below 95%. |
| Recall@3 | ≥ 90% | **UNKNOWN** | Not computed by any current harness. Cannot be marked PASS or FAIL — genuinely unmeasured. |
| Faithfulness | ≥ 95% | **UNKNOWN** (not simply FAIL) | Measured groundedness-rate was 36.7% at baseline, ~40-47% cited as "current" — both far below 95%. But the harness's own code discloses the "candidate answer" fed to the judge is a proxy (top retrieved chunk's first 400 characters, not a real generated answer), explicitly commented as skewing the number HIGH. **The measurement itself is invalid** — a low score against an invalid measurement is not the same as a confirmed FAIL against the real target. Must be marked UNKNOWN until the harness is redesigned to test a real generated answer, not treated as a soft PASS or assumed-FAIL. |
| Correctness | ≥ 90% | **UNKNOWN** | Not computed by any current harness. |
| Abstention | ≥ 99% | **UNKNOWN** | Not computed by any current harness. |

**Implication:** 4 of 5 CEO-specified RAG gates cannot currently be evaluated at all (UNKNOWN), and the 1 gate that can be evaluated (recall@10) is a confirmed FAIL. **The RAG system cannot honestly be certified against the CEO's stated acceptance gates in its current state** — this is a harness/measurement gap as much as a retrieval-quality gap, and both need addressing (see Packet 3) before this section of the launch decision can be made on real evidence rather than partial/invalid data.

---

## Part B — Full Launch Gate Matrix

Gates 1-25 are carried forward from `18-launch-gate-scorecard.md`, re-evaluated against this remediation-planning pass's evidence. Gates 26-27 (DPDP, general rate limiting) from that document are **removed** — DPDP is out of scope per CEO's 2026-08-30 authorization, and general rate limiting is superseded by the more precise VULN-D1/D2/D3 entry below. New gates 28-31 reflect items surfaced or reclassified in this pass.

| # | Gate | Status | Basis |
|---|---|---|---|
| 1 | Repo reproducibility | **CONDITIONAL** (unchanged) | CI green; CI Gate not required (Packet 4, trivial fix pending); E2E Nightly red 25+ days (unchanged, not re-verified this pass) |
| 2 | Build & bundle | **PASS** (unchanged) | Not re-investigated this pass; no new evidence contradicts prior PASS |
| 3 | Secret scanning | **PASS** (unchanged) | Not re-investigated this pass |
| 4 | Database schema integrity | **CONDITIONAL** (unchanged) | RLS 100% coverage; DB-12 verified closed; stale DESIGN_ONLY migration still present (not re-verified this pass, carried forward) |
| 5 | Migration parity | **CONDITIONAL** (unchanged) | Not re-investigated this pass |
| 6 | RLS coverage | **FAIL** (downgraded from CONDITIONAL) | Question_bank answer key exposure (P1-01) confirmed still open at the RLS/grant layer — this is the exact defect this gate exists to catch, and it is confirmed live, not merely conditional |
| 7 | Grant hygiene | **CONDITIONAL** (unchanged) | Default-privilege auto-grant pattern unchanged; not re-investigated this pass beyond P1-01/P1-07 specifics |
| 8 | Auth — JWT verification | **PASS** (unchanged) | Not contradicted by this pass's evidence |
| 9 | Auth — service-role key isolation | **PASS** (unchanged) | Not contradicted by this pass's evidence |
| 10 | RBAC — role storage | **PASS** (unchanged) | Not contradicted by this pass's evidence |
| 11 | RBAC — route coverage | **CONDITIONAL** (downgraded from PASS) | Original "410/410 have auth checks" is confirmed accurate at a coarse level, but this pass reconfirmed P2-04's 3 routes where a check runs but its result isn't enforced — a real exception to the blanket PASS, now reclassified P1 (Packet 11) |
| 12 | RBAC — escalation prevention | **CONDITIONAL** (unchanged) | Not re-investigated this pass |
| 13 | Tenant isolation | **CONDITIONAL** (unchanged) | Not re-investigated this pass beyond confirming class_students/class_enrollments has zero live divergence (§22, item 1) |
| 14 | Quiz submission atomicity | **PASS** (unchanged) | Not contradicted by this pass's evidence |
| 15 | Adaptive learning closed loop | **FAIL** (downgraded from CONDITIONAL) | This pass found a second live write path to `concept_mastery` (`tutor/answer/route.ts:247`) bypassing the canonical `update_learner_state_post_quiz` RPC, directly contradicting the "single canonical mastery write path" positive finding this gate partly rested on (§21 item B7) |
| 16 | Foxy AI safety | **PASS** (unchanged) | Not contradicted by this pass's evidence |
| 17 | RAG retrieval quality | **FAIL** (unchanged, see Part A) | Recall@10 confirmed FAIL; 4 other mandated metrics UNKNOWN, not PASS |
| 18 | Question bank integrity | **CONDITIONAL** (downgraded from NO-GO/FAIL — the RPC-serving leak is closed) | RPC-level leak closed 2026-08-14, verified by a passing regression test. RLS/grant-level leak remains open but is now understood, scoped, and blocked on a known dependency (mobile release) rather than an open-ended unknown — hence CONDITIONAL rather than a flat FAIL, though it remains launch-relevant until Packet 2 Phase B ships |
| 19 | Payment integrity | **PASS** (unchanged) | Not contradicted; but see gate 30 below for the newly-scoped rate-limiting gap on payment routes specifically |
| 20 | Observability & alerting | **CONDITIONAL** (unchanged) | Single-channel alerting confirmed; fix now known to require near-zero engineering (Packet 5) |
| 21 | Cron job reliability | **PARTIAL UNKNOWN** (was CONDITIONAL) | P0-01 fix confirmed merged (pending deploy verification); queue-consumer claim-step locking explicitly could not be confirmed either way this pass — marked UNKNOWN per §21 item B8, not silently folded into a CONDITIONAL |
| 22 | PII redaction | **PASS** (unchanged) | Not contradicted by this pass's evidence |
| 23 | Backup & disaster recovery | **CONDITIONAL** (unchanged) | No material change found (§21 item B9) |
| 24 | CI/CD deployment gating | **CONDITIONAL** (unchanged, fix trivial) | CI Gate not required confirmed exactly as originally stated; fix is a ~30-minute settings change (Packet 4) |
| 25 | Error handling & boundaries | **FAIL** (downgraded from CONDITIONAL) | Original "52 files reference ErrorBoundary... 3 Edge Functions leak raw errors" undersold the scope — this pass confirmed ~750 raw error-message occurrences across 47+ Edge Functions and Next.js routes (Packet 9), a systemic pattern, not an isolated 3-file gap |
| 26 | Admin data minimization (child PII) | **FAIL** (new gate) | 5 confirmed admin routes return unfiltered `students`/`student_subscriptions`/`monthly_reports` rows including DOB, phone, and other PII fields to admin sessions (Packet 11) |
| 27 | Rate limiting — OAuth/payments/auth-critical paths | **FAIL** (new gate, replaces original gate 27) | 6 specific routes confirmed to have zero rate limiting, with a precise, low-risk fix already scoped (Packet 10) |
| 28 | Deployed-component integrity (Edge Functions) | **FAIL** (new gate) | 53-function repo/deployment gap confirmed live; at least one live function (`export-report`) has no source of truth in the repo at all; 8+ newer functions deployed outside CI performing real writes to `audit_logs` and RAG content tables (§21 item B3) |
| 29 | Feature-flag rollout governance | **FAIL** (new gate) | 3 constitution-pinned flags confirmed live at 100% rollout with zero staged-rollout stages completed, contradicting their own documented kill-switch/staged-activation design intent (§21 item B4) |
| 30 | Content reachability (grade encoding) | **FAIL** (new gate) | 100% of `topic_diagrams` rows (3,168/3,168) confirmed unreachable via the live student-facing query path — a confirmed, currently-active, 100%-reproduction-rate defect (§21 item B5) |
| 31 | Mastery/XP write-path consistency | **CONDITIONAL** (new gate) | Second live write path to `concept_mastery` confirmed (also drives gate 15's downgrade); severity depends on whether the two paths' counting semantics actually diverge, which was not confirmed either way this pass |

---

## Part C — Verdict Tally (this pass)

| Verdict | Count | vs. Original `18-launch-gate-scorecard.md` (25 gates, DPDP-inclusive) |
|---|---|---|
| **PASS** | 8 | 10 (2 gates downgraded: RLS coverage, RBAC route coverage moved off PASS) |
| **CONDITIONAL** | 10 | 12 (net: several unchanged, some downgraded to FAIL/UNKNOWN, new CONDITIONALs added) |
| **FAIL** | 11 | 3 NO-GO in original (this pass uses FAIL consistently instead of mixing NO-GO/FAIL terminology, and adds 4 new FAIL gates plus downgrades 4 previously-CONDITIONAL/PASS gates to FAIL) |
| **UNKNOWN (partial)** | 2 (gate 21 partially, embedded in Part A's 4 RAG sub-gates) | 0 — original scorecard did not use an UNKNOWN category; this is a correction, not a new problem, since some of these were previously silently treated as PASS-by-omission |

**This is not evidence that the system got worse since the original audit.** Several "downgrades" (gates 6, 11, 15, 18, 25, and the RAG sub-gates) reflect **more precise, freshly-verified evidence replacing prose estimates or silent PASS-by-omission**, not new regressions. Gate 18 (question bank) is actually a genuine improvement in understanding — the RPC-level leak is now confirmed closed, narrowing what remains open to a well-scoped, dependency-blocked item rather than an open-ended unknown.

---

## Part D — Final Recommendation

### **NO-GO for unrestricted public launch. CONDITIONAL path exists for a controlled pilot, contingent on the Phase 0 items in `25-revised-remediation-roadmap.md` closing — with one item (P1-01's mobile dependency) likely setting the real timeline.**

**Reasoning:**

1. **The core academic-integrity defect (P1-01) is real but now precisely scoped and partially closed.** The RPC-serving leak — the path an ordinary student would actually encounter through the app — is already fixed and regression-tested. What remains (direct-REST access to the answer key) requires a determined, technically-capable actor with a valid login, not an ordinary student clicking through the quiz UI. This changes the *practical* urgency without eliminating the *should-fix* status. The remaining work is blocked on a mobile release cycle, not a backend decision — recommend treating this as "in progress, on a known and reasonable timeline" rather than "blocking, unscoped risk," provided the mobile release is actually started immediately and tracked to completion.

2. **The RAG quality gates cannot be honestly evaluated today.** One gate (recall@10) is a confirmed, real FAIL. Four others are UNKNOWN because the measurement infrastructure doesn't exist yet to compute them, and the one number that does exist for faithfulness is measured with a self-admittedly biased proxy. **Recommend the CEO not accept any GO decision that treats the current RAG numbers as settled** — the immediate next step (Packet 3, step 1: a single read-only embedding-coverage query) is low-cost and should be run before any further RAG-related timeline commitment is made.

3. **Several newly-reclassified risks (Edge Function drift, feature-flag governance, grade-encoding reachability) are confirmed live, active defects, not backlog hygiene.** None of them are security-critical in the sense of enabling cross-tenant data leakage or credential compromise, but they represent real gaps in operational discipline (undocumented production deployments, bypassed rollout governance) that a CEO greenlighting a pilot should be aware of as *current, not historical, state*.

4. **The good news:** the vast majority of the launch-blocking work is now precisely scoped, low-risk, and largely independent of each other — 7 of the 12 packets (P0-01, P1-03, P1-04, P1-05, P1-06, rate limiting, admin PII) are estimated at low effort with no schema-migration risk and no cross-dependencies, and could plausibly close within 1-2 weeks if greenlit for execution in parallel. The single item most likely to set the real calendar is P1-01's mobile release, which should start immediately regardless of what else is sequenced around it.

5. **Two items are not the CEO's decision to make by default** — they need an explicit call: P1-07 (revoke a grant that a prior engineer deliberately left in place) and P1-08 (how much of the ~750-site error-leak surface to fix now vs. later). Recommend these be raised directly rather than resolved by engineering judgment, consistent with the CEO's own instruction that unresolved decisions be surfaced, not silently closed.

**This recommendation is a planning-phase output only. No execution has occurred. All packets in `20-remediation-packets.md` remain pending separate CEO approval before any code, schema, configuration, or production system is touched.**
