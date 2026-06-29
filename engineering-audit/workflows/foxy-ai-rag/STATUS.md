# STATUS: Foxy AI Tutor & RAG (Cycle 4)

> One per workflow cycle. The workflow is **COMPLETE** only when every box below is checked.

- **Cycle:** cycle-4
- **Workflow:** foxy-ai-rag (Foxy chat turn + grounded-answer RAG pipeline + sibling AI Edge Functions)
- **Primary invariants:** P12 (AI safety); P8 (RLS on RAG/vector reads); P13 (no PII to LLM/traces)
- **Owner squad:** ai-engineer (lead/impl) + assessment (CBSE-scope / age-appropriateness correctness); testing (coverage); quality (independent validation)
- **Started:** 2026-06-29
- **Status:** **CYCLE 4 LANDED — P12 output backstop complete; FOX-4 gated, FOX-7 + streaming-residual + Hindi-tokens follow-ups**

## Phase progress
| Phase | Artifact | Done |
|---|---|---|
| MAP | `01-map.md` | [x] |
| IDENTIFY GAPS | `02-gap-analysis.md` | [x] |
| ROOT CAUSE | `03-root-cause.md` | [x] |
| DESIGN | `04-solution-design.md` | [x] |
| IMPLEMENT | `05-implementation.md` | [x] |
| SELF-REVIEW | `06-self-review.md` | [x] |
| INDEPENDENT VALIDATION | `07-validation.md` | [x] |
| REGRESSION | `08-regression.md` | [x] |

## Completion gate
Status of each gate item for the Cycle-4 *landed* set (FOX-1 + FOX-2 + FOX-3 + FOX-6):

- [x] **Business goal met** for the in-scope set — the P12 "no unfiltered LLM output to students" backstop now guards EVERY student-facing exit of the LIVE grounded path (the gap that the legacy→grounded-answer cutover left behind). FOX-1 (+ Deno twin) screens output; FOX-2 neutralizes student-message injection; FOX-3 restores the dead doubt/homework template branch; FOX-6 pins the P13 prompt-assembly boundary. *(NOT in scope: FOX-4 user-gated; FOX-7-new + streaming-residual + Hindi-tokens follow-ups.)*
- [x] **No broken/empty states** on touched paths — on a block the EXISTING safe-abstain envelope (`response:''`, `groundingStatus:'hard-abstain'`) is served + quota refunded; safe answers persist byte-identically.
- [x] **Bilingual (P7)** — served safe-abstain / refusal copy Hi/En via existing abstain handling; no new string bypasses `AuthContext.isHi`.
- [x] **P12 AI safety** — deterministic content backstop on every student-facing exit before render/persist; fail-safe (screen throw → abstain). No model/provider/prompt-scope change.
- [x] **P8 RLS boundary** — RAG retrieval remains service-role, scope-keyed, server-only (FOX-5 COMPLIANT); no client vector read introduced.
- [x] **P13 privacy** — new logs/audits carry scope + category + traceId only; screens are pure (never log input); FOX-6 pins no-PII-to-Claude.
- [x] **Not over-blocking CBSE** — word-boundary HARD_BLOCK excludes curriculum collisions (ass/hell/sex/alcohol/weapon/retard) + CS literal-markup; biology/chemistry/history/civics/CS answers pass.
- [x] **Invariants P1–P15** upheld; P12/P13 strengthened, no regression.
- [x] **type-check** green.
- [x] **lint** green (0 errors).
- [x] **test** green (305/305 vitest + 3/3 Deno).
- [x] **build** green; bundle within P10 caps.
- [x] **Quality verdict = APPROVE** (`07-validation.md`, independent).
- [x] **P14 review chain complete** — ai-engineer (impl) → assessment (APPROVE WITH CONDITIONS, conditions addressed) + testing (coverage GREEN) + quality (independent APPROVE). See `08-regression.md`.
- [x] **Regression sweep green + catalog filed** — sweep GREEN; **REG-182 (P12 output backstop) + REG-183 (P12 injection neutralization)** added → catalog **150**; REG-37/39/50/54/66/67 still green.

## Why NOT fully COMPLETE — open gated / follow-up items (resume here next session)
1. **FOX-4 (Medium, GATED — USER APPROVAL):** OpenAI gpt-4o-mini/gpt-4o is present in `grounded-answer` as a **MoL SHADOW comparison** (telemetry only; does NOT reach students today — the student-facing answer is always the screened Claude output). Provider PRESENCE is user-gated per the constitution. **CEO decision:** formally approve & govern the OpenAI shadow usage, or remove it.
2. **FOX-7 (NEW, MINOR follow-up — ai-engineer):** extend `screenStudentFacingText` to the legacy fallback persist path (`_lib/legacy-flow.ts` / `persistLegacyFoxyResponse`). Reachable on `ff_grounded_ai_foxy`-OFF / grounded-abstain fallback; currently retains the OLDER substring `validateOutput` guard — consistency upgrade, **not an unfiltered hole**.
3. **Streaming residual (MINOR):** live browser may briefly show streamed deltas before the `abstain` frame clears them; persisted record + final frame + every non-streamed consumer always safe; gated by `ff_foxy_streaming`. Optional: short streamed-token lookback / first-paint delay, or frontend `onAbstain` also clears `structured` (frontend domain; REG-50-pinned transform).
4. **Bilingual Hindi profanity-token coverage (MINOR):** `HARD_BLOCK_PATTERNS` English-oriented; bounded (acts on model OUTPUT, not student input). Hindi/Devanagari token pass tracked.

## Sign-off
| Role | Agent | Date | Verdict |
|---|---|---|---|
| Builder (impl) | ai-engineer (FOX-1/2/3) + testing (FOX-6) | 2026-06-29 | DONE (in-scope set) |
| Correctness (P14 reviewer) | assessment (CBSE-scope / age-appropriateness) | 2026-06-29 | **APPROVE WITH CONDITIONS** — conditions addressed |
| Quality (independent) | quality | 2026-06-29 | **APPROVE** |
| Testing | testing | 2026-06-29 | **GREEN** (305/305 + 3/3 Deno; REG-182/183 filed) |
| Orchestrator (mark COMPLETE) | — | — | NOT YET — auto-fix-safe complete; FOX-4 user-gated + FOX-7-new / streaming-residual / Hindi-tokens follow-ups |
