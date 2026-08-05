'use client';

/**
 * MissionCard — S1.6/U7 rendering of one play-module mission (config +
 * derived progress). Presentation only; the `play` module (assessment-owned)
 * derives MissionConfig[] and progress. This card links each step to the
 * canonical surface (e.g. /dive?mission=<id>) via an optional `href` on the
 * step; the target page reads ?mission=<id> as a read-only breadcrumb.
 *
 * P7 bilingual. P13 no PII.
 */

import Link from 'next/link';
import { MissionStepList, type MissionStepView } from './MissionStepList';

export interface MissionCardProps {
  missionId: string;
  title: string;
  titleHi?: string;
  description?: string;
  descriptionHi?: string;
  completedSteps: number;
  totalSteps: number;
  steps: MissionStepView[];
  isHi: boolean;
}

const t = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

export function MissionCard({
  missionId,
  title,
  titleHi,
  description,
  descriptionHi,
  completedSteps,
  totalSteps,
  steps,
  isHi,
}: MissionCardProps) {
  const pct = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
  const complete = completedSteps >= totalSteps && totalSteps > 0;
  return (
    <article
      data-testid="mission-card"
      data-mission-id={missionId}
      className="rounded-2xl p-4"
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-md)',
      }}
    >
      <header className="flex justify-between items-start gap-3">
        <div className="min-w-0">
          <h3
            className="text-base font-bold m-0 font-heading"
            style={{ color: 'var(--text-1)' }}
          >
            {isHi && titleHi ? titleHi : title}
          </h3>
          {(description || descriptionHi) && (
            <p className="text-[12px] mt-1 m-0" style={{ color: 'var(--text-3)' }}>
              {isHi && descriptionHi ? descriptionHi : description}
            </p>
          )}
        </div>
        {complete ? (
          <span
            className="inline-flex items-center h-6 px-2 rounded-full text-[11px] font-bold text-white shrink-0"
            style={{ background: 'var(--success, #059669)' }}
          >
            ✓ {t(isHi, 'Done', 'पूरा')}
          </span>
        ) : (
          <span
            className="text-[11px] font-semibold shrink-0 tabular-nums"
            style={{ color: 'var(--text-2)' }}
          >
            {completedSteps}/{totalSteps}
          </span>
        )}
      </header>
      <div
        className="mt-2 h-2 rounded-full overflow-hidden"
        style={{ background: 'var(--surface-2)' }}
        aria-label={t(isHi, 'Mission progress', 'मिशन प्रगति')}
      >
        <div
          className="h-full transition-all"
          style={{ width: `${pct}%`, background: 'var(--purple)' }}
        />
      </div>
      <div className="mt-3">
        <MissionStepList steps={steps} isHi={isHi} missionId={missionId} />
      </div>
    </article>
  );
}

export default MissionCard;
