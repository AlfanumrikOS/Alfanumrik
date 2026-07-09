'use client';

import { useState } from 'react';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { Button, IconButton, Textarea } from '@alfanumrik/ui/ui/primitives';

/* ═══════════════════════════════════════════════════════════════
   ReportIssueModal — student-facing issue reporter for AI answers.

   Posts to /api/support/ai-issue which inserts into ai_issue_reports.
   Referenced from ChatBubble's "Report an issue" link (Task 3.15).

   Presentation: re-skinned to tokens + primitives (Textarea / Button /
   IconButton), fully bilingual with Devanagari Hindi copy. The reason
   picker stays a real radio-group (5 role="radio" options) and the shell
   keeps its role="dialog" + data-testid contract — the pinned a11y/
   regression surface is unchanged. The POST path/payload and every
   handler are untouched (P12).

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
  { value: 'wrong_answer', en: 'Wrong answer', hi: 'गलत जवाब' },
  { value: 'off_topic', en: 'Off topic / not from my chapter', hi: 'विषय से हटकर / मेरे अध्याय से नहीं' },
  { value: 'inappropriate', en: 'Inappropriate or unsafe content', hi: 'अनुचित या असुरक्षित सामग्री' },
  { value: 'unclear', en: 'Unclear / hard to understand', hi: 'अस्पष्ट / समझने में मुश्किल' },
  { value: 'other', en: 'Other', hi: 'अन्य' },
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
      setValidationError(isHi ? 'कृपया एक कारण चुनें' : 'Please choose a reason');
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
          ? 'रिपोर्ट भेजते समय समस्या हुई। कृपया फिर से कोशिश करें।'
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
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto px-4 py-4"
      style={{ backgroundColor: 'var(--scrim)' }}
    >
      <div
        data-testid="report-issue-panel"
        className="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl bg-surface-1 p-5 shadow-lg"
      >
        {success ? (
          <div className="py-6 text-center" data-testid="report-issue-success">
            <p className="text-fluid-md font-semibold" style={{ color: 'var(--success)' }}>
              ✓ {isHi ? 'धन्यवाद — हम इसे बेहतर बनाएँगे' : 'Got it — thanks for helping us improve'}
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2">
              <h2 id="report-issue-title" className="text-fluid-base font-bold text-foreground">
                {isHi ? 'इस जवाब में क्या समस्या है?' : 'What’s wrong with this answer?'}
              </h2>
              <IconButton
                variant="ghost"
                size="sm"
                onClick={onClose}
                label={isHi ? 'बंद करें' : 'Close'}
                icon={<span aria-hidden="true">✕</span>}
                className="-me-1.5 -mt-1 shrink-0"
              />
            </div>

            <fieldset className="mt-4 space-y-2">
              <legend className="sr-only">{isHi ? 'कारण' : 'Reason'}</legend>
              {REASON_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-surface-3 px-3 py-2.5 text-fluid-sm transition-colors hover:bg-surface-2"
                >
                  <input
                    type="radio"
                    name="report-reason"
                    value={opt.value}
                    checked={reasonCategory === opt.value}
                    onChange={() => setReasonCategory(opt.value)}
                    style={{ accentColor: 'var(--primary)' }}
                  />
                  <span className="text-foreground">{isHi ? opt.hi : opt.en}</span>
                </label>
              ))}
            </fieldset>

            <label className="mt-4 block">
              <span className="text-fluid-xs font-medium" style={{ color: 'var(--text-2)' }}>
                {isHi ? 'अतिरिक्त जानकारी (वैकल्पिक)' : 'Additional detail (optional)'}
              </span>
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, MAX_COMMENT_LENGTH))}
                maxLength={MAX_COMMENT_LENGTH}
                minRows={3}
                className="mt-1"
                placeholder={isHi ? 'बताइए क्या गलत है...' : 'Tell us what went wrong...'}
              />
              <span className="mt-1 block text-right text-fluid-xs" style={{ color: 'var(--text-3)' }}>
                {comment.length}/{MAX_COMMENT_LENGTH}
              </span>
            </label>

            {validationError && (
              <p
                role="alert"
                className="mt-2 text-fluid-xs"
                style={{ color: 'var(--danger)' }}
                data-testid="report-issue-validation-error"
              >
                {validationError}
              </p>
            )}
            {submitError && (
              <p role="alert" className="mt-2 text-fluid-xs" style={{ color: 'var(--danger)' }}>
                {submitError}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
                {isHi ? 'रद्द करें' : 'Cancel'}
              </Button>
              <Button variant="primary" size="sm" onClick={handleSubmit} loading={submitting}>
                {submitting
                  ? isHi ? 'भेजा जा रहा है...' : 'Submitting...'
                  : isHi ? 'भेजें' : 'Submit'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
