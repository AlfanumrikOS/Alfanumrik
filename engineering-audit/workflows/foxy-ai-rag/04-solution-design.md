# Foxy AI Tutor & RAG — SOLUTION DESIGN (Cycle 4)

Scope of THIS change: **FOX-1** (HIGH, P12 — deterministic output backstop on the
live grounded path) and **FOX-2** (MED, P12 — student-message injection
heuristic). FOX-3 (assessment review) and FOX-4 (user-gated provider) are
explicitly OUT of scope and re-flagged at the bottom.

Hard constraints honored: **no model/provider change** (FOX-4 untouched), **no
system-prompt / CBSE-scope / grade-appropriateness change**, **existing
validators reused**, **must not over-block legitimate CBSE curriculum**,
**fail-safe**, **P13 (no PII/message text in any new log/trace)**.

---

## FOX-1 — deterministic output content backstop

### Problem (recap)
The live grounded path has no deterministic profanity/age-appropriateness output
filter. `validateOutput`/`validateContentScope` are wired only into the
`ff_grounded_ai_foxy`-OFF legacy flow. Two live student-facing surfaces are
unguarded:
1. Non-streaming structured path (`route.ts`, post-`extractValidatedStructured`).
2. Streaming path (`_lib/streaming.ts` + the Deno `pipeline-stream.ts`), which
   emits raw Claude deltas.

### Why we did NOT block on `validateOutput` directly
`validateOutput`'s `BLOCKLIST` matches **bare substrings** (`lower.includes('ass')`,
`'hell'`, `'sex'`, `'alcohol'`, `'weapon'`...). On a CBSE grade 6-12 tutor those
collide with core curriculum vocabulary:

| Blocklist token | Collides with (legitimate CBSE) |
|---|---|
| `ass` | cl**ass**, m**ass**, p**ass**age, **ass**ess, "the **ass**" (donkey — NCERT fables) |
| `hell` | s**hell** (electron shell — chemistry), **hell**o |
| `sex` | **sex**ual reproduction (Gr 8 Biology), the **sex** of offspring |
| `alcohol` | Class 10/12 chemistry |
| `weapon`/`murder`/`drug` | History / Civics / Political Science |

Using its pass/fail (or its `***` sanitizer, which rewrites `class` → `cl***`) as
the blocking decision would over-block real lessons — a direct violation of the
P12 requirement that legitimate curriculum MUST pass.

### Design — a conservative, word-boundary screen that REUSES the validator
New module `src/lib/ai/validation/output-screen.ts` exporting
`screenStudentFacingText(text, ctx) → { safe, categories }`:

- **Blocking decision** = a high-precision, **word-boundary-anchored**
  `HARD_BLOCK_PATTERNS` set: unambiguous profanity, slurs, **directed** self-harm
  incitement, and chat/template-injection tokens. These are tokens that are
  **never** part of legitimate CBSE 6-12 content. (`retard` is deliberately
  EXCLUDED — collides with physics "retardation".)
- **Reuse**: `validateOutput` is still **called** as a **WARN-only telemetry
  signal** (`legacy_validator_flag`) so its logic continues to run on the live
  path (observability parity with the legacy flow) — but it never makes the
  block decision.
- **Threshold documented** (does NOT loosen safety): borderline
  curriculum-legitimate terms (sex, alcohol, weapon, drug, clinical "suicide")
  are intentionally NOT hard-blocked; they remain governed by `FOXY_SAFETY_RAILS`
  + grade/subject scope + grounding.
- **Fail-safe**: if the screen throws, returns `safe:false` → caller serves the
  safe-abstain envelope (never unscreened text).

A **Deno twin** `supabase/functions/grounded-answer/output-screen.ts` mirrors the
identical `HARD_BLOCK_PATTERNS` set (the Next-TS and Deno-TS module graphs cannot
share a file). Keep the two lists byte-for-byte in sync.

### Wiring (every student-facing path now guarded)

| Path | Guard locus | On unsafe |
|---|---|---|
| Non-streaming (canonical) | `route.ts` — screens BOTH the denormalized `assistantContent` AND the raw `grounded.answer` before persist/return | returns the EXISTING hard-abstain envelope (`response:''`, `groundingStatus:'hard-abstain'`, `abstainReason:'upstream_error'`), refunds quota, category-only telemetry + audit |
| Streaming — Deno source | `pipeline-stream.ts` — screens the COMPLETE `accumulated` text before yielding `done` | yields `abstain` INSTEAD of `done` so the unsafe `done`/structured frame NEVER reaches the client |
| Streaming — Next boundary | `_lib/streaming.ts persistOnDone()` — screens the COMPLETE buffered `assistantContent` before commit | persists a SAFE (empty) record + flush() emits a synthesized `abstain` frame + refunds quota (canonical backstop if the Deno fn is an older deployment) |

The non-streaming `route.ts` screen and the streaming `streaming.ts` screen are
the **canonical** guards (they hold regardless of Deno deployment version,
exactly like the existing structured-validation defense-in-depth). The Deno
streaming screen is the **strongest** guard (stops the unsafe frame at the
source).

### Streaming — the hard part, and what we did
True mid-stream blocking is **infeasible**: `streaming.ts` re-emits every upstream
chunk verbatim to the browser as it arrives (low-latency contract, REG-50 pin),
so by the time the full text is known the deltas are already on the wire.

We therefore took the task-sanctioned **minimum-bar-plus** approach:
1. **Deno source (best):** screen the full `accumulated` text before `done` is
   yielded → emit `abstain` instead. The unsafe structured/`done` frame is never
   produced. The client's existing `onAbstain` handler clears the streamed
   `content`.
2. **Next boundary (guarantee):** screen the buffered answer at `persistOnDone`;
   **persist a SAFE empty record** (so session-resume GET, parent portal,
   analytics — every non-streamed consumer — are guaranteed safe) and emit a
   synthesized `abstain` frame for live-client reconciliation.
3. Telemetry on both.

#### Residual (documented)
On the streaming path, if an unsafe answer is generated, the **live browser may
briefly display the streamed text deltas** before the `abstain` frame lands and
the client clears them. Additionally, the renderer chooses structured rendering
without checking `groundingStatus` and can recover structured from `content`
(`MessageList.tsx:140-146`); the Deno-source guard (emitting `abstain` instead of
`done`) means **no `structured` payload is sent on a blocked turn**, so the
recover-from-`content`/clear-`content` path on `onAbstain` reconciles the live
view. The **persisted record and all non-streamed consumers are always safe**.
Likelihood is very low (Claude on a CBSE-scoped, grounded, temperature ≤ 0.3
prompt). A frontend follow-up (have `onAbstain` also clear `structured`) and/or a
buffered-frame transform would fully close the live-view residual — flagged, not
done here (frontend domain; would touch the REG-50-pinned verbatim-passthrough
transform).

### Alternatives rejected
- **Block on `validateOutput` as-is** — rejected: substring matching over-blocks
  core curriculum (table above). Violates the "must not over-block" constraint.
- **Use `validateOutput`'s `***` sanitizer to rewrite tokens in place** —
  rejected: rewrites `class`→`cl***`, mangles legitimate answers.
- **Modify `output-guard.ts` to use word boundaries** — rejected: it has other
  (legacy) callers; changing shared behavior is out of scope and risky. We add a
  new, purpose-built screen and leave the legacy validator untouched.
- **True mid-stream token blocking** — rejected: requires buffering the whole
  stream server-side (defeats streaming UX) or rewriting the REG-50-pinned
  verbatim-passthrough transform. Out of proportion to a low-likelihood event;
  the task explicitly sanctioned the persist-time-validation minimum.
- **New dedicated `AbstainReason` (e.g. `safety_blocked`)** — rejected for now:
  would touch the Deno `types.ts` union, the Next `grounded-client.ts` union, and
  the `REFUND_ABSTAIN_REASONS`/`LEGACY_FALLBACK_ABSTAIN_REASONS` lists + the
  frontend. We reuse `upstream_error` (already refund-eligible, already
  client-handled) on the wire and log the TRUE reason (`safety_blocked` +
  categories) in telemetry/audit. A typed reason is a clean follow-up.

---

## FOX-2 — student-message injection heuristic

New module `src/lib/ai/validation/input-guard.ts` exporting
`neutralizeInjectionAttempt(message) → { text, neutralized }`:

- Strips only **assistant-directed override phrases** — each pattern REQUIRES an
  explicit reference to the assistant's instructions/prompt/rules/persona
  ("ignore your previous instructions", "reveal your system prompt", "you are now
  a ...", chat role tokens). Bare "ignore"/"forget"/"system" in ordinary
  questions ("ignore the negative root", "what is a system?") are preserved.
- **Fail-open** on the input side (a heuristic miss must not break a turn; the
  FOX-1 output screen is the hard backstop regardless of input).
- Wired in `route.ts` right after input validation: the ORIGINAL `message` is
  still persisted + shown in the student's bubble; the **neutralized `safeQuery`**
  is what is sent to the model (`groundedRequest.query`). One P13-safe telemetry
  line (`foxy.input.injection_neutralized`, scope only) when it fires.

We did NOT reuse `src/lib/sanitize.ts:sanitizeText` — it strips `(){}` and would
mangle math like `f(x)`/`{set}`. The new guard is surgical.

---

## P13 posture (new log/trace lines)
Every new log/audit added carries **subject/grade/mode/categories/traceId only** —
never the student message, the answer text, name, email, or phone. The screens
are pure functions; they do not log their input.

## Risk / rollback
- **Over-block risk**: bounded by the conservative word-boundary set + the
  curriculum-collision analysis; legitimate biology/chemistry/history/civics text
  passes. If a false-positive is ever observed, narrow a single pattern (the set
  is data, not logic).
- **Rollback**: the screens are additive and self-contained. Reverting is
  deleting the two `output-screen.ts` files + `input-guard.ts` and their call
  sites; no schema, no flag, no contract change. (No feature flag was added —
  this is a P12 safety backstop that should not be operator-disable-able; the
  existing `ff_grounded_ai_enabled` kill switch still disables the whole path.)
- **No model/provider/prompt/scope change** — confirmed.

## Re-flagged (NOT in this change)
- **FOX-4 (REQUIRES USER APPROVAL — provider governance):** OpenAI
  gpt-4o-mini/gpt-4o is present in `grounded-answer` (`claude.ts:resolveModelOrder`).
  **Clarification after independent quality review:** on the live student-facing
  path it operates as a **MoL SHADOW comparison (telemetry only)** — the
  student-facing answer is **always the screened Claude output**; the OpenAI
  generation does **not** reach students. The FOX-1 screens would cover OpenAI
  output anyway (they act on the FINAL text regardless of provider), but per the
  constitution the **presence** of a second provider is itself user-gated. The
  CEO decision is: formally approve & govern the OpenAI shadow usage, or remove
  it. No code change to the provider chain here.
- **FOX-3 (assessment review):** RESOLVED in-cycle — see 05 "Cycle 4 refinements."
  Assessment approved widening `VALID_MODES` (doubt/homework/explorer) with the
  safety rails template-independent; no scope relaxed.

## Final shipped state — additions confirmed at landing

- **FOX-6 (P13) — LANDED:** a prompt-assembly contract test asserts the composed
  Foxy system prompt + user message carries only scope + UUID (no studentName /
  email / phone). Pure test addition; no behavior change. (The studentName remains
  fetched ONLY to scrub it out of cached synthesis text per `foxy-long-memory.ts`.)

- **FOX-7 (NEW post-implementation follow-up — ai-engineer, MINOR) — NOT done:**
  extend `screenStudentFacingText` to the **legacy fallback persist path**
  (`_lib/legacy-flow.ts` / `persistLegacyFoxyResponse`) for defense-in-depth
  consistency. That path is reachable only on `ff_grounded_ai_foxy`-OFF /
  grounded-abstain fallback and currently retains the OLDER substring
  `validateOutput` guard — **not an unfiltered hole**, a consistency upgrade so
  the same word-boundary screen guards every persist site. Tracked, not blocking.
  > Disambiguation: this reuses the FOX-7 id. The gap-analysis FOX-7
  > (`applyFoxyWordCap` no-op) is informational/cost-only (not P12) and remains an
  > intentional MoL-gated TODO; the NEW FOX-7 above is the screening-consistency
  > follow-up surfaced during implementation.

- **Streaming residual (MINOR, documented):** upstream text deltas reach the
  browser before the completion screen runs; the persisted record, the final
  frame, and all non-streamed consumers are guaranteed safe; gated by
  `ff_foxy_streaming`. Optional full-closure: a short streamed-token lookback /
  first-paint delay, or have the frontend `onAbstain` also clear `structured`
  (frontend domain; touches the REG-50-pinned verbatim-passthrough transform).

- **Bilingual Hindi profanity-token coverage (MINOR, tracked):** the
  `HARD_BLOCK_PATTERNS` set is English-token-oriented. Bounded risk — the screen
  acts on model OUTPUT (CBSE-scoped, grounded) not student input. A Hindi/Devanagari
  profanity-token pass is tracked as a follow-up.
