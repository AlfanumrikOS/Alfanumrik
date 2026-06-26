'use client';

/**
 * ContextPanel — the third pane of the Alfa OS Foxy workspace (ff_student_os_v1).
 *
 * Desktop/tablet: a quiet right-hand rail showing the active subject + a
 * mastery-aware nudge (<MasteryAwareness>).
 * Mobile: the same content surfaces as a bottom sheet (reusing the existing
 * <SheetModal>) so it never competes with the chat for vertical space.
 *
 * It is PURELY presentational chrome around the existing chat. It issues no AI
 * calls — every actionable suggestion is handed up via `onSuggest`, which the
 * Foxy page routes through its existing mode/prompt mechanism. The chat column,
 * renderer, modes, limits, and scope-lock are untouched (P12 / REG-55).
 *
 * Bilingual via isHi.
 */

import { SheetModal } from '@/components/ui';
import MasteryAwareness, { type MasterySuggestion } from './MasteryAwareness';

interface ContextPanelProps {
  isHi: boolean;
  studentId: string | undefined;
  activeSubjectName: string;
  activeSubjectIcon: string;
  /** Subject code forwarded to MasteryAwareness for per-subject nudge scoping. */
  activeSubject?: string;
  onSuggest: (s: MasterySuggestion) => void;
  /** Mobile bottom-sheet open state (controlled by the Foxy page). */
  sheetOpen: boolean;
  onSheetClose: () => void;
}

export default function ContextPanel({
  isHi,
  studentId,
  activeSubjectName,
  activeSubjectIcon,
  activeSubject,
  onSuggest,
  sheetOpen,
  onSheetClose,
}: ContextPanelProps) {
  const body = (
    <MasteryAwareness
      isHi={isHi}
      studentId={studentId}
      activeSubjectName={activeSubjectName}
      activeSubjectIcon={activeSubjectIcon}
      activeSubject={activeSubject}
      onSuggest={onSuggest}
    />
  );

  return (
    <>
      {/* Desktop / tablet rail — hidden below lg, where the bottom sheet takes
          over. shrink-0 so the chat column keeps its width. */}
      <aside
        className="hidden lg:flex flex-col shrink-0 border-l overflow-y-auto"
        style={{ width: 280, background: 'var(--surface-1)', borderColor: 'var(--border)' }}
        aria-label={isHi ? 'संदर्भ पैनल' : 'Context panel'}
      >
        <div className="p-3 text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)', borderBottom: '1px solid var(--border)' }}>
          {isHi ? 'तुम्हारा संदर्भ' : 'Your context'}
        </div>
        {body}
      </aside>

      {/* Mobile bottom sheet — same content, reuses SheetModal. */}
      <div className="lg:hidden">
        <SheetModal
          open={sheetOpen}
          onClose={onSheetClose}
          title={isHi ? 'तुम्हारा संदर्भ' : 'Your context'}
        >
          {body}
        </SheetModal>
      </div>
    </>
  );
}
