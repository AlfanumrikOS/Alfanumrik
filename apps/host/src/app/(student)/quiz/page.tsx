'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { calculateScorePercent } from '@alfanumrik/lib/scoring';
import { track } from '@alfanumrik/lib/analytics';
import { submitQuizResults, saveCognitiveMetrics, supabase, updateChapterProgress, startQuizSession, checkQuizAnswer, type QuizAnswerCheck } from '@alfanumrik/lib/supabase';
import { invalidateDashboard, useFeatureFlags } from '@alfanumrik/lib/swr';
import { useNextTask } from '@alfanumrik/lib/quiz/v2/use-next-task';
import { OPTION_LETTERS, parseOptions, isMcqQuestion } from '@alfanumrik/lib/quiz/options';
import { isPyqYear } from '@alfanumrik/lib/quiz/pyq-years';
// Phase 4 — session resume. `saveQuizAnswerProgress` makes every confirmed
// answer durable server-side the instant it is confirmed (on EVERY mode, no
// flag); `fetchQuizResume` rebuilds an interrupted session from that record.
// See packages/lib/src/quiz/resume.ts for the substrate + security design.
import {
  saveQuizAnswerProgress,
  fetchQuizResume,
  isResumeSessionId,
  writeResumeBreadcrumb,
  readResumeBreadcrumb,
  clearResumeBreadcrumb,
} from '@alfanumrik/lib/quiz/resume';
// P0 fix cluster (2026-08-11) — the two client→server submit-contract values
// that were each re-derived inline at more than one call site, and wrong at
// one of them. `collectSessionQuestionIds` guarantees EVERY served question
// (MCQ or written) is snapshotted by start_quiz_session; `computeElapsedSeconds`
// guarantees p_time is elapsed — not remaining — in exam mode. See
// packages/lib/src/quiz/session-contract.ts for the full defect writeup.
import { collectSessionQuestionIds, computeElapsedSeconds } from '@alfanumrik/lib/quiz/session-contract';
import { assembleQuiz } from '@alfanumrik/lib/quiz-assembler';
import { XP_RULES } from '@alfanumrik/lib/xp-config';
// P10 — DEEP import, not the `@alfanumrik/ui/ui` barrel. That barrel's
// `index.ts` ends with `export * as primitives from './primitives'`, and
// neither @alfanumrik/ui nor @alfanumrik/lib declares `sideEffects: false`
// (nor are they in next.config.js `optimizePackageImports`), so webpack must
// evaluate every re-exported module: importing these four Wonder Blocks off
// the barrel dragged the ENTIRE canonical primitive library (Dialog, Drawer,
// BottomSheet, Tooltip, Tabs, Table, Toast, Avatar, …) into /quiz's first
// load as one 12.3 kB gz chunk that this page renders none of.
// `wonder-blocks.tsx` imports nothing but React, so this is byte-identical
// at runtime — same components, same props, no barrel.
import { Card, Button, ProgressBar, LoadingFoxy } from '@alfanumrik/ui/ui/wonder-blocks';
import { useAllowedSubjects } from '@alfanumrik/lib/useAllowedSubjects';
import { authHeader } from '@alfanumrik/lib/api/auth-header';
import QuizSetup from '@alfanumrik/ui/quiz/QuizSetup';
// Foxy North-Star Phase 3 (L5/E5) — 5-rung hint ladder + prereq warm-up card.
// P10: dynamic-imported (ssr:false, null loading) — conditional-render surfaces
// (HintLadder mounts only after a wrong answer; PrereqSuggestion mounts only
// when the API returns a suggestion), so lazy load is behaviorally invisible.
const HintLadder = dynamic(
  () => import('@alfanumrik/ui/quiz/HintLadder').then((m) => m.default),
  { ssr: false, loading: () => null },
);
const PrereqSuggestion = dynamic(
  () => import('@alfanumrik/ui/quiz/PrereqSuggestion').then((m) => m.default),
  { ssr: false, loading: () => null },
);
import FeedbackOverlay from '@alfanumrik/ui/quiz/FeedbackOverlay';
// D6 (Foxy North-Star Phase 2) — sampled, non-blocking 1-tap confidence
// prompt shown AFTER the answer is confirmed (P3 timing untouched).
// Sampling is deterministic via shouldPromptConfidence (no Math.random).
import ConfidencePrompt, { shouldPromptConfidence, type ConfidenceValue } from '@alfanumrik/ui/quiz/ConfidencePrompt';
// P10: dynamic-imported (ssr:false) for the same reason as HintLadder above —
// this is the SA/MA/LA answer pad and mounts ONLY on the written-answer branch
// (`question_type` is not MCQ). An MCQ-only session never renders it, so on the
// overwhelmingly common path its CBSE hint tables, word-count and review-step
// logic was being paid for nothing. `loading` renders LoadingFoxy rather than
// null (unlike HintLadder) because this IS the primary input for a written
// question — the student must see something occupying that slot.
// Nothing about answer capture, timing (P3) or evaluation changes; only when
// the module is fetched.
// RESTORED 2026-08-23: b00b9c872 (in PR #1605) silently converted this back to
// a static import, inlining the whole pad into the eager /quiz page chunk. That
// was one of the three P10 ratchet breaches on main post-merge.
const WrittenAnswerInput = dynamic(
  () => import('@alfanumrik/ui/quiz/ncert/WrittenAnswerInput'),
  { ssr: false, loading: () => <LoadingFoxy /> },
);
// Canonical math renderer (P6/P12 fail-safe; P10: KaTeX loads lazily and
// only when the text actually contains math — plain questions cost nothing).
import MathRenderer from '@alfanumrik/ui/math/MathRenderer';

// Lazy-load QuizResults — only shown after quiz completion (results screen)
const QuizResults = dynamic(() => import('@alfanumrik/ui/quiz/QuizResults'), {
  ssr: false,
  loading: () => <LoadingFoxy />,
});

// Phase 4 U1 — "Ask Foxy about a missed question" launcher on the results
// screen. The launcher itself is a tiny module (button + useState); FoxyPanel
// is dynamic-imported inside the launcher only when the student taps.
import FoxyPanelLauncher from '@alfanumrik/ui/foxy-launcher/FoxyPanelLauncher';
// Screen 08 "Result" (Wave B, `ff_quiz_result_v2`) — additive presentational
// alternative to QuizResults. Flag OFF by default (architect seeds the row
// separately); the legacy QuizResults path below is completely untouched
// when the flag is off or still resolving. See
// packages/ui/src/quiz/v2/ResultSummary.tsx for the full design rationale,
// including the deliberate mastery-band vocabulary choice flagged for
// assessment's review.
const ResultSummary = dynamic(() => import('@alfanumrik/ui/quiz/v2/ResultSummary'), {
  ssr: false,
  loading: () => <LoadingFoxy />,
});
// Screen 07 "Practice" (Wave B3, `ff_quiz_v2`) — additive presentational
// alternative for the MCQ-in-progress screen, showing per-question
// correctness immediately via check_quiz_answer() instead of deferring to
// the results screen. Flag OFF by default; the legacy per-question JSX
// inside the quiz screen render branch below is completely untouched when
// the flag is off, the mode isn't 'practice', or the question isn't MCQ.
// See packages/ui/src/quiz/v2/PracticeRunner.tsx for the full design
// rationale, including the "no retry after reveal" enforcement boundary.
const PracticeRunner = dynamic(() => import('@alfanumrik/ui/quiz/v2/PracticeRunner'), {
  ssr: false,
  loading: () => <LoadingFoxy />,
});
// Lazy-load MisconceptionExplainer — only mounted on wrong MCQ; the API
// gates on ff_distractor_micro_explainer_v1 server-side (returns null body
// when off, so the component renders nothing).
const MisconceptionExplainer = dynamic(() => import('@alfanumrik/ui/quiz/MisconceptionExplainer'), {
  ssr: false,
  loading: () => null,
});
import {
  createFeedbackState, onCorrectAnswer, onWrongAnswer, onSessionComplete,
  getNearCompletionNudge, playFeedbackSound,
  type FeedbackState, type FeedbackResult,
} from '@alfanumrik/lib/feedback-engine';
import {
  BLOOM_CONFIG, FATIGUE_EASE_OFF_THRESHOLD,
  initialCognitiveLoad, updateCognitiveLoad, getReflectionPrompt, classifyError,
  type BloomLevel, type CognitiveLoadState, type ReflectionPrompt, type ErrorType,
} from '@alfanumrik/lib/cognitive-engine';
// Foxy North-Star Phase 0 (F2/F3/F4) — shared SRS due-card query/selection,
// SM-2 quality mapping → EXISTING /api/learner/review/grade endpoint (which
// owns the math), and the batched topic-mastery lookup for classifyError.
import {
  fetchSrsDueQuizCards,
  selectSrsReviewSet,
  gradeSrsCardsFireAndForget,
  fetchTopicMasteryByQuestionId,
} from '@alfanumrik/lib/learn/srs-quiz-review';

type QuizMode = 'practice' | 'cognitive' | 'exam';
type Screen = 'select' | 'quiz' | 'feedback' | 'results';

interface Question {
  id: string;
  question_text: string;
  question_hi: string | null;
  question_type: string;
  options: string | string[];
  /**
   * KEYLESS SERVING (migration 20260814000023). NOT populated on any live path
   * any more — every serving RPC and every direct `question_bank` query on this
   * page stopped returning `question_bank.correct_answer_index`, and the
   * server-shuffle / resume paths stamp the fail-loud `-1` sentinel. Optional
   * because "absent" is now the normal case; read it only through
   * `clientHasAnswerKey()`, never by direct comparison.
   */
  correct_answer_index?: number;
  explanation: string | null;
  explanation_hi: string | null;
  hint: string | null;
  /**
   * `question_bank.difficulty` / `question_bank.bloom_level` are NULLABLE
   * columns, and the fresh-serve path has always passed their NULLs straight
   * through — the old non-nullable declarations were simply untrue at runtime
   * (see `classifyQuizError` below, which already handled `bloom_level` being
   * absent). The lie mattered: it let the resume payload builder "safely"
   * default a NULL bloom to `'remember'`, which made the SAME question answered
   * wrong the SAME way classify as `'knowledge_gap'` on a resumed session and
   * `'procedural'` on a fresh one. That `error_type` is persisted to
   * `quiz_responses.error_type` and feeds `update_learner_state_post_quiz`.
   *
   * The types are now honest. Any fallback belongs at the point of CONSUMPTION
   * (where the fresh and resumed paths share code and therefore cannot
   * diverge), never at construction.
   */
  difficulty: number | null;
  bloom_level: string | null;
  chapter_number: number;
  // Written answer fields (SA/MA/LA from NCERT sources)
  marks_possible?: number;
  answer_text?: string | null;
  source_table?: string;
  question_id?: string;  // original ID from ncert_exercises or rag_content_chunks
  cbse_type?: string;
  cbse_label?: string;
  time_estimate?: number;
  word_limit?: number;
}

interface Response {
  question_id: string;
  selected_option: number;
  is_correct: boolean;
  time_spent: number;
  error_type?: ErrorType;
  // Written answer fields (populated for SA/MA/LA)
  student_answer_text?: string;
  marks_awarded?: number;
  marks_possible?: number;
  rubric_feedback?: string;
  /**
   * P1 shuffle/index mismatch fix (migration 20260418110000).
   * The 4-integer permutation used to render this question's MCQ options,
   * or `null` for non-shuffled / non-MCQ rows. Sent verbatim to the
   * `submit_quiz_results` RPC so the server can translate the shuffled
   * `selected_option` back to the original space before comparing with
   * `question_bank.correct_answer_index`.
   */
  shuffle_map?: number[] | null;
  /**
   * F8 (Foxy North-Star Phase 0): hint depth (0-3) the student had revealed
   * AT ANSWER TIME for this question. Field name is a fixed server contract
   * (`hint_level`); architect is adding the column + RPC read in parallel.
   * Optional so older stored/pending payloads stay valid.
   */
  hint_level?: number;
  /**
   * D6 (Foxy North-Star Phase 2): 1-tap self-reported confidence (1-5) from
   * the sampled post-answer prompt. Fixed server contract: smallint 1-5,
   * NULL when unanswered — so this stays `undefined` when the prompt was not
   * sampled, auto-dismissed, or ignored. Captured AFTER answer confirm, so
   * P3 timing semantics are unaffected.
   */
  confidence?: number;
  telemetry?: {
    latency_ms?: number;
    changed_answers_count?: number;
    hints_used?: number;
  };
}

// ─── Written answer helpers ──────────────────────────────────────────────────
function mapToWrittenType(qt: string): 'short_answer' | 'medium_answer' | 'long_answer' | 'hots' | 'numerical' | 'intext' {
  const map: Record<string, string> = {
    short_answer: 'short_answer', medium_answer: 'medium_answer', long_answer: 'long_answer',
    hots: 'hots', numerical: 'numerical', intext: 'intext',
    sa: 'short_answer', la: 'long_answer', ma: 'medium_answer',
  };
  return (map[qt] ?? 'short_answer') as 'short_answer' | 'medium_answer' | 'long_answer' | 'hots' | 'numerical' | 'intext';
}

function getWordLimit(qt: string): number {
  const limits: Record<string, number> = {
    short_answer: 40, medium_answer: 100, long_answer: 200,
    hots: 150, numerical: 60, intext: 80, sa: 40, la: 200, ma: 100,
  };
  return limits[qt] ?? 80;
}

function getTimeEstimate(qt: string): number {
  const times: Record<string, number> = {
    short_answer: 120, medium_answer: 240, long_answer: 480,
    hots: 360, numerical: 180, intext: 150, sa: 120, la: 480, ma: 240,
  };
  return times[qt] ?? 180;
}

/**
 * Detect whether a question is MCQ based on its type and available options.
 *
 * The body moved to `packages/lib/src/quiz/options.ts` as `isMcqQuestion`
 * (Phase 5 track B) — this file's copy and the learn chapter page's
 * `isLearnPageMCQ` were the same predicate, and the learn one had already
 * drifted (it was missing the `cbse_type` branch below). THIS copy was the
 * superset, so it is the one the shared module adopted: behaviour here is
 * unchanged, and the alias keeps all 7 call sites in this file untouched.
 */
const isQuestionMCQ = isMcqQuestion;

/* `classifyQuizError(question, response)` lived here and was DELETED
 * 2026-08-24 when its single call site — the client-side write into the dead
 * `question_responses` table — was removed (see the tombstone in
 * handleQuizComplete). It branched on `bloom_level`: 'remember' →
 * 'knowledge_gap'; 'apply'|'analyze'|'evaluate'|'create' → 'conceptual';
 * otherwise 'procedural'.
 *
 * It was NOT the classifier behind `quiz_responses.error_type`. That value is
 * produced at answer time by `classifyError` (@alfanumrik/lib, called around
 * the setResponses below) and persisted by the server submit RPC. Comments in
 * `packages/lib/src/quiz/resume.ts` and
 * `apps/host/src/__tests__/quiz/resume-payload.test.ts` still cite this
 * function by name and attribute quiz_responses.error_type to it — that
 * attribution was already inaccurate.
 * TODO(assessment/testing): restate those two rationales against
 * `classifyError`. The underlying rule they defend still holds and now has a
 * second consumer: a fabricated `bloom_level` default on resume would skew the
 * Bloom's panel that /api/practice/history reads off quiz_responses.bloom_level.
 */

const VALID_QUIZ_COUNTS = [5, 10, 15, 20] as const;

/* ═══ OPTION SHUFFLE — server-owned (migration 20260428160000) ═══
 *
 * P0 fix: shuffle authority moved from client to server. The legacy
 * client-side seededShuffle was stable across sessions; when
 * question_bank.options got edited, the cached shuffle map drifted from
 * the new correct_answer_index and students saw "wrong" feedback on the
 * SAME option whose explanation said it was correct.
 *
 * New flow:
 *   1. startQuizSession() → server generates per-question shuffle, snapshots
 *      options + correct_answer_index, returns shuffled options to client
 *      WITHOUT correct_answer_index.
 *   2. Client renders options as-given (already in display order).
 *   3. On submit, client sends only { question_id, selected_displayed_index };
 *      server re-derives is_correct from the snapshot.
 *
 * Per-question feedback during the quiz (live isCorrect check) is
 * unavailable in Phase A — the FeedbackOverlay shows "Submitted —
 * check results at end". Phase B may add a per-answer server roundtrip.
 *
 * The legacy fallback path (when server session is null — e.g. RPC failure)
 * keeps the questions in original order and submits with selected_option as
 * the original index. Without a shuffle the visual-correct equality holds.
 */
// Identity helpers for the legacy fallback path. With server-owned shuffle,
// shuffleMaps[i] is always null; client renders options in the order the
// server returned them, and `selected_option` IS the displayed index.
function getShuffledOptions(q: {options:string|string[]}, _shuffleMap: number[]|null) {
  return parseOptions(q.options);
}

function shuffledToOriginal(displayIdx: number, _shuffleMap: number[]|null) {
  return displayIdx;
}

function originalToShuffled(origIdx: number, _shuffleMap: number[]|null) {
  return origIdx;
}

/**
 * Does the CLIENT hold a usable answer key for this question?
 *
 * KEYLESS SERVING (migration 20260814000023). After that migration NO student
 * serving path returns `question_bank.correct_answer_index`:
 *   - `select_quiz_questions_rag` / `select_quiz_questions_v2` /
 *     `get_quiz_questions` dropped it from their JSON payloads;
 *   - `start_quiz_session` never returned it (this page stamps -1 as a
 *     fail-loud sentinel on that path);
 *   - every direct `question_bank` query on this page and in
 *     `packages/lib/src` stopped selecting the column.
 *
 * So this predicate is `false` for every question a student is served today.
 * It exists — rather than being hard-coded to `false` — for two reasons:
 *   1. it is the honest question to ask at each of the five decision sites
 *      below, all of which previously asked the WRONG one ("is there a server
 *      session?") and would silently mis-render if a session were missing;
 *   2. the LEGACY fallback (start_quiz_session returned no session) used to
 *      derive live correctness locally. It can no longer do that, and the
 *      correct behaviour is the one the v2 path already has: show a neutral
 *      "Submitted — check results at end" and let the SERVER reveal
 *      correctness at submit. Claiming "wrong" because the key is absent would
 *      be a lie shown to a student who may well have been right.
 *
 * P1 is unaffected either way: the score has always been re-derived
 * server-side (`submit_quiz_results_v2` from the session snapshot, or
 * `submit_quiz_results` from `question_bank` on the legacy path). This
 * predicate only governs LIVE, in-quiz feedback.
 */
function clientHasAnswerKey(q: { correct_answer_index?: number | null }): boolean {
  const k = q.correct_answer_index;
  return typeof k === 'number' && Number.isInteger(k) && k >= 0 && k <= 3;
}

export default function QuizPage() {
  const experienceV3 = false;
  const { student, isLoggedIn, isLoading, isHi, refreshSnapshot, activeRole } = useAuth();
  const router = useRouter();
  const { unlocked: allowedSubjects } = useAllowedSubjects();

  // Screen 08 "Result" (Wave B, `ff_quiz_result_v2`) — additive flag branch.
  // OFF by default; when off (or still resolving) the legacy QuizResults
  // path below is rendered byte-identical to today.
  const { data: quizV2Flags } = useFeatureFlags();
  const resultV2On = quizV2Flags?.ff_quiz_result_v2 === true;
  // Screen 07 "Practice" (Wave B3, `ff_quiz_v2`) — additive flag branch.
  // OFF by default; when off (or mode isn't 'practice', or the current
  // question isn't MCQ) the legacy per-question JSX is rendered
  // byte-identical to today.
  const practiceV2On = quizV2Flags?.ff_quiz_v2 === true;
  // "Next task" CTA for the v2 Result screen — reuses the existing
  // Today-queue mechanism (fails soft to /today). Cheap to resolve
  // unconditionally; only rendered when resultV2On.
  const nextTask = useNextTask(student?.id ?? null);

  // Setup state
  const [screen, setScreen] = useState<Screen>('select');
  const [quizMode, setQuizMode] = useState<QuizMode>('cognitive');
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState<number | null>(null);
  const [questionCount, setQuestionCount] = useState(10);
  const [examTimeLimit, setExamTimeLimit] = useState(180); // minutes for exam mode
  const [examTimerActive, setExamTimerActive] = useState(false);
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null);
  const [selectedQuestionTypes, setSelectedQuestionTypes] = useState<string[]>(['mcq']);
  /**
   * PYQ board-paper year from `?year=` (e.g. /quiz?subject=math&year=2019).
   *
   * `/pyq` used to be a SECOND quiz runtime: it fetched year-tagged rows, read
   * `correct_answer_index` in the browser, graded there, and persisted nothing.
   * It is now a launcher into THIS page, and the year is the one thing it still
   * carries — a question-SELECTION hint handed to assembleQuiz. It changes
   * WHICH questions are served and nothing else: shuffle snapshot, anti-cheat,
   * scoring and the atomic submit are the standard path (P1/P2/P3/P4 untouched).
   */
  const [pyqYear, setPyqYear] = useState<number | null>(null);

  // Written answer evaluation state
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [lastWrittenAnswer, setLastWrittenAnswer] = useState<string>('');
  const [lastWrittenTimeSpent, setLastWrittenTimeSpent] = useState<number>(0);
  const [currentEval, setCurrentEval] = useState<{
    marks_awarded: number;
    marks_possible: number;
    feedback: string;
    is_correct: boolean;
    key_points?: { point: string; hit: boolean }[];
    model_answer_summary?: string;
    grade?: string;
    percentage?: number;
  } | null>(null);

  // Cognitive 2.0 state
  const [cogLoad, setCogLoad] = useState<CognitiveLoadState>(initialCognitiveLoad());
  const [reflection, setReflection] = useState<ReflectionPrompt | null>(null);

  // Emotional feedback state
  const [feedbackState] = useState<FeedbackState>(() => createFeedbackState());
  const [activeFeedback, setActiveFeedback] = useState<FeedbackResult | null>(null);

  // Quiz state
  const [questions, setQuestions] = useState<Question[]>([]);
  // shuffleMaps is retained as a state slot for the legacy fallback path —
  // when startQuizSession() returns null and we serve original-order
  // questions, the maps are all-null. The server-shuffle path (Phase A)
  // also stores all-null because the server delivered options pre-shuffled
  // and selected_displayed_index is just the index the user clicked.
  const [shuffleMaps, setShuffleMaps] = useState<Array<number[] | null>>([]);
  // P0 fix: server-owned quiz session ID. When non-null, submitQuizResults
  // routes through submit_quiz_results_v2 (snapshot-backed scoring).
  const [serverSessionId, setServerSessionId] = useState<string | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [responses, setResponses] = useState<Response[]>([]);
  const [showExplanation, setShowExplanation] = useState(false);
  const [hintLevel, setHintLevel] = useState(0);
  // D6: per-question confidence prompt state, keyed by question id.
  // number = value tapped (1-5); 'dismissed' = auto-dismissed/ignored (never
  // re-shown for that question). Absent key + sampled index → prompt renders.
  const [confidenceByQid, setConfidenceByQid] = useState<Record<string, number | 'dismissed'>>({});
  const [timer, setTimer] = useState(0);
  const [questionTimer, setQuestionTimer] = useState(0);
  const [changedAnswersCount, setChangedAnswersCount] = useState(0);
  // Screen 07 "Practice" (`ff_quiz_v2`) — immediate per-question feedback via
  // check_quiz_answer() (migration 20260802130000). Keyed by question_id.
  // 'unavailable' = confirmed but no immediate verdict could be obtained
  // (no server session for this question, or the RPC returned null —
  // offline/failure). See confirmAnswerPracticeV2 below for the full
  // offline-degrade design rationale.
  const [answerChecks, setAnswerChecks] = useState<Record<string, QuizAnswerCheck | 'unavailable'>>({});
  const [checkingAnswer, setCheckingAnswer] = useState(false);
  // PRIMARY "no retry after reveal" enforcement: a synchronous, ref-based
  // guard checked BEFORE any state update or RPC call in
  // confirmAnswerPracticeV2, so even two click/tap events that both fire
  // before React re-renders can only ever pass through once per question
  // id. This is the frontend state-machine responsibility the
  // check_quiz_answer migration's header comment explicitly calls out as
  // the primary enforcement point — the RPC's own replay-lock is
  // defense-in-depth only, not a substitute for this guard.
  const confirmedPracticeQuestionIdsRef = useRef<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [noQuestionsError, setNoQuestionsError] = useState(false);
  const [noQuestionsMessage, setNoQuestionsMessage] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── TRUE ELAPSED TIME — THE SINGLE DERIVATION (P0 fix, 2026-08-11) ───────
  // `timer` counts UP in practice/cognitive but DOWN in exam mode, so it is
  // the time REMAINING there, not elapsed. It was being passed raw as the
  // RPC's `p_time`, which inverted P3 Check 1 (`p_time / questions < 3s` →
  // flag → XP 0): a student who used almost the whole exam window submitted
  // p_time ≈ 0 and was flagged, every exam that auto-submitted at `timer === 0`
  // was flagged by construction, and a rusher who left 25 minutes on the clock
  // sailed through. The correct conversion already existed a hundred lines
  // below (the exam_simulations write) but the submit call never used it.
  //
  // Derive it ONCE, here. Every consumer — the submit RPC (both the happy path
  // and the retry path), the client-side advisory anti-cheat check, the
  // exam_simulations row and the quiz_completed analytics event — reads THIS
  // value. There is deliberately no second site left that could forget the
  // count-down conversion. P3's 3s/question threshold is unchanged.
  const elapsedSeconds = computeElapsedSeconds({
    quizMode,
    timer,
    examTimeLimitMinutes: examTimeLimit,
  });

  // Results state.
  // Marking-Authenticity Wave 2: extended with optional xp_capped / xp_uncapped /
  // idempotent_replay so QuizResults can render the cap banner + replay subtitle.
  // These fields originate in /api/quiz/submit; older submission paths leave
  // them undefined and the banner stays hidden (no behavior change).
  const [results, setResults] = useState<{
    total: number; correct: number; score_percent: number; xp_earned: number; session_id: string;
    xp_capped?: boolean;
    xp_uncapped?: number;
    idempotent_replay?: boolean;
    // SLC-5: server anti-cheat verdict. When the authoritative RPC trips any of
    // the 3 P3 checks it returns flagged=true with the REAL score_percent and
    // xp_earned=0. The client surfaces a gentle, non-accusatory note (below) and
    // NEVER overrides the recorded score. Older/fallback paths leave it undefined.
    flagged?: boolean;
  } | null>(null);

  // Network error resilience — retry support for failed submissions
  const [networkError, setNetworkError] = useState<string | null>(null);
  const pendingSubmissionRef = useRef<Response[] | null>(null);

  // Phase 3A Wave A — teacher-assigned remediation completion seam. When the
  // quiz was launched from a "from your teacher" Today item, the deep link
  // carries ?from=teacher&remediationId=<assignmentId>. On COMPLETION (results
  // screen with a real result) we fire POST /api/rhythm/remediation/[id]/resolve
  // ONCE to flip the assignment to resolved. This touches NONE of the
  // scoring/XP/anti-cheat/submit path (P1/P2/P3/P4 untouched) — the resolve
  // route owns the status flip; the quiz graded as a normal student quiz.
  const remediationResolvedRef = useRef(false);

  // F4 (Foxy North-Star Phase 0): question_id → concept_mastery.mastery_probability
  // for the CURRENT quiz's topics. Populated by ONE batched fire-and-forget
  // fetch at quiz start (never blocks quiz load); read by classifyError with
  // an explicit 0.5 fallback for topics with no concept_mastery row.
  const masteryByQidRef = useRef<Record<string, number>>({});
  // F2 (Foxy North-Star Phase 0): question_bank id → spaced_repetition_cards id
  // for /quiz?mode=srs sessions. After a successful submit, each answered
  // question's card is graded fire-and-forget via the EXISTING
  // /api/learner/review/grade endpoint (which owns the SM-2 math). Cleared
  // after grading fires (and on any non-SRS quiz start) so a card can never
  // be graded twice for one session.
  const srsCardIdByQidRef = useRef<Record<string, string>>({});

  // JEE/NEET tag mode — grades 11-12 only, persisted to localStorage
  const [jeeNeetMode, setJeeNeetMode] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = localStorage.getItem('alfanumrik_jee_neet_mode');
    if (stored !== null) setJeeNeetMode(stored === 'true');
    else {
      const g = student?.grade ?? '9';
      if (g === '11' || g === '12') setJeeNeetMode(true);
    }
  }, [student?.grade]);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
    if (!isLoading && isLoggedIn && !student && activeRole !== 'student') {
      router.replace(activeRole === 'teacher' ? '/teacher' : activeRole === 'guardian' ? '/parent' : '/');
    }
  }, [isLoading, isLoggedIn, student, activeRole, router]);

  // Check URL params for pre-selected subject/mode (passed as initial values to QuizSetup)
  const [initialSubject, setInitialSubject] = useState<string | null>(null);
  const [initialMode, setInitialMode] = useState<QuizMode>('cognitive');
  const [initialCount, setInitialCount] = useState<number>(10);
  const [initialChapter, setInitialChapter] = useState<number | null>(null);
  // E5: live (subject, chapter) from QuizSetup — feeds PrereqSuggestion above.
  const [setupSelection, setSetupSelection] = useState<{ subject: string | null; chapter: number | null }>({
    subject: null,
    chapter: null,
  });
  // Adaptive deep-links emitted by Daily Rhythm / adaptive surfaces:
  //   /quiz?qid=<question_bank id> → start a quiz with that question first
  //   /quiz?mode=srs               → review quiz sourced from due SRS cards
  // Both are fail-soft: any fetch failure / empty result falls back to the
  // normal setup screen. Neither link carries a subject param, so the
  // handler derives it from the fetched question / due cards.
  const [deepLink, setDeepLink] = useState<
    | { kind: 'qid'; qid: string }
    | { kind: 'srs'; subject: string | null }
    | null
  >(null);
  const deepLinkFiredRef = useRef(false);
  // Phase 4 resume: the session id to rebuild, from ?session= or the
  // same-device breadcrumb. Consumed exactly once (resumeFiredRef).
  const [resumeSessionId, setResumeSessionId] = useState<string | null>(null);
  const resumeFiredRef = useRef(false);
  // Flips once the resume attempt has resolved either way. The ?qid= / ?mode=srs
  // deep-link consumer waits on it so a pending resume and a "start this exact
  // quiz" link can never both drive the same page instance.
  const resumeSettledRef = useRef(false);
  // True while THIS page instance is running a resumed session. Used to (a)
  // skip the P6 "all served questions must be freshly assembled" path and
  // (b) keep answered questions immutable — a resumed session starts at the
  // first UNANSWERED question and the runtime has no backward navigation, so
  // an already-recorded answer can never be revisited or changed.
  const [isResumedSession, setIsResumedSession] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const subj = params.get('subject');
    if (subj) {
      // Accept the URL-provided subject; the server will validate on quiz start.
      setSelectedSubject(subj);
      setInitialSubject(subj);
    }
    const mode = params.get('mode');
    // `practice` was the ONLY QuizMode with no branch here, so every
    // `?mode=practice` deep link silently fell through to the 'cognitive'
    // default. Two live surfaces emit it — /assignments (startAssignment) and
    // learn/[subject]/[chapter] ("Take a Quiz") — and PracticeRunner's gate is
    // `quizMode === 'practice'`, so Screen 07 Practice was unreachable from
    // any deep link no matter what `ff_quiz_v2` was set to. Practice is a
    // first-class mode in QuizSetup (its own card, its own difficulty picker),
    // so the correct behaviour is simply to honour it exactly like the other
    // two: preselect the mode and let the student confirm on the setup screen.
    if (mode === 'practice') { setQuizMode('practice'); setInitialMode('practice'); }
    if (mode === 'cognitive') { setQuizMode('cognitive'); setInitialMode('cognitive'); }
    if (mode === 'exam') { setQuizMode('exam'); setInitialMode('exam'); }
    const qid = params.get('qid');
    const QID_UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    const hasExplicitStart = Boolean((qid && QID_UUID_RE.test(qid)) || mode === 'srs');
    if (qid && QID_UUID_RE.test(qid)) {
      setDeepLink({ kind: 'qid', qid });
    } else if (mode === 'srs') {
      setDeepLink({ kind: 'srs', subject: subj });
    }
    // Phase 4 resume deep link: /quiz?session=<uuid>. Emitted by the Today
    // `resume_in_progress` CTA (resolve-next-action.ts). Falls back to the
    // same-device breadcrumb so closing the tab and reopening a bare /quiz
    // still offers to continue — but ONLY when the URL isn't already asking
    // for a specific new quiz (?qid= / ?mode=srs), which must win: an explicit
    // navigation is a stronger signal of intent than a leftover breadcrumb.
    const sessionParam = params.get('session') ?? params.get('sessionId');
    if (isResumeSessionId(sessionParam)) {
      setResumeSessionId(sessionParam);
    } else if (!hasExplicitStart) {
      const breadcrumb = readResumeBreadcrumb();
      if (isResumeSessionId(breadcrumb)) setResumeSessionId(breadcrumb);
    }
    const countParam = params.get('count');
    if (countParam) {
      const c = parseInt(countParam, 10);
      if ((VALID_QUIZ_COUNTS as readonly number[]).includes(c)) {
        setQuestionCount(c);
        setInitialCount(c);
      }
    }
    const chapterParam = params.get('chapter');
    if (chapterParam) {
      const ch = parseInt(chapterParam, 10);
      if (!isNaN(ch) && ch > 0) {
        setSelectedChapter(ch);
        setInitialChapter(ch);
      }
    }
    // PYQ launcher deep link: /quiz?subject=<code>&year=<board paper year>.
    // Bounded to the range CBSE board papers plausibly exist in, so a junk or
    // hostile `?year=` can never reach the assembler's tag filter. Out-of-range
    // simply leaves pyqYear null and the quiz assembles normally.
    const yearParam = params.get('year');
    if (yearParam) {
      const yr = parseInt(yearParam, 10);
      if (isPyqYear(yr)) setPyqYear(yr);
    }
  }, []);

  // Track whether exam auto-submit has fired (prevents double-submit)
  const examAutoSubmittedRef = useRef(false);

  // Global timer (counts up for practice/cognitive, starts from limit for exam)
  useEffect(() => {
    if (screen === 'quiz') {
      if (quizMode === 'exam' && !examTimerActive) {
        setTimer(examTimeLimit * 60); // set to limit in seconds
        setExamTimerActive(true);
        examAutoSubmittedRef.current = false;
      }
      timerRef.current = setInterval(() => {
        setTimer(t => {
          if (quizMode === 'exam') {
            if (t <= 1) {
              // Time's up — auto-submit
              if (timerRef.current) clearInterval(timerRef.current);
              return 0;
            }
            return t - 1;
          }
          return t + 1;
        });
      }, 1000);
      return () => { if (timerRef.current) clearInterval(timerRef.current); };
    }
    setExamTimerActive(false);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [screen, quizMode, examTimeLimit, examTimerActive]);

  // Exam auto-submit: when timer reaches 0, trigger submission
  useEffect(() => {
    if (screen === 'quiz' && quizMode === 'exam' && timer === 0 && examTimerActive && !examAutoSubmittedRef.current) {
      examAutoSubmittedRef.current = true;
      nextQuestion();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only fire on timer reaching 0
  }, [timer, screen, quizMode, examTimerActive]);

  // Phase 3A Wave A — teacher-remediation completion flip. Fires ONCE when the
  // results screen renders WITH a real result AND the quiz was launched from a
  // teacher-assigned Today item (deep link carried ?from=teacher&remediationId).
  // The resolve route is idempotent + student-scoped server-side, so a retry or
  // double-render is harmless. Fire-and-forget — never blocks the results UI,
  // never logs PII (P13). No scoring/XP/submit coupling (P1/P2/P3/P4 untouched).
  useEffect(() => {
    if (screen !== 'results' || !results) return;
    if (remediationResolvedRef.current) return;
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    if (params.get('from') !== 'teacher') return;
    const assignmentId = params.get('remediationId');
    const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!assignmentId || !UUID_RE.test(assignmentId)) return;

    remediationResolvedRef.current = true;
    (async () => {
      try {
        await fetch(`/api/rhythm/remediation/${assignmentId}/resolve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        });
        // Best-effort: the assignment owns its lifecycle. A failure simply means
        // the next /today read re-surfaces it and a re-attempt will resolve it.
      } catch {
        /* swallow — no PII, no user-facing error for this background flip */
      }
    })();
  }, [screen, results]);

  // Student-facing teacher assignments — completion recording. Fires ONCE
  // when the results screen renders WITH a real result AND the quiz was
  // launched from /assignments (deep link carries ?from=assignment&
  // assignmentId=<id>). Mirrors the teacher-remediation hook above exactly:
  // the assignment is graded as a NORMAL student quiz first (P1/P2/P3/P4
  // untouched); this call only RECORDS the already-computed score/session
  // into assignment_submissions so the teacher's existing grading screen
  // (/teacher/submissions) sees it. Fire-and-forget, no PII (P13).
  const assignmentCompletionRecordedRef = useRef(false);
  useEffect(() => {
    if (screen !== 'results' || !results) return;
    if (assignmentCompletionRecordedRef.current) return;
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    if (params.get('from') !== 'assignment') return;
    const assignmentId = params.get('assignmentId');
    const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!assignmentId || !UUID_RE.test(assignmentId) || !results.session_id) return;

    assignmentCompletionRecordedRef.current = true;
    (async () => {
      try {
        await fetch(`/api/student/assignments/${assignmentId}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
          body: JSON.stringify({ session_id: results.session_id }),
        });
        // Best-effort: a failure here only means the teacher's submissions
        // view won't show this attempt yet — the student's own score/XP
        // (already recorded via the normal quiz path above) is unaffected.
      } catch {
        /* swallow — no PII, no user-facing error for this background write */
      }
    })();
  }, [screen, results]);

  // Per-question timer
  useEffect(() => {
    if (screen === 'quiz' && !showExplanation) {
      setQuestionTimer(0);
      qTimerRef.current = setInterval(() => setQuestionTimer(t => t + 1), 1000);
      return () => { if (qTimerRef.current) clearInterval(qTimerRef.current); };
    }
    return () => { if (qTimerRef.current) clearInterval(qTimerRef.current); };
  }, [screen, currentIdx, showExplanation]);

  /**
   * P6: Runtime question quality gate — filter out malformed questions before
   * serving.
   *
   * KEYLESS (migration 20260814000023): the `correct_answer_index` 0-3 clause
   * that used to close the MCQ block is GONE FROM HERE. It is the single reason
   * every serving path had to ship the answer key to the browser, and it now
   * lives in `public.question_bank_p6_valid` — applied as a filter inside
   * `select_quiz_questions_rag` / `select_quiz_questions_v2` /
   * `get_quiz_questions`, and as a hard skip inside `start_quiz_session`.
   *
   * That relocation is only sound because `start_quiz_session` is on the path
   * of EVERY question this page renders, including the pinned deep-link and SRS
   * sets that never touch a serving RPC. The merge below drops any question the
   * server declined to snapshot, which is how a P6 rejection reaches the UI.
   *
   * Every key-FREE check stays here (text, template markers, 4 non-empty
   * options) — this is defence in depth against a malformed payload, not the
   * primary gate.
   */
  function isValidQuestion(q: Question): boolean {
    // Text must be non-empty and free of template markers
    if (!q.question_text || q.question_text.length < 5) return false;
    if (q.question_text.includes('{{') || q.question_text.includes('[BLANK]')) return false;

    // MCQ-specific validation
    if (isQuestionMCQ(q)) {
      const qOpts = Array.isArray(q.options) ? q.options : (() => { try { return JSON.parse(q.options as string); } catch { return []; } })();
      if (qOpts.length !== 4) return false;
      if (qOpts.some((o: string) => !o || String(o).trim() === '')) return false;
    }

    return true;
  }

  const startQuiz = useCallback(async (opts?: {
    subject?: string;
    difficulty?: number | null;
    questionCount?: number;
    quizMode?: QuizMode;
    examTimeLimit?: number;
    chapterNumber?: number | null;
    questionTypes?: string[];
    /**
     * Adaptive deep-link support (?qid= / ?mode=srs): pre-fetched, P6-valid
     * question_bank rows to serve FIRST in the quiz. Everything downstream
     * (P6 gate, server shuffle snapshot, anti-cheat, atomic submit) is the
     * normal pipeline — deep links only change WHICH questions are served.
     */
    pinnedQuestions?: Question[];
    /** When true, serve ONLY pinnedQuestions (SRS review quiz) — skip pool assembly. */
    pinnedOnly?: boolean;
  }) => {
    // When called from QuizSetup, apply the selected options to page state
    const subj = opts?.subject ?? selectedSubject;
    const diff = opts?.difficulty !== undefined ? opts.difficulty : selectedDifficulty;
    const qCount = opts?.questionCount ?? questionCount;
    const chapter = opts?.chapterNumber !== undefined ? opts.chapterNumber : selectedChapter;
    const qTypes = opts?.questionTypes ?? selectedQuestionTypes;
    if (opts) {
      if (opts.subject !== undefined) setSelectedSubject(opts.subject);
      if (opts.difficulty !== undefined) setSelectedDifficulty(opts.difficulty);
      if (opts.questionCount !== undefined) setQuestionCount(opts.questionCount);
      if (opts.quizMode !== undefined) setQuizMode(opts.quizMode);
      if (opts.examTimeLimit !== undefined) setExamTimeLimit(opts.examTimeLimit);
      if (opts.chapterNumber !== undefined) setSelectedChapter(opts.chapterNumber);
      if (opts.questionTypes !== undefined) setSelectedQuestionTypes(opts.questionTypes);
    }
    if (!subj || !student) return;
    setLoading(true);
    setNoQuestionsError(false);
    setNoQuestionsMessage('');
    try {
      const diffModeMap: Record<string, string> = { '1': 'easy', '2': 'medium', '3': 'hard' };
      const diffMode = diff != null ? (diffModeMap[String(diff)] || 'mixed') : (opts?.quizMode === 'cognitive' ? 'progressive' : 'mixed');

      // Adaptive deep-link pinning: pre-validated question_bank rows served
      // FIRST. `pinnedOnly` (SRS review deep link) means the pinned set IS
      // the quiz — skip pool assembly entirely.
      const pinned = (opts?.pinnedQuestions ?? []).filter(p => isValidQuestion(p));
      const pinnedOnly = Boolean(opts?.pinnedOnly) && pinned.length > 0;

      // Guaranteed Count Assembler — ensures exact requested count or explicit failure.
      // Honor the user's question-type selection from QuizSetup (MCQ Only / Short Answer
      // / Long Answer / Mixed / NCERT Exercise). Hardcoding ['mcq'] silently dropped
      // the picker selection — reported 2026-05-09.
      const result = pinnedOnly
        ? { success: true, questions: [] as Question[], returnedCount: pinned.length }
        : await assembleQuiz({
            subject: subj,
            grade: student.grade,
            requestedCount: qCount,
            difficulty: diffMode,
            chapter: chapter ?? null,
            questionTypes: qTypes && qTypes.length > 0 ? qTypes : ['mcq'],
            mode: opts?.quizMode ?? quizMode,
            // PYQ launcher (`/pyq` → `/quiz?...&year=`). Null for every other
            // entry point, in which case the assembler behaves exactly as before.
            pyqYear,
          });

      // Deep-link fail-soft: when a pinned question exists, tolerate a
      // partial/failed pool fill instead of surfacing the count error — the
      // pinned question always leads and the quiz starts with whatever the
      // pool could supply.
      if (!result.success && pinned.length === 0) {
        const onlyMcq = qTypes.length === 1 && qTypes[0] === 'mcq';
        const typeLabel = onlyMcq
          ? ''
          : qTypes.includes('mcq') && qTypes.length > 1
            ? (isHi ? ' मिश्रित ' : ' Mixed ')
            : qTypes[0] === 'short_answer'
              ? (isHi ? ' लघु उत्तर ' : ' Short Answer ')
              : qTypes[0] === 'long_answer'
                ? (isHi ? ' दीर्घ उत्तर ' : ' Long Answer ')
                : qTypes[0] === 'ncert'
                  ? (isHi ? ' NCERT ' : ' NCERT ')
                  : '';

        // Auto-reduce: when the pool has ≥5 MCQ questions but fewer than
        // requested, silently retry with the largest valid count that fits.
        // Guard (autoCount !== qCount) prevents infinite re-entry.
        const VALID_COUNTS_ASC = [5, 10, 15, 20] as const;
        const autoCount = VALID_COUNTS_ASC
          .filter(n => n <= result.returnedCount)
          .at(-1);

        if (onlyMcq && autoCount !== undefined && autoCount !== qCount) {
          // Retry with reduced count — exit the current startQuiz invocation.
          void startQuiz({ ...(opts ?? {}), questionCount: autoCount });
          return;
        }

        // Hard error — auto-reduce not possible (pool < 5, non-MCQ, or already
        // at the minimum valid count).
        if (result.returnedCount === 0) {
          setNoQuestionsError(true);
          setNoQuestionsMessage(
            !onlyMcq
              ? (isHi
                  ? `अभी${typeLabel}प्रश्न उपलब्ध नहीं हैं। कृपया "केवल MCQ" चुनें।`
                  : `No${typeLabel}questions available yet for this chapter. Please pick "MCQ Only" for now.`)
              : (isHi
                  ? 'इस अध्याय में अभी प्रश्न नहीं हैं।'
                  : 'No questions available for this chapter yet.')
          );
        } else {
          setNoQuestionsError(true);
          setNoQuestionsMessage(
            isHi
              ? `केवल ${result.returnedCount}${typeLabel}प्रश्न उपलब्ध हैं (${qCount} चाहिए)। कृपया अन्य अध्याय या प्रश्न प्रकार आज़माएँ।`
              : `Only ${result.returnedCount}${typeLabel}questions available (${qCount} needed). Try another chapter or question type.`
          );
        }
        setLoading(false);
        return;
      }

      // P6 last-line quality gate (SLC-7): filter malformed questions OUT of the
      // assembled set BEFORE they reach the student. Defense-in-depth behind the
      // upstream quiz-generator oracle (REG-54) + DB constraints. Filtering only
      // REMOVES malformed items; it never alters scoring. Because we filter here
      // — before startQuizSession (mcqIds) snapshots the server shuffle and before
      // setQuestions renders — the served (filtered) set is the single set that is
      // shuffled, rendered, answered, counted, and submitted. So P1
      // (score = round(correct / served * 100)) and the P4 RPC snapshot stay
      // consistent on the ACTUAL served count.
      // Pinned questions lead; pool questions fill the remaining slots
      // (deduped by id, capped at the requested count).
      const pinnedIds = new Set(pinned.map(p => p.id));
      const assembledQs = pinned.length > 0
        ? [...pinned, ...result.questions.filter((q: Question) => !pinnedIds.has(q.id))].slice(0, qCount)
        : result.questions;
      const qs = assembledQs.filter((q: Question) => isValidQuestion(q));
      const droppedCount = assembledQs.length - qs.length;
      if (droppedCount > 0) {
        // Structured, PII-free warning (P13) so content QA can observe malformed
        // serves. Logs only content-pool descriptors + counts — never any
        // student-identifiable data.
        console.warn('[Quiz][P6] Filtered malformed questions before serving', {
          subject: subj,
          grade: student.grade,
          requested: assembledQs.length,
          served: qs.length,
          dropped: droppedCount,
        });
      }

      // If the gate leaves zero valid questions, do NOT start an empty/broken
      // quiz — surface a clean bilingual (P7) error/empty state instead.
      if (qs.length === 0) {
        setNoQuestionsError(true);
        setNoQuestionsMessage(
          isHi
            ? 'मान्य प्रश्न लोड नहीं हो सके। कृपया फिर से कोशिश करें।'
            : "Couldn't load valid questions. Please try again."
        );
        setLoading(false);
        return;
      }

      // P0 fix (migration 20260428160000): move shuffle authority to server.
      // For MCQ questions, ask the server to generate the shuffle and snapshot
      // options + correct_answer_index. The server returns options already in
      // display order; selected_option is just the displayed index.
      //
      // P0 fix (2026-08-11): the id list is EVERY served question, not just the
      // MCQ ones. start_quiz_session writes one quiz_session_shuffles row per
      // id it is handed, and that table is BOTH the per-response snapshot
      // submit_quiz_results_v2 looks up AND the "how many questions were
      // served" source for P3 anti-cheat Check 3. Passing only MCQ ids left
      // written (SA/MA/LA/NCERT) questions with no row at all, so the RPC
      // raised session_not_started and destroyed the whole submission — and a
      // PURE written quiz produced an empty list, skipped the RPC entirely and
      // submitted with p_session_id = NULL, which missed for every response.
      // start_quiz_session already stores a non-MCQ row correctly (identity
      // shuffle + empty options snapshot, migration 20260801100800).
      const sessionQuestionIds = collectSessionQuestionIds(qs);
      let session: Awaited<ReturnType<typeof startQuizSession>> = null;
      if (sessionQuestionIds.length > 0 && student) {
        session = await startQuizSession(student.id, sessionQuestionIds);
      }

      let displayQuestions = qs;
      if (session && session.session_id && Array.isArray(session.questions)) {
        // Merge server-shuffled options into the original question objects so
        // downstream UI (Bloom, hints, explanations, written-answer fields)
        // keeps working untouched. The server returns options in shuffled
        // order; we replace `options` so getShuffledOptions() (now an
        // identity helper) renders them as-is.
        const byId = new Map(session.questions.map(s => [s.question_id, s]));
        // ── SERVER-SIDE P6 REJECTION CHANNEL (migration 20260814000023) ──────
        // start_quiz_session now SKIPS any question that fails
        // `public.question_bank_p6_valid` — no snapshot row, and absent from
        // `session.questions`. Absence is therefore no longer just "unknown id";
        // it is the server saying "this question is not gradeable, do not serve
        // it". Previously this branch kept the question (`if (!s) return q`),
        // which after the keyless change would render a question the client
        // cannot validate and the server refused to snapshot.
        //
        // This is the ONLY way a P6 failure reaches the pinned deep-link / SRS
        // sets, which never pass through a serving RPC.
        const droppedByServerP6 = qs.filter((q: Question) => !byId.has(q.id));
        if (droppedByServerP6.length > 0) {
          // PII-free (P13): content-pool descriptors + counts only.
          console.warn('[Quiz][P6] Server declined to snapshot questions; dropping before serve', {
            subject: subj,
            grade: student.grade,
            requested: qs.length,
            dropped: droppedByServerP6.length,
          });
        }
        displayQuestions = qs.filter((q: Question) => byId.has(q.id)).map((q: Question) => {
          const s = byId.get(q.id);
          if (!s) return q; // unreachable after the filter above; keeps types honest
          // Non-MCQ questions are now snapshotted too (see sessionQuestionIds
          // above), and the server returns an EMPTY options_displayed for them.
          // Only a real 4-option MCQ snapshot may rewrite the question object —
          // otherwise a written question would have its options blanked and its
          // correct_answer_index stamped, for no benefit. Leaving it untouched
          // keeps the written-answer renderer byte-identical to before.
          if (!Array.isArray(s.options_displayed) || s.options_displayed.length !== 4) {
            return q;
          }
          return {
            ...q,
            options: s.options_displayed,
            // The server intentionally does NOT return correct_answer_index.
            // Set it to -1 client-side to make any accidental client-side
            // comparison fail loudly instead of silently scoring wrong.
            // (The review screen reads correct_option_text from the v2 RPC
            // response, not from this field.)
            correct_answer_index: -1,
          };
        });
        setServerSessionId(session.session_id);
        // Phase 4: same-device resume breadcrumb (session id only — never any
        // answer, option or correctness). Lets a student who simply closed the
        // tab reopen a bare /quiz and be offered their session back, without
        // routing through /today. The server still authorises every read.
        writeResumeBreadcrumb(session.session_id);
      } else {
        // Server session unavailable — fall back to original-order render.
        // Without a shuffle, selected_option IS the original index, so
        // legacy v1 scoring still works correctly.
        setServerSessionId(null);
        // No server session means nothing durable to come back to; drop any
        // breadcrumb so a later visit can't offer to resume a DIFFERENT,
        // older session while this un-resumable one is the live quiz.
        clearResumeBreadcrumb();
      }

      // If the SERVER-side P6 gate emptied the set (every candidate was
      // ungradeable), do not start a zero-question quiz — surface the same
      // bilingual (P7) empty state the client-side gate above uses. Mirrors the
      // `qs.length === 0` guard so both P6 layers fail the same way.
      if (displayQuestions.length === 0) {
        setServerSessionId(null);
        clearResumeBreadcrumb();
        setNoQuestionsError(true);
        setNoQuestionsMessage(
          isHi
            ? 'मान्य प्रश्न लोड नहीं हो सके। कृपया फिर से कोशिश करें।'
            : "Couldn't load valid questions. Please try again."
        );
        setLoading(false);
        return;
      }

      // F2: an SRS card map only survives into a pinnedOnly (SRS review)
      // session — any other quiz start clears it so stale mappings from an
      // abandoned SRS session can never grade cards against a normal quiz.
      if (!pinnedOnly) srsCardIdByQidRef.current = {};

      // F4: ONE batched fetch at quiz start — topics of the served questions
      // → concept_mastery.mastery_probability. Fire-and-forget (quiz start
      // latency unaffected); classifyError falls back to 0.5 until/unless it
      // resolves, and permanently for topics with no mastery row.
      masteryByQidRef.current = {};
      void fetchTopicMasteryByQuestionId(supabase, student.id, qs.map((qq: Question) => qq.id))
        .then((m) => { masteryByQidRef.current = m; })
        .catch(() => { /* keep {} — classifyError uses the 0.5 fallback */ });

      setQuestions(displayQuestions);
      // shuffleMaps stays all-null in both Phase A paths; see comment at
      // state declaration.
      setShuffleMaps(displayQuestions.map(() => null));
      setCurrentIdx(0);
      setResponses([]);
      setSelectedOption(null);
      setChangedAnswersCount(0);
      setShowExplanation(false);
      setTimer(0);
      // Screen 07 "Practice" v2 state — fresh quiz, fresh check-answer state.
      setAnswerChecks({});
      setCheckingAnswer(false);
      confirmedPracticeQuestionIdsRef.current = new Set();
      // Phase 4: this is a brand-new session, not a resumed one.
      setIsResumedSession(false);
      setCogLoad(initialCognitiveLoad());
      setReflection(null);
      // B2C funnel: quiz-start activation event. Fires exactly once per
      // successfully-assembled quiz (after the P6 quality gate, before render).
      // PII-free — only the subject code + grade string (P5). Matches the
      // quiz_started taxonomy in analytics.ts. subj/student are non-null here
      // (guarded at the top of startQuiz).
      track('quiz_started', { subject: subj, grade: student.grade });
      setScreen('quiz');
    } catch (e) {
      console.error('Quiz load error:', e);
      setNoQuestionsError(true);
      setNoQuestionsMessage(
        isHi ? 'क्विज़ लोड करने में समस्या हुई। कृपया फिर से कोशिश करें।' : 'Failed to load quiz. Please try again.'
      );
    }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // `pyqYear` is in the deps deliberately: it is set by an effect that reads
  // the URL AFTER first render, so a callback closed over the initial `null`
  // would drop the board year on the very launch that asked for it.
  }, [selectedSubject, student, questionCount, selectedDifficulty, selectedChapter, selectedQuestionTypes, pyqYear, isHi, router]);

  // ── Adaptive deep-link consumer (?qid= / ?mode=srs) ────────────────────────
  // Fires ONCE (deepLinkFiredRef) when the student profile is loaded and we
  // are still on the setup screen with no quiz load in flight. Both branches
  // are fail-soft: any fetch error, P6 validation failure, or empty due-card
  // set clears the spinner and leaves the student on the normal setup screen
  // (no error banner). Scoring/XP/anti-cheat are untouched — deep links only
  // choose WHICH questions startQuiz serves through its normal pipeline.
  useEffect(() => {
    if (!deepLink || deepLinkFiredRef.current) return;
    if (isLoading || !student) return;          // readiness: profile loaded
    if (screen !== 'select' || loading) return; // readiness: still on setup, idle
    // Phase 4: never race a pending resume (see resumeSettledRef).
    if (resumeSessionId && !resumeSettledRef.current) return;
    deepLinkFiredRef.current = true;

    // KEYLESS (migration 20260814000023): `correct_answer_index` is deliberately
    // absent. Both deep-link branches below feed startQuiz(), which routes
    // through start_quiz_session — and THAT is where the P6 "index 0-3" check
    // now runs (`public.question_bank_p6_valid`). A pinned question that fails
    // it gets no snapshot and is dropped before render (see startQuiz).
    const QB_COLUMNS =
      'id, subject, question_text, question_hi, question_type, options, ' +
      'explanation, explanation_hi, hint, difficulty, ' +
      'bloom_level, chapter_number';

    (async () => {
      setLoading(true);
      try {
        if (deepLink.kind === 'qid') {
          // Single-question deep link: fetch the row (RLS-respecting client),
          // validate P6 shape, then start a quiz with it pinned first and the
          // remaining slots filled by the normal assembler for its subject.
          const { data: row } = await supabase
            .from('question_bank')
            .select(QB_COLUMNS)
            .eq('id', deepLink.qid)
            .eq('is_active', true)
            .maybeSingle();
          const pinnedQ = row as (Question & { subject?: string | null }) | null;
          if (!pinnedQ || !pinnedQ.subject || !isValidQuestion(pinnedQ)) {
            setLoading(false); // fail-soft → normal setup screen
            return;
          }
          const chapterNum =
            typeof pinnedQ.chapter_number === 'number' && pinnedQ.chapter_number > 0
              ? pinnedQ.chapter_number
              : null;
          setInitialSubject(pinnedQ.subject);
          if (chapterNum != null) setInitialChapter(chapterNum);
          await startQuiz({
            subject: pinnedQ.subject,
            chapterNumber: chapterNum,
            pinnedQuestions: [pinnedQ],
          });
          return;
        }

        // kind === 'srs' — review quiz sourced from due SRS cards born from
        // wrong quiz answers. The due filter + subject/dedupe selection live
        // in the SHARED helper (packages/lib/src/learn/srs-quiz-review.ts) so
        // the dashboard lane COUNT and this quiz's CONTENT agree by
        // construction (F3): own active cards, source quiz_wrong_answer,
        // next_review_date <= today, with a question_bank source_id.
        const dueCards = await fetchSrsDueQuizCards(supabase, student.id, {
          subject: deepLink.subject,
        });
        // A quiz session has a single subject — honor the URL filter when
        // present, else use the earliest-due card's subject.
        const reviewSet = selectSrsReviewSet(dueCards, {
          subject: deepLink.subject,
          cap: questionCount, // cap at page count default
        });
        const srsSubject = reviewSet.subject;
        const dueIds = reviewSet.questionIds;
        if (!srsSubject) { setLoading(false); return; }
        if (dueIds.length === 0) { setLoading(false); return; }
        // F2: remember which card each served question came from so the
        // post-submit grade loop can close (question → card → SM-2 grade).
        srsCardIdByQidRef.current = reviewSet.cardIdByQuestionId;
        const { data: rows } = await supabase
          .from('question_bank')
          .select(QB_COLUMNS)
          .in('id', dueIds)
          .eq('is_active', true);
        const byId = new Map(
          ((rows ?? []) as unknown as Question[]).filter(r => isValidQuestion(r)).map(r => [r.id, r])
        );
        // Preserve due order (earliest review first).
        const reviewQs = dueIds
          .map(id => byId.get(id))
          .filter((r): r is Question => Boolean(r));
        if (reviewQs.length === 0) { setLoading(false); return; }
        setInitialSubject(srsSubject);
        await startQuiz({
          subject: srsSubject,
          chapterNumber: null,
          pinnedQuestions: reviewQs,
          pinnedOnly: true,
        });
      } catch {
        // Fail-soft: clear the spinner, stay on the normal setup screen.
        setLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fire-once consumer guarded by deepLinkFiredRef; isValidQuestion/questionCount are stable per render
  }, [deepLink, isLoading, student, screen, loading, startQuiz]);

  // ── Phase 4: session RESUME consumer (/quiz?session=<uuid>) ───────────────
  //
  // Rebuilds an interrupted session from the server-owned snapshot instead of
  // starting a new quiz. Deliberately does NOT call startQuiz/startQuizSession:
  // a resume must never mint a second session id, a second shuffle snapshot,
  // or a second row anywhere (idempotency). It re-hydrates the SAME session.
  //
  // What is restored, and from where:
  //   - the exact question set, in the exact DISPLAYED option order the
  //     student saw (server snapshot + shuffle map — the client is never told
  //     which option is correct, before or after the interruption);
  //   - each already-answered question's OWN selected index and the time the
  //     student actually spent on it (both persisted server-side at answer
  //     time, first-write-wins, so neither can be retro-edited);
  //   - the total-time counter, seeded with the SUM of those per-question
  //     times. That is on-task time, never wall clock: an hour spent away
  //     from the tab contributes exactly zero, so the P3 3s/question floor
  //     cannot be defeated by walking away — and an honest resumer is not
  //     falsely flagged by a counter that restarted at zero.
  //
  // `is_correct` is seeded `false` for restored answers, exactly as
  // confirmAnswer() does in server-shuffle mode: it is a provisional
  // placeholder the submit response overwrites with server truth. It is not,
  // and never becomes, a scoring input (P1).
  //
  // Fail-soft on every branch: any non-resumable reason (already submitted,
  // expired, corrupt, or the immediate-feedback interlock) simply leaves the
  // student on the normal setup screen with no error banner.
  useEffect(() => {
    if (!resumeSessionId || resumeFiredRef.current) return;
    if (isLoading || !student) return;
    if (screen !== 'select' || loading) return;
    resumeFiredRef.current = true;

    (async () => {
      setLoading(true);
      try {
        const result = await fetchQuizResume(resumeSessionId, authHeader);
        if (!result.resumable) {
          // Nothing to come back to — drop the stale breadcrumb so we don't
          // keep re-asking on every future /quiz visit.
          clearResumeBreadcrumb();
          resumeSettledRef.current = true;
          setLoading(false);
          return;
        }

        const restoredQuestions: Question[] = result.questions.map(q => ({
          id: q.question_id,
          question_text: q.question_text,
          question_hi: q.question_hi,
          question_type: q.question_type,
          options: q.options_displayed,
          // Same contract as the server-shuffle start path: the client does
          // NOT know the correct index. -1 makes any accidental client-side
          // comparison fail loudly rather than silently score wrong.
          correct_answer_index: -1,
          explanation: q.explanation,
          explanation_hi: q.explanation_hi,
          hint: q.hint,
          difficulty: q.difficulty,
          bloom_level: q.bloom_level,
          chapter_number: q.chapter_number,
        }));

        // Answered questions lead the payload (see orderResumeRows), so the
        // restored responses are a prefix and the cursor is their count.
        const answered = result.questions.filter(q => q.answered);
        if (answered.some(q => q.selected_displayed_index === null)) {
          // Defensive: an answered row with no usable index would desync the
          // cursor from the response list. Start fresh rather than guess.
          clearResumeBreadcrumb();
          resumeSettledRef.current = true;
          setLoading(false);
          return;
        }

        const restoredResponses: Response[] = answered.map(q => ({
          question_id: q.question_id,
          selected_option: q.selected_displayed_index as number,
          is_correct: false, // provisional — server truth arrives at submit
          time_spent: q.time_spent_seconds ?? 0,
          shuffle_map: null,
          hint_level: 0,
          telemetry: {
            latency_ms: (q.time_spent_seconds ?? 0) * 1000,
            changed_answers_count: 0,
            hints_used: 0,
          },
        }));

        setQuestions(restoredQuestions);
        setShuffleMaps(restoredQuestions.map(() => null));
        setServerSessionId(result.session_id);
        setResponses(restoredResponses);
        setCurrentIdx(Math.min(restoredResponses.length, restoredQuestions.length - 1));
        setSelectedOption(null);
        setChangedAnswersCount(0);
        setShowExplanation(false);
        setHintLevel(0);
        setCurrentEval(null);
        setReflection(null);
        setCogLoad(initialCognitiveLoad());
        setAnswerChecks({});
        setCheckingAnswer(false);
        // Already-answered ids are pre-loaded into the "no retry after reveal"
        // guard so the practice-v2 confirm path can never re-confirm one.
        confirmedPracticeQuestionIdsRef.current = new Set(answered.map(q => q.question_id));
        setSelectedSubject(result.subject);
        setSelectedChapter(result.chapter_number);
        setQuestionCount(restoredQuestions.length);
        // P3: seed the total-time counter with real on-task time (see above).
        setTimer(result.elapsed_seconds);
        // The session's REAL instrument, read back from the server snapshot
        // (`quiz_session_shuffles.session_mode`, migration 20260814000021).
        // `result.mode` can only ever be 'practice' or 'cognitive': the payload
        // builder refuses an `exam` session outright (`exam_not_resumable`) and
        // refuses an unrecorded one (`mode_unknown`), both of which land on the
        // `!result.resumable` branch above.
        //
        // This REPLACES a line that read `if (quizMode === 'exam')
        // setQuizMode('cognitive')`, which was dead code: on a fresh
        // `/quiz?session=<uuid>` load — the only way the resume CTA arrives —
        // the URL carries no `?mode=exam`, so `quizMode` was already the
        // default and the branch never fired. A timed exam attempt therefore
        // resumed silently as an untimed one and was recorded in
        // `quiz_sessions` as though it were the same instrument.
        setQuizMode(result.mode);
        setExamTimerActive(false);
        examAutoSubmittedRef.current = false;
        setIsResumedSession(true);
        writeResumeBreadcrumb(result.session_id);
        track('quiz_started', { subject: result.subject, grade: student.grade });
        resumeSettledRef.current = true;
        setScreen('quiz');
      } catch {
        clearResumeBreadcrumb();
        resumeSettledRef.current = true;
      }
      setLoading(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fire-once consumer guarded by resumeFiredRef
  }, [resumeSessionId, isLoading, student, screen, loading]);

  // parseOptions is imported from @alfanumrik/lib/quiz/options (used by shuffle logic)

  const selectAnswer = (optIdx: number) => {
    if (showExplanation) return;
    if (selectedOption !== null && selectedOption !== optIdx) {
      setChangedAnswersCount(c => c + 1);
    }
    setSelectedOption(optIdx);
  };

  const confirmAnswer = () => {
    if (selectedOption === null) return;
    const q = questions[currentIdx];

    // P0 fix (migration 20260428160000): when serverSessionId is set, the
    // client does NOT know correct_answer_index — the server snapshot is the
    // single source of truth. We mark is_correct as `false` provisionally
    // (won't be sent to v2 RPC; it's just used for client-side UI like
    // anti-cheat patterns). The authoritative is_correct comes back in the
    // submit response. This eliminates the bug class where client and server
    // disagreed on coordinate spaces.
    //
    // Legacy fallback path (serverSessionId === null): no shuffle was
    // applied, so selectedOption is already the original index and we can
    // compare directly to correct_answer_index for live feedback.
    // KEYLESS (20260814000023): the legacy branch below can only run when the
    // client actually holds a key, which no serving path supplies any more.
    // `!clientHasAnswerKey(q)` folds that case into the same neutral, honest
    // "server will tell us" behaviour instead of asserting "wrong".
    const isV2 = serverSessionId !== null || !clientHasAnswerKey(q);
    const originalPicked = shuffledToOriginal(selectedOption, shuffleMaps[currentIdx] ?? null);
    const isCorrect = isV2
      ? false  // unknown until server response — see comment above
      : (originalPicked === q.correct_answer_index);

    // Emotional feedback. In v2 mode we show a neutral "Submitted" reaction
    // instead of correct/wrong, since the answer isn't known yet.
    const fb = isV2
      ? onCorrectAnswer(feedbackState)  // reuse the gentle "submitted" sound
      : (isCorrect ? onCorrectAnswer(feedbackState) : onWrongAnswer(feedbackState));
    playFeedbackSound(fb);
    setActiveFeedback({
      ...fb,
      foxyLine: isV2
        ? {
            en: 'Submitted — check results at end',
            hi: 'जवाब जमा हो गया — नतीजे अंत में देखो',
          }
        : fb.foxyLine,
    });

    // Near-completion nudge (only meaningful in legacy path where we know correctness)
    if (!isV2) {
      const nudge = getNearCompletionNudge(currentIdx, questions.length);
      if (nudge && !isCorrect) {
        setActiveFeedback({ ...fb, foxyLine: nudge });
      }
    }

    // Classify error type for cognitive analysis. In v2 mode this is a
    // best-effort label since isCorrect isn't yet known; the server will
    // re-classify based on its own is_correct.
    const avgTime = responses.length > 0
      ? responses.reduce((a, r) => a + r.time_spent, 0) / responses.length
      : questionTimer;
    // F4: real per-topic mastery from the batched quiz-start fetch. Explicit
    // 0.5 fallback ONLY when this question's topic has no concept_mastery row
    // (or the fire-and-forget fetch hasn't resolved / failed) — the previous
    // hardcoded 0.5 disabled classifyError's two mastery-dependent branches.
    const studentMastery = masteryByQidRef.current[q.id] ?? 0.5;
    // `difficulty` is a NULLABLE column. The fallback lives HERE — at the
    // single point of CONSUMPTION that the fresh and resumed paths both flow
    // through — rather than in whichever loader built the question, which is
    // what let the two paths diverge. It is also behaviour-preserving: this
    // call site previously received a raw NULL on the fresh path, and
    // `classifyError`'s only two difficulty branches (`<= 2`, `>= 3`) take the
    // identical arm for `null` (coerces to 0) and for 2.
    const errorType = classifyError(isCorrect, questionTimer, avgTime, q.difficulty ?? 2, studentMastery);

    setResponses(prev => [...prev, {
      question_id: q.id,
      selected_option: selectedOption,
      is_correct: isCorrect,
      time_spent: questionTimer,
      error_type: errorType,
      // Legacy shuffle_map field — null in both Phase A paths. v2 RPC ignores
      // this field; v1 RPC accepts null and treats selected_option as
      // already-original (correct fallback semantics).
      shuffle_map: null,
      // F8: hint depth captured AT ANSWER TIME (0-3). Server contract field.
      hint_level: Math.min(Math.max(hintLevel, 0), 5),
      telemetry: {
        latency_ms: questionTimer * 1000,
        changed_answers_count: changedAnswersCount,
        hints_used: hintLevel,
      },
    }]);

    // ── Phase 4: PERSIST-IMMEDIATELY (always on, every mode) ──────────────
    // The instant an answer is confirmed it becomes durable server-side, so a
    // refresh / tab close / connection drop between here and final submit no
    // longer loses it. Fire-and-forget by contract: it never blocks the quiz
    // and never throws, and its failure costs only resumability — grading
    // still happens exactly once, at final submit, unchanged (P1/P2/P4).
    //
    // Server-side this is first-write-wins, so a double-tap or a retry cannot
    // rewrite a recorded answer, and neither can a resumed tab.
    //
    // SKIPPED on the practice-v2 branch: there confirmAnswerPracticeV2 calls
    // check_quiz_answer(), which persists the SAME three columns itself
    // (migration 20260802130000). Both writers are replay-locked, so a double
    // write would be harmless — but letting only one own the write keeps
    // check_quiz_answer's `already_answered` flag meaningful for the UI.
    // (The practice-v2 writer does NOT stamp `session_mode`, so such a session
    // resolves to `mode_unknown` and is refused at resume. That is coherent
    // rather than a gap: `practiceV2On` IS `ff_quiz_v2`, and the immediate-
    // feedback interlock already refuses resume for that whole cohort.)
    const practiceV2OwnsPersist = practiceV2On && quizMode === 'practice' && isQuestionMCQ(q);
    if (serverSessionId && !practiceV2OwnsPersist && isQuestionMCQ(q) && selectedOption >= 0) {
      void saveQuizAnswerProgress(
        serverSessionId,
        q.id,
        selectedOption,
        questionTimer,
        authHeader,
        // The instrument, recorded ATOMICALLY with the first persisted answer
        // (migration 20260814000021). Without it a resumed exam attempt ran
        // untimed and nothing on the record could even detect the swap.
        quizMode,
      );
    }

    // In exam mode, skip explanation — go straight to next question
    if (quizMode === 'exam') {
      if (qTimerRef.current) clearInterval(qTimerRef.current);
      if (currentIdx < questions.length - 1) {
        setCurrentIdx(i => i + 1);
        setSelectedOption(null);
        setChangedAnswersCount(0);
        setHintLevel(0);
        return;
      }
      // Last question — submit
      nextQuestion();
      return;
    }

    setShowExplanation(true);
    if (qTimerRef.current) clearInterval(qTimerRef.current);

    // Cognitive load tracking + reflection prompts
    const newCogLoad = updateCognitiveLoad(cogLoad, isCorrect, questionTimer);
    setCogLoad(newCogLoad);
    if (quizMode === 'cognitive' || quizMode === 'practice') {
      const bloom = (q.bloom_level || 'remember') as BloomLevel;
      const prompt = getReflectionPrompt(isCorrect, newCogLoad.consecutiveErrors, newCogLoad.consecutiveCorrect, bloom);
      setReflection(prompt);
    }
  };

  /**
   * D6: student tapped a confidence level on the sampled post-answer prompt.
   * Patches the already-pushed response row for that question (the response
   * is pushed at confirm time; confidence arrives moments later). Clamped to
   * the 1-5 server contract. Never touches time_spent / is_correct (P3/P1).
   */
  const handleConfidenceSelect = (questionId: string, value: ConfidenceValue) => {
    const clamped = Math.min(Math.max(Math.round(value), 1), 5);
    setConfidenceByQid(prev => ({ ...prev, [questionId]: clamped }));
    setResponses(prev => prev.map(r =>
      r.question_id === questionId ? { ...r, confidence: clamped } : r
    ));
  };

  /** D6: prompt auto-dismissed or ignored — never re-show for this question. */
  const handleConfidenceDismiss = (questionId: string) => {
    setConfidenceByQid(prev => ({ ...prev, [questionId]: 'dismissed' }));
  };

  /**
   * Screen "07 Practice" (`ff_quiz_v2`) — wraps the EXISTING confirmAnswer()
   * completely unchanged (same responses[] push, feedback state, cognitive
   * load, reflection prompts, showExplanation — P1/P2/P3/P4 untouched) and
   * additionally asks check_quiz_answer() to reveal THIS ONE question's
   * correctness immediately, exactly once.
   *
   * Offline / RPC-failure degrade — DESIGN DECISION (frontend call, flagged
   * for review in the task report): when checkQuizAnswer() returns null
   * (network error, offline, or any RPC failure), this does NOT enqueue a
   * retry via the pending_writes offline queue
   * (packages/lib/src/offline/store.ts, used by ExamRunner's autosave).
   * It simply marks the question 'unavailable' and lets the student
   * continue — the real, authoritative grading still happens exactly once,
   * at final submit, via the UNCHANGED submitQuizResults() call below.
   * Reasoning:
   *   1. check_quiz_answer() is REPLAY-LOCKED server-side: the FIRST call
   *      that ever reaches it for a (session_id, question_id) pair wins
   *      permanently (see migration 20260802130000's header). A
   *      queued-and-later-replayed offline write is a bad fit for that
   *      semantics — if the student's first attempt was silently queued
   *      while offline and they kept going, a delayed replay firing
   *      minutes later (possibly after they've mentally moved on) risks
   *      confirming a stale/mismatched guess for a feature whose entire
   *      value proposition is IMMEDIATE feedback. A stale reveal is worse
   *      than no reveal.
   *   2. It is safe to skip entirely: this RPC is a pure side-channel
   *      (durability + display), never a scoring input (per the migration's
   *      explicit non-goals). The final submit still grades and records
   *      the session correctly with zero dependency on whether this call
   *      ever succeeded.
   *   3. It keeps "no retry after reveal" simple: exactly one attempt, one
   *      outcome (a verdict or 'unavailable'), never a queued retry that
   *      could resurface a stale verdict for a question the student has
   *      already moved past.
   * A richer "sync when back online" UX is a legitimate future ask, but it
   * needs its own design pass with assessment/architect on the
   * replay-lock interaction — not bolted on here under time pressure.
   */
  const confirmAnswerPracticeV2 = async () => {
    if (selectedOption === null) return;
    const q = questions[currentIdx];
    if (!q) return;
    // PRIMARY guard — see doc comment above. Synchronous; runs before any
    // state update or await, so a second invocation (double-tap, or a
    // second click queued before re-render) is a pure no-op.
    if (confirmedPracticeQuestionIdsRef.current.has(q.id)) return;
    confirmedPracticeQuestionIdsRef.current.add(q.id);

    const selectedAtConfirm = selectedOption;
    const timeAtConfirm = questionTimer;

    // Existing, unchanged confirm flow: pushes to responses[], drives
    // feedback/cognitive-load/reflection state, sets showExplanation(true).
    confirmAnswer();

    if (serverSessionId === null || !isQuestionMCQ(q)) {
      // No server session to ask (legacy fallback path) — do NOT
      // reintroduce client-side correct_answer_index comparison for this
      // flag branch; graceful degrade to the neutral "checked at end" state.
      setAnswerChecks(prev => ({ ...prev, [q.id]: 'unavailable' }));
      return;
    }

    setCheckingAnswer(true);
    try {
      const result = await checkQuizAnswer(serverSessionId, q.id, selectedAtConfirm, timeAtConfirm);
      setAnswerChecks(prev => ({ ...prev, [q.id]: result ?? 'unavailable' }));
      if (result) {
        // Upgrade the neutral "Submitted" reaction confirmAnswer() played
        // above (it can't know correctness in server-shuffle mode) to the
        // real reaction now that the authoritative verdict is in. Reuses
        // the existing feedback-engine helpers — no new scoring/sound logic.
        const fb = result.is_correct ? onCorrectAnswer(feedbackState) : onWrongAnswer(feedbackState);
        playFeedbackSound(fb);
        setActiveFeedback(fb);
      }
    } finally {
      setCheckingAnswer(false);
    }
  };

  // ─── Written answer submission (SA/MA/LA) ─────────────────────────────────
  const handleWrittenSubmit = async (answer: string, timeSpent: number) => {
    const q = questions[currentIdx];
    setIsEvaluating(true);
    setEvalError(null);
    // Save for retry
    setLastWrittenAnswer(answer);
    setLastWrittenTimeSpent(timeSpent);

    let evalResult: { marks_awarded: number; marks_possible: number; feedback: string; is_correct: boolean; key_points?: { point: string; hit: boolean }[]; model_answer_summary?: string } | null = null;

    try {
      const { data: sessData } = await supabase.auth.getSession();
      const token = sessData?.session?.access_token ?? '';
      const resp = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/ncert-question-engine`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({
            action: 'evaluate_answer',
            student_id: student!.id,
            question_id: q.question_id ?? q.id,
            source_table: q.source_table ?? 'question_bank',
            question_text: q.question_text,
            student_answer: answer,
            marks_possible: q.marks_possible ?? 2,
            question_type: q.cbse_type ?? q.question_type,
          }),
        }
      );
      if (resp.ok) {
        evalResult = await resp.json();
      }
    } catch (err) {
      console.warn('Written answer evaluation failed:', err);
    }

    // If evaluation failed (network error, API error, null result), don't punish the student.
    // Show retry/skip options instead of marking wrong.
    if (!evalResult) {
      setIsEvaluating(false);
      setEvalError(
        isHi
          ? 'मूल्यांकन विफल। तुम्हारा जवाब सहेजा गया है — फिर से कोशिश करो या छोड़ दो।'
          : 'Evaluation failed. Your answer is saved — you can retry or skip.'
      );
      return; // Don't auto-advance — let student retry or skip
    }

    // Record the written response
    // Written answers are "correct" if they earn >= 50% of marks.
    // A student who earns 1/2 marks deserves credit, not a red "WRONG" mark.
    const marksAwarded = evalResult.marks_awarded ?? 0;
    const marksPossible = q.marks_possible ?? 2;
    const isCorrect = marksPossible > 0 ? marksAwarded >= marksPossible * 0.5 : false;

    // Emotional feedback
    const fb = isCorrect ? onCorrectAnswer(feedbackState) : onWrongAnswer(feedbackState);
    playFeedbackSound(fb);
    setActiveFeedback({ ...fb });

    setResponses(prev => [...prev, {
      question_id: q.id,
      selected_option: -1, // No option selected for written answers
      is_correct: isCorrect,
      time_spent: timeSpent,
      student_answer_text: answer,
      marks_awarded: marksAwarded,
      marks_possible: marksPossible,
      rubric_feedback: evalResult?.feedback ?? undefined,
      // P1 server-side shuffle fix: written answers are not shuffled,
      // selected_option (-1) is already in original space.
      shuffle_map: null,
      // F8: hint depth captured AT ANSWER TIME (0-3). Server contract field.
      hint_level: Math.min(Math.max(hintLevel, 0), 5),
      telemetry: {
        latency_ms: timeSpent * 1000,
        changed_answers_count: 0,
        hints_used: hintLevel,
      },
    }]);

    // Store full evaluation result for rich feedback display
    setCurrentEval({
      marks_awarded: marksAwarded,
      marks_possible: marksPossible,
      feedback: evalResult.feedback,
      is_correct: isCorrect,
      key_points: evalResult.key_points,
      model_answer_summary: evalResult.model_answer_summary,
      grade: undefined, // grade not returned from this endpoint
      percentage: marksPossible > 0 ? Math.round((marksAwarded / marksPossible) * 100) : 0,
    });

    setIsEvaluating(false);
    setShowExplanation(true);
    if (qTimerRef.current) clearInterval(qTimerRef.current);

    // Update cognitive load
    const newCogLoad = updateCognitiveLoad(cogLoad, isCorrect, timeSpent);
    setCogLoad(newCogLoad);
  };

  const handleWrittenSkip = () => {
    const q = questions[currentIdx];
    setResponses(prev => [...prev, {
      question_id: q.id,
      selected_option: -1,
      is_correct: false,
      time_spent: 0,
      student_answer_text: '',
      marks_awarded: 0,
      marks_possible: q.marks_possible ?? 2,
      rubric_feedback: 'Skipped',
      // P1 server-side shuffle fix: skipped written answers carry no shuffle.
      shuffle_map: null,
      // F8: hint depth captured AT ANSWER (skip) TIME (0-3).
      hint_level: Math.min(Math.max(hintLevel, 0), 5),
      telemetry: {
        latency_ms: 0,
        changed_answers_count: 0,
        hints_used: hintLevel,
      },
    }]);
    // Move to next question
    if (currentIdx < questions.length - 1) {
      setCurrentIdx(i => i + 1);
      setSelectedOption(null);
      setChangedAnswersCount(0);
      setShowExplanation(false);
      setReflection(null);
      setHintLevel(0);
    } else {
      nextQuestion();
    }
  };

  const nextQuestion = async () => {
    if (currentIdx < questions.length - 1) {
      setCurrentIdx(i => i + 1);
      setSelectedOption(null);
      setChangedAnswersCount(0);
      setShowExplanation(false);
      setReflection(null);
      setHintLevel(0);
      setCurrentEval(null);
    } else {
      // Quiz complete — submit results
      if (timerRef.current) clearInterval(timerRef.current);
      setScreen('feedback');
      setLoading(true);
      try {
        const allResponses = [...responses];
        // Add the last response if not already added (only for MCQ — written answers are added by handleWrittenSubmit)
        if (allResponses.length < questions.length) {
          const q = questions[currentIdx];
          if (isQuestionMCQ(q)) {
            // P0 fix (migration 20260428160000): in v2 mode, server re-derives
            // is_correct from the snapshot. In legacy mode, no shuffle is
            // applied so selected_option IS the original index.
            // KEYLESS (20260814000023) — see clientHasAnswerKey.
            const isV2 = serverSessionId !== null || !clientHasAnswerKey(q);
            const lastIsCorrect = isV2
              ? false
              : (selectedOption === q.correct_answer_index);
            allResponses.push({
              question_id: q.id,
              selected_option: selectedOption!,
              is_correct: lastIsCorrect,
              time_spent: questionTimer,
              shuffle_map: null,
              // F8: hint depth captured at answer time (0-3).
              hint_level: Math.min(Math.max(hintLevel, 0), 5),
              telemetry: {
                latency_ms: questionTimer * 1000,
                changed_answers_count: changedAnswersCount,
                hints_used: hintLevel,
              },
            });
          }
        }

        // ── ANTI-CHEAT: Client-side validation before submission (P3) ──
        // SLC-5 convergence: the client is NOT a security boundary (P3/P9). The
        // server RPC (submit_quiz_results_v2) is the single authority — it
        // applies the SAME 3 P3 checks, sets `flagged=true`, zeros XP, but still
        // RECORDS the session with the REAL score_percent.
        //
        // CORRECTION (2026-08-11): that last clause used to be false for one
        // whole class of quiz. When a response had no quiz_session_shuffles
        // row, the RPC RAISEd `session_not_started` BEFORE reaching any of the
        // three checks — so nothing was recorded, no score, no session row. It
        // hit every quiz containing at least one written question, because the
        // client only ever snapshotted MCQ ids. Both halves are fixed (see
        // `sessionQuestionIds` above and migration 20260814000022); the
        // "still RECORDS the session" claim is true again. The client therefore
        // performs these checks ADVISORY-ONLY (warn + telemetry) and ALWAYS
        // proceeds to submitQuizResults. It must NEVER discard the attempt or
        // override the score to 0 — doing so silently destroyed a legitimately
        // fast / edge-case student's work and recorded NO session. Thresholds
        // are UNCHANGED (avg<3s, all-same-index>3 MCQ, count≠count); only the
        // client RESPONSE changed from reject → advisory-submit.
        //
        // 1. Minimum time: 3 seconds avg per question (bots submit instantly).
        // Applies to ALL response types (MCQ, SA, LA). Pure short-answer or
        // long-answer quizzes contain zero MCQ responses, so the previous
        // guard (mcqResponses.length > 0) silently bypassed the check on
        // those quizzes. P3 invariant requires the check whenever any
        // response exists, regardless of question type.
        //
        // `elapsedSeconds`, not `timer`: in exam mode the timer counts DOWN,
        // so the raw value is the time REMAINING and this advisory check would
        // disagree with the server's (see the single derivation at the top of
        // the component).
        const mcqResponses = allResponses.filter(r => r.selected_option >= 0);
        const totalResponses = allResponses.length;
        const avgTimePerQ = totalResponses > 0 ? elapsedSeconds / totalResponses : 0;
        if (totalResponses > 0 && avgTimePerQ < 3) {
          // ADVISORY ONLY — do NOT discard the attempt. The server re-checks
          // this same condition and is the authority on flag + zero-XP.
          console.warn(`[AntiCheat] Quiz completed too fast: ${elapsedSeconds}s for ${totalResponses} questions (avg ${avgTimePerQ.toFixed(1)}s < 3s) — submitting; server is authoritative`);
        }

        // 2. Detect impossible response patterns — FLAG (warn but still submit)
        // If ALL MCQ answers are the same index and >3 MCQ questions, flag as suspicious
        // Written answers (selected_option === -1) are excluded from this check
        const optionCounts = [0, 0, 0, 0];
        mcqResponses.forEach(r => { if (r.selected_option >= 0 && r.selected_option < 4) optionCounts[r.selected_option]++; });
        const maxSameOption = Math.max(...optionCounts);
        if (mcqResponses.length > 3 && maxSameOption === mcqResponses.length) {
          console.warn(`[AntiCheat] All MCQ answers were option ${optionCounts.indexOf(maxSameOption)} — pattern gaming`);
        }

        // 3. Verify response count matches question count.
        // ADVISORY ONLY — do NOT discard the attempt. The server re-checks
        // jsonb_array_length(p_responses) against the number of questions it
        // actually SERVED (COUNT(*) over quiz_session_shuffles for this
        // session — NOT v_total, which is derived from the payload itself and
        // would be a tautology) and is the authority on flag + zero-XP; it
        // still records the session with the real score.
        //
        // That served count is only correct because `sessionQuestionIds`
        // above snapshots EVERY served question. When it snapshotted MCQs
        // only, a mixed quiz had more responses than served rows and would
        // have been flagged here even if it had survived submission at all.
        if (allResponses.length !== questions.length) {
          console.warn(`[AntiCheat] Response count (${allResponses.length}) != question count (${questions.length}) — submitting; server is authoritative`);
        }

        const subMeta = allowedSubjects.find(s => s.code === selectedSubject);
        const res = await submitQuizResults(
          student!.id,
          selectedSubject!,
          student!.grade,
          subMeta?.name || selectedSubject!,
          questions[0]?.chapter_number || 1,
          allResponses,
          elapsedSeconds,  // P0 fix: p_time is ELAPSED, never the exam-mode remainder
          serverSessionId,  // P0 fix: route to v2 RPC when present
        );
        setResults(res);
        // Phase 4: the session is graded — retire the resume breadcrumb so no
        // later visit offers to "continue" a finished quiz. Belt-and-braces
        // only: the resume route independently refuses any session whose
        // idempotency key already appears on a graded quiz_sessions row, so a
        // stale breadcrumb could never reopen a submitted session anyway.
        clearResumeBreadcrumb();
        setIsResumedSession(false);
        // P0 fix: if v2 returned per-question review data, sync the
        // authoritative is_correct back into local responses so QuizResults
        // shows the correct/wrong banner derived from server truth.
        // F6 fix: `allResponses` (built above at the top of this function) is
        // a SEPARATE array from the `responses` React state, and it still
        // holds the provisional `is_correct: false` placeholder used in
        // server-shuffle (v2) mode. It feeds the exam_simulations write,
        // question_responses write, and cognitive-metrics write BELOW this
        // block — so it must be mutated in place with the same server-truth
        // values, not just the `responses` state. (In legacy/non-v2 mode
        // `res.questions` is absent so this loop is a no-op and allResponses
        // keeps its already-correct client-computed values.)
        if (res && Array.isArray((res as { questions?: unknown }).questions)) {
          const reviewByQid = new Map(
            ((res as { questions: Array<{ question_id: string; is_correct: boolean }> }).questions)
              .map(rq => [rq.question_id, rq])
          );
          for (const r of allResponses) {
            const review = reviewByQid.get(r.question_id);
            if (review) r.is_correct = review.is_correct;
          }
          setResponses(prev => prev.map(r => {
            const review = reviewByQid.get(r.question_id);
            return review ? { ...r, is_correct: review.is_correct } : r;
          }));
        }
        // F2 (SRS grade loop close): for /quiz?mode=srs sessions, grade each
        // served card via the EXISTING /api/learner/review/grade endpoint.
        // Runs AFTER the server-truth is_correct sync above (in v2 mode the
        // per-answer is_correct is provisional until the submit response), and
        // fire-and-forget so submit latency is unaffected. The map is cleared
        // first so a retry/double-render can never grade a card twice.
        if (Object.keys(srsCardIdByQidRef.current).length > 0) {
          const srsCardMap = srsCardIdByQidRef.current;
          srsCardIdByQidRef.current = {};
          gradeSrsCardsFireAndForget({
            cardIdByQuestionId: srsCardMap,
            responses: allResponses,
          });
        }
        refreshSnapshot();
        // Invalidate SWR dashboard cache so the dashboard reflects new unlock state
        invalidateDashboard(student!.id);
        // Bust the server-side rhythm cache (30s TTL) so next load sees updated chapter progress
        fetch('/api/rhythm/today', { method: 'POST', credentials: 'same-origin' }).catch(() => {});

        // Update chapter progress after quiz — use chapter from URL param OR from question metadata
        const chapterForProgress = selectedChapter ?? questions[0]?.chapter_number ?? null;
        if (chapterForProgress) {
          updateChapterProgress(selectedSubject!, student!.grade, chapterForProgress).catch((err: unknown) => {
            console.warn('[quiz] chapter progress update failed:', err instanceof Error ? err.message : String(err));
          });
        }

        // REMOVED 2026-08-24 — client-side saveQuestionResponses() write.
        // It inserted a duplicate copy of every response into the legacy
        // `question_responses` table, which has ZERO rows in production and is
        // read by nothing (the 20260623000700/000800 migrations repointed the
        // last readers off it; /api/practice/history and the super-admin bloom
        // reports were repointed in the same change as this one). The write's
        // only error handling was a console.warn, so it had been failing
        // silently and nobody could tell. Per-question rows are already
        // written server-side and atomically by `submit_quiz_results_v2` into
        // `quiz_responses` (P4), which is the table every reader now uses.
        // Nothing is lost by dropping this.
        //
        // CME mastery state is updated server-side by that same v2 RPC: for
        // each response whose question carries a topic_id it calls
        // `update_learner_state_post_quiz`, which is what actually writes
        // concept mastery (migration 20260814000022, lines 714-731).
        // NOTE — do NOT re-attribute this to `atomic_quiz_profile_update`, as
        // an earlier version of this comment did. That is a SEPARATE RPC that
        // only touches profile/XP (students, student_learning_profiles,
        // xp_transactions); it writes neither `quiz_responses` nor mastery.
        // There is no client-side mastery write here and must never be one.

        // Save cognitive metrics for this session (cognitive mode only — tracks ZPD and fatigue)
        if (quizMode === 'cognitive' && res?.session_id) {
          const inZpd = allResponses.filter((_, i) => questions[i]?.difficulty === 2).length;
          const tooEasy = allResponses.filter((_, i) => questions[i]?.difficulty === 1).length;
          const tooHard = allResponses.filter((_, i) => questions[i]?.difficulty === 3).length;
          saveCognitiveMetrics({
            student_id: student!.id,
            quiz_session_id: res.session_id,
            questions_in_zpd: inZpd,
            questions_too_easy: tooEasy,
            questions_too_hard: tooHard,
            zpd_accuracy_rate: inZpd > 0 ? allResponses.filter((r, i) => r.is_correct && questions[i]?.difficulty === 2).length / inZpd : undefined,
            // Retrospective/preparatory telemetry consumer (progress page "Low Energy"
            // badge, exam-prep energy indicator) — intentionally uses the ease-off tier,
            // not the pause tier. See FATIGUE_EASE_OFF_THRESHOLD doc comment in
            // cognitive-engine.ts for why these are deliberately different bars.
            fatigue_detected: cogLoad.fatigueScore > FATIGUE_EASE_OFF_THRESHOLD,
            difficulty_adjustments: cogLoad.shouldEaseOff || cogLoad.shouldPushHarder ? 1 : 0,
            avg_response_time_seconds: allResponses.length > 0
              ? allResponses.reduce((a, r) => a + r.time_spent, 0) / allResponses.length
              : undefined,
          }).catch((err: unknown) => {
            console.warn('[quiz] saveCognitiveMetrics failed:', err instanceof Error ? err.message : String(err));
          });
        }

        // Save exam simulation if in exam mode
        if (quizMode === 'exam' && res?.session_id) {
          const totalMarks = allResponses.length; // 1 mark per question for MCQ
          const obtainedMarks = allResponses.filter(r => r.is_correct).length;
          supabase.from('exam_simulations').insert({
            student_id: student!.id,
            subject: selectedSubject!,
            grade: student!.grade,
            exam_format: 'cbse',
            total_marks: totalMarks,
            obtained_marks: obtainedMarks,
            percentage: totalMarks > 0 ? Math.round((obtainedMarks / totalMarks) * 100 * 100) / 100 : 0,
            // Was `examTimeLimit * 60 - timer` — the CORRECT conversion, but a
            // second, independent copy of it. It is now the shared derivation
            // so the submit RPC and this row can never disagree again.
            time_taken_seconds: elapsedSeconds,
            time_limit_seconds: examTimeLimit * 60,
            is_completed: true,
            completed_at: new Date().toISOString(),
          }).then(() => {});
        }

        track('quiz_completed', {
          subject: selectedSubject!,
          score: res?.score_percent ?? 0,
          questions: allResponses.length,
          grade: student!.grade,
          time_seconds: elapsedSeconds,
        });
      } catch (e) {
        console.error('Submit error:', e);
        // Store pending submission for retry
        pendingSubmissionRef.current = [...responses];
        if (pendingSubmissionRef.current.length < questions.length) {
          const q = questions[currentIdx];
          if (isQuestionMCQ(q) && selectedOption !== null) {
            // P0 fix: same v2/v1 dispatch as the happy path.
            // KEYLESS (20260814000023) — see clientHasAnswerKey.
            const isV2 = serverSessionId !== null || !clientHasAnswerKey(q);
            const lastIsCorrect = isV2
              ? false
              : (selectedOption === q.correct_answer_index);
            pendingSubmissionRef.current.push({
              question_id: q.id,
              selected_option: selectedOption,
              is_correct: lastIsCorrect,
              time_spent: questionTimer,
              shuffle_map: null,
              // F8: hint depth captured at answer time (0-3).
              hint_level: Math.min(Math.max(hintLevel, 0), 5),
            });
          }
        }
        // COPY CORRECTION (2026-08-11): this used to reassure the student
        // that their answers had been stored. That was a false statement on
        // every branch that reaches here — a failed submit writes NO
        // quiz_sessions row and NO quiz_responses rows, so nothing durable
        // exists anywhere. The
        // answers are held in `pendingSubmissionRef` in this tab only, and
        // they are lost on refresh. Say what is actually true: the submission
        // failed, and retry is the way to save it. (P7: bilingual.)
        setNetworkError(isHi
          ? 'कनेक्शन की समस्या — तुम्हारे उत्तर अभी सहेजे नहीं जा सके। पुनः प्रयास करें।'
          : "Connection problem — your answers couldn't be saved yet. Please retry.");
        const total = responses.length;
        const correct = responses.filter(r => r.is_correct).length;
        // SECURITY: When API fails, show score for display only but DO NOT award XP.
        // XP must only be granted by the server after answer validation.
        // Showing xp_earned: 0 with a note that XP will sync when online.
        setResults({
          total,
          correct,
          score_percent: calculateScorePercent(correct, total),
          xp_earned: 0, // XP is ONLY awarded server-side
          session_id: '',
        });
      }
      setLoading(false);
      setScreen('results');

      // Play completion sound
      const completionFb = onSessionComplete(feedbackState);
      playFeedbackSound(completionFb);
    }
  };

  // Retry failed quiz submission (network error recovery)
  const retrySubmit = useCallback(async () => {
    if (!pendingSubmissionRef.current || !student || !selectedSubject) return;
    setLoading(true);
    setNetworkError(null);
    try {
      const allResponses = pendingSubmissionRef.current;
      const subMeta = allowedSubjects.find(s => s.code === selectedSubject);
      const res = await submitQuizResults(
        student.id,
        selectedSubject,
        student.grade,
        subMeta?.name || selectedSubject,
        questions[0]?.chapter_number || 1,
        allResponses,
        elapsedSeconds,  // P0 fix: same single elapsed derivation as the happy path
        serverSessionId,  // P0 fix: v2 path on retry too
      );
      setResults(res);
      if (res && Array.isArray((res as { questions?: unknown }).questions)) {
        const reviewByQid = new Map(
          ((res as { questions: Array<{ question_id: string; is_correct: boolean }> }).questions)
            .map(rq => [rq.question_id, rq])
        );
        setResponses(prev => prev.map(r => {
          const review = reviewByQid.get(r.question_id);
          return review ? { ...r, is_correct: review.is_correct } : r;
        }));
        // Keep the retry payload in sync with server truth (mirrors the F6
        // in-place sync on the happy path) before the F2 grade loop reads it.
        for (const r of allResponses) {
          const review = reviewByQid.get(r.question_id);
          if (review) r.is_correct = review.is_correct;
        }
      }
      // F2 (SRS grade loop close) — retry path mirror of the happy-path call.
      if (Object.keys(srsCardIdByQidRef.current).length > 0) {
        const srsCardMap = srsCardIdByQidRef.current;
        srsCardIdByQidRef.current = {};
        gradeSrsCardsFireAndForget({
          cardIdByQuestionId: srsCardMap,
          responses: allResponses,
        });
      }
      refreshSnapshot();
      // Invalidate SWR dashboard cache so the dashboard reflects new unlock state
      invalidateDashboard(student!.id);
      // Bust the server-side rhythm cache (30s TTL) so next load sees updated chapter progress
      fetch('/api/rhythm/today', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
      pendingSubmissionRef.current = null;

      // Update chapter progress after quiz — use chapter from URL param OR from question metadata
      const chapterForProgress = selectedChapter ?? questions[0]?.chapter_number ?? null;
      if (chapterForProgress) {
        updateChapterProgress(selectedSubject, student.grade, chapterForProgress).catch((err: unknown) => {
          console.warn('[quiz-retry] chapter progress update failed:', err instanceof Error ? err.message : String(err));
        });
      }

      track('quiz_completed', {
        subject: selectedSubject,
        score: res?.score_percent ?? 0,
        questions: allResponses.length,
        grade: student.grade,
        time_seconds: elapsedSeconds,
      });
    } catch (e) {
      console.error('Retry submit error:', e);
      setNetworkError(isHi
        ? 'कनेक्शन की समस्या — तुम्हारे उत्तर अभी सहेजे नहीं जा सके। पुनः प्रयास करें।'
        : "Connection problem — your answers couldn't be saved yet. Please retry.");
    }
    setLoading(false);
  }, [student, selectedSubject, questions, elapsedSeconds, selectedChapter, isHi, refreshSnapshot, serverSessionId, allowedSubjects]);

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  /**
   * Heuristic exam tag for JEE/NEET mode (grades 11-12).
   * Physics numerical-style → JEE Main
   * Biology application → NEET
   * Chemistry with organic keywords → JEE Advanced
   * Else → Board
   */
  function getExamTag(question: Question): { label: string; labelHi: string; color: string } {
    const text = (question.question_text || '').toLowerCase();
    const subject = selectedSubject || '';
    if (subject === 'physics' && /\d+\s*(m\/s|newton|joule|kg|ms|rad|ohm|volt|watt|coulomb|ampere|hertz|pascal)/.test(text)) {
      return { label: 'JEE Main', labelHi: 'JEE मेन', color: '#2563EB' };
    }
    if (subject === 'biology' && (question.bloom_level === 'apply' || question.bloom_level === 'analyze' || /cell|enzyme|hormone|dna|rna|organ|gene|photosynthesis|respirat/.test(text))) {
      return { label: 'NEET', labelHi: 'NEET', color: '#16A34A' };
    }
    if (subject === 'chemistry' && /organic|benzene|alkane|alkene|alkyl|ester|aldehyde|ketone|amine|polymer|aromatic/.test(text)) {
      return { label: 'JEE Adv', labelHi: 'JEE एडवांस', color: '#7C3AED' };
    }
    return { label: 'Board', labelHi: 'बोर्ड', color: '#E8581C' };
  }

  if (isLoading || !student) return <LoadingFoxy />;

  const subMeta = allowedSubjects.find(s => s.code === selectedSubject);
  const q = questions[currentIdx];
  const opts = q ? getShuffledOptions(q, shuffleMaps[currentIdx] ?? null) : [];
  const progress = questions.length > 0 ? ((currentIdx + (showExplanation ? 1 : 0)) / questions.length) * 100 : 0;
  const correctSoFar = responses.filter(r => r.is_correct).length;

  // ═══ NO QUESTIONS AVAILABLE — friendly empty state ═══
  if (noQuestionsError && screen === 'select') {
    const errorSubMeta = allowedSubjects.find(s => s.code === selectedSubject);
    return (
      <div className="mesh-bg min-h-dvh flex flex-col items-center justify-center px-6 gap-5">
        <div className="text-5xl">📭</div>
        <h2 className="font-bold text-lg text-center" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}>
          {isHi ? 'इस विषय में अभी प्रश्न नहीं हैं' : 'No questions available yet'}
        </h2>
        <p className="text-sm text-center max-w-xs" style={{ color: 'var(--text-2)' }}>
          {noQuestionsMessage ||
            (isHi
              ? `${errorSubMeta?.name ?? 'इस विषय'} के लिए पर्याप्त प्रश्न उपलब्ध नहीं हैं। कृपया कोई अन्य विषय या अध्याय चुनें।`
              : `Not enough questions for ${errorSubMeta?.name ?? 'this subject'} right now. Try a different subject or chapter.`)}
        </p>
        <div className="flex gap-3">
          <Button variant="primary" onClick={() => { setNoQuestionsError(false); }}>
            {isHi ? '← विषय बदलें' : '← Change Subject'}
          </Button>
          <Button variant="ghost" onClick={() => router.push('/foxy')}>
            {isHi ? 'Foxy से सीखो' : 'Learn with Foxy'}
          </Button>
        </div>
      </div>
    );
  }

  // ═══ SUBJECT SELECTION SCREEN ═══
  if (screen === 'select') {
    return (
      <div>
        {/* Foxy North-Star Phase 3 (E5) — Prerequisite warm-up suggestion.
            Fetches /api/learn/prereq-check; renders nothing when the flag is
            off (route returns null) or when prereqs are met. Warm-up switches
            the chapter and immediately starts the prereq quiz; dismiss lets
            the student continue with the originally-picked chapter. */}
        <PrereqSuggestion
          isHi={isHi}
          subject={setupSelection.subject}
          grade={student?.grade ?? ''}
          chapter={setupSelection.chapter}
          onWarmUp={(prereqChapter, s) => {
            setInitialChapter(prereqChapter);
            void startQuiz({
              subject: setupSelection.subject ?? initialSubject ?? undefined,
              chapterNumber: prereqChapter,
              quizMode,
              questionCount,
            });
            // Analytics is safe to omit here — the destination click is the
            // authoritative signal; the route redirects to /quiz already.
            void s;
          }}
        />
        <QuizSetup
          isHi={isHi}
          initialSubject={initialSubject}
          initialMode={initialMode}
          initialCount={initialCount}
          initialChapter={initialChapter}
          loading={loading}
          studentGrade={student?.grade ?? ''}
          onStart={startQuiz}
          onGoBack={() => router.push(experienceV3 ? '/today' : '/dashboard')}
          onSelectionChange={setSetupSelection}
        />
      </div>
    );
  }

  // ═══ QUIZ SCREEN ═══
  if (screen === 'quiz' && q) {
    const isAnswered = showExplanation;
    const currentShuffleMap = shuffleMaps[currentIdx] ?? null;
    // P0 fix (migration 20260428160000): in v2 mode, the client does not
    // know correct_answer_index — q.correct_answer_index has been set to -1
    // explicitly to make any accidental comparison fail loudly. The live
    // banner shows "Submitted — check results at end" rather than
    // correct/wrong. In legacy mode (no server session), comparison still
    // works because no shuffle is applied (selected_option IS original).
    // KEYLESS (20260814000023): `!clientHasAnswerKey(q)` folds the legacy
    // no-server-session render into the same neutral treatment. Without it a
    // keyless legacy question would highlight NO option as correct and label a
    // right answer "Not quite" — see clientHasAnswerKey for the full note.
    const isV2Question = serverSessionId !== null || !clientHasAnswerKey(q);
    const originalPicked = selectedOption !== null
      ? shuffledToOriginal(selectedOption, currentShuffleMap)
      : null;
    const isCorrect = !isV2Question && (originalPicked === q.correct_answer_index);

    // Screen 07 "Practice" (Wave B3, `ff_quiz_v2`) — additive branch. Only
    // engages for MCQ questions in practice mode; written-answer questions
    // fall through to the legacy JSX below unchanged (they already show
    // immediate AI-graded feedback via handleWrittenSubmit — no gap to fix
    // there). When the flag is off, this branch never runs and the legacy
    // return below is rendered byte-identical to today.
    // D6: sampled, non-blocking confidence prompt. Renders only AFTER the
    // answer is confirmed (isAnswered), only on deterministically sampled
    // question indices (~every 3rd), and only until answered/dismissed once.
    // Exam mode never sets showExplanation, so it never appears there.
    const showConfidencePrompt =
      isAnswered &&
      shouldPromptConfidence(currentIdx) &&
      confidenceByQid[q.id] === undefined;
    const confidencePromptEl = showConfidencePrompt ? (
      <ConfidencePrompt
        key={q.id}
        isHi={isHi}
        onSelect={(v) => handleConfidenceSelect(q.id, v)}
        onDismiss={() => handleConfidenceDismiss(q.id)}
      />
    ) : null;

    if (practiceV2On && quizMode === 'practice' && isQuestionMCQ(q)) {
      const check = answerChecks[q.id];
      const checkResultProp =
        check === undefined
          ? null
          : check === 'unavailable'
            ? ('unavailable' as const)
            : {
                isCorrect: check.is_correct,
                correctDisplayedIndex: check.correct_displayed_index,
                explanation: check.explanation,
                explanationHi: check.explanation_hi,
              };
      return (
        <>
          {/* D6: floating, non-blocking — PracticeRunner is untouched and the
              student can always continue without interacting. */}
          {confidencePromptEl && (
            <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 w-[92vw] max-w-sm shadow-lg rounded-2xl">
              {confidencePromptEl}
            </div>
          )}
          <PracticeRunner
          isHi={isHi}
          question={{
            id: q.id,
            options: opts,
            questionText: q.question_text,
            questionTextHi: q.question_hi,
            chapterNumber: q.chapter_number,
            bloomLevel: q.bloom_level,
            hint: q.hint,
          }}
          questionNumber={currentIdx + 1}
          totalQuestions={questions.length}
          selectedOption={selectedOption}
          isAnswered={showExplanation}
          checking={checkingAnswer}
          checkResult={checkResultProp}
          subjectName={subMeta?.name}
          subjectIcon={subMeta?.icon}
          subjectColor={subMeta?.color}
          hintLevel={hintLevel}
          onSelect={selectAnswer}
          onConfirm={confirmAnswerPracticeV2}
          onNext={nextQuestion}
          onRequestHint={() => setHintLevel(1)}
          />
        </>
      );
    }

    return (
      <div className="mesh-bg min-h-dvh flex flex-col focus-screen">
        {/* Emotional feedback overlay */}
        <FeedbackOverlay feedback={activeFeedback} isHi={isHi} />

        {/* Full-screen evaluation blocker for written answers */}
        {isEvaluating && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
            <div className="bg-white rounded-xl p-8 text-center max-w-sm mx-4 shadow-xl">
              <div className="text-4xl mb-4 animate-bounce">🤔</div>
              <h3 className="text-lg font-semibold mb-2" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}>
                {isHi ? 'तुम्हारा जवाब जांचा जा रहा है...' : 'Evaluating your answer...'}
              </h3>
              <p className="text-sm" style={{ color: 'var(--text-3)' }}>
                {isHi ? 'AI शिक्षक तुम्हारे उत्तर की समीक्षा कर रहा है' : 'Our AI teacher is reviewing your response'}
              </p>
              <div className="mt-4 w-full bg-purple-100 rounded-full h-1 overflow-hidden">
                <div className="bg-purple-600 h-1 rounded-full animate-pulse" style={{ width: '100%' }} />
              </div>
            </div>
          </div>
        )}

        {/* Header — distraction-free: progress + timer only */}
        <header className="page-header" style={{ background: 'rgba(251,248,244,0.92)', backdropFilter: 'blur(20px)', borderColor: 'var(--border)' }}>
          <div className="app-container py-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-lg">{subMeta?.icon}</span>
                <span className="text-sm font-semibold" style={{ color: subMeta?.color }}>
                  {isHi ? `सवाल ${currentIdx + 1}/${questions.length}` : `Q ${currentIdx + 1}/${questions.length}`}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-[var(--text-3)] font-medium">
                <span>{correctSoFar}/{responses.length} ✓</span>
                <span style={{ color: quizMode === 'exam' && timer < 300 ? '#DC2626' : 'var(--text-3)', fontWeight: 600, fontFamily: 'var(--font-mono, monospace)' }}>
                  {formatTime(timer)}
                </span>
                {(student?.grade === '11' || student?.grade === '12') && (
                  <button
                    onClick={() => {
                      const next = !jeeNeetMode;
                      setJeeNeetMode(next);
                      localStorage.setItem('alfanumrik_jee_neet_mode', String(next));
                    }}
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full transition-all"
                    style={{
                      background: jeeNeetMode ? '#2563EB18' : 'var(--surface-2)',
                      color: jeeNeetMode ? '#2563EB' : 'var(--text-3)',
                      border: `1px solid ${jeeNeetMode ? '#2563EB40' : 'transparent'}`,
                    }}
                    title={jeeNeetMode ? 'Hide JEE/NEET tags' : 'Show JEE/NEET tags'}
                  >
                    🎯 {jeeNeetMode ? 'JEE/NEET' : 'Tags'}
                  </button>
                )}
              </div>
            </div>
            <ProgressBar value={progress} color={subMeta?.color} height={4} />
          </div>
        </header>

        <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-5 flex flex-col gap-4">
          {/* Phase 4: tell a resumed learner, in plain language, that their
              earlier work is intact and where they are picking up (P7). */}
          {isResumedSession && (
            <div
              role="status"
              className="rounded-xl px-3 py-2 text-xs font-semibold"
              style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
            >
              {isHi
                ? `▶ जहाँ छोड़ा था वहीं से — पहले के ${responses.length} जवाब सुरक्षित हैं।`
                : `▶ Continuing where you stopped — your earlier ${responses.length} answer${responses.length === 1 ? '' : 's'} ${responses.length === 1 ? 'is' : 'are'} saved.`}
            </div>
          )}
          {/* Branch: MCQ vs Written Answer rendering */}
          {isQuestionMCQ(q) ? (
            <>
              {/* Question */}
              <Card className="!p-5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] font-semibold text-[var(--text-3)] uppercase tracking-wider">
                    {isHi ? `अध्याय ${q.chapter_number}` : `Chapter ${q.chapter_number}`}
                  </span>
                  {(() => {
                    const bl = (q.bloom_level || 'remember') as BloomLevel;
                    const bc = BLOOM_CONFIG[bl] || BLOOM_CONFIG.remember;
                    return (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${bc.color}18`, color: bc.color }}>
                        {bc.icon} {isHi ? bc.labelHi : bc.label}
                      </span>
                    );
                  })()}
                  {/* R5 (2026-08-11) — the mid-quiz "Fatigue 47%" chip was REMOVED,
                      not renamed. `fatigueScore` is an internal cognitive-load
                      scalar; a percentage of it is not something a Class 6-12
                      student can act on, and showing it mid-question invites
                      self-doubt with no remedy. The COMPUTATION is untouched
                      (`cogLoad.fatigueScore` still drives `fatigue_detected` on
                      the session row and the existing cognitive pause prompt
                      further down, which offers an actual action: take a break).
                      Display only was deleted. Do not re-add a raw percentage. */}
                  {jeeNeetMode && (student?.grade === '11' || student?.grade === '12') && (() => {
                    const tag = getExamTag(q);
                    return (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full ml-auto"
                        style={{ background: tag.color + '18', color: tag.color }}>
                        🎯 {isHi ? tag.labelHi : tag.label}
                      </span>
                    );
                  })()}
                </div>
                <div className="text-lg md:text-xl font-semibold leading-relaxed" style={{ whiteSpace: 'pre-wrap' }}>
                  <MathRenderer content={isHi && q.question_hi ? q.question_hi : q.question_text} />
                </div>
              </Card>

          {/* Options */}
          <div className="space-y-2.5">
            {opts.map((opt: string, idx: number) => {
              const letter = OPTION_LETTERS[idx] || String(idx + 1);
              const optText = opt.replace(/^[A-D][\.\)]\s*/, '');
              const isSelected = selectedOption === idx;
              // P0 fix: in v2 mode the client doesn't know the correct
              // option, so isCorrectOpt is always false (no green check
              // appears mid-quiz). Final review screen highlights the
              // correct option using the server's correct_option_text from
              // the v2 RPC response.
              // `?? -1`: KEYLESS (20260814000023) — the field is optional now.
              // -1 can never equal a rendered option index, and this branch is
              // already unreachable when the key is absent (`!isV2Question`
              // implies clientHasAnswerKey(q)); the fallback exists so the type
              // is honest rather than asserted away.
              const isCorrectOpt = !isV2Question
                && (idx === originalToShuffled(q.correct_answer_index ?? -1, shuffleMaps[currentIdx] ?? null));

                  let bg = 'var(--surface-1)';
                  let border = 'var(--border)';
                  let textColor = 'var(--text-1)';
                  let letterBg = 'var(--surface-2)';
                  let letterColor = 'var(--text-2)';

                  if (isAnswered) {
                    if (isV2Question && isSelected) {
                      // v2 mode: just show the student's pick highlighted
                      // in neutral color since correctness is unknown.
                      bg = `${subMeta?.color || 'var(--orange)'}10`;
                      border = subMeta?.color || 'var(--orange)';
                      letterBg = subMeta?.color || 'var(--orange)';
                      letterColor = '#fff';
                    } else if (isCorrectOpt) {
                      bg = 'rgba(22,163,74,0.08)';
                      border = 'rgba(22,163,74,0.4)';
                      textColor = '#16A34A';
                      letterBg = '#16A34A';
                      letterColor = '#fff';
                    } else if (isSelected && !isCorrectOpt) {
                      bg = 'rgba(220,38,38,0.06)';
                      border = 'rgba(220,38,38,0.3)';
                      textColor = '#DC2626';
                      letterBg = '#DC2626';
                      letterColor = '#fff';
                    }
                  } else if (isSelected) {
                    bg = `${subMeta?.color || 'var(--orange)'}08`;
                    border = subMeta?.color || 'var(--orange)';
                    letterBg = subMeta?.color || 'var(--orange)';
                    letterColor = '#fff';
                  }

                  return (
                    <button
                      key={idx}
                      onClick={() => selectAnswer(idx)}
                      className={`w-full rounded-2xl py-4 px-4 flex items-center gap-4 transition-all active:scale-[0.97] ${isAnswered && isCorrectOpt ? 'quiz-correct' : ''} ${isAnswered && isSelected && !isCorrectOpt ? 'quiz-wrong' : ''}`}
                      style={{
                        background: bg,
                        border: `1.5px solid ${border}`,
                        textAlign: 'left',
                        minHeight: 56, /* Fat-finger friendly on budget phones */
                        boxShadow: isSelected && !isAnswered ? `0 0 0 2px ${subMeta?.color || 'var(--orange)'}30` : 'none',
                      }}
                      disabled={isAnswered}
                    >
                      <span
                        className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0 transition-all"
                        style={{ background: letterBg, color: letterColor }}
                      >
                        {letter}
                      </span>
                      <span className="text-sm md:text-base font-medium leading-snug flex-1" style={{ color: textColor }}>
                        {/* Label already stripped above; inline-only — an
                            option must never contain display math. */}
                        <MathRenderer inline content={optText} />
                      </span>
                      {isAnswered && isCorrectOpt && <span className="ml-auto text-xl flex-shrink-0">✓</span>}
                      {isAnswered && isSelected && !isCorrectOpt && <span className="ml-auto text-xl flex-shrink-0">✗</span>}
                    </button>
                  );
                })}
              </div>

              {/* Explanation */}
              {isAnswered && (
                <div
                  className="rounded-2xl p-4 border"
                  style={{
                    background: isV2Question
                      ? 'rgba(124,58,237,0.05)'
                      : (isCorrect ? 'rgba(22,163,74,0.05)' : 'rgba(220,38,38,0.04)'),
                    borderColor: isV2Question
                      ? 'rgba(124,58,237,0.15)'
                      : (isCorrect ? 'rgba(22,163,74,0.15)' : 'rgba(220,38,38,0.12)'),
                  }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg">
                      {isV2Question ? '✓' : (isCorrect ? '🎉' : '💡')}
                    </span>
                    <span className="text-sm font-bold"
                      style={{ color: isV2Question ? '#7C3AED' : (isCorrect ? '#16A34A' : '#DC2626') }}>
                      {isV2Question
                        ? (isHi ? 'जवाब जमा हो गया' : 'Answer submitted')
                        : isCorrect
                          ? (isHi ? 'शाबाश! सही जवाब!' : 'Correct! Well done!')
                          : (isHi ? 'गलत जवाब' : 'Incorrect')}
                    </span>
                    {!isV2Question && isCorrect && <span className="ml-auto text-xs font-bold" style={{ color: 'var(--orange)' }}>+{XP_RULES.quiz_per_correct} XP</span>}
                  </div>
                  <p className="text-sm leading-relaxed text-[var(--text-2)]">
                    {isV2Question
                      ? (isHi
                          ? 'क्विज़ ख़त्म होने पर सही जवाब और व्याख्या देखोगे।'
                          : "You'll see the correct answer and explanation at the end of the quiz.")
                      : (
                        <MathRenderer
                          content={isHi && q.explanation_hi ? q.explanation_hi : q.explanation || (isHi ? 'कोई व्याख्या उपलब्ध नहीं' : 'No explanation available')}
                        />
                      )}
                  </p>
                </div>
              )}

              {/* D6: sampled 1-tap confidence — inline, after the explanation,
                  never blocks the Next button below. */}
              {confidencePromptEl}

              {/* Pedagogy v2 — Wave 1: distractor micro-explainer.
                  Mounts only on wrong MCQ (legacy path; v2 path defers feedback
                  to results screen). API is gated by ff_distractor_micro_explainer_v1
                  and renders nothing when no curated remediation exists. */}
              {isAnswered && !isV2Question && !isCorrect && q.id && selectedOption !== null && (
                <MisconceptionExplainer
                  questionId={q.id}
                  distractorIndex={selectedOption}
                />
              )}

              {/* Reflection Prompt — shown in cognitive and practice modes */}
              {isAnswered && (quizMode === 'cognitive' || quizMode === 'practice') && reflection && (
                <div className="rounded-2xl p-4 border" style={{ background: 'rgba(124,58,237,0.05)', borderColor: 'rgba(124,58,237,0.15)' }}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-lg">🪞</span>
                    <span className="text-xs font-bold" style={{ color: '#7C3AED' }}>
                      {reflection.type === 'pause' ? (isHi ? 'रुको और सोचो' : 'Pause & Reflect') : (isHi ? 'सोचो' : 'Reflect')}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed text-[var(--text-2)]">
                    {isHi ? reflection.messageHi : reflection.message}
                  </p>
                </div>
              )}

              {/* Cognitive Pause Alert — shown when fatigue detected */}
              {isAnswered && (quizMode === 'cognitive' || quizMode === 'practice') && cogLoad.shouldPause && (
                <div className="rounded-2xl p-4 border" style={{ background: 'rgba(239,68,68,0.06)', borderColor: 'rgba(239,68,68,0.2)' }}>
                  <div className="flex items-center gap-2">
                    <span className="text-xl">😮‍💨</span>
                    <div>
                      <p className="text-sm font-bold" style={{ color: '#EF4444' }}>
                        {isHi ? 'ब्रेक ले लो!' : 'Take a break!'}
                      </p>
                      <p className="text-xs text-[var(--text-3)]">
                        {isHi ? 'थोड़ा आराम करो, फिर वापस आओ।' : 'Rest a bit, then come back stronger.'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Foxy North-Star Phase 3 (L5) — 5-rung Hint Ladder.
                  Replaces the legacy 3-tier padded hints (rung state machine
                  + P3 lock live in @alfanumrik/lib/learn/hint-ladder.ts).
                  Rungs 2-5 unlock only after a recorded wrong answer, which
                  in legacy path is `isAnswered && !isV2Question && !isCorrect`
                  with `originalPicked` as the distractor index. In v2 mode
                  the client doesn't know correctness until session-end, so
                  wrongAttempt stays null and only rung 1 is available. */}
              {q.id && (
                <HintLadder
                  isHi={isHi}
                  question={{
                    id: q.id,
                    hint: q.hint,
                    explanation: q.explanation,
                    explanation_hi: q.explanation_hi,
                  }}
                  wrongAttempt={
                    isAnswered && !isV2Question && !isCorrect && originalPicked !== null
                      ? { distractorIndex: originalPicked }
                      : null
                  }
                  onHintLevelChange={(lvl) => setHintLevel(lvl)}
                  onRequestEquivalent={() => {
                    // "Equivalent question" — additive, non-blocking: advance
                    // past the current question. The pinned/pool assembler
                    // owns question replacement; a proper foxy_served_items
                    // twin request is a follow-up (see report handoff).
                    void nextQuestion();
                  }}
                />
              )}

              {/* Action Buttons */}
              <div className="flex gap-3 mt-auto pb-2">
                {!isAnswered ? (
                  <>
                    {/* Legacy inline hint button removed — HintLadder above
                        owns the reveal UX end-to-end (rungs 1-5). */}
                    <Button
                      fullWidth
                      onClick={confirmAnswer}
                      color={subMeta?.color}
                      size="md"
                      disabled={selectedOption === null}
                      style={selectedOption === null ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                    >
                      {selectedOption !== null
                        ? (isHi ? 'जवाब जमा करो' : 'Submit Answer')
                        : (isHi ? 'एक विकल्प चुनो' : 'Select an option')}
                    </Button>
                  </>
                ) : (
                  <Button fullWidth onClick={nextQuestion} color={subMeta?.color}>
                    {currentIdx < questions.length - 1
                      ? (isHi ? 'अगला सवाल →' : 'Next Question →')
                      : (isHi ? 'नतीजे देखो 🎯' : 'See Results 🎯')}
                  </Button>
                )}
              </div>
            </>
          ) : (
            /* ═══ WRITTEN ANSWER (SA/MA/LA) ═══ */
            <>
              {!isAnswered ? (
                <>
                  <WrittenAnswerInput
                    questionText={isHi && q.question_hi ? q.question_hi : q.question_text}
                    questionType={mapToWrittenType(q.cbse_type ?? q.question_type)}
                    marksP={q.marks_possible ?? 2}
                    wordLimit={q.word_limit ?? getWordLimit(q.cbse_type ?? q.question_type)}
                    timeEstimate={q.time_estimate ?? getTimeEstimate(q.cbse_type ?? q.question_type)}
                    onSubmit={handleWrittenSubmit}
                    onSkip={handleWrittenSkip}
                    questionNumber={currentIdx + 1}
                    totalQuestions={questions.length}
                    isEvaluating={isEvaluating}
                  />
                  {/* Evaluation failure — retry/skip UI */}
                  {evalError && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-center space-y-2">
                      <p className="text-sm text-amber-800">{evalError}</p>
                      <div className="flex gap-2 justify-center">
                        <button
                          onClick={() => { setEvalError(null); handleWrittenSubmit(lastWrittenAnswer, lastWrittenTimeSpent); }}
                          className="px-4 py-2 bg-amber-600 text-white rounded text-sm font-medium hover:bg-amber-700 active:scale-[0.98] transition-all"
                        >
                          {isHi ? 'फिर से कोशिश करो' : 'Retry Evaluation'}
                        </button>
                        <button
                          onClick={() => { setEvalError(null); handleWrittenSkip(); }}
                          className="px-4 py-2 bg-gray-200 text-gray-700 rounded text-sm font-medium hover:bg-gray-300 active:scale-[0.98] transition-all"
                        >
                          {isHi ? 'छोड़ दो' : 'Skip'}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                /* Written answer post-evaluation feedback */
                <>
                  <Card className="!p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] font-semibold text-[var(--text-3)] uppercase tracking-wider">
                        {isHi ? `अध्याय ${q.chapter_number}` : `Chapter ${q.chapter_number}`}
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded"
                        style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>
                        {q.cbse_label ?? 'SA'} {q.marks_possible ?? 2} {isHi ? 'अंक' : 'marks'}
                      </span>
                    </div>
                    <div className="text-lg md:text-xl font-semibold leading-relaxed" style={{ whiteSpace: 'pre-wrap' }}>
                      {isHi && q.question_hi ? q.question_hi : q.question_text}
                    </div>
                  </Card>

                  {/* Written evaluation feedback — uses currentEval for richer display */}
                  {currentEval && (
                    <div className="rounded-2xl p-4 border space-y-3"
                      style={{
                        background: (currentEval.percentage ?? 0) >= 80 ? 'rgba(22,163,74,0.05)'
                          : (currentEval.percentage ?? 0) >= 50 ? 'rgba(245,158,11,0.05)'
                          : 'rgba(220,38,38,0.04)',
                        borderColor: (currentEval.percentage ?? 0) >= 80 ? 'rgba(22,163,74,0.15)'
                          : (currentEval.percentage ?? 0) >= 50 ? 'rgba(245,158,11,0.15)'
                          : 'rgba(220,38,38,0.12)',
                      }}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">
                            {(currentEval.percentage ?? 0) >= 80 ? '🎉' : (currentEval.marks_awarded ?? 0) > 0 ? '📝' : '💡'}
                          </span>
                          <span className="text-base font-bold"
                            style={{
                              color: (currentEval.percentage ?? 0) >= 80 ? '#16A34A'
                                : (currentEval.marks_awarded ?? 0) > 0 ? '#F59E0B'
                                : '#DC2626',
                            }}>
                            {currentEval.marks_awarded}/{currentEval.marks_possible} {isHi ? 'अंक' : 'marks'}
                          </span>
                        </div>
                        <span className={`px-2 py-1 rounded text-xs font-bold ${
                          (currentEval.percentage ?? 0) >= 80 ? 'bg-green-100 text-green-700'
                            : (currentEval.percentage ?? 0) >= 50 ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-red-100 text-red-700'
                        }`}>
                          {(currentEval.percentage ?? 0) >= 80
                            ? (isHi ? 'बहुत अच्छा' : 'Good')
                            : (currentEval.percentage ?? 0) >= 50
                            ? (isHi ? 'ठीक' : 'Fair')
                            : (isHi ? 'सुधार करो' : 'Needs Work')}
                        </span>
                      </div>

                      {/* AI feedback */}
                      {currentEval.feedback && (
                        <p className="text-sm leading-relaxed text-[var(--text-2)]">
                          {currentEval.feedback}
                        </p>
                      )}

                      {/* Key points breakdown */}
                      {currentEval.key_points && currentEval.key_points.length > 0 && (
                        <div className="space-y-1">
                          <span className="text-xs font-semibold" style={{ color: 'var(--text-3)' }}>
                            {isHi ? 'मुख्य बिंदु:' : 'Key Points:'}
                          </span>
                          {currentEval.key_points.map((kp, i) => (
                            <div key={i} className="flex items-start gap-2 text-xs">
                              <span className="flex-shrink-0 mt-0.5">{kp.hit ? '✅' : '❌'}</span>
                              <span style={{ color: kp.hit ? '#16A34A' : 'var(--text-3)' }}>{kp.point}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Model answer */}
                      {(currentEval.model_answer_summary || q.explanation) && (
                        <div className="pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                          <div className="rounded-lg px-3 py-2 text-sm leading-relaxed"
                            style={{ background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.12)' }}>
                            <span className="font-semibold text-xs block mb-1" style={{ color: '#3B82F6' }}>
                              {isHi ? 'आदर्श उत्तर' : 'Model Answer'}
                            </span>
                            <p className="text-[var(--text-2)]">
                              {currentEval.model_answer_summary || q.explanation}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Fallback if currentEval is null but showExplanation is true */}
                  {!currentEval && (() => {
                    const lastResp = responses[responses.length - 1];
                    if (!lastResp) return null;
                    const awarded = lastResp.marks_awarded ?? 0;
                    const possible = lastResp.marks_possible ?? q.marks_possible ?? 2;
                    const gotFullMarks = awarded >= possible;
                    return (
                      <div className="rounded-2xl p-4 border"
                        style={{
                          background: gotFullMarks ? 'rgba(22,163,74,0.05)' : 'rgba(220,38,38,0.04)',
                          borderColor: gotFullMarks ? 'rgba(22,163,74,0.15)' : 'rgba(220,38,38,0.12)',
                        }}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-lg">{gotFullMarks ? '🎉' : awarded > 0 ? '📝' : '💡'}</span>
                          <span className="text-sm font-bold"
                            style={{ color: gotFullMarks ? '#16A34A' : awarded > 0 ? '#F59E0B' : '#DC2626' }}>
                            {awarded}/{possible} {isHi ? 'अंक' : 'marks'}
                          </span>
                        </div>
                        {lastResp.rubric_feedback && (
                          <p className="text-sm leading-relaxed text-[var(--text-2)]">
                            {lastResp.rubric_feedback}
                          </p>
                        )}
                      </div>
                    );
                  })()}

                  {/* Next button for written answers */}
                  <div className="flex gap-3 mt-auto pb-2">
                    <Button fullWidth onClick={nextQuestion} color={subMeta?.color}>
                      {currentIdx < questions.length - 1
                        ? (isHi ? 'अगला सवाल →' : 'Next Question →')
                        : (isHi ? 'नतीजे देखो 🎯' : 'See Results 🎯')}
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </main>
      </div>
    );
  }

  // ═══ RESULTS SCREEN ═══
  if (screen === 'results' && results) {
    const networkErrorBanner = networkError && (
      <div className="fixed bottom-20 left-4 right-4 bg-amber-500 text-white rounded-xl p-4 text-center z-40 shadow-lg animate-slide-up">
        <p className="text-sm font-medium mb-2">{networkError}</p>
        <button
          onClick={retrySubmit}
          disabled={loading}
          className="px-4 py-1.5 bg-white text-amber-700 rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {loading
            ? (isHi ? 'भेज रहे हैं...' : 'Submitting...')
            : (isHi ? 'पुनः प्रयास करें' : 'Retry')}
        </button>
      </div>
    );

    // Screen 08 v2 branch — additive alternative, gated by ff_quiz_result_v2.
    // Consumes the EXACT same already-computed `results`/`questions`/
    // `responses` the legacy QuizResults path below receives; no scoring/XP
    // recomputation (P1/P2 untouched).
    if (resultV2On) {
      return (
        <>
          <ResultSummary
            isHi={isHi}
            results={results}
            questions={questions}
            responses={responses}
            timer={timer}
            subject={
              selectedSubject && subMeta
                ? { code: selectedSubject, name: subMeta.name, icon: subMeta.icon, color: subMeta.color }
                : null
            }
            nextTask={{ href: nextTask.href, labelEn: nextTask.labelEn, labelHi: nextTask.labelHi }}
            onRetry={() => { setScreen('select'); setQuestions([]); setResponses([]); setResults(null); setNetworkError(null); pendingSubmissionRef.current = null; }}
            onAskFoxy={(href) => router.push(href)}
            onNextTask={(href) => router.push(href)}
          />
          {networkErrorBanner}
        </>
      );
    }

    return (
      <>
        <QuizResults
          results={results}
          questions={questions}
          responses={responses}
          shuffleMaps={shuffleMaps}
          // P0 fix: server review payload from submit_quiz_results_v2.
          // QuizResults.tsx renders correct_option_text from this map
          // instead of deriving from local options[correct_answer_index]
          // (which was never trustworthy after content edits).
          serverReview={
            (results as { questions?: Array<{
              question_id: string;
              is_correct: boolean;
              correct_option_text: string | null;
              correct_original_index: number;
              selected_displayed_index: number;
              selected_original_index: number;
            }> }).questions ?? null
          }
          isHi={isHi}
          quizMode={quizMode}
          selectedSubject={selectedSubject}
          studentName={student!.name}
          timer={timer}
          isFirstQuiz={false}
          onRetry={() => { setScreen('select'); setQuestions([]); setResponses([]); setResults(null); setNetworkError(null); pendingSubmissionRef.current = null; }}
          onGoHome={() => router.push(experienceV3 ? '/today' : '/dashboard')}
          onAskFoxy={() => { /* Phase 4 U1: page mounts the tap-gated launcher below. */ }}
        />
        {/* Phase 4 U1: tap-gated "Ask Foxy about this quiz" launcher. Panel is
            dynamic-imported (ssr:false) inside the launcher only on tap. */}
        <div className="max-w-2xl mx-auto px-4 mt-4">
          <FoxyPanelLauncher
            subject={selectedSubject || 'science'}
            grade={student?.grade || '10'}
            mode="doubt"
            context="quiz-results"
            initialPrompt={
              isHi
                ? 'मुझे इस क्विज़ में गलत हुए सवालों को समझने में मदद करो।'
                : 'Help me understand the questions I got wrong on this quiz.'
            }
            isHi={isHi}
            language={isHi ? 'hi' : 'en'}
            studentId={student?.id}
            studentName={student?.name}
            ctaLabel={{ en: '🦊 Ask Foxy about this quiz', hi: '🦊 इस क्विज़ पर फॉक्सी से पूछो' }}
          />
        </div>
        {/* SLC-5: gentle, NON-accusatory note when the server flagged the attempt.
            The real score_percent is still shown by QuizResults above; this only
            explains why no XP was awarded. Bilingual per P7. Never punitive. */}
        {results.flagged && (
          <div className="fixed bottom-20 left-4 right-4 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 text-center z-30 shadow-sm animate-slide-up">
            <p className="text-sm">
              {isHi
                ? 'इस प्रयास की समीक्षा के लिए चिह्नित किया गया, इसलिए कोई XP नहीं मिला। तुम्हारा स्कोर सहेज लिया गया है — दोबारा कोशिश करके XP कमाओ!'
                : 'This attempt was flagged for review, so no XP was awarded. Your score is saved — try again to earn XP!'}
            </p>
          </div>
        )}
        {networkError && (
          <div className="fixed bottom-20 left-4 right-4 bg-amber-500 text-white rounded-xl p-4 text-center z-40 shadow-lg animate-slide-up">
            <p className="text-sm font-medium mb-2">{networkError}</p>
            <button
              onClick={retrySubmit}
              disabled={loading}
              className="px-4 py-1.5 bg-white text-amber-700 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {loading
                ? (isHi ? 'भेज रहे हैं...' : 'Submitting...')
                : (isHi ? 'पुनः प्रयास करें' : 'Retry')}
            </button>
          </div>
        )}
      </>
    );
  }

  // ═══ RESULTS SCREEN — no results (submission failed or no responses) ═══
  if (screen === 'results' && !results) {
    return (
      <div className="mesh-bg min-h-dvh flex flex-col items-center justify-center px-6">
        <div className="text-center py-12 px-6">
          <div className="text-5xl mb-4">😕</div>
          <h3 className="text-lg font-bold mb-1" style={{ fontFamily: 'var(--font-display)' }}>
            {isHi ? 'नतीजे उपलब्ध नहीं हैं' : 'Results not available'}
          </h3>
          <p className="text-sm text-[var(--text-3)] mb-4 max-w-xs mx-auto">
            {isHi
              ? 'कुछ गलत हो गया। कृपया दोबारा कोशिश करो।'
              : 'Something went wrong. Please try again.'}
          </p>
          <div className="flex gap-3 justify-center">
            <Button onClick={() => { setScreen('select'); setQuestions([]); setResponses([]); setResults(null); }}>
              {isHi ? 'फिर से क्विज़ लो' : 'Try Again'}
            </Button>
            <Button variant="ghost" onClick={() => router.push(experienceV3 ? '/today' : '/dashboard')}>
              {isHi ? 'होम' : 'Home'}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Submission in progress (screen === 'feedback')
  if (screen === 'feedback') {
    return (
      <div className="mesh-bg min-h-dvh flex flex-col items-center justify-center px-6">
        <div className="text-center">
          <LoadingFoxy />
          <p className="text-sm text-[var(--text-2)] mt-4 font-medium">
            {isHi ? 'नतीजे तैयार हो रहे हैं...' : 'Preparing your results...'}
          </p>
        </div>
      </div>
    );
  }

  // Fallback loading
  return <LoadingFoxy />;
}
