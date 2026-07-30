# Daily 6 (WhatsApp) — Assessment Behavioral Spec (P14 pre-implementation gate)

Issued by assessment 2026-07-30. Binding on the Phase-3 builder and tester.

## Four binding corrections to the plan
1. attemptMode 'offline_replay' is a ROUTE contract, not an RPC argument. The bot calls submit_quiz_results_v2 directly; the only replay rule to replicate is the 168h staleness cap. Partial sets are NEVER submitted (response count != served count is a deliberate P3 Check-3 flag).
2. The quiz path does NOT advance adaptive_mastery. The bot must call bkt_update() per answered question — and explicitly NOT record_adaptive_response(), which awards its own uncapped XP outside the P2 formula and the 200/day cap (would double-pay WhatsApp students). REJECTED path.
3. get_questions_for_node has no P6 gate (filters is_active only). The bot applies the P6 quality gate itself before start_quiz_session.
4. Immediate feedback grades against quiz_session_shuffles.shuffle_map + correct_answer_index_snapshot — never live question_bank. Display-only; the RPC remains the sole scoring authority; show its return values verbatim.

## (a) Queue composition — DECISION: get_practice_queue(p_student_id, p_subject, p_grade, 6)
NOT composeDailyRhythm. Accept the RPC queue verbatim — no bot-side re-ranking.
Cold start / short-queue fallback, in order:
1. Zero adaptive_mastery rows for (subject, grade) → seed_adaptive_mastery(student, subject, grade) once, retry.
2. Queue < 6 nodes → top up deficit via select_quiz_questions_rag(student, subject, grade, NULL, deficit, 'mixed', '{mcq}', NULL).
3. P6-valid questions < 6 → serve smaller set, FLOOR 3. Below 3 → no session; bilingual "not enough practice for this subject yet — try another subject". Score/XP always use the actual total served.

## (b) Question fetch
Per queue item: get_questions_for_node(node_code, 1, NULL, exclude_ids = already picked). P6 gate every candidate (non-empty text, no template braces or [BLANK], exactly 4 distinct non-empty options, correct_answer_index 0-3, non-empty explanation). One refetch per node, then slot falls to top-up. Then start_quiz_session(student, question_ids); serve ONLY the returned options_displayed. Opcode d6:a:<n> carries the DISPLAYED index 0-3 == selected_displayed_index. List rows labelled A/B/C/D with option text in row description (72-char limit); the FULL question + all 4 full options go in the message body (<=1024 chars) so row truncation never changes the real choice.

**dev-5 correction (assessment Phase-3 conformance review, condition for approval, implemented 2026-07-30):** the opcode above under-specified a real data-integrity gap — `d6:a:<n>` carried no question-position information, so a tap on a STALE interactive list card (an older, already-superseded question message; WhatsApp never disables previously-sent lists) produced a genuinely new inbound event, passed the `d6_last_event_id` dedup guard, and was silently applied to whatever question was CURRENTLY active — misgrading it and shifting every subsequent answer one slot out of alignment. Corrected format: **`d6:a:<qIdx>:<optIdx>`**, where `qIdx` is the 0-based question position (= `session.d6_index` at serve time, NOT a global counter) and `optIdx` is the displayed option index (unchanged semantics). The server validates `qIdx === session.d6_index` before grading; a mismatch is treated as a stale/superseded tap — no grade, no `bkt_update`, no `d6_index` advance — and re-serves the current question with a brief bilingual nudge. See `packages/lib/src/whatsapp/intent.ts` and `apps/host/src/app/api/whatsapp/_lib/daily6.ts` (`handleStaleD6Tap`).

## (c) Session lifecycle → whatsapp_sessions
Start (after resolveActiveStudent + daily gate): state='daily6_active', d6_date=IST date, d6_quiz_session_id, d6_question_ids (served order), d6_index=0, d6_responses=[], d6_served_at=now(), subject, grade (STRING, P5). context: d6_idempotency_key=crypto.randomUUID() (regenerated only on new compose), d6_q_sent_at (per-question serve timestamp), d6_meta per question {question_id, node_code, source, mastery_pct_before}. Each answer: append {question_id, selected_displayed_index, time_spent}, d6_index+=1, reset d6_q_sent_at. After submit: clear d6_* back to defaults (KEEP d6_date — it is the daily-gate marker), state='idle'.
Timing (P3 source of truth): time_spent = clamp(answer_provider_timestamp − context.d6_q_sent_at, 1, 600) seconds — server-derived. p_time = SUM(time_spent), NOT wall-clock last−first. Do NOT raise the 1s floor to 3.

## (d) Per-question flow — immediate feedback, one combined message
Serve → answer → grade vs snapshot (correct displayed index d satisfies shuffle_map[d+1] = correct_answer_index_snapshot) → bkt_update(active_student_id, node_code, is_correct, time_spent*1000) → ONE feedback message → next question as its own interactive message.
- Correct: "✅ Correct!" + one-line reinforcement — no explanation.
- Wrong: "❌ The answer was <letter>: <correct option text>" + explanation truncated ~300 chars at a sentence boundary; use explanation_hi when locale='hi' and non-empty, else EN fallback.
interleave-source items SHOULD bump adaptive_mastery.interleave_count (deferrable past beta — leave a TODO).

## (e) Submit mapping (exact)
service-role client → submit_quiz_results_v2: p_session_id=d6_quiz_session_id; p_student_id=active_student_id ONLY (R6 chokepoint); p_subject=session.subject; p_grade=session.grade (STRING); p_topic=NULL; p_chapter=NULL; p_responses=d6_responses verbatim ([{question_id, selected_displayed_index, time_spent}]); p_time=SUM(time_spent); p_idempotency_key=context.d6_idempotency_key. The RPC's session-ownership check MUST NOT be weakened. RPC failure → retry on next inbound with the SAME key. No attemptMode.

## (f) XP — exact table (6-question set, unflagged, uncapped)
score_percent=ROUND(correct/6*100); xp=correct*10+(>=80?20:0)+(=100?50:0): 0→0, 1→10, 2→20, 3→30, 4→40, 5→70 (83%≥80 bonus), 6→130. Same 200/day cap + ledger as web. Show the RPC's returned xp_earned VERBATIM; append cap line when xp_capped. Flagged (P3): xp_earned=0, score recorded. Daily gate: until migration 20260801100400 lands, interim gate = d6_date==today ⇒ one set/day for everyone (do NOT call check_and_record_usage yet — the feature code doesn't exist in get_plan_limit; leave a TODO citing the Phase-4 migration + that it must extend the school-aware 20260729130400 version). At the gate: friendly bilingual "done for today, come back tomorrow" + app deep link.

## (g) Abandonment / resume
Same IST day: resume at d6_index, re-serve current question; duplicate/late answers ignored via position check. All answered but submit failed: retry with stored key up to 168h after d6_served_at; beyond → abandon without submit. New IST day with partial set: abandon WITHOUT submitting (never short p_responses — bkt_update already captured learning), clear d6_*, bilingual "yesterday's set expired — starting fresh", serve new set.

## (h) Closing summary (one message)
"🎯 4/6 correct · 67% · +40 XP\n<Node title>: 62% → 68% · Next review: Thu\n🔥 Streak: 5 days" (hi: सही / अगला रिवीज़न / दिन; XP + Streak untranslated per P7). All numbers from the RPC return verbatim; streak from students.streak_days read AFTER submit; flagged → "+0 XP — answered too fast to earn XP / XP के लिए थोड़ा धीरे सोचकर जवाब दो"; xp_capped → "(daily XP limit reached)". Footer node = node_code with most questions in the set (tie: first srs_due, else first). before = compose-time mastery_pct from d6_meta; after = adaptive_mastery.mastery_prob re-read post-final-bkt_update, ROUND(*100). Next review = that node's next_review_at as IST weekday ("12 Aug" form if >6 days out).

## (i) Anti-cheat — all three P3 checks UNCHANGED. Testing pins: flagged → xp 0, score recorded, flagged copy shown.

## (j) mixed_recall_queue hook (Phase 6 obligations on today's build)
(1) Composition must be a discrete, testable step with an injection point AFTER get_practice_queue and BEFORE the top-up. (2) context.d6_meta carries per-question source + node_code.

## (Q5) Subject selection — student picks, seeded from students.selected_subjects
Beta: single-subject set per day. First D6 tap of the day → subject picker (interactive list) from students.selected_subjects (fallback preferred_subject, then the grade's valid subject set), default/top row "Continue <last session.subject>". Skip the picker when only one subject exists. Auto-rotation rejected for beta.
