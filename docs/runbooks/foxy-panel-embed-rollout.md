# FoxyPanel Embed Rollout (U1 / U1b)

Owner: frontend (with ops as tracker custodian)
Reviewers: ai-engineer, testing, mobile
Wave: Phase 4 wave 4b (U1 done; U1b + per-question "Ask Foxy" tracked below)
Tracker record: `docs/trackers/foxy-north-star/tracker.json` — reqId `U1`
Reg pin: `.claude/regression/02-foxy-ai.md` REG-360 (static-import guard)

## 1. U1 status — DONE this wave

Slim FoxyPanel extracted to a reusable UI package with three embed points
live, all tap-gated + dynamic-imported so the panel's chat/streaming/markdown/
KaTeX chunk never appears in the host page's first-load JS.

### 1.1 Extracted module

Canonical location: `packages/ui/src/foxy-panel/`
- `FoxyPanel.tsx` — the panel shell (message list + input + send-message adapter)
- `MessageList.tsx`, `MessageInput.tsx` — leaf components
- `useFoxyChat.ts` — the single owned chat hook (also the shared source for /foxy)
- `foxy-types.ts`, `foxy-constants.ts` — types + constants

Old apps/host paths at `apps/host/src/app/foxy/_...` retained as 2-line
re-export stubs so /foxy's live page keeps working without a shape change.

### 1.2 Sanctioned launcher

Canonical location: `packages/ui/src/foxy-launcher/FoxyPanelLauncher.tsx`
- Provides the tap surface (button + panel container).
- Dynamic-imports the panel module via `next/dynamic({ ssr: false })` ONLY
  on tap, so no server render and no first-load cost.
- This is the ONLY sanctioned static entry-point from a host page.

### 1.3 Embed points

Three live embed points, all through `FoxyPanelLauncher`:
1. **Today / Dashboard** — `apps/host/src/app/dashboard/` (student route).
2. **Learn / [subject] / [chapter]** — `apps/host/src/app/learn/[subject]/[chapter]/`.
3. **Quiz results screen** — `packages/ui/src/quiz/QuizResults.tsx` (embed via
   the launcher; the `onAskFoxy` prop is already wired end-to-end for the
   per-question "Ask Foxy" follow-up).

### 1.4 Bundle budget — held

Baselines for the three embed pages measured this wave, all within tolerance
of the prior first-load JS gate. Snapshot (kB, first-load JS):
- Dashboard: 124.5 (unchanged)
- Learn (`/learn/[subject]/[chapter]`): 167.4 (unchanged)
- Quiz results: 177.0 (unchanged)

The panel chunk (~200+ kB combined chat + streaming + markdown + KaTeX)
is only fetched on tap, so `CAP_PAGE_KB` and `CAP_SHARED_KB` (see
`scripts/check-bundle-size.mjs`) are unaffected.

### 1.5 Static-import guard — REG-360

Test: `apps/host/src/__tests__/regressions/foxy-panel-no-static-embed.test.ts`
Behavior pinned: no `apps/host/src/app/**/page.tsx` may contain a static
import of `@alfanumrik/ui/foxy-panel/*`. The launcher path
(`@alfanumrik/ui/foxy-launcher/*`) is intentionally out of scope — that IS
the sanctioned static entry-point. The `/foxy` page itself imports the moved
primitives via the `apps/host/src/app/foxy/_...` re-export stubs; those
stubs are transitive and do not appear as a literal `@alfanumrik/ui/foxy-panel`
string in the page's own source, so the walk cleanly ignores them.

## 2. U1b — DEFERRED (follow-up wave)

Fold the standalone `/foxy` page's chat column onto `FoxyPanel` so there is
truly ONE panel implementation. Blocker: `FoxyPanel` currently accepts a
narrow `SendMessageHooks` prop surface; the /foxy page adds "save session /
report a bad answer / speak the reply (TTS)" affordances that need a wider
prop surface.

Required prop-surface design (out of scope for wave 4b — a design PR before
the code PR):
- `SendMessageHooks` widens with optional `onSaveSession`, `onReport`,
  `onSpeak` handlers (all optional; embed points omit them).
- `FoxyPanel` renders overflow actions only when the corresponding handler
  is provided, so embed points render the minimal surface today.
- `/foxy` page then reduces to a thin shell that mounts `FoxyPanel` with
  the full handler set.

Exit criterion: `/foxy` page's chat column code is DELETED; the only chat
UI in the tree is `packages/ui/src/foxy-panel/FoxyPanel.tsx`.

## 3. Per-question "Ask Foxy" — DEFERRED (follow-up)

Inside `QuizResults`, each question row gets an "Ask Foxy" affordance that
launches the panel pre-scoped to that question. The prop is already there:
`onAskFoxy: (question) => void` is wired from the quiz components all the
way through the launcher. What's missing is the panel-side handling: when
launched with a question payload, seed the first turn with a Foxy prompt
that references the specific question + student's answer.

Sequencing: land after U1b so the widened `FoxyPanel` prop surface is the
one entry point that also accepts the initial-turn seed.

## 4. Rollback

Static-import guard failure at CI is the primary tripwire. To unwind a
regression PR:
1. Revert the offending page.tsx change (restores the tap-gated dynamic path).
2. If the extracted module itself is at fault, revert to the last-good
   `packages/ui/src/foxy-panel/` commit — the 2-line re-export stubs at the
   old apps/host paths mean /foxy keeps working through the revert.
3. Re-run `apps/host/src/__tests__/regressions/foxy-panel-no-static-embed.test.ts`
   locally to confirm the tree is back to a green state before pushing.

## 5. Progress ledger

| Item | Status | Notes |
|---|---|---|
| Extraction to `packages/ui/src/foxy-panel/` | done | 6 modules moved |
| `FoxyPanelLauncher` sanctioned entry-point | done | `packages/ui/src/foxy-launcher/` |
| Dashboard embed | live | tap-gated |
| Learn / [subject] / [chapter] embed | live | tap-gated |
| Quiz results embed | live | tap-gated; `onAskFoxy` prop wired |
| Static-import guard test | live | REG-360 |
| U1b — fold /foxy chat column | not started | needs prop-surface design PR first |
| Per-question "Ask Foxy" panel-side handling | not started | sequence after U1b |
