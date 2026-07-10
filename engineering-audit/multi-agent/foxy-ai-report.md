# Agent E - Foxy AI Tutor and Safety Report

Status: Stage 1 read-heavy reconnaissance complete
Date: 2026-07-10
Scope: No code changes implemented. This report is the only file written.

## 1. Scope inspected

- Active Foxy Next route: `/api/foxy`, including auth, subject governance, quota, session continuity, blocking grounded-answer path, streaming path, legacy fallback, persistence, audit logging, and GET history read.
- Shared grounded-answer Edge Function: request admission, security policy, internal-caller signing path, quota reservation/settlement, circuit updates, blocking and streaming pipelines, output screening, trace/audit behavior.
- Streaming safety: first-paint/backstop behavior in Next `handleStreamingFoxyTurn`, Edge `pipeline-stream`, client SSE handling, JSON fallback hard-abstain behavior, and readiness manifest coverage.
- Unsafe-output screening: Node `screenStudentFacingText`, Deno twin, Deno parity tests, Hindi/Hinglish abusive-token coverage, and curriculum false-positive guardrails.
- RAG readiness manifest and RCA-13 trail.
- UI action wiring: Explain simpler, Show example, Quiz me, Save to notebook, Report an issue, legacy save/report paths, and "Git it" references.
- Persistence and observability: `foxy_chat_messages`, `foxy_sessions`, `student_bookmarks`, `ai_issue_reports`, `foxy_message_feedback`, audit logs, grounding traces, safety-block logs, and readiness test artifacts.

## 2. Files inspected

- `apps/host/src/app/api/foxy/route.ts` - active route responsibilities, blocking grounded path, output screen, persistence, audit, quiz gating, session GET.
- `apps/host/src/app/api/foxy/_lib/streaming.ts` - SSE transform, first-paint buffering, stream quota refunds, persisted-message event, streaming persistence.
- `apps/host/src/app/api/foxy/_lib/legacy-flow.ts` - `ff_grounded_ai_foxy` kill-switch and grounded-service fallback path.
- `apps/host/src/app/api/foxy/_lib/quota.ts`, `_lib/session.ts`, `_lib/responders.ts`, `_lib/constants.ts` - quota/session/persistence support.
- `packages/lib/src/ai/grounded-client.ts` - only allowed Next caller to `grounded-answer`, internal caller signing, hop timeout, upstream-error collapse, streaming helper.
- `supabase/functions/grounded-answer/index.ts`, `pipeline.ts`, `pipeline-stream.ts`, `output-screen.ts`, `validators.ts`, `trace.ts`, `coverage.ts`, `circuit.ts`.
- `packages/lib/src/ai/validation/output-screen.ts` and `supabase/functions/grounded-answer/output-screen.ts`.
- `packages/lib/src/ai/prompts/foxy-system.ts` and grounded-answer Foxy prompt files.
- `apps/host/src/app/foxy/page.tsx`, `_hooks/useFoxyChat.ts`, `_components/MessageList.tsx`, `_components/ReportDialog.tsx`.
- `packages/ui/src/foxy/ChatBubble.tsx`, `ReportIssueModal`, `HardAbstainCard`, `UnverifiedBanner`.
- `apps/host/src/app/api/foxy/learning-action/route.ts`, `feedback/route.ts`, `quiz-answer/route.ts`, `apps/host/src/app/api/support/ai-issue/route.ts`, `apps/host/src/app/api/student/foxy-interaction/route.ts`.
- Tests and manifests: `scripts/foxy-rag-readiness.json`, `apps/host/src/__tests__/foxy-rag-readiness.test.ts`, `apps/host/src/__tests__/api/foxy/output-safety-backstop.test.ts`, `streaming-structured-persistence.test.ts`, `foxy-streaming.test.ts`, `foxy-streaming-json-fallback-abstain.test.ts`, output-screen tests, Deno parity tests, learning-action tests.
- Context docs: `engineering-audit/CODEX_HANDOVER.md`, `engineering-audit/PRODUCT_READINESS_EXECUTION_2026-07-09.md`, `engineering-audit/PRIORITY-BACKLOG.md`.

## 3. Confirmed findings

1. The active Foxy path is `/api/foxy`, not a direct student-facing Edge Function. The route explicitly owns RBAC, subject governance, daily quota, session continuity, cognitive context, persistence, audit logs, and upgrade prompts; Voyage/RAG/Claude/circuit logic is delegated to `grounded-answer`. Evidence: `apps/host/src/app/api/foxy/route.ts:1-24`.

2. Grounded-answer calls are centralized and signed. `packages/lib/src/ai/grounded-client.ts` states it is the only allowed Next.js direct caller to `/functions/v1/grounded-answer`, builds internal caller headers, collapses transport/config/HTTP errors into `upstream_error`, and returns clean abstain shapes instead of throwing. Evidence: `packages/lib/src/ai/grounded-client.ts:14-18`, `:201-230`, `:249-268`, `:320-337`.

3. Blocking grounded responses have a strong final output backstop before persistence or return. The route screens both denormalized structured output and raw legacy `answer`; unsafe output returns `hard-abstain`, refunds quota, records category-only telemetry/audit, and does not persist the unsafe answer. Evidence: `apps/host/src/app/api/foxy/route.ts:2026-2078`, `:2089-2157`.

4. Legacy fallback is now also screened. `persistLegacyFoxyResponse` screens `legacy.response` before saving or returning; unsafe text becomes a safe hard-abstain and refunds quota. This closes the old FOX-7 class for the intent-router fallback path. Evidence: `apps/host/src/app/api/foxy/_lib/legacy-flow.ts:104-163`, `:165-237`.

5. Streaming first-paint is guarded at the Next layer. `handleStreamingFoxyTurn` buffers `text` and `done` frames, screens the complete answer during `persistOnDone`, and only releases buffered frames after a safe verdict; unsafe streams emit only an abstain frame and persist empty content. Evidence: `apps/host/src/app/api/foxy/_lib/streaming.ts:140-188`, `:223-263`, `:448-540`.

6. The Edge streaming pipeline still documents that its own mid-stream screen happens after deltas are already emitted, but the Next transform compensates by withholding those deltas from the browser. This is an important layered invariant: Edge alone is not first-paint safe; `/api/foxy` makes the student-visible wire safe. Evidence: `supabase/functions/grounded-answer/pipeline-stream.ts:867-887` versus `apps/host/src/app/api/foxy/_lib/streaming.ts:452-455`, `:503-521`.

7. Quiz Me is deliberately non-streaming and oracle-gated. The route excludes `quiz_me` from streaming because the full structured MCQ must be validated before display; it creates evidential served-item anchors only when the MCQ and concept binding pass, otherwise it downgrades to practice-only/fallback. Evidence: `apps/host/src/app/api/foxy/route.ts:1683-1688`, `:1902-2015`, `:2396-2405`; client force-blocking evidence: `apps/host/src/app/foxy/_hooks/useFoxyChat.ts:686-692`.

8. Output-screen parity is explicitly guarded across Node and Deno. The Node and Deno `HARD_BLOCK_PATTERNS` are intended to be byte-identical; tests block profanity, slurs, directed self-harm, prompt-injection wording, and abusive Hindi/Devanagari/Hinglish text while preserving legitimate Hindi curriculum text. Evidence: `packages/lib/src/ai/validation/output-screen.ts:71-146`, `supabase/functions/grounded-answer/output-screen.ts:5-85`, `apps/host/src/__tests__/lib/ai/validation/output-screen-deno-parity.test.ts:43-82`, `supabase/functions/grounded-answer/__tests__/output-screen.test.ts:20-73`.

9. Age-appropriate behavior is mainly prompt/policy driven, not a semantic classifier. The Foxy prompt says to keep language age-appropriate for grades 6-12 and not invent facts; output screening catches only high-precision hard blocks. Evidence: `packages/lib/src/ai/prompts/foxy-system.ts:11-13`, `:340-345`, `packages/lib/src/ai/validation/output-screen.ts:123-146`.

10. Hindi/English parity is present in the UI and validation layer, with some English-only server prompt fragments. ChatBubble labels for Explain simpler, Show example, Quiz me, Save, and Report are bilingual; error/fallback copy in the hook also has Hindi variants. However, some server-side inserted prompt sections explicitly use English and rely on grounded-answer downstream localization. Evidence: `packages/ui/src/foxy/ChatBubble.tsx:396-465`, `apps/host/src/app/foxy/_hooks/useFoxyChat.ts:184-188`, `:764-811`, `apps/host/src/app/api/foxy/route.ts:1344-1348`.

11. Quota behavior exists at two layers. `/api/foxy` deducts/refunds daily `foxy_chat` quota around user-visible failures; `grounded-answer` reserves/settles route-level estimated/actual cost and records route security audit/circuit state. Evidence: `apps/host/src/app/api/foxy/_lib/streaming.ts:13-16`, `:107-137`, `:471-478`, `:537-540`; `supabase/functions/grounded-answer/index.ts:221-247`, `:306-345`, `:489-552`.

12. Persistence is deliberately conservative. Blocking and streaming paths write user/assistant turns to `foxy_chat_messages`; unsafe streaming persists empty assistant content and null structured/sources, while safe responses store structured payloads and server-side sources but do not expose raw NCERT sources on the wire. Evidence: `apps/host/src/app/api/foxy/route.ts:32-36`, `:2089-2157`, `:2450-2464`; `apps/host/src/app/api/foxy/_lib/streaming.ts:260-340`.

13. Observability is broad but uneven in privacy posture. Most safety and learning-action logs are category/enums/scope only; some route logs still include `studentId` in server logs. Audit logs include trace ID, model, confidence, RAG chunk count, structured-present, and flow. Evidence: `apps/host/src/app/api/foxy/route.ts:2043-2063`, `:2313-2338`; `apps/host/src/app/api/foxy/_lib/streaming.ts:236-258`, `:392-419`; `apps/host/src/app/api/foxy/learning-action/route.ts:237-264`.

14. UI action wiring is mostly present behind `ff_foxy_learning_actions_v1`. The new ChatBubble bar dispatches `got_it`, `explain_simpler`, `show_example`, `quiz_me`, and `save`; overflow contains Save to notebook and Report an issue. Page wiring records the action, saves optimistic state, and re-sends prior question for explain/example/quiz directives. Evidence: `packages/ui/src/foxy/ChatBubble.tsx:43-49`, `:344-465`; `apps/host/src/app/foxy/page.tsx:1040-1100`; `apps/host/src/app/foxy/_hooks/useFoxyChat.ts:508-536`.

15. Save to Notebook now has a real server path in the new action route. It validates ownership of the assistant message, publishes a non-evidential event, and inserts `student_bookmarks` through the RLS-respecting server client. The legacy flag-off Save still writes spaced repetition cards through `/api/student/foxy-interaction`. Evidence: `apps/host/src/app/api/foxy/learning-action/route.ts:198-227`, `:306-341`; `apps/host/src/app/api/student/foxy-interaction/route.ts:53-127`; `apps/host/src/app/foxy/_components/MessageList.tsx:250-268`.

16. Report an Issue has a modern grounding issue path and a legacy report path. The ChatBubble opens `ReportIssueModal` and posts to `/api/support/ai-issue`, writing `ai_issue_reports` for super-admin grounding review; the older page-level `ReportDialog` and `/api/student/foxy-interaction` `report_response` flow still exist. Evidence: `packages/ui/src/foxy/ChatBubble.tsx:330-340`, `:456-485`; `apps/host/src/app/api/support/ai-issue/route.ts:1-17`, `:49-100`; `apps/host/src/app/foxy/page.tsx:1106-1133`; `apps/host/src/app/api/student/foxy-interaction/route.ts:4-12`.

17. "Git it" is not present as an active action type in current UI/server code. It appears in handover docs as a broken action, likely a typo/stale alias for "Got it". Active code supports `got_it`, not `git_it`. Evidence: `engineering-audit/CODEX_HANDOVER.md:7-13`, `:41-42`; `packages/ui/src/foxy/ChatBubble.tsx:43-49`; `apps/host/src/app/api/foxy/learning-action/route.ts:73-80`.

18. RAG readiness is manifest-backed. `scripts/foxy-rag-readiness.json` has `remainingFollowUps: []` and tracks grounded output backstop, legacy fallback backstop, streaming contract, streaming first-paint backstop, Hindi output-screen, JSON fallback abstain, config parity, workflow/backlog status. The manifest test asserts required artifacts, evidence snippets, and no stale FOX-7/streaming/Hindi follow-up trail. Evidence: `scripts/foxy-rag-readiness.json:1-134`; `apps/host/src/__tests__/foxy-rag-readiness.test.ts:21-64`.

## 4. Evidence

- Active route contract: `apps/host/src/app/api/foxy/route.ts:1-58`.
- Internal grounded-answer caller contract: `packages/lib/src/ai/grounded-client.ts:14-18`, `:201-230`.
- Blocking output safety: `apps/host/src/app/api/foxy/route.ts:2026-2078`.
- Legacy fallback safety: `apps/host/src/app/api/foxy/_lib/legacy-flow.ts:117-163`.
- Streaming first-paint safety: `apps/host/src/app/api/foxy/_lib/streaming.ts:140-188`, `:448-540`.
- Edge streaming residual note: `supabase/functions/grounded-answer/pipeline-stream.ts:867-887`.
- Output-screen parity: `apps/host/src/__tests__/lib/ai/validation/output-screen-deno-parity.test.ts:43-82`.
- Hindi/Hinglish coverage: `apps/host/src/__tests__/lib/ai/validation/output-screen.test.ts:25-80`.
- RAG readiness manifest: `scripts/foxy-rag-readiness.json:1-134`.
- UI action bar: `packages/ui/src/foxy/ChatBubble.tsx:344-465`.
- Learning-action server guard: `apps/host/src/app/api/foxy/learning-action/route.ts:1-60`, `:198-227`, `:306-341`.
- Report issue server path: `apps/host/src/app/api/support/ai-issue/route.ts:1-17`, `:49-100`.
- Git it doc-only reference: `engineering-audit/CODEX_HANDOVER.md:7-13`.

## 5. Risks

- P1 - Dual report paths can fragment issue review. `ReportIssueModal` writes `ai_issue_reports`, while legacy `report_response` writes a different path through `/api/student/foxy-interaction`. This may split QA triage unless dashboards reconcile both.
- P1 - Server logs still include `studentId` in several warnings/info logs. This may be acceptable for backend ops but is inconsistent with the stricter P13 comments used elsewhere.
- P1 - Hindi parity is mostly guarded for labels and unsafe tokens, but several prompt addenda and fallback rails are English-only and rely on downstream localization. This is not necessarily broken, but it is weaker than full Hindi/English parity.
- P1 - Age appropriateness is prompt-led. There is no grade-level readability or semantic moderation classifier beyond deterministic hard-block patterns.
- P2 - Edge streaming pipeline by itself is not first-paint safe; safety depends on the Next route buffering transform. Any future direct streaming caller to `grounded-answer?stream=1` could reintroduce unsafe first-paint unless it repeats the transform.
- P2 - RAG soft mode allows general CBSE fallback when chunks are empty or weak, then labels may become `unverified` rather than hard-abstain. This is a product trade-off; it needs monitoring to avoid confident unsupported answers.
- P2 - "Git it" remains in handover docs but not code. If product expects a visible "Git it" label, it is absent; if it is a typo for "Got it", docs should be corrected later.
- P2 - Several readiness tests assert source snippets and manifests. Good for guardrails, but they do not replace live Edge/runtime probes with real feature-flag, quota, and DB policy state.

## 6. Dependencies

- Feature flags: `ff_grounded_ai_foxy`, `ff_foxy_streaming`, `ff_grounded_ai_enabled`, `ff_foxy_learning_actions_v1`, `ff_event_bus_v1`, and grounded-answer route policies.
- Secrets/env: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `INTERNAL_CALLER_SIGNING_SECRET`, `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, optional `OPENAI_API_KEY` for shadow telemetry.
- Supabase tables/RPCs: `foxy_sessions`, `foxy_chat_messages`, `foxy_message_feedback`, `student_bookmarks`, `spaced_repetition_cards`, `ai_issue_reports`, `grounded_ai_traces`, `retrieval_traces`, `feature_flags`, `topic_mastery`, `record_message_feedback`, quota/security functions.
- Shared safety/config contracts: Node/Deno output-screen twins, grounded config parity, `FoxyResponse` structured schema, internal caller signing helpers.
- UI/UX state: persisted `messageId` must arrive from blocking JSON or streaming `persisted` SSE before feedback/learning actions can be fully recorded.

## 7. Recommended action

1. No Stage 1 code changes.
2. Decide whether "Git it" is a typo for "Got it"; if yes, update docs and acceptance criteria later. If no, define a new explicit action type before implementation.
3. Consolidate Report an Issue into a single canonical table/dashboard path or add a reconciliation view that merges `ai_issue_reports` and legacy `ai_response_reports`.
4. Add a privacy pass over Foxy logs to standardize P13-safe logging, especially `studentId` in warnings.
5. Add a Hindi parity audit for server prompt fragments and fallback copy, not just UI labels/output-screen tokens.
6. Treat `/api/foxy` as the only approved streaming caller to `grounded-answer?stream=1`; document that direct Edge streaming is unsafe without a buffering transform.
7. Add live/staging smoke probes for feature flags, quota refund, signed internal calls, report issue, save to notebook, and streaming unsafe-output backstop.

## 8. Files proposed for modification

Stage 1 proposes no immediate code modifications.

Potential later files if fixes are approved:

- `engineering-audit/CODEX_HANDOVER.md` - correct or clarify "Git it".
- `packages/ui/src/foxy/ChatBubble.tsx` - only if product wants a distinct action beyond `got_it`, or wants report path changes.
- `apps/host/src/app/foxy/page.tsx` and `apps/host/src/app/foxy/_components/ReportDialog.tsx` - retire or bridge legacy report flow.
- `apps/host/src/app/api/student/foxy-interaction/route.ts` and `apps/host/src/app/api/support/ai-issue/route.ts` - consolidate reporting surfaces.
- `apps/host/src/app/api/foxy/route.ts`, `_lib/streaming.ts`, `_lib/legacy-flow.ts` - only for log privacy or newly approved runtime probes.
- `packages/lib/src/ai/prompts/foxy-system.ts` and grounded-answer prompt files - Hindi/server prompt parity.
- `scripts/foxy-rag-readiness.json` and associated tests - extend readiness manifest with live smoke evidence if desired.

## 9. Tests required

Recommended readout/CI set before claiming production readiness:

- `npx vitest run src/__tests__/api/foxy/output-safety-backstop.test.ts src/__tests__/api/foxy/streaming-structured-persistence.test.ts src/__tests__/foxy-streaming.test.ts src/__tests__/foxy-streaming-json-fallback-abstain.test.ts src/__tests__/foxy-rag-readiness.test.ts`
- `npx vitest run src/__tests__/lib/ai/validation/output-screen.test.ts src/__tests__/lib/ai/validation/output-screen-deno-parity.test.ts`
- `cd supabase/functions/grounded-answer && deno test __tests__/output-screen.test.ts`
- `npx vitest run src/__tests__/foxy/learning-action-chat-bubble.test.tsx src/__tests__/foxy/learning-action-hook.test.ts src/__tests__/api/foxy/learning-action.test.ts src/__tests__/api/foxy/learning-action-source-guards.test.ts`
- `npx vitest run src/__tests__/api/foxy/quiz-answer.test.ts src/__tests__/api/foxy/quiz-intent-mode-swap.test.ts src/__tests__/lib/foxy/quiz-me-oracle-gate.test.ts`
- Manual/live smoke: signed grounded-answer call, streaming unsafe fixture, quota refund on `upstream_error`, Save to notebook, Report an issue, Hindi fallback, and session resume with structured and legacy messages.

Not run in this Stage 1 pass: tests/build commands. This was intentionally reconnaissance-only.

## 10. Confidence level

Confidence: High for static wiring and code-path findings; medium for live production behavior.

Reasoning: The active code, tests, and readiness manifest strongly support the safety/wiring conclusions. Live feature flag state, Supabase route policy rows, quota ledgers, RLS behavior, and deployed Edge version were not queried in this Stage 1 pass.

## 11. Unresolved questions

- Is "Git it" a typo for "Got it", or a distinct intended action?
- Which report table is canonical for super-admin AI quality review: `ai_issue_reports`, legacy `ai_response_reports`, or both?
- Should `ff_foxy_learning_actions_v1` be considered production-on, or is the legacy save/report UI still the expected default?
- Do product and assessment want a semantic moderation/readability layer for age appropriateness beyond the deterministic hard-block screen?
- Should direct streaming access to `grounded-answer?stream=1` be forbidden by policy except through `/api/foxy`?
- Are Hindi server prompt fragments expected to be fully localized, or is downstream answer-language control sufficient?
- Are current production/staging flags aligned with the repo readiness manifest generated on 2026-07-09?
