'use client';

/**
 * ReportDialog — modal for reporting an incorrect Foxy answer.
 *
 * Plan ref: docs/superpowers/plans/2026-05-09-student-quality-upgrade.md
 *           Task 5c: extract report flow
 *
 * Re-skinned onto the canonical primitives (Dialog + Chip + Textarea +
 * Button) — token-only, AA, 44px targets, no clickable divs. It remains a
 * controlled component: `open`, `reason`, `correction`, `submitting`, and
 * `success` are all owned by the parent so the parent composes the network
 * payload. Bilingual copy preserved verbatim (P7); the reason `value`s and
 * every handler are untouched.
 */

import {
  Dialog,
  DialogTitle,
  DialogBody,
  DialogFooter,
  Chip,
  Textarea,
  Button,
} from '@/components/ui/primitives';
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
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      aria-label={isHi ? 'गलत उत्तर रिपोर्ट करें' : 'Report incorrect answer'}
    >
      {!success ? (
        <>
          <DialogTitle>
            {isHi ? '⚠️ गलत उत्तर रिपोर्ट करें' : '⚠️ Report Incorrect Answer'}
          </DialogTitle>
          <DialogBody className="space-y-4">
            {/* What Foxy said */}
            <div
              className="rounded-xl border p-3 text-fluid-xs"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--danger) 8%, var(--surface-1))',
                borderColor: 'color-mix(in srgb, var(--danger) 22%, transparent)',
              }}
            >
              <div
                className="mb-1 text-fluid-xs font-bold uppercase tracking-wider"
                style={{ color: 'var(--danger)' }}
              >
                {isHi ? 'फॉक्सी का जवाब:' : 'Foxy’s response:'}
              </div>
              <div
                className="leading-relaxed"
                style={{ color: 'var(--text-2)', maxHeight: 100, overflow: 'hidden' }}
              >
                {foxyMsg.substring(0, 300)}
                {foxyMsg.length > 300 ? '...' : ''}
              </div>
            </div>

            {/* Reason */}
            <div>
              <label className="mb-2 block text-fluid-xs font-semibold" style={{ color: 'var(--text-3)' }}>
                {isHi ? 'क्या गलत है?' : 'What’s wrong?'}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {REPORT_REASONS.map((r) => (
                  <Chip
                    key={r.value}
                    tone="danger"
                    selected={reason === r.value}
                    onClick={() => onReasonChange(r.value)}
                  >
                    {isHi ? r.labelHi : r.label}
                  </Chip>
                ))}
              </div>
            </div>

            {/* Student's correction */}
            <div>
              <label
                htmlFor="foxy-report-correction"
                className="mb-1 block text-fluid-xs font-semibold"
                style={{ color: 'var(--text-3)' }}
              >
                {isHi ? 'सही उत्तर क्या होना चाहिए? (वैकल्पिक)' : 'What should the correct answer be? (optional)'}
              </label>
              <Textarea
                id="foxy-report-correction"
                value={correction}
                onChange={(e) => onCorrectionChange(e.target.value)}
                placeholder={isHi ? 'सही उत्तर लिखें...' : 'Type the correct answer here...'}
                minRows={3}
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={onClose} fullWidth>
              {isHi ? 'रद्द करें' : 'Cancel'}
            </Button>
            <Button variant="danger" onClick={onSubmit} loading={submitting} fullWidth>
              {submitting
                ? isHi ? 'भेजा जा रहा है...' : 'Submitting...'
                : isHi ? '⚠️ रिपोर्ट भेजें' : '⚠️ Submit Report'}
            </Button>
          </DialogFooter>
        </>
      ) : (
        <>
          <DialogBody className="py-8 text-center">
            <div className="mb-3 text-4xl" aria-hidden="true">✅</div>
            <h3 className="mb-2 text-fluid-base font-bold text-foreground">
              {isHi ? 'धन्यवाद!' : 'Thank you!'}
            </h3>
            <p className="text-fluid-xs" style={{ color: 'var(--text-3)' }}>
              {isHi
                ? 'आपकी रिपोर्ट दर्ज हो गई है। हम इसकी जाँच करेंगे और सुधार करेंगे।'
                : 'Your report has been recorded. Our team will review and fix this.'}
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="primary" onClick={onClose} fullWidth>
              {isHi ? 'ठीक है' : 'OK'}
            </Button>
          </DialogFooter>
        </>
      )}
    </Dialog>
  );
}
