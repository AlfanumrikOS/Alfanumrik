'use client';

/**
 * LeadershipTab — the Foxy North-Star K9 leadership dashboard, folded into the
 * /school-admin/reports page as the 5th tab (?tab=leadership).
 *
 * P10 FOLD-IN DECISION (2026-08-05, quality-gate blocker): this surface
 * originally shipped as a standalone route at /school-admin/leadership, which
 * measured over the 260 kB per-page cap. The cap is structurally unreachable
 * for ANY new route under the school-admin layout — the shell alone exceeds
 * 260 kB. Following the Phase 1 safeguarding-queue precedent (see
 * escalations/page.tsx header), the leadership dashboard was folded into this
 * grandfathered `reports` page as an additional tab, dynamic-imported so it
 * stays out of the host page's first-load chunk set. The standalone route dir
 * was deleted. The API route (`/api/school-admin/leadership`) is unchanged.
 *
 * Reads /api/school-admin/leadership, which returns:
 *   { school_overview, safeguarding_counts, competency_summary, coverage }
 *
 * When ff_school_pulse_v1 is OFF, the endpoint returns a 404-shape body which
 * this component renders as a friendly "not enabled yet" placeholder. Tiles
 * are SHARED (packages/ui/src/leadership/Tiles.tsx). No business logic here —
 * ops owns metric definitions, backend owns the aggregations.
 *
 * P7 bilingual. P13 no PII (all values are aggregates).
 */

import { useEffect, useState } from 'react';
import { SectionErrorBoundary } from '@alfanumrik/ui/SectionErrorBoundary';
import { LeadershipTile, LeadershipSection } from '@alfanumrik/ui/leadership/Tiles';
import { useAuth } from '@alfanumrik/lib/AuthContext';

const t = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

interface LeadershipPayload {
  school_overview?: {
    students_total?: number;
    active_this_week?: number;
    at_risk?: number;
    avg_mastery_pct?: number;
  };
  safeguarding_counts?: {
    open?: number;
    escalated?: number;
    resolved_7d?: number;
  };
  competency_summary?: {
    average_growth_pct?: number;
    retention_pct?: number;
    engagement_pct?: number;
    top_competencies?: Array<{ code: string; label: string; growth_pct: number }>;
  };
  coverage?: {
    subjects_ready?: number;
    subjects_total?: number;
    chapters_ready?: number;
    chapters_total?: number;
    stale_syllabus_rows?: number;
  };
  disabled?: boolean;
}

export default function LeadershipTab() {
  const { isHi } = useAuth();
  const [data, setData] = useState<LeadershipPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [disabled, setDisabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/school-admin/leadership', {
          credentials: 'same-origin',
        });
        if (cancelled) return;
        if (res.status === 404) {
          setDisabled(true);
          setLoading(false);
          return;
        }
        if (!res.ok) {
          setError(String(res.status));
          setLoading(false);
          return;
        }
        setData((await res.json()) as LeadershipPayload);
      } catch {
        if (!cancelled)
          setError(
            t(isHi, "Couldn't load leadership metrics.", 'नेतृत्व मेट्रिक्स लोड नहीं हो सके।'),
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isHi]);

  if (loading) {
    return (
      <div
        className="h-32 rounded-2xl animate-pulse"
        style={{ background: 'var(--surface-2)' }}
        aria-hidden="true"
      />
    );
  }
  if (disabled) {
    return (
      <>
        <h2
          className="text-lg font-extrabold m-0 font-heading"
          style={{ color: 'var(--text-1)' }}
        >
          {t(isHi, 'Leadership dashboard', 'नेतृत्व डैशबोर्ड')}
        </h2>
        <p className="text-sm mt-2" style={{ color: 'var(--text-3)' }}>
          {t(
            isHi,
            'This surface is not enabled for your school yet.',
            'यह सुविधा अभी आपके स्कूल के लिए सक्षम नहीं है।',
          )}
        </p>
      </>
    );
  }
  if (error || !data) {
    return (
      <p className="text-sm" style={{ color: 'var(--danger, #DC2626)' }}>
        {error ||
          t(isHi, "Couldn't load leadership metrics.", 'नेतृत्व मेट्रिक्स लोड नहीं हो सके।')}
      </p>
    );
  }

  const so = data.school_overview ?? {};
  const cs = data.competency_summary ?? {};
  const cov = data.coverage ?? {};
  const sg = data.safeguarding_counts ?? {};

  return (
    <div data-testid="leadership-tab-panel">
      <header className="mb-5">
        <h2
          className="text-lg font-extrabold m-0 font-heading"
          style={{ color: 'var(--text-1)' }}
        >
          {t(isHi, 'Leadership dashboard', 'नेतृत्व डैशबोर्ड')}
        </h2>
        <p className="text-sm mt-1 m-0" style={{ color: 'var(--text-3)' }}>
          {t(
            isHi,
            'PARAKH-style school health, aggregated.',
            'PARAKH-शैली में स्कूल का समग्र स्वास्थ्य।',
          )}
        </p>
      </header>

      <SectionErrorBoundary section="Competency growth">
        <LeadershipSection
          title="Competency growth"
          titleHi="दक्षता विकास"
          isHi={isHi}
        >
          <LeadershipTile
            label="Average growth"
            labelHi={isHi ? 'औसत विकास' : undefined}
            value={cs.average_growth_pct != null ? `${cs.average_growth_pct}%` : '—'}
          />
          <LeadershipTile
            label="Avg mastery"
            labelHi={isHi ? 'औसत मास्टरी' : undefined}
            value={so.avg_mastery_pct != null ? `${so.avg_mastery_pct}%` : '—'}
          />
          <LeadershipTile
            label="Top competency"
            labelHi={isHi ? 'शीर्ष दक्षता' : undefined}
            value={cs.top_competencies?.[0]?.label ?? '—'}
            hint={
              cs.top_competencies?.[0]
                ? `+${cs.top_competencies[0].growth_pct}%`
                : undefined
            }
          />
          <LeadershipTile
            label="Students"
            labelHi={isHi ? 'छात्र' : undefined}
            value={so.students_total ?? '—'}
          />
        </LeadershipSection>
      </SectionErrorBoundary>

      <SectionErrorBoundary section="Retention & engagement">
        <LeadershipSection
          title="Retention & engagement"
          titleHi="प्रतिधारण और सहभागिता"
          isHi={isHi}
        >
          <LeadershipTile
            label="Retention (30d)"
            labelHi={isHi ? 'प्रतिधारण (30द)' : undefined}
            value={cs.retention_pct != null ? `${cs.retention_pct}%` : '—'}
            accent="var(--success, #059669)"
          />
          <LeadershipTile
            label="Engagement"
            labelHi={isHi ? 'सहभागिता' : undefined}
            value={cs.engagement_pct != null ? `${cs.engagement_pct}%` : '—'}
            accent="var(--success, #059669)"
          />
          <LeadershipTile
            label="Active this week"
            labelHi={isHi ? 'इस सप्ताह सक्रिय' : undefined}
            value={so.active_this_week ?? '—'}
          />
          <LeadershipTile
            label="At-risk"
            labelHi={isHi ? 'जोखिम में' : undefined}
            value={so.at_risk ?? '—'}
            accent="var(--warning, #F5A623)"
          />
        </LeadershipSection>
      </SectionErrorBoundary>

      <SectionErrorBoundary section="Syllabus coverage">
        <LeadershipSection
          title="Syllabus coverage"
          titleHi="पाठ्यक्रम कवरेज"
          isHi={isHi}
        >
          <LeadershipTile
            label="Subjects ready"
            labelHi={isHi ? 'तैयार विषय' : undefined}
            value={
              cov.subjects_ready != null && cov.subjects_total != null
                ? `${cov.subjects_ready}/${cov.subjects_total}`
                : '—'
            }
          />
          <LeadershipTile
            label="Chapters ready"
            labelHi={isHi ? 'तैयार अध्याय' : undefined}
            value={
              cov.chapters_ready != null && cov.chapters_total != null
                ? `${cov.chapters_ready}/${cov.chapters_total}`
                : '—'
            }
          />
          <LeadershipTile
            label="Stale rows"
            labelHi={isHi ? 'पुराने रिकॉर्ड' : undefined}
            value={cov.stale_syllabus_rows ?? '—'}
            accent="var(--warning, #F5A623)"
          />
        </LeadershipSection>
      </SectionErrorBoundary>

      <SectionErrorBoundary section="Safety">
        <LeadershipSection title="Safety" titleHi="सुरक्षा" isHi={isHi}>
          <LeadershipTile
            label="Open cases"
            labelHi={isHi ? 'खुले मामले' : undefined}
            value={sg.open ?? 0}
            accent="var(--danger, #DC2626)"
            href="/school-admin/escalations?tab=safeguarding"
          />
          <LeadershipTile
            label="Escalated"
            labelHi={isHi ? 'बढ़ाए गए' : undefined}
            value={sg.escalated ?? 0}
            accent="var(--danger, #DC2626)"
            href="/school-admin/escalations?tab=safeguarding"
          />
          <LeadershipTile
            label="Resolved (7d)"
            labelHi={isHi ? 'हल किए गए (7द)' : undefined}
            value={sg.resolved_7d ?? 0}
            accent="var(--success, #059669)"
            href="/school-admin/escalations?tab=safeguarding"
          />
        </LeadershipSection>
      </SectionErrorBoundary>
    </div>
  );
}
