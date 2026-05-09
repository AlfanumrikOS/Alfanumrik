'use client';

/**
 * ReportDialog — modal for reporting an incorrect Foxy answer.
 *
 * Plan ref: docs/superpowers/plans/2026-05-09-student-quality-upgrade.md
 *           Task 5c: extract report flow
 *
 * Owns the dialog UI:
 *   - "Foxy's response" preview (truncated to 300 chars)
 *   - REPORT_REASONS chip picker (bilingual)
 *   - Optional student correction textarea
 *   - Submit / Cancel actions
 *   - Post-submit success state with "Thank you!" + OK
 *
 * It is a controlled component:
 *   - `open` toggles visibility (falsy = unmounted)
 *   - `reason` / `correction` are owned by the parent so the parent can
 *     compose the network payload.
 *   - `submitting` and `success` are flags driven by the parent's submit
 *     flow (submitting locks the button, success swaps the body).
 *
 * Behavior moved verbatim from `src/app/foxy/page.tsx` — bilingual copy,
 * red-error palette, sm:rounded-2xl bottom-sheet on mobile.
 */

import { REPORT_REASONS } from '../_lib/foxy-constants';

export interface ReportDialogProps {
  open: boolean;
  /** The Foxy reply being reported. Truncated to 300 chars in the preview. */
  foxyMsg: string;
  reason: string;
  correction: string;
  submitting: boolean;
  success: boolean;
  isHi: boolean;
  onReasonChange: (reason: string) => void;
  onCorrectionChange: (correction: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export function ReportDialog({
  open,
  foxyMsg,
  reason,
  correction,
  submitting,
  success,
  isHi,
  onReasonChange,
  onCorrectionChange,
  onSubmit,
  onClose,
}: ReportDialogProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e: React.MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-t-2xl sm:rounded-2xl p-5 max-h-[80vh] overflow-y-auto animate-slide-up"
        style={{ background: 'var(--surface-1)' }}
      >
        {!success ? (
          <>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)' }}>
                {isHi ? '⚠️ गलत उत्तर रिपोर्ट करें' : '⚠️ Report Incorrect Answer'}
              </h3>
              <button onClick={onClose} className="text-lg" style={{ color: 'var(--text-3)' }}>
                ✕
              </button>
            </div>

            {/* What Foxy said */}
            <div className="mb-4 p-3 rounded-xl text-xs" style={{ background: '#EF444408', border: '1px solid #EF444420' }}>
              <div className="font-bold text-[10px] uppercase tracking-wider mb-1" style={{ color: '#EF4444' }}>
                {isHi ? 'फॉक्सी का जवाब:' : 'Foxy’s response:'}
              </div>
              <div className="leading-relaxed" style={{ color: 'var(--text-2)', maxHeight: 100, overflow: 'hidden' }}>
                {foxyMsg.substring(0, 300)}
                {foxyMsg.length > 300 ? '...' : ''}
              </div>
            </div>

            {/* Reason */}
            <div className="mb-3">
              <label className="text-xs font-semibold mb-2 block" style={{ color: 'var(--text-3)' }}>
                {isHi ? 'क्या गलत है?' : 'What’s wrong?'}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {REPORT_REASONS.map((r) => (
                  <button
                    key={r.value}
                    onClick={() => onReasonChange(r.value)}
                    className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all"
                    style={{
                      background: reason === r.value ? '#EF444415' : 'var(--surface-2)',
                      color: reason === r.value ? '#EF4444' : 'var(--text-3)',
                      border: `1.5px solid ${reason === r.value ? '#EF444440' : 'var(--border)'}`,
                    }}
                  >
                    {isHi ? r.labelHi : r.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Student's correction */}
            <div className="mb-4">
              <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-3)' }}>
                {isHi ? 'सही उत्तर क्या होना चाहिए? (वैकल्पिक)' : 'What should the correct answer be? (optional)'}
              </label>
              <textarea
                value={correction}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onCorrectionChange(e.target.value)}
                placeholder={isHi ? 'सही उत्तर लिखें...' : 'Type the correct answer here...'}
                rows={3}
                className="w-full text-sm rounded-xl px-3 py-2 resize-none outline-none"
                style={{ background: 'var(--surface-2)', border: '1.5px solid var(--border)', fontFamily: 'var(--font-body)' }}
              />
            </div>

            {/* Submit */}
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold"
                style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
              >
                {isHi ? 'रद्द करें' : 'Cancel'}
              </button>
              <button
                onClick={onSubmit}
                disabled={submitting}
                className="flex-1 py-2.5 rounded-xl text-xs font-bold text-white transition-all active:scale-95 disabled:opacity-50"
                style={{ background: '#EF4444' }}
              >
                {submitting
                  ? (isHi ? 'भेजा जा रहा है...' : 'Submitting...')
                  : (isHi ? '⚠️ रिपोर्ट भेजें' : '⚠️ Submit Report')}
              </button>
            </div>
          </>
        ) : (
          <div className="text-center py-6">
            <div className="text-4xl mb-3">✅</div>
            <h3 className="text-base font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
              {isHi ? 'धन्यवाद!' : 'Thank you!'}
            </h3>
            <p className="text-xs mb-4" style={{ color: 'var(--text-3)' }}>
              {isHi
                ? 'आपकी रिपोर्ट दर्ज हो गई है। हम इसकी जाँच करेंगे और सुधार करेंगे।'
                : 'Your report has been recorded. Our team will review and fix this.'}
            </p>
            <button
              onClick={onClose}
              className="px-6 py-2 rounded-xl text-xs font-bold text-white"
              style={{ background: 'var(--orange)' }}
            >
              {isHi ? 'ठीक है' : 'OK'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
