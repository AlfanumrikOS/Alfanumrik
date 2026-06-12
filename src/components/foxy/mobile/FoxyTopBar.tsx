'use client';

/**
 * FoxyTopBar — Foxy OS (ff_foxy_os_v1) compact mobile top bar (<lg only).
 *
 * Replaces the legacy 5-row Foxy header stack on phones with a single ~56px
 * sticky bar: back chevron · Foxy avatar + tappable "subject · chapter" chip
 * (opens the Study sheet) · overflow "⋯" button (Phase 1: also opens the Study
 * sheet; Tools sheet is Phase 3).
 *
 * PRESENTATION ONLY. All data + handlers arrive as props from /foxy/page.tsx —
 * no chat/scoring/AI logic lives here. Cosmic light tokens only (no dark mode),
 * CSS-only motion (no framer-motion). Bilingual via `isHi`.
 *
 * Lazy-loaded via dynamic() at the call site so the OFF path fetches zero new
 * chunks (P10).
 */

interface FoxyTopBarProps {
  isHi: boolean;
  /** Foxy face emoji for the current state (idle/thinking/happy). */
  foxyFace: string;
  /** Whether Foxy is mid-thought — drives the avatar pulse. */
  thinking?: boolean;
  /** Already-localized active subject name. */
  subjectName: string;
  /** Active subject brand color (hex) for the chip accent. */
  subjectColor: string;
  /** Active subject icon (emoji). */
  subjectIcon: string;
  /** Already-localized chapter label, or null when no chapter is selected. */
  chapterLabel: string | null;
  /** Back navigation (e.g. router.push('/dashboard')). */
  onBack: () => void;
  /** Opens the Study sheet (subject/chapter chip + overflow both call this). */
  onOpenStudy: () => void;
}

export function FoxyTopBar({
  isHi,
  foxyFace,
  thinking = false,
  subjectName,
  subjectColor,
  subjectIcon,
  chapterLabel,
  onBack,
  onOpenStudy,
}: FoxyTopBarProps) {
  const chipText = chapterLabel
    ? `${subjectName} · ${chapterLabel}`
    : subjectName;

  return (
    <div
      className="foxy-os-topbar lg:hidden flex items-center gap-2 px-2"
      style={{
        background: 'var(--surface-1)',
        borderBottom: '1px solid var(--border)',
        color: 'var(--text-1)',
      }}
    >
      {/* Back chevron — >=44x44 touch target */}
      <button
        type="button"
        onClick={onBack}
        className="foxy-os-tap flex items-center justify-center rounded-xl transition-all active:scale-90"
        style={{ color: 'var(--text-2)' }}
        aria-label={isHi ? 'वापस' : 'Back'}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M12.5 4L7 10l5.5 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Foxy avatar */}
      <div
        className="foxy-os-avatar flex items-center justify-center shrink-0"
        style={{
          background: 'linear-gradient(135deg, var(--orange), #F59E0B)',
          animation: thinking ? 'pulse 1s infinite' : 'none',
        }}
        aria-hidden="true"
      >
        {foxyFace}
      </div>

      {/* Subject · chapter chip — opens the Study sheet */}
      <button
        type="button"
        onClick={onOpenStudy}
        className="foxy-os-chip flex items-center gap-1.5 min-w-0 flex-1 rounded-xl px-2.5 transition-all active:scale-[0.98]"
        style={{
          background: 'var(--surface-2)',
          border: `1.5px solid ${subjectColor}33`,
        }}
        aria-label={
          isHi
            ? `अध्ययन मेनू खोलें — ${chipText}`
            : `Open study menu — ${chipText}`
        }
      >
        <span className="text-sm shrink-0" aria-hidden="true">{subjectIcon}</span>
        <span
          className="text-xs font-bold truncate"
          style={{ color: 'var(--text-1)' }}
        >
          {chipText}
        </span>
        <span className="text-[10px] shrink-0 ml-auto" style={{ color: 'var(--text-3)' }} aria-hidden="true">▾</span>
      </button>

      {/* Overflow — Phase 1 opens the Study sheet too (Tools sheet is Phase 3) */}
      <button
        type="button"
        onClick={onOpenStudy}
        className="foxy-os-tap flex items-center justify-center rounded-xl transition-all active:scale-90"
        style={{ color: 'var(--text-2)' }}
        aria-label={isHi ? 'अधिक विकल्प' : 'More options'}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <circle cx="4" cy="10" r="1.6" />
          <circle cx="10" cy="10" r="1.6" />
          <circle cx="16" cy="10" r="1.6" />
        </svg>
      </button>
    </div>
  );
}

export default FoxyTopBar;
