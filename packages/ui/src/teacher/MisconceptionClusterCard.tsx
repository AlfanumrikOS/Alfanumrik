'use client';

/**
 * MisconceptionClusterCard — one row in the "Misconception clusters" panel on
 * the teacher Command Center. Reads a single cluster row from the
 * teacher-dashboard `get_misconception_clusters` action:
 *
 *   { pattern_code, concept_codes[], student_count,
 *     students: [{ id, name }], first_detected, last_detected }
 *
 * Presentation ONLY. Server owns the clustering / pattern derivation
 * (assessment/backend). This card renders the name, count badge, up to 6 avatar
 * chips, and an "Evidence" affordance that opens EvidenceDrawer. P7 bilingual.
 * P13 no PII in logs.
 */

import type { CSSProperties } from 'react';

export interface MisconceptionCluster {
  pattern_code: string;
  concept_codes: string[];
  student_count: number;
  students: Array<{ id: string; name: string }>;
  first_detected: string;
  last_detected: string;
}

const t = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

// Very light heuristic for a human label from a snake_case pattern code.
// The server owns the canonical taxonomy; this is only a display fallback for
// codes we haven't localized yet.
function humanizePatternCode(code: string): string {
  return code.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const CHIP_STYLE: CSSProperties = {
  background: 'var(--surface-2)',
  border: '1px solid var(--border)',
  color: 'var(--text-2)',
};

export function MisconceptionClusterCard({
  cluster,
  isHi,
  onViewEvidence,
}: {
  cluster: MisconceptionCluster;
  isHi: boolean;
  onViewEvidence: (cluster: MisconceptionCluster) => void;
}) {
  const label = humanizePatternCode(cluster.pattern_code);
  const chips = cluster.students.slice(0, 6);
  const overflow = Math.max(0, cluster.student_count - chips.length);
  return (
    <div
      data-testid="misconception-cluster-card"
      className="rounded-xl p-3 border-l-[3px]"
      style={{
        background: 'var(--surface-2)',
        borderLeftColor: 'var(--purple)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div className="flex justify-between items-start gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold m-0" style={{ color: 'var(--text-1)' }}>
            {label}
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
            {cluster.concept_codes.slice(0, 3).join(' · ')}
          </p>
        </div>
        <span
          data-testid="cluster-count-badge"
          className="inline-flex items-center justify-center min-w-[24px] h-[22px] px-1.5 rounded-full text-[11px] font-bold text-white shrink-0"
          style={{ background: 'var(--purple)' }}
        >
          {cluster.student_count}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {chips.map((s) => (
          <span
            key={s.id}
            className="inline-flex items-center h-6 px-2 rounded-full text-[11px] font-medium"
            style={CHIP_STYLE}
            title={s.name}
          >
            {s.name}
          </span>
        ))}
        {overflow > 0 && (
          <span
            className="inline-flex items-center h-6 px-2 rounded-full text-[11px] font-medium"
            style={CHIP_STYLE}
          >
            +{overflow}
          </span>
        )}
      </div>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={() => onViewEvidence(cluster)}
          data-testid="view-evidence-btn"
          className="py-1 px-2.5 rounded-md text-[11px] font-semibold border-none cursor-pointer"
          style={{ background: 'var(--purple)', color: 'white' }}
        >
          {t(isHi, 'View evidence', 'सबूत देखें')}
        </button>
      </div>
    </div>
  );
}

export default MisconceptionClusterCard;
