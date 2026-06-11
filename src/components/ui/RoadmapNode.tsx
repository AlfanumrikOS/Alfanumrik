'use client';

/**
 * RoadmapNode — a single mastery-state node in a SubjectRoadmap skill tree.
 *
 * Part of the Alfa OS flagship redesign (ff_student_os_v1). Pure presentation
 * over the existing concept_mastery / get_mastery_overview outputs — it does
 * not compute mastery, it only renders the state the engine already decided.
 *
 * Mastery state is encoded by SHAPE + RING + NUMERIC LABEL, never by colour
 * alone (WCAG 1.4.1 — accessibility requirement). Each state carries:
 *   - a distinct status glyph (✓ mastered, ◑ learning, ↻ needs-revision, 🔒 locked)
 *   - a MasteryRing-style coloured ring around the node
 *   - the numeric mastery percentage as visible text
 *
 * CSS-only motion: the reveal uses the existing `stagger` system via a
 * `--stagger-i` custom property the parent SkillTree sets per node and the
 * `os-roadmap-node` keyframe in globals/cosmic CSS. prefers-reduced-motion is
 * honoured by those rules (no JS animation, no animation library — protects
 * P10).
 */

import type { ReactNode } from 'react';

export type RoadmapNodeStatus = 'mastered' | 'learning' | 'needs-revision' | 'locked';

export interface RoadmapNodeProps {
  /** Chapter / topic label (caller passes already-localized text). */
  label: ReactNode;
  /** Mastery percentage 0–100. Shown as the numeric encoding. */
  percent: number;
  status: RoadmapNodeStatus;
  /** Stagger index for the CSS-only reveal. */
  index?: number;
  /** Optional click — locked nodes should pass an upsell/no-op handler. */
  onClick?: () => void;
  /** Accessible status word (caller localizes, e.g. "महारत" / "Mastered"). */
  statusLabel: string;
}

const STATUS_GLYPH: Record<RoadmapNodeStatus, string> = {
  mastered: '✓',
  learning: '◑',
  'needs-revision': '↻',
  locked: '🔒',
};

// Ring colours mirror the MasteryRing thresholds + dashboard palette. These
// are the VISUAL reinforcement; the glyph + numeric label carry the meaning so
// colour is never the sole channel.
const STATUS_COLOR: Record<RoadmapNodeStatus, string> = {
  mastered: 'var(--green, #16A34A)',
  learning: 'var(--orange, #E8581C)',
  'needs-revision': '#8B5CF6',
  locked: 'var(--text-3, #9CA3AF)',
};

export function RoadmapNode({
  label,
  percent,
  status,
  index = 0,
  onClick,
  statusLabel,
}: RoadmapNodeProps) {
  const color = STATUS_COLOR[status];
  const pct = Math.min(100, Math.max(0, Math.round(percent)));
  const isLocked = status === 'locked';

  // Derive the accessible topic name defensively: SkillTreeNode.label is a
  // ReactNode by contract, but every current caller passes a localized string.
  // For strings/numbers use the value directly; if a non-text node is ever
  // passed, fall back to the status + percentage so the label is never empty.
  const accessibleLabel =
    typeof label === 'string'
      ? label
      : typeof label === 'number'
        ? String(label)
        : '';
  const ariaLabel = accessibleLabel
    ? `${accessibleLabel} — ${statusLabel} ${pct}%`
    : `${statusLabel} ${pct}%`;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isLocked && !onClick}
      aria-label={ariaLabel}
      className="os-roadmap-node group flex items-center gap-3 w-full text-left rounded-2xl p-3 transition-all active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      style={{
        // Inline custom property feeds the CSS-only staggered reveal.
        ['--stagger-i' as string]: String(index),
        background: isLocked ? 'var(--surface-2)' : 'var(--surface-1)',
        border: `1px solid ${isLocked ? 'var(--border)' : `${color}33`}`,
        boxShadow: isLocked ? 'none' : 'var(--shadow-sm)',
        opacity: isLocked ? 0.6 : 1,
        minHeight: 48, // AAA touch target
        cursor: isLocked && !onClick ? 'not-allowed' : 'pointer',
      }}
    >
      {/* Ring + glyph: dual encoding (shape + colour). */}
      <span
        className="relative inline-flex items-center justify-center flex-shrink-0"
        style={{ width: 36, height: 36 }}
        aria-hidden="true"
      >
        <svg width={36} height={36} viewBox="0 0 36 36" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={18} cy={18} r={15} fill="none" stroke="var(--surface-2)" strokeWidth={3} />
          <circle
            cx={18}
            cy={18}
            r={15}
            fill="none"
            stroke={color}
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 15}
            strokeDashoffset={(2 * Math.PI * 15) * (1 - pct / 100)}
            style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1)' }}
          />
        </svg>
        <span className="absolute text-sm font-bold" style={{ color }}>
          {STATUS_GLYPH[status]}
        </span>
      </span>

      <span className="flex-1 min-w-0">
        <span
          className="block text-sm font-semibold truncate"
          style={{ color: 'var(--text-1)', fontFamily: 'var(--font-display)' }}
        >
          {label}
        </span>
        <span className="block text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
          {statusLabel}
          {' · '}
          <span style={{ fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}>
            {pct}%
          </span>
        </span>
      </span>
    </button>
  );
}

export default RoadmapNode;
