# Engineering-Audit Program — Close-Out Summary (CEO-facing)

> **Status: COMPLETE — 8 of 8 ranked workflows audited → hardened → merged (2026-06-28 → 2026-06-29).**
> This is the founder-level close-out. Per-cycle detail lives in `cycles/2026-06-29-*.md` and
> `workflows/*/`; the live program counter is `STATE.md`; the actionable residual is the
> `PRIORITY-BACKLOG.md` "Post-program remediation backlog".

## What this program was
A continuous, ranked audit of the eight highest-blast-radius user journeys in Alfanumrik Learning OS.
Each workflow ran the same 8-phase loop — MAP → GAP ANALYSIS → ROOT-CAUSE → DESIGN → IMPLEMENT →
SELF-REVIEW → INDEPENDENT VALIDATION → REGRESSION — with an independent quality/orchestrator verdict and a
P14 review chain on every cycle. The rule throughout: land only **auto-fix-safe** changes (no product
invariant, pricing, RBAC, schema-drop, or AI-model change without explicit CEO approval); everything that
touches a product decision is surfaced, not silently changed.

## The 8 cycles and the headline finding per cycle

| # | Workflow | Invariants | Headline finding | Disposition |
|---|---|---|---|---|
| 1 | Auth & Onboarding | P15, P8, P9 | The signup→verify→profile→dashboard funnel's 3-layer profile failsafe had a gap where a logical RPC failure wasn't surfaced; fixed (AO-4) so the layer-3 fallback engages. Grade stored canonically as "9" not "Grade 9" (AO-5, P5). A separate prod migration-drift incident was resolved repo-side (PR #1153, deploy green). | DONE — partial; AO-3 (institution_admin provisioning) user-gated, AO-10 grade backfill follow-up |
| 2 | Payments & Subscriptions | P11 | Razorpay split-brain risk **closed**: the webhook now flows only through atomic RPCs (`activate_subscription` → `atomic_subscription_activation` fallback → 503 retry), verify/webhook contention serialized by advisory lock, event-level idempotency. PAY-1/3/4/5/6/7/8 landed. | DONE — auto-fix-safe; PAY-2 (pricing source) user-gated |
| 3 | Student Learning Core | P1-P6, P12 | The dead P6 `isValidQuestion` validator was wired into quiz start (SLC-7) so served-count consistency holds; P1 score-formula three-way parity + P2 XP earning-literal parity pinned (SLC-2/3). A **second uncapped XP writer** (legacy `quiz_sessions` trigger) was found. | DONE — auto-fix-safe; SLC-1 (uncapped XP trigger) user-gated, SLC-4/5 cross-agent |
| 4 | Foxy AI Tutor & RAG | P12, P8, P13 | The LIVE grounded path had **lost the P12 "no unfiltered LLM output to students" backstop** at the grounded-answer cutover. FOX-1 added `screenStudentFacingText` (+ Deno twin) on EVERY student-facing exit; FOX-2 neutralizes message injection. Also recorded: `/api/foxy` is the live route (constitution was stale). | DONE — P12 backstop; FOX-4 (OpenAI shadow provider) user-gated |
| 5 | Teacher / School-Admin B2B | P8, P9, P13 | **CRITICAL cross-tenant student-PII leak (TSB-1) — FOUND & FIXED.** A teacher with `grades_taught` but no class could read (and at one site WRITE) names/mastery/XP of EVERY grade-6-12 student across ALL schools via the teacher-dashboard grade fallback (service-role, RLS-bypassed). Now `school_id`-scoped + fail-closed at all 8 sites. DPDP-reportable class of exposure. | DONE — auto-fix-safe; TSB-4 (table-drop) user-gated |
| 6 | Super-Admin & Observability | P9, P13 | Mechanism layers sound (gate-before-I/O on every route, redactPII, flag default-OFF). The dominant gap is a POLICY one: the admin ladder gates by ACTION-destructiveness not READ-data-sensitivity, so the most PII-heavy bulk export sits at the LOWEST `support` tier (SAO-1). SAO-3/2/7/4 hardening landed (134-route gate sweep, egress redaction). | DONE — auto-fix-safe; SAO-1/SAO-5 (PII-export tiering) user-gated |
| 7 | Parent Portal | P8, P13, P15 | Built in two eras (demo/link-code + consent/RBAC) layered, not replaced — leaving a weaker legacy path live. PP-2 closed a PostgREST `.or()` link-code filter-injection at all 3 sites; PP-1 added a brute-force rate limit. The legacy `parent_login` grants an ACTIVE guardian link from a link code ALONE (no consent). | DONE — auto-fix-safe; PP-1-consent + PP-3 (link/consent model) user-gated |
| 8 | Cross-cutting | P7, P8, P10, mobile sync | Three of four themes are the SAME failure: an invariant expressed as a rule/comment with no mechanical enforcer (P7 edges, 87%-admin-client route default, cross-repo constant mirror). The fourth is the inverse — the P10 bundle cap is a freely-editable number ratcheted UP 5×. Landed: P7 server-notification Hindi + mobile-web drift contracts + bundle-cap pin. | DONE — auto-fix-safe; XC-3/XC-4b/XC-7 = larger initiatives |

## Regression coverage added by the program
The catalog grew **from ~146 to 160** — **17 new pinned regressions, REG-177 through REG-193**:

| REG | Cycle | Pins |
|---|---|---|
| REG-177 | 1 | `send_auth_email` always-200 (P15) |
| REG-178 / REG-179 | 2 | verify-route HMAC reject (P11) / `subscribe` RBAC gate pre-Razorpay (P9/P11) |
| REG-180 / REG-181 | 3 | score-formula three-way parity (P1) / XP SQL-literal parity (P2) |
| REG-182 / REG-183 | 4 | live grounded-path output backstop (P12) / student-message injection neutralization (P12) |
| REG-184 / REG-185 | 5 | teacher-dashboard grade-fallback tenant scope (P8/P13) / teacher-assigned RLS backstop (P8) |
| REG-186 / REG-187 | 6 | full-surface admin auth-gate sweep (P9) / bare-name log canary (P13) |
| REG-188 / REG-189 / REG-190 | 7 | link-code filter-injection + twin parity / per-IP rate limit / profile authz + child-data deny (P8/P9/P13) |
| REG-191 / REG-192 / REG-193 | 8 | subscription price web↔mobile parity / score-config web↔Flutter parity / bundle-cap pin (P10) |

(Authoritative source: `.claude/regression-catalog.md`.)

## Consolidated decision register
The audit deliberately did NOT change product decisions. The unresolved work is tiered by how it must be
actioned. Full per-item rationale is in `PRIORITY-BACKLOG.md` → "Post-program remediation backlog".

### Tier-1 — USER-GATED (needs a CEO decision)
| Item | Cycle | The decision |
|---|---|---|
| **PAY-2** (pricing source) | 2 | `create-order` hardcoded `PRICING` vs DB `subscription_plans`; any pricing-amount change is user-gated. |
| **SLC-1** (uncapped XP trigger) | 3 | A second, uncapped XP writer (legacy `quiz_sessions` trigger). Consolidate to one capped writer (P2). |
| **FOX-4** (OpenAI provider) | 4 | gpt-4o-mini/gpt-4o present as a MoL shadow comparison (not student-facing). Govern or remove. |
| **TSB-4** (table-drop) | 5 | Dual `class_students` / `class_enrollments` join tables; picking one canonical + DROPping the other. |
| **SAO-1 / SAO-5** (PII-export tiering) | 6 | Mass student/parent/teacher PII bulk-export sits at the lowest `support` tier (DPDP-relevant). |
| **PP-1-consent / PP-3** (parent-link consent model) | 7 | Legacy `parent_login` creates an ACTIVE guardian link from a link code ALONE — no approval. |

### Tier-2 — REVERSIBLE / pre-approved (engineering may schedule)
SLC-4 / SLC-5 (dual daily-cap + reject-semantics), SAO residual cleanups (export message-column redaction,
periodic re-read), PP-1 durable limiter, AO-10 grade-coercion backfill. (AO-3's provisioning MODEL is
user-gated; its read-consolidation is reversible.)

### Tier-3 — LARGER-PROGRAM initiatives (multi-sprint engineering)
| Item | Cycle | Initiative |
|---|---|---|
| **XC-3** | 8 | Systemic RLS defense-in-depth — 87% of routes use the RLS-bypassing admin client; defense-in-depth is absent at the dominant data path. Subsumes Cycle-5 TSB-2 + Cycle-7 PP-5. |
| **XC-4b** | 8 | Split @supabase/* out of first paint (~57 kB) → ratchet the P10 bundle cap back toward the 160 kB baseline. |
| **XC-7** | 8 | Adopt a central keyed-resolver i18n primitive + a missing-translation lint (the chokepoint absent today). |
| **PP-5** (client migration) | 7 | Move parent child-data routes to RLS-scoped clients — folds into XC-3. |

## The one-line takeaway
Eight critical journeys were audited and hardened with 17 new regression pins; the single most consequential
find — a critical cross-tenant student-PII leak (TSB-1) — was fixed in-flight, the P12 Foxy output backstop
and P11 payment integrity were restored, and every remaining product-shaping decision is now explicitly on
the CEO's desk (Tier-1) rather than buried in code.
