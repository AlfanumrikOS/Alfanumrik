'use client';

/**
 * SkillTree — vertical mastery-state skill tree for a single subject.
 *
 * Part of the Alfa OS flagship redesign (ff_student_os_v1). It is a pure
 * presentation primitive: the caller passes already-resolved nodes (each with
 * a mastery status + percent derived from the existing concept_mastery /
 * get_mastery_overview engine output). SkillTree only lays them out, draws the
 * connecting spine, and assigns the CSS-only staggered reveal index.
 *
 * - No animation library (CSS `stagger` system only — protects P10).
 * - Mastery encoded via RoadmapNode's shape + ring + numeric label, never
 *   colour alone (WCAG 1.4.1).
 * - Bilingual by contract: caller localizes `label` + `statusLabel` per node
 *   and `emptyLabel`.
 */

import type { ReactNode } from 'react';
import { RoadmapNode, type RoadmapNodeStatus } from './RoadmapNode';

export interface SkillTreeNode {
  id: string;
  label: ReactNode;
  percent: number;
  status: RoadmapNodeStatus;
  statusLabel: string;
  onClick?: () => void;
}

export interface SkillTreeProps {
  nodes: SkillTreeNode[];
  /** Shown when there are no nodes yet (caller localizes). */
  emptyLabel?: ReactNode;
  className?: string;
}

export function SkillTree({ nodes, emptyLabel, className = '' }: SkillTreeProps) {
  if (nodes.length === 0) {
    return (
      <div
        className={`rounded-2xl p-4 text-center text-sm ${className}`}
        style={{
          background: 'var(--surface-2)',
          border: '1px dashed var(--border)',
          color: 'var(--text-3)',
        }}
      >
        {emptyLabel}
      </div>
    );
  }

  return (
    <ol
      className={`os-skill-tree relative flex flex-col gap-2 ${className}`}
      style={{ listStyle: 'none', margin: 0, padding: 0 }}
    >
      {nodes.map((n, i) => (
        <li key={n.id} className="relative">
          {/* Connecting spine between nodes — purely decorative. */}
          {i < nodes.length - 1 && (
            <span
              aria-hidden="true"
              className="absolute"
              style={{
                left: 21,
                top: 48,
                bottom: -8,
                width: 2,
                background: 'var(--border)',
              }}
            />
          )}
          <RoadmapNode
            label={n.label}
            percent={n.percent}
            status={n.status}
            statusLabel={n.statusLabel}
            index={i}
            onClick={n.onClick}
          />
        </li>
      ))}
    </ol>
  );
}

export default SkillTree;
