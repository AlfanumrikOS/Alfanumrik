'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';

/* ═══════════════════════════════════════════════════════════════
   ReportIssueModal — student-facing issue reporter for AI answers.

   Posts to /api/support/ai-issue which inserts into ai_issue_reports.
   Referenced from ChatBubble's "Report an issue" link (Task 3.15).

   Accepts optional traceId, messageId, questionBankId so the admin
   review queue can look up the exact generation that was flagged.
   ═══════════════════════════════════════════════════════════════ */

export type ReportReasonCategory =
  | 'wrong_answer'
  | 'off_topic'
  | 'inappropriate'
  | 'unclear'
  | 'other';

export interface ReportIssueModalProps {
  isOpen: boolean;
  onClose: () => void;
  traceId?: string;
  messageId?: string;
  questionBankId?: string;
}

const MAX_COMMENT_LENGTH = 500;

const REASON_OPTIONS: { value: ReportReasonCategory; en: string; hi: string }[] = [
  { value: 'wrong_answer', en: 'Wrong answer', hi: 'Galat jawab' },
  { value: 'off_topic', en: 'Off topic / not from my chapter', hi: 'Mere chapter se nahi hai' },
  { value: 'inappropriate', en: 'Inappropriate or unsafe content', hi: 'Galat ya unsafe content' },
  { value: 'unclear', en: 'Unclear / hard to understand', hi: 'Samjhane mein mushkil' },
  { value: 'other', en: 'Other', hi: 'Doosra' },
];

export function ReportIssueModal({
  isOpen,
  onClose,
  traceId,
  messageId,
  questionBankId,
}: ReportIssueModalProps) {
  const { isHi } = useAuth();
  const [reasonCategory, setReasonCategory] = useState<ReportReasonCategory | null>(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    setValidationError(null);
    setSubmitError(null);

    if (!reasonCategory) {
      setValidationError(isHi ? 'Karan chune' : 'Please choose a reason');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/support/ai-issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          traceId,
          messageId,
          questionBankId,
          reasonCategory,
          comment: comment.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'report_failed');
      }
      setSuccess(true);
      // Auto-close after showing success for 1.2s
      setTimeout(() => {
        onClose();
        // Reset state for next open
        setSuccess(false);
        setReasonCategory(null);
        setComment('');
      }, 1200);
    } catch (err) {
      setSubmitError(
        isHi
          ? 'Report bhejte waqt problem aayi. Phir try karein.'
          : 'Something went wrong. Please try again.',
      );
    }
    setSubmitting(false);
  };

  return (
    <div
      data-testid="report-issue-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-issue-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        {success ? (
          <div className="py-6 text-center" data-testid="report-issue-success">
            <p className="text-lg font-semibold text-green-700">
              ✓ {isHi ? 'Dhanyavaad — hum behtar karenge' : 'Got it — thanks for helping us improve'}
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between">
              <h2
                id="report-issue-title"
                className="text-base font-bold text-gray-900"
              >
                {isHi ? 'Is jawab mein kya problem hai?' : 'What\u2019s wrong with this answer?'}
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label={isHi ? 'Band karein' : 'Close'}
                className="ml-2 rounded-full p-1 text-gray-500 transition hover:bg-gray-100 hover:text-gray-800"
              >
                ✕
              </button>
            </div>

            <fieldset className="mt-4 space-y-2">
              <legend className="sr-only">
                {isHi ? 'Karan' : 'Reason'}
              </legend>
              {REASON_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm transition hover:bg-gray-50"
                >
                  <input
                    type="radio"
                    name="report-reason"
                    value={opt.value}
                    checked={reasonCategory === opt.value}
                    onChange={() => setReasonCategory(opt.value)}
                    className="accent-orange-500"
                  />
                  <span className="text-gray-800">{isHi ? opt.hi : opt.en}</span>
                </label>
              ))}
            </fieldset>

            <label className="mt-4 block">
              <span className="text-xs font-medium text-gray-700">
                {isHi ? 'Aur detail (optional)' : 'Additional detail (optional)'}
              </span>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, MAX_COMMENT_LENGTH))}
                maxLength={MAX_COMMENT_LENGTH}
                rows={3}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-orange-400 focus:outline-none focus:ring-1 focus:ring-orange-400"
                placeholder={isHi ? 'Kya galat hai samjhaiye...' : 'Tell us what went wrong...'}
              />
              <span className="mt-1 block text-right text-[10px] text-gray-500">
                {comment.length}/{MAX_COMMENT_LENGTH}
              </span>
            </label>

            {validationError && (
              <p role="alert" className="mt-2 text-xs text-red-600" data-testid="report-issue-validation-error">
                {validationError}
              </p>
            )}
            {submitError && (
              <p role="alert" className="mt-2 text-xs text-red-600">
                {submitError}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-60"
              >
                {isHi ? 'Cancel' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-orange-600 disabled:opacity-60"
              >
                {submitting
                  ? (isHi ? 'Bhej rahe hain...' : 'Submitting...')
                  : (isHi ? 'Bhejein' : 'Submit')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}