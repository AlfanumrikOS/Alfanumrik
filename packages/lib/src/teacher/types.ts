/**
 * Shared types for teacher-dashboard SWR hooks.
 * Mirror of the host-app GradingQueue.tsx interface so packages/lib
 * can type-check independently of apps/host path aliases.
 */

export interface GradingQueueItem {
  submission_id: string;
  assignment_id: string;
  assignment_title: string;
  student_id: string;
  student_name: string;
  submitted_at: string | null;
  question_count: number;
  auto_score: number | null;
  needs_review_reason: 'all_same_answer' | 'too_fast' | null;
}
