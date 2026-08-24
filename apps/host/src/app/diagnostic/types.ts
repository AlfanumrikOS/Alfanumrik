/**
 * /diagnostic — shared types.
 *
 * Split out of page.tsx purely so the lazy-loaded screen components
 * (StreamScreen, InsufficientScreen, QuizScreen, ResultsScreen) can import
 * the shapes they render without importing page.tsx itself. Type-only
 * imports are erased at compile time, so this file adds zero runtime bundle
 * weight — the split exists to keep page.tsx importable/dynamic-import-able
 * without a circular reference back to itself.
 */

import type { Bilingual } from './copy';

export interface DiagnosticQuestion {
  id: string;
  question_text: string;
  question_hi: string | null;
  question_type: string;
  options: string | string[];
  correct_answer_index: number;
  explanation: string | null;
  explanation_hi: string | null;
  difficulty: number;
  bloom_level: string;
  chapter_number: number | null;
  topic_id: string | null;
}

export interface DiagnosticResponse {
  question_id: string;
  selected_answer_index: number;
  // NOTE: the server re-derives correctness from question_bank and ignores this
  // field (spec §7A C1). It is retained only so an older server build — and the
  // Flutter client, which posts the same shape — keeps working unchanged.
  is_correct: boolean;
  time_taken_seconds: number;
  topic: string | null;
  difficulty: number;
  bloom_level: string;
}

/**
 * One server-authoritative per-question verdict from /api/diagnostic/complete.
 *
 * DELIBERATELY MINIMAL. The question text, options, `explanation` and
 * `explanation_hi` are NOT here — the page already holds them on
 * `DiagnosticQuestion` from /api/diagnostic/start, and re-sending them would
 * pay for the same bytes twice on a 2-5 Mbps connection (P10).
 *
 * What IS here is exactly the set the client must not be trusted to compute:
 * correctness and the correct index. The review screen joins on `question_id`.
 * Same discipline as P1's "display the score the server returned, never
 * recompute it" — applied one level down, per question.
 */
export interface DiagnosticQuestionResult {
  question_id: string;
  question_number: number;
  is_correct: boolean;
  selected_index: number | null;
  correct_index: number | null;
}

export interface DiagnosticSummary {
  session_id: string;
  score_percent: number;
  correct_answers: number;
  total_questions: number;
  weak_topics: string[];
  strong_topics: string[];
  recommended_difficulty: 'easy' | 'medium' | 'hard';
  rpc_failed?: boolean;

  // ─── Phase 5 additions ────────────────────────────────────────
  // All OPTIONAL: a client built against a newer server must still render a
  // response from an older deployment (and the Flutter client, which shares
  // this contract, ignores unknown keys).

  /**
   * C2 placement validity. The server has always returned this
   * (`complete/route.ts`); this type used to drop it on the floor, so the UI
   * could not tell an acted-on placement from a disarmed one.
   */
  placement_confidence?: 'low' | 'normal';

  /** P7 siblings of weak_topics / strong_topics (Devanagari titles). */
  weak_topics_hi?: string[];
  strong_topics_hi?: string[];

  /** Per-question verdicts, in served order. Absent on an older server. */
  question_results?: DiagnosticQuestionResult[];
}

/** §5.4 fallback CTA. `kind` is one of other_subject | guided_lesson | foxy. */
export interface DiagnosticAlternative {
  kind: string;
  href: string;
  label: Bilingual | null;
}

export interface InsufficientState {
  reason: string;
  message: Bilingual | null;
  alternatives: DiagnosticAlternative[];
  subjectCode: string;
}

export type DiagnosticScreen = 'setup' | 'quiz' | 'results' | 'insufficient' | 'stream';
