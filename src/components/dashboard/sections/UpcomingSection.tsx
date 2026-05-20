'use client';

/**
 * UpcomingSection — collapsed below-fold accordion content.
 *
 * Houses time-sensitive widgets that previously stacked above-the-fold:
 *   - Board exam countdown (grades 10/11/12) with urgency colors + readiness
 *   - Per-exam countdown list from `dashData.exams`
 *   - Pending parent-link approval card (when a guardian has requested)
 *
 * This component is lazy-loaded via next/dynamic from page.tsx — it only mounts
 * when the user expands the "Upcoming" accordion, so the heavy date math + list
 * iteration stay out of the first-paint bundle.
 *
 * Owned by frontend. JSX moved verbatim from page.tsx — no behavior changes.
 */

import PendingLinkApproval, { type PendingLink } from '@/components/dashboard/PendingLinkApproval';
import type { Subject as AllowedSubject } from '@/lib/subjects.types';
import { trackDashboardCta } from '@/lib/posthog/dashboard-cta';

interface UpcomingExam {
  id: string;
  exam_name: string;
  exam_type: string;
  subject: string;
  exam_date: string;
  days_left: number;
}

interface UpcomingSectionProps {
  isHi: boolean;
  router: { push: (path: string) => void };
  studentGrade: string;
  cbseReadiness: number | null;
  upcomingExams: UpcomingExam[];
  allowedSubjects: AllowedSubject[];
  pendingLinks: PendingLink[];
  onLinkApproved: () => void;
}

export default function UpcomingSection({
  isHi,
  router,
  studentGrade,
  cbseReadiness,
  upcomingExams,
  allowedSubjects,
  pendingLinks,
  onLinkApproved,
}: UpcomingSectionProps) {
  // Board exam countdown — only renders for grades 10/11/12.
  const renderBoardCountdown = () => {
    const g = (studentGrade || '').replace('Grade ', '').trim();
    const gradeNum = parseInt(g, 10);
    if (Number.isNaN(gradeNum) || gradeNum < 10) return null;

    // Approximate board exam dates (CBSE 2027) — same source as page.tsx.
    const BOARD_DATE_10_12 = new Date('2027-02-15');
    const PREBOARD_DATE_11 = new Date('2026-12-01');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let targetDate: Date;
    let examLabel: string;
    let examLabelHi: string;

    if (gradeNum === 11) {
      targetDate = PREBOARD_DATE_11;
      examLabel = 'Pre-Board Exams';
      examLabelHi = 'प्री-बोर्ड परीक्षा';
    } else {
      targetDate = BOARD_DATE_10_12;
      examLabel = `Class ${g} Board Exams`;
      examLabelHi = `कक्षा ${g} बोर्ड परीक्षा`;
    }

    const daysLeft = Math.max(
      0,
      Math.ceil((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
    );
    const readinessPct = cbseReadiness ?? 0;

    const urgencyColor = daysLeft < 60 ? '#DC2626' : daysLeft < 120 ? '#D97706' : '#16A34A';
    const bgColor =
      daysLeft < 60
        ? 'rgba(220,38,38,0.05)'
        : daysLeft < 120
          ? 'rgba(217,119,6,0.05)'
          : 'rgba(22,163,74,0.05)';
    const borderColor =
      daysLeft < 60
        ? 'rgba(220,38,38,0.2)'
        : daysLeft < 120
          ? 'rgba(217,119,6,0.2)'
          : 'rgba(22,163,74,0.2)';

    const motivationEn =
      daysLeft < 60
        ? 'Final push — every session counts now.'
        : daysLeft < 120
          ? 'Consistent daily practice beats last-minute cramming.'
          : 'You have time. Build the habit now.';
    const motivationHi =
      daysLeft < 60
        ? 'अंतिम चरण — हर सेशन अब मायने रखता है।'
        : daysLeft < 120
          ? 'नियमित अभ्यास लास्ट-मिनट रटाई से बेहतर है।'
          : 'समय है। अभी से आदत बनाओ।';

    return (
      <div
        className="editorial-card"
        style={{
          background: bgColor,
          borderColor,
          borderLeft: `4px solid ${urgencyColor}`,
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p
              className="editorial-eyebrow"
              style={{ color: urgencyColor }}
            >
              {isHi ? examLabelHi : examLabel}
            </p>
            <div className="flex items-baseline gap-2 mt-1">
              <span
                className="dashboard-rank-display"
                style={{ color: urgencyColor }}
              >
                {daysLeft}
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-serif)',
                  fontSize: 'var(--text-md)',
                  color: 'var(--ink-2)',
                  letterSpacing: '-0.01em',
                }}
              >
                {isHi ? 'दिन बाकी' : 'days left'}
              </span>
            </div>
          </div>
          {readinessPct > 0 && (
            <div className="text-right flex-shrink-0">
              <p
                style={{
                  fontFamily: 'var(--font-serif)',
                  fontSize: 'var(--text-2xl)',
                  fontWeight: 500,
                  color: urgencyColor,
                  letterSpacing: '-0.015em',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {readinessPct}%
              </p>
              <p
                style={{ fontSize: 10, color: 'var(--ink-3)' }}
              >
                {isHi ? 'सिलेबस कवर' : 'syllabus covered'}
              </p>
            </div>
          )}
        </div>
        <p
          className="mt-3"
          style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)' }}
        >
          {isHi ? motivationHi : motivationEn}
        </p>
      </div>
    );
  };

  return (
    <div className="space-y-4 pt-3">
      {/* Pending parent-link approval — shown first because it's actionable. */}
      {pendingLinks.length > 0 && (
        <PendingLinkApproval links={pendingLinks} onApproved={onLinkApproved} isHi={isHi} />
      )}

      {/* Board exam countdown */}
      {renderBoardCountdown()}

      {/* Upcoming exam timeline — each row has a 4px colored left-bar
          that encodes days-until urgency: red < 7d, orange < 21d, gold
          < 60d, ink otherwise. Reads like a calendar, not a list. */}
      {upcomingExams.length > 0 && (
        <div>
          <p
            className="editorial-eyebrow mb-2"
            style={{ paddingLeft: 2 }}
          >
            {isHi ? 'आगामी परीक्षाएँ' : 'Upcoming Exams'}
          </p>
          <div className="dashboard-timeline">
            {upcomingExams.map((exam) => {
              const days = exam.days_left;
              const isUrgent = days <= 7;
              const examMeta = allowedSubjects.find((s) => s.code === exam.subject);
              const typeLabel =
                exam.exam_type === 'unit_test'
                  ? 'UT'
                  : exam.exam_type === 'half_yearly'
                    ? isHi
                      ? 'अर्ध-वार्षिक'
                      : 'Half-Yearly'
                    : isHi
                      ? 'वार्षिक'
                      : 'Annual';
              // Urgency color → left-bar accent.
              const urgencyColor =
                days <= 7
                  ? '#DC2626'
                  : days <= 21
                    ? '#F97316'
                    : days <= 60
                      ? '#D97706'
                      : 'var(--ink-3)';
              return (
                <button
                  key={exam.id}
                  onClick={() => {
                    trackDashboardCta({
                      section: 'upcoming',
                      action: isUrgent ? 'exam_urgent_tap' : 'exam_tap',
                      destination: '/exams',
                    });
                    router.push('/exams');
                  }}
                  className="dashboard-timeline-item text-left"
                  style={{ borderLeftColor: urgencyColor }}
                  aria-label={`${exam.exam_name} — ${days} ${isHi ? 'दिन बाकी' : 'days left'}`}
                >
                  <div
                    className="rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{
                      width: 36,
                      height: 36,
                      background: `${examMeta?.color ?? '#7D7264'}12`,
                      alignSelf: 'center',
                      fontSize: 18,
                    }}
                    aria-hidden="true"
                  >
                    {examMeta?.icon ?? '📋'}
                  </div>
                  <div className="flex-1 min-w-0 self-center">
                    <p
                      className="truncate"
                      style={{
                        fontFamily: 'var(--font-serif)',
                        fontWeight: 500,
                        fontSize: 'var(--text-md)',
                        color: 'var(--ink)',
                        letterSpacing: '-0.01em',
                      }}
                    >
                      {exam.exam_name}
                    </p>
                    <p
                      style={{
                        fontSize: 10,
                        color: 'var(--ink-3)',
                        marginTop: 2,
                        letterSpacing: '0.04em',
                      }}
                    >
                      {typeLabel} ·{' '}
                      {new Date(exam.exam_date).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </p>
                  </div>
                  <div
                    className="self-center text-right flex-shrink-0"
                    style={{ minWidth: 48 }}
                  >
                    <p
                      className="dashboard-timeline-item__days"
                      style={{ color: urgencyColor }}
                    >
                      {days}
                    </p>
                    <p
                      style={{
                        fontSize: 10,
                        color: 'var(--ink-3)',
                        marginTop: 2,
                      }}
                    >
                      {isHi ? 'दिन' : 'days'}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
