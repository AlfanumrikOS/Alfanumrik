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

export interface DiagnosticSummary {
  session_id: string;
  score_percent: number;
  correct_answers: number;
  total_questions: number;
  weak_topics: string[];
  strong_topics: string[];
  recommended_difficulty: 'easy' | 'medium' | 'hard';
  rpc_failed?: boolean;
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
