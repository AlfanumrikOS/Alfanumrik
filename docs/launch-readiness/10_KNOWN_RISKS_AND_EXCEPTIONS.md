# 10 — Known Risks and Exceptions

**Status:** DRAFT — Phase 1. This is the CEO-visible exception register. Every entry needs an owner, risk
statement, expiry/trigger, and compensating control per the launch mandate's completion criteria. Entries
below are ported from the EXISTING `engineering-audit/PRIORITY-BACKLOG.md` (do not re-litigate these without
new evidence — they already went through an 8-phase audit loop with independent validation) plus NEW items
found by this program.

## Tier-1 — USER-GATED (CEO decision required before this program can close them)
| Item | What it is | Current status (2026-08-23) | Compensating control until decided |
|---|---|---|---|
| PAY-2-canonical-price | Web vs mobile `unlimited` plan billed different prices | **RESOLVED 2026-06-30** (PR #1179) — CEO approved convergence to ₹1099/₹8799. Docs reconciled by this session. Verified: **zero historical transactions were affected** (production `payment_history` has zero `unlimited`-plan rows, ever). | N/A — closed |
| SLC-1-backfill/clamp | Legacy uncapped XP trigger inflated some students' XP historically; going-forward dedup landed (SLC-1), backfill/clamp deferred | Deferred pending SLC-4 landing (per STATE.md) | Read-only quantification planned before any clamp; CEO decision required before mutating stored XP values |
| FOX-4 (OpenAI shadow provider) | gpt-4o-mini/gpt-4o present as a MoL shadow comparison in `grounded-answer`, not student-facing | **DONE 2026-06-29** — confirmed double-flag-gated OFF, never student-facing, PII-redacted, cost-capped (REG-197) | N/A — closed, govern-with-flag |
| TSB-4-cutover | `class_students`/`class_enrollments` dual roster table — DROP the redundant one | **OPEN** — going-forward soft-delete sync landed (REG-200); the actual DROP/repoint/backfill cutover remains CEO-gated (irreversible) | Sync trigger keeps both tables consistent going forward; historical pre-sync divergence not yet backfilled |
| SAO-1/SAO-5 (PII-export tiering) | Mass student/parent/teacher PII bulk-export sat at the lowest `support` admin tier | **DONE 2026-06-29** — CEO-approved re-tier to `super_admin` (REG-198) | N/A — closed |
| PP-1-consent/PP-3 | Legacy `parent_login` granted an ACTIVE guardian link from a link code alone, no consent step | **DONE 2026-06-29** — CEO-approved Option B (pending→approve flow) (REG-199) | N/A — closed |
| AO-3 | `institution_admin` provisioning model | Still user-gated per STATE.md; read-consolidation is reversible and may proceed without the model decision | Not yet independently re-verified this cycle |

## Tier-3 — LARGER-PROGRAM initiatives (multi-sprint, explicitly NOT expected to close before a controlled pilot)
| Item | What it is | Why it's Tier-3 not a launch blocker |
|---|---|---|
| XC-3 | ~87% of API routes use the RLS-bypassing `supabaseAdmin` client instead of an RLS-scoped client (systemic defense-in-depth gap) | Requires per-route migration across the majority of the API surface. Launch mandate's Gate C requires proving cross-tenant/cross-role denial — this program will verify the ACTUAL denial behavior holds today (via RBAC/RLS/application-layer checks) even where the admin client is used, not assume XC-3 blocks launch. If verification finds a live denial gap tied to a specific route, that specific route is escalated to Critical/High, not deferred as XC-3. |
| XC-4b | Split `@supabase/*` out of first paint (~57 kB) to ratchet the P10 bundle cap back down | Performance/bundle-budget optimization, not a correctness or safety gap |
| XC-7 | Central keyed-resolver i18n primitive + missing-translation lint | P7 bilingual coverage currently enforced by convention, not a mechanical gate — a real gap, but a multi-sprint fix, not a launch blocker by itself. Frontend recon is spot-checking whether launch-critical screens specifically have real Hindi coverage regardless of this gap. |
| PP-5 | Move parent child-data routes to RLS-scoped clients | Folds into XC-3 |

## NEW items found by this program (not in the prior audit)
| Item | Found by | Severity (preliminary) | Detail |
|---|---|---|---|
| `payment_history.amount` dual-writer race | Orchestrator, 2026-08-23 (PAY-2 MRR investigation) | Medium-High, pending backend recon confirmation of blast radius | `verify/route.ts` writes a live `subscription_plans` DB lookup; `webhook/route.ts` writes the actual Razorpay-captured amount. Same unique constraint, race determines which lands. Currently low real-world impact (production `payment_history` has only 5 rows total, ever) but the PATTERN is a genuine architectural risk that could bite at real transaction volume. See `04_FINDINGS_AND_CONFLICTS.md`. |
| Regression catalog self-reported count divergence | Orchestrator, 2026-08-23 | Low-Medium (process integrity, not a product defect) | `.claude/regression/00-header.md` itself states "404 entries upper bound / 399 honest... 346 (max 399)" as an unresolved, acknowledged divergence dated 2026-08-11. A launch-evidence program should not inherit an ambiguous regression count. |
| `CODEX_HANDOVER.md` mission with no located completion evidence | Orchestrator, 2026-08-23 | Unknown until adaptive/Foxy recon lands | The handover asked a second agent system to verify Foxy action-button wiring and adaptive-engine runtime connection. No standalone findings doc was found. Being independently re-verified by this program's ai-engineer recon rather than assumed done or assumed never-done. |
| Untracked large vendored dumps in working tree | Orchestrator, 2026-08-22 (graphify session) | Low (hygiene), but flagged to architect for a `.gitignore` decision | `flutter/` (vendored Flutter SDK, ~17.9k files) and `tools/pdf-content-ingestor/` (4,893 extracted PDF page images) sit untracked at repo root. Not a launch blocker but worth a deliberate include/exclude decision before any release branch is finalized. |
| `.gitignore` line-49 bare pattern bug | Orchestrator, 2026-08-22 | **Was Critical if unaddressed — FIXED same session** | Unanchored `Alfanumrik/` pattern matched `mobile/android/app/src/main/kotlin/com/alfanumrik/`, risking silent un-tracking of the Flutter Android package on next untrack/re-add cycle. Fixed to `/Alfanumrik/`; verified via `git check-ignore`. |

## Rule
No item in this file may be silently marked resolved without linking to the exact commit/PR/test that closed
it (see the Tier-1 rows above for the pattern to follow — every "DONE" links a commit or REG id).
