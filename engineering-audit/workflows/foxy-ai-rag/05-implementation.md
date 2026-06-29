# Foxy AI Tutor & RAG — IMPLEMENTATION (Cycle 4)

Closes **FOX-1** (P12 output backstop on the live grounded path) and **FOX-2**
(P12 student-message injection heuristic). No model/provider change, no
system-prompt / CBSE-scope / grade-appropriateness change.

---

## New files

| File | Purpose |
|---|---|
| `src/lib/ai/validation/output-screen.ts` | TS deterministic output screen `screenStudentFacingText` (FOX-1). Word-boundary `HARD_BLOCK_PATTERNS`; reuses `validateOutput` as WARN-only telemetry; fail-safe → `safe:false`. |
| `src/lib/ai/validation/input-guard.ts` | TS `neutralizeInjectionAttempt` (FOX-2). Strips assistant-directed override phrases only; fail-open. |
| `supabase/functions/grounded-answer/output-screen.ts` | DENO TWIN of the output screen (FOX-1). Identical `HARD_BLOCK_PATTERNS`; used by the streaming Deno pipeline. |

---

## Changed files (exact loci)

### 1. `src/app/api/foxy/route.ts` — non-streaming canonical guard + FOX-2 input

**a. Imports** (after the quiz-oracle-prompts import, ~line 109):
```ts
+ import { screenStudentFacingText } from '@/lib/ai/validation/output-screen';
+ import { neutralizeInjectionAttempt } from '@/lib/ai/validation/input-guard';
```

**b. FOX-2 — neutralize the student message** (immediately after the grade
validation, ~line 574):
```ts
+ const injectionGuard = neutralizeInjectionAttempt(message);
+ const safeQuery = injectionGuard.text;
+ if (injectionGuard.neutralized) {
+   logger.warn('foxy.input.injection_neutralized', { subject, grade }); // P13: scope only
+ }
```
The original `message` is unchanged (still persisted + shown in the bubble).

**c. FOX-2 — use the neutralized query** (`groundedRequest`, ~line 1517):
```ts
- query: message,
+ query: safeQuery,
```
This is the single `query` field used by BOTH the blocking and streaming branches
(the same `groundedRequest` object is passed to `handleStreamingFoxyTurn`).

**d. FOX-1 — screen before persist/return** (right after `assistantContent` is
computed, ~line 2017, before the persistence block):
```ts
+ const outputScreen   = screenStudentFacingText(assistantContent, { grade, subject });
+ const rawAnswerScreen = screenStudentFacingText(grounded.answer,  { grade, subject });
+ if (!outputScreen.safe || !rawAnswerScreen.safe) {
+   // logger.warn('foxy.output.safety_blocked', { subject, grade, mode, categories, traceId }) — P13
+   // logAudit('foxy.chat.safety_blocked', { ...categories, traceId, flow }) — metadata only
+   await refundQuota(studentId, 'foxy_chat');
+   logFoxyAsk(0);
+   return NextResponse.json({
+     success: true, response: '', sessionId: resolvedSessionId,
+     quotaRemaining: <remaining + 1>, tokensUsed: 0,
+     groundingStatus: 'hard-abstain', abstainReason: 'upstream_error',
+     suggestedAlternatives: [], traceId: grounded.trace_id,
+   });
+ }
```
Screens BOTH the denormalized rendering (`assistantContent`, what gets persisted +
the structured-text equivalent) AND the raw `grounded.answer` (the legacy
string-only `response` field), so neither surface can carry unscreened text. The
return reuses the EXISTING hard-abstain envelope shape (`route.ts:1812-1822`).

### 2. `src/app/api/foxy/_lib/streaming.ts` — streaming Next-boundary guard

**a. Imports** (after `supabase-admin`):
```ts
+ import { logger } from '@/lib/logger';
+ import { screenStudentFacingText } from '@/lib/ai/validation/output-screen';
```

**b. Redaction flag** (with the other accumulators, before `persistOnDone`):
```ts
+ let safetyRedacted = false;
```

**c. Screen the buffered answer** (in `persistOnDone`, right after
`assistantContent` is computed):
```ts
+ const screen = screenStudentFacingText(assistantContent, { grade, subject });
+ if (!screen.safe) {
+   safetyRedacted = true;
+   // logger.warn('foxy.output.safety_blocked', { ...categories, flow: 'grounded-answer-stream' }) — P13
+   // logAudit('foxy.chat.safety_blocked', ...) — metadata only
+ }
+ const persistContent    = safetyRedacted ? '' : assistantContent;
+ const persistStructured = safetyRedacted ? null : (structured ?? null);
```

**d. Persist SAFE** (UPDATE branch + INSERT branch):
```ts
- content: assistantContent,           + content: persistContent,
- structured: structured ?? null,      + structured: persistStructured,
- sources: sourcesPayload,             + sources: safetyRedacted ? null : sourcesPayload,
```

**e. Don't derive anchors from blocked text** (pending-expectations gate):
```ts
- if (params.usePendingExpectations) {
+ if (params.usePendingExpectations && !safetyRedacted) {
```

**f. Don't double-audit**: the normal `foxy.chat` completion audit is wrapped in
`if (!safetyRedacted) { ... }`.

**g. Reconciliation frame + refund** (in `flush()`, `doneSeen` branch):
```ts
  await persistOnDone();
+ if (safetyRedacted) {
+   controller.enqueue(encoder.encode(
+     `event: abstain\ndata: ${JSON.stringify({ abstainReason: 'upstream_error', suggestedAlternatives: [], traceId: lastTraceId, latencyMs: 0 })}\n\n`));
+   await refundQuota(params.studentId, 'foxy_chat');
+ } else if (assistantMessageId) {
    // ... existing `persisted` frame ...
  }
```
The client's existing `onAbstain` handler (`useFoxyChat.ts:772`) clears the
streamed `content` → safe abstain UI. `upstream_error` is already in
`REFUND_ABSTAIN_REASONS` and already client-handled (no new type/contract).

### 3. `supabase/functions/grounded-answer/pipeline-stream.ts` — Deno source guard

**a. Import** (after the `trace.ts` import):
```ts
+ import { screenStudentFacingText } from './output-screen.ts';
```

**b. Screen before `done`** (right after `ctx.answerLength = accumulated.length;`,
before the structured parse + `yield { kind: 'done' }`):
```ts
+ const outScreen = screenStudentFacingText(accumulated);
+ if (!outScreen.safe) {
+   console.warn(`foxy(stream): output_safety_blocked categories=${outScreen.categories.join(',')}`);
+   yield { kind: 'abstain', abstainReason: 'upstream_error', suggestedAlternatives: [], traceId, latencyMs: Date.now() - startedAt };
+   return;
+ }
```
This yields `abstain` INSTEAD of `done`, so on a blocked turn no `done`/structured
frame is ever produced — the unsafe payload never reaches the Next layer or the
client.

---

## How EVERY student-facing path is now filtered

| Student-facing exit | Filter |
|---|---|
| Non-streaming `response` (raw `grounded.answer`) | `route.ts` `rawAnswerScreen` |
| Non-streaming `structured` + persisted `content` | `route.ts` `outputScreen` (denormalized) |
| Streaming live deltas + `done.structured` | Deno `pipeline-stream.ts` screen → `abstain` (no `done` emitted on block) |
| Streaming persisted record (session-resume GET, parent portal, analytics) | `streaming.ts persistOnDone` → SAFE empty record |
| Streaming live client reconciliation | synthesized `abstain` frame → `onAbstain` clears `content` |
| OpenAI fallback output (FOX-4 path) | covered — the screens act on the FINAL text regardless of which provider produced it |
| Quiz-me MCQ | already oracle-gated (REG-54); also passes through `outputScreen` (denormalized) |
| Hard-abstain / error paths | unchanged — already `response:''`, never raw text (FOX-8) |

## Streaming handling + residual (precise)
- **Stopped at source** (Deno): blocked turns become `abstain`, not `done` — no
  structured payload sent.
- **Guaranteed at boundary** (Next): persisted record is empty/safe; non-streamed
  consumers never see unsafe text; live client reconciled via `abstain` frame.
- **Residual**: the live browser may briefly show streamed text deltas before the
  `abstain` frame lands and clears them. Persisted + non-streamed surfaces are
  always safe. Low likelihood (CBSE-scoped, grounded, temp ≤ 0.3). Full live-view
  closure (frontend: `onAbstain` also clears `structured`; or a buffered-frame
  transform) is a flagged follow-up — it touches the REG-50-pinned
  verbatim-passthrough transform / the frontend, both out of this change's domain.

## P12 / P13 rationale
- **P12** ("no unfiltered LLM output to students"): every student-facing exit now
  passes a deterministic content backstop before render/persist; on failure the
  existing safe-abstain envelope is served. Fail-safe (screen throw → abstain).
- **P13**: all new logs/audits carry scope + stable category tags + traceId only;
  the screens are pure and never log their input. No name/email/phone/message
  text in any new line.
- **Not over-blocking**: word-boundary HARD_BLOCK set excludes curriculum-colliding
  substrings (ass/hell/sex/alcohol/weapon/retard); biology/chemistry/history/
  civics text passes. Documented threshold in `output-screen.ts` header +
  04-solution-design.md.

## Self-review
- `npm run type-check`: **PASS** (clean).
- No change to: Claude model id, provider order, `resolveModelOrder`,
  `FOXY_SAFETY_RAILS`, prompt templates, `selectFoxyPromptTemplate`,
  curriculum-scope behavior, temperature (0.3), quotas, kill switch, circuit
  breaker, REG-50 single-retrieval (still exactly one hop per turn).
- Existing validators reused: `validateOutput` (WARN-only telemetry inside the
  screen); existing hard-abstain envelope + `onAbstain` client handler + `abstain`
  SSE event reused for reconciliation; `refundQuota`/`REFUND_ABSTAIN_REASONS`
  reused.
- Deno twin parity: `HARD_BLOCK_PATTERNS` identical in both
  `src/lib/ai/validation/output-screen.ts` and
  `supabase/functions/grounded-answer/output-screen.ts` — keep in sync on edits.
- Known minor edge: a non-quiz-me turn that is blocked AFTER a quiz-me evidential
  `foxy_served_items` insert could orphan that row. In practice quiz-me MCQs are
  oracle-gated + grounded and the fallback is a safe canned response, so this
  is effectively unreachable; an orphaned served item is non-evidential and
  harmless (cannot move mastery, never shown). Left as-is.

## Cycle 4 refinements (FOX-1 CS-exempt, FOX-3 modes)

Two assessment-approved follow-ups applied after the initial Cycle 4 landing. No
model/provider change, no system-prompt / `FOXY_SAFETY_RAILS` / CBSE-scope change.

### FOX-1 — tighten injection-token patterns (CS curriculum exemption)
The two over-broad injection patterns were over-blocking legitimate grade 11-12
Computer Science answers that display literal markup as a pedagogical example.

| | Before | After |
|---|---|---|
| `<system>` XML tag | `/<\/?\s*system\s*>/i` (blocked bare `<system>`/`</system>`) | removed — bare tag now PASSES (CS example) |
| `[inst]` token | `/\[\/?\s*inst\s*\]/i` (blocked bare `[inst]`/`[/inst]`) | replaced by two LLaMA-paired patterns |
| LLaMA-paired `[INST]` | (n/a) | `/<\/?s>\s*\[\/?\s*inst\s*\]/i` + `/\[\/?\s*inst\s*\]\s*<\/?s>/i` |

Retained verbatim: `/<<\s*sys\s*>>/i` (covers the `<<SYS>>` block) and
`/<\|im_(?:start|end)\|>/i` (ChatML). Net result: real prompt-injection chat
templates (`<s>[INST]…[/INST]</s>`, `<<SYS>>…`, `<|im_start|>…`) are still caught;
a bare `<system>`-as-XML or `[inst]`-as-text in a CS/coding answer now passes.
Applied BYTE-IDENTICALLY in the HARD_BLOCK_PATTERNS regex literals of both
`src/lib/ai/validation/output-screen.ts` and
`supabase/functions/grounded-answer/output-screen.ts` (parity test
`output-screen-deno-parity.test.ts` still holds; 22 literals ≥ 20 floor). Module
headers updated in both twins.

### FOX-3 — widen `VALID_MODES` (UX/format reconciliation, not safety)
`src/app/api/foxy/_lib/constants.ts`: `VALID_MODES` widened from
`['learn','explain','practice','revise']` to add `'doubt'`, `'homework'`,
`'explorer'`. Previously the route coerced those down to `'learn'`
(`route.ts:506`), so the `doubt_v1` template branch was dead. After widening,
`selectFoxyPromptTemplate` (UNCHANGED, `route.ts:421-425`) yields the
assessment-approved mapping:

| mode | template |
|---|---|
| learn / explain | `foxy_tutor_teach_v1` |
| practice | `foxy_tutor_exam_v1` |
| revise | `foxy_tutor_teach_v1` |
| doubt / homework | `foxy_tutor_doubt_v1` (restored — was dead) |
| explorer | `foxy_tutor_teach_v1` (default) |

Safety unchanged: `FOXY_SAFETY_RAILS` (CBSE scope, age-appropriateness,
grounding) are injected on EVERY path independent of template; the templates
differ only in pedagogical FORMAT. No client-contract/type derives from this
array (it is used only for an `includes()` whitelist), so no type change needed.

### Follow-up for the testing agent
`output-screen.test.ts:33-34` pin the OLD behavior (bare `[INST]` / `</system>`
→ blocked) and must be updated to the new intent: bare `<system>`/`[inst]` PASS
(add a CS-example pass case), and a LLaMA-paired `<s>[INST]…[/INST]</s>` BLOCK
case should be added. These belong to the testing agent.

### FOX-6 (P13 prompt-assembly contract test) — LANDED
A prompt-assembly contract test asserts the composed Foxy system prompt + user
message carries only scope + UUID — **no studentName / email / phone**. Pure test
addition (no behavior change). `studentName` remains fetched ONLY to scrub it out
of cached synthesis text (`foxy-long-memory.ts`); no Claude-bound template var
carries it. This pins the FOX-6 watch item so a future edit that threads the name
into a prompt var fails CI.

### FOX-6 / output + input tests (testing) — LANDED
- output-screen: profanity / slur / self-harm / injection-token BLOCK; curriculum
  control set (class, mass, shell, "sexual reproduction", alcohol, weapon,
  retardation, "the ass" fable) PASS; fail-safe on throw; the CS-exemption cases
  (bare `<system>`/`[inst]` PASS; LLaMA-paired `<s>[INST]…[/INST]</s>` BLOCK).
- input-guard: override phrases neutralized; legit "ignore the negative root" /
  "what is a system?" preserved; fail-open.
- route.ts non-streaming: unsafe answer → hard-abstain envelope + refund + no
  persist of unsafe text + P13 telemetry shape.
- streaming.ts: unsafe buffered answer → empty persisted record + synthesized
  abstain frame + refund; safe answer → byte-identical to today.
- Deno pipeline-stream (Deno lane): unsafe accumulated → `abstain` not `done`.
- Deno parity: `output-screen-deno-parity.test.ts` holds (22 literals ≥ 20 floor).
- **Result:** 305/305 vitest + 3/3 Deno pass. Catalog → **REG-182** (live grounded
  path output content backstop — every student-facing exit screened; streaming
  persists safe; Deno emits abstain not done) + **REG-183** (student-message
  injection neutralization, fail-open). See `08-regression.md`.

---

## Final shipped state — gated / follow-up items (NOT implemented)

- **FOX-4 (MED, USER-GATED — provider governance):** OpenAI gpt-4o-mini/gpt-4o in
  `grounded-answer` operates as a **MoL SHADOW comparison (telemetry only)** on the
  live path — per the independent quality review the student-facing answer is
  **always the screened Claude output**; the OpenAI generation does **not** reach
  students today. The FOX-1 screens cover OpenAI output regardless, but the
  **presence** of a second provider is user-gated per the constitution. **CEO
  decision:** approve & govern the shadow usage, or remove it. No provider-chain
  code change in this cycle.

- **FOX-7 (NEW, MINOR follow-up — ai-engineer):** extend `screenStudentFacingText`
  to the legacy fallback persist path (`_lib/legacy-flow.ts` /
  `persistLegacyFoxyResponse`) for defense-in-depth consistency. Reachable only on
  `ff_grounded_ai_foxy`-OFF / grounded-abstain fallback; currently retains the
  OLDER substring `validateOutput` guard — **not an unfiltered hole**, a
  consistency upgrade. (Reuses the FOX-7 id; the gap-analysis FOX-7 word-cap no-op
  is informational/cost-only and remains a separate MoL-gated TODO.)

- **Streaming residual (MINOR, documented):** upstream text deltas reach the
  browser before the completion screen runs; persisted record + final frame +
  every non-streamed consumer are guaranteed safe; gated by `ff_foxy_streaming`.
  Optional full closure: short streamed-token lookback / first-paint delay, or
  frontend `onAbstain` also clears `structured` (frontend domain; REG-50-pinned
  transform).

- **Bilingual Hindi profanity-token coverage (MINOR, tracked):** the
  `HARD_BLOCK_PATTERNS` set is English-token-oriented. Bounded — the screen acts on
  model OUTPUT (CBSE-scoped, grounded), not student input. Hindi/Devanagari
  profanity-token pass tracked as a follow-up.
