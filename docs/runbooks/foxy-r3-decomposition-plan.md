# Foxy R3 — Pipeline Decomposition Plan

Owner: ai-engineer (with ops as tracker+analyzer custodian)
Reviewers: assessment, backend, testing
Wave: Phase 4 (deferred from wave 4b per ai-engineer scoping call)
Tracker record: `docs/trackers/foxy-north-star/tracker.json` — reqId `R3`
Spec: `docs/superpowers/specs/2026-08-05-foxy-north-star-alignment-design.md` §7 (R3 mapping table)
Sibling reg pin: `.claude/regression/02-foxy-ai.md` REG-359 (characterization fixtures)

R3 was correctly deferred by ai-engineer during Phase 4 wave 4b: the
scaffolding, characterization harness, and out-of-router changes it depends on
(L3/L4 configs, assignments L1 module, decide-ladder/director-prompt/close-stage
flag seeds) have landed, but the actual `handleFoxyPost` -> stage-module split
is a multi-PR wave in its own right. This runbook is the sequenced plan.

## 1. Current state (verified 2026-08-05 in the working tree)

| Item | Status | Evidence |
|---|---|---|
| Characterization fixtures seeded | 11 of 16 | `apps/host/src/__tests__/fixtures/foxy-golden-turns/001-011*.json` — the harness `apps/host/src/__tests__/api/foxy/foxy-route-characterization.test.ts` (REG-359) declares every turn it pins and marks the remaining 5 `pending:true` with the reason each one needs. |
| Pipeline scaffolding | Live but not wired | `apps/host/src/app/api/foxy/_pipeline/` — `compose.ts` (runner: timing ledger + terminal short-circuit + publish-once at close, never-throws-from-instrumentation), `types.ts`, plus 8 empty stage stubs: `observe.ts`, `gate.ts`, `diagnose.ts`, `decide.ts`, `teach.ts`, `check.ts`, `update.ts`, `close.ts`. Every stub is a no-op `return { kind: 'continue' }` with the R3 note in its header. |
| L3 assessment config (7-tier decide ladder incl. safety hold + assigned work) | Built, flag OFF | Feature flag `ff_foxy_decide_ladder_v1` seeded OFF/0% (`supabase/migrations/20260811000000_seed_ff_foxy_decide_ladder_v1.sql`). |
| L4 director prompt config | Built, flag OFF | Feature flag `ff_foxy_director_prompt_v1` seeded OFF/0% (`supabase/migrations/20260811000002_seed_ff_foxy_director_prompt_v1.sql`); teaching-director config at `apps/host/src/app/api/foxy/_lib/teaching-director-config.ts`. |
| L7 close-stage flag | Seeded OFF | `supabase/migrations/20260811000003_seed_ff_foxy_close_stage_v1.sql`. |
| L1 assignments reader | Live module (facade + read) | `apps/host/src/app/api/foxy/_lib/assignments.ts` + supporting index migration (see spec §4.3). |
| Group B router consolidation | Done | Single Foxy route on `/api/foxy` per plan §7 R3 sub-goal. |

## 2. Sequenced sub-waves

R3 is split into three PR-sized waves. Each wave is self-contained and can
merge independently; the characterization suite (REG-359) is the tripwire
between waves.

### R3-A — Seed the remaining 5 characterization fixtures

Prerequisite for R3-B. Extends the harness to cover the branches marked
`pending:true` in `foxy-route-characterization.test.ts`.

Fixtures to seed:
1. **math-solve mock turn** — enters the math pipeline branch (dense-format,
   flag-ON path pinned; also captures flag-OFF byte-identity in the flag sweep).
2. **curriculum-scope T3 rejection** — the `ff_foxy_curriculum_guard_v1` T3
   ("off-scope, no similar chapters") terminal. Confirms refund + wire shape
   + `dbOps` order for scope-terminal turns.
3. **safeguarding two-tier chain** — Tier-1 regex hit -> Tier-2 classifier
   confirm -> Childline envelope. Pins REG-348's fail-closed contract
   through the characterization lens (independent replay of the safeguarding
   route surface, not just the module).
4. **`foxy_messages` roster turn** — a resume-conversation turn where the
   prior-session context loader hydrates the message roster. Pins the
   `messages_snapshot` shape + insert ordering.
5. **`chapter_concepts` snapshot turn** — a first-turn-in-chapter turn that
   writes the initial `chapter_concepts` snapshot. Pins the write happening
   exactly once and NOT again on the immediate follow-up turn.

Exit criterion for R3-A: `pending` count in the harness drops to zero;
`FIXTURE_UPDATE=1` re-emits identical bytes on a rerun.

### R3-B — Extract `handleFoxyPost` sections into the 8 stage modules

Byte-identical extraction. Each stage moves in its own PR, in the order of
the pipeline, following the section-to-stage mapping in spec §7. The
characterization suite MUST be re-run after each extraction PR — a red
result means the extraction was NOT byte-identical, and the PR is blocked.

Order:
1. `observe` — quota check, safeguarding pre-scan, prior-session context.
2. `gate` — kill-switch, grade-spoof, quota-429 terminal producers.
3. `diagnose` — L2 "one short question first" director step (already served
   via `foxy_served_items` per L2 spec).
4. `decide` — the 7-tier planner (behind `ff_foxy_decide_ladder_v1` OFF).
5. `teach` — director-driven teach/hint/explain (behind
   `ff_foxy_director_prompt_v1` OFF).
6. `check` — hint-ladder + oracle gate (already REG-355 pinned, unchanged).
7. `update` — canonical evidence RPC dispatch (REG-352/L6 territory).
8. `close` — L7 close payload (behind `ff_foxy_close_stage_v1` OFF, additive).

The stage stubs already carry the R3 note in their headers reminding future
edits that the runner is not wired yet.

### R3-C — Wire `runPipeline` into route.ts

Single PR. Shrinks `handleFoxyPost` to `return runPipeline(ctx, stages)` where
`stages` is the ordered list from R3-B. After this PR the route file is a
thin composition root — every branch of behavior lives in a stage module.

Exit criterion for R3-C:
- REG-359 characterization suite still deep-equals every fixture (all 16).
- All 20 flag-OFF sweeps in the harness still deep-equal the baseline
  cold-start fixture (byte-for-byte OFF-identity contract preserved).
- Per-stage timings from `compose.ts`'s ledger emit through
  `logSystemMetric` on both terminal and continue paths (R6 observability).

## 3. Rollback

No runtime dual-path flag. This is a **git-revert rollback** by design (per
the approved Phase 4 R3 design report): keeping two live handlers in the
route in parallel would double the maintenance surface and defeat the whole
point of the extraction. Each of R3-A, R3-B (per-stage), and R3-C is a
single-commit PR sized for `git revert` to restore the pre-PR route byte
identity if the characterization suite fails post-deploy.

## 4. Risk register

Two failure modes to specifically watch. Both trip the characterization
suite, which is why REG-359 is the R3 tripwire.

1. **Silent flag-hoist leak into extracted stage** — an extracted stage
   reads a flag that used to be read once at the top of `handleFoxyPost`
   and cached for the turn. If the extraction re-reads the flag from the
   stage, per-user rollout-bucket read counts diverge from the pre-R3
   baseline (each call to `isFeatureEnabled` is one bucket read; some
   percentage-rollout implementations sample per read). Mitigation: the
   `TurnContext` type already carries `flags: Record<string, boolean>`
   populated in `observe`; every downstream stage MUST read from
   `ctx.flags`, never call `isFeatureEnabled` directly. Enforced by
   grepping the extracted stage files for `isFeatureEnabled(` in the R3-B
   PRs — any hit outside `observe` fails review.

2. **Response envelope reshape breaks mobile contract** — the Flutter app
   parses `wireJson` by top-level key order in some code paths (the
   `_sendViaEdge` dead-code branch documented in root `CLAUDE.md`, plus
   the live `/api/foxy` consumer whose key expectations are pinned by
   REG-359's `wireJsonKeyOrder` assertion). Any reordering of the
   `NextResponse.json({ ... })` builder in a stage extraction breaks the
   characterization suite AND the mobile parser. Mitigation: `close.ts`
   is the only stage authorized to build the terminal response; all other
   stages return `{ kind: 'terminal', response }` only via helpers that
   reuse the existing builders. Enforced by REG-359's key-order pins.

## 5. Related tracker records

- `S1.3` (planner-tier extension) and `L3` (decide-ladder) tier-pin tests
  live outside R3 and can graduate to `verified` independently — R3 only
  moves the code that CALLS them.
- `L4` (teach) and `L2` (diagnose) director-config work is done; the R3-B
  extraction merely re-homes the section that reads that config.
- `L7` (close) payload work is R3-B/C.
- `R6` (observability) per-stage timing metrics graduate to `verified`
  after R3-C merges (compose.ts's ledger writes them on every turn).

## 6. Progress ledger

| Sub-wave | Status | PR | Notes |
|---|---|---|---|
| R3-A | not started | — | seeds 5 pending fixtures |
| R3-B | not started | — | 8 sequential PRs, one per stage |
| R3-C | not started | — | wire runPipeline + shrink route.ts |

Update this table when each sub-wave lands. R3 tracker record moves from
`in_progress` -> `tested` after R3-C's characterization gate is green, then
orchestrator bumps to `verified` after quality signoff.
