/**
 * Shared types for the mock-test runner family of components.
 * Splitting these out lets <MockTestRunner /> stay under the per-file LOC
 * budget while keeping the public type surface stable for the API caller.
 */

export interface MockTestQuestion {
  id: string;
  question_number: number;
  question_text: string;
  question_hi?: string | null;
  question_type: 'mcq_single' | 'mcq_multi' | string;
  options: string[];
  marks_correct: number;
  marks_wrong: number;
  chapter_title?: string | null;
  /** Admin/teacher-only — students never see this in the API response. */
  correct_answer_index?: number;
  /** Admin/teacher-only — students never see this in the API response. */
  explanation?: string;
}

export interface MockTestPaper {
  id: string;
  paper_code: string;
  exam_family: string;
  exam_year: number;
  total_questions: number;
  duration_minutes: number;
  subject_scope: string[];
}

export interface ResponseEntry {
  selectedIndex: number | null;
  selectedIndices?: number[];
  marked: boolean;
  visited: boolean;
}

export type Status = 'unattempted' | 'attempted' | 'marked' | 'skipped';

/**
 * Submission result shapes — returned by POST /api/exams/papers/[id]/submit.
 *
 * The Results page reads these via sessionStorage (keyed by attempt_id) to
 * avoid a re-fetch; the API contract owns the canonical numbers per P1
 * (frontend never recalculates score_percent or xp_earned).
 */

export interface SubmitSummary {
  total_questions: number;
  attempted_count: number;
  correct_count: number;
  wrong_count: number;
  skipped_count: number;
  raw_score: number;
  max_score: number;
  score_percent: number;
  xp_earned: number;
  time_taken_seconds: number;
  submitted_at: string;
}

export interface ReviewItem {
  question_id: string;
  question_number?: number;
  question_text: string;
  options: string[];
  response_index: number | null;
  correct_answer_index: number;
  is_correct: boolean | null;
  marks_awarded: number;
  explanation: string;
  chapter_title: string | null;
}

export interface SubmitResult {
  attempt_id: string;
  paper_id: string;
  summary: SubmitSummary;
  review: ReviewItem[];
}
