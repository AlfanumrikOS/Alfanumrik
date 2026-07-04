'use client';

/**
 * FoxyTopBar — Foxy OS (ff_foxy_os_v1) compact mobile top bar (<lg only).
 *
 * Replaces the legacy 5-row Foxy header stack on phones with a single ~56px
 * sticky bar: back chevron · Foxy avatar + tappable "subject · chapter" chip
 * (opens the Study sheet) · overflow "⋯" button (Phase 3: opens the Tools
 * sheet — language / voice / progress / history / context).
 *
 * PRESENTATION ONLY. All data + handlers arrive as props from /foxy/page.tsx —
 * no chat/scoring/AI logic lives here. Cosmic light tokens only (no dark mode),
 * CSS-only motion (no framer-motion). Bilingual via `isHi`.
 *
 * Lazy-loaded via dynamic() at the call site so the OFF path fetches zero new
 * chunks (P10).
 */

import { Button, IconButton } from '@/components/ui/primitives';

interface FoxyTopBarProps {
  isHi: boolean;
  /** Foxy face emoji for the current state (idle/thinking/happy). */
  foxyFace: string;
  /** Whether Foxy is mid-thought — drives the avatar pulse. */
  thinking?: boolean;
  /** Already-localized active subject name. */
  subjectName: string;
  /**
   * Active subject brand color (hex). Retained for caller API stability; the
   * chip accent is now token-driven (secondary Button on tokenized surface),
   * so this value is no longer consumed for styling.
   */
  subjectColor?: string;
  /** Active subject icon (emoji). */
  subjectIcon: string;
  /** Already-localized chapter label, or null when no chapter is selected. */
  chapterLabel: string | null;
  /** Back navigation (e.g. router.push('/dashboard')). */
  onBack: () => void;
  /** Opens the Study sheet (subject/chapter chip calls this). */
  onOpenStudy: () => void;
  /** Opens the Tools sheet (overflow "⋯" calls this). Phase 3. */
  onOpenTools: () => void;
}

export function FoxyTopBar({
  isHi,
  foxyFace,
  thinking = false,
  subjectName,
  subjectIcon,
  chapterLabel,
  onBack,
  onOpenStudy,
  onOpenTools,
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
      <IconButton
        label={isHi ? 'वापस' : 'Back'}
        variant="ghost"
        size="sm"
        onClick={onBack}
        icon={
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M12.5 4L7 10l5.5 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        }
      />

      {/* Foxy avatar */}
      <div
        className="foxy-os-avatar flex items-center justify-center shrink-0"
        style={{
          // Warm-channel Foxy avatar (stays burnt-orange under cosmic, where
          // --orange remaps to violet). Fully tokenized — no raw colour literal.
          background: 'linear-gradient(135deg, var(--accent-warm), var(--gold))',
          animation: thinking ? 'pulse 1s infinite' : 'none',
        }}
        aria-hidden="true"
      >
        {foxyFace}
      </div>

      {/* Subject · chapter chip — opens the Study sheet */}
      <Button
        variant="secondary"
        size="sm"
        fullWidth
        onClick={onOpenStudy}
        className="min-w-0 flex-1 justify-start"
        aria-label={
          isHi
            ? `अध्ययन मेनू खोलें — ${chipText}`
            : `Open study menu — ${chipText}`
        }
        leadingIcon={<span className="text-sm" aria-hidden="true">{subjectIcon}</span>}
        trailingIcon={<span className="text-[10px] ml-auto" aria-hidden="true">▾</span>}
      >
        <span className="truncate">{chipText}</span>
      </Button>

      {/* Overflow — Phase 3 opens the Tools sheet (language / voice / progress
          / history / context). The chip above keeps opening the Study sheet. */}
      <IconButton
        label={isHi ? 'अधिक विकल्प' : 'More options'}
        variant="ghost"
        size="sm"
        onClick={onOpenTools}
        icon={
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <circle cx="4" cy="10" r="1.6" />
            <circle cx="10" cy="10" r="1.6" />
            <circle cx="16" cy="10" r="1.6" />
          </svg>
        }
      />
    </div>
  );
}

export default FoxyTopBar;
