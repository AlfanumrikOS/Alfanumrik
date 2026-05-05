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

import { Card, SectionHeader } from '@/components/ui';
import PendingLinkApproval, { type PendingLink } from '@/components/dashboard/PendingLinkApproval';
import type { Subject as AllowedSubject } from '@/lib/subjects.types';

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
        className="rounded-2xl p-4"
        style={{ background: bgColor, border: `1.5px solid ${borderColor}` }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
              style={{ background: `${urgencyColor}15` }}
              aria-hidden="true"
            >
              🎓
            </div>
            <div>
              <p
                className="text-[11px] font-bold uppercase tracking-wider"
                style={{ color: urgencyColor }}
              >
                {isHi ? examLabelHi : examLabel}
              </p>
              <p
                className="text-xl font-extrabold leading-none mt-0.5"
                style={{ fontFamily: 'var(--font-display)', color: urgencyColor }}
              >
                {daysLeft} {isHi ? 'दिन बाकी' : 'days left'}
              </p>
            </div>
          </div>
          {readinessPct > 0 && (
            <div className="text-right flex-shrink-0">
              <p
                className="text-lg font-extrabold"
                style={{ color: urgencyColor, fontFamily: 'var(--font-display)' }}
              >
                {readinessPct}%
              </p>
              <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                {isHi ? 'सिलेबस कवर' : 'syllabus covered'}
              </p>
            </div>
          )}
        </div>
        <p className="text-xs mt-3" style={{ color: 'var(--text-3)' }}>
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

      {/* Upcoming exam list */}
      {upcomingExams.length > 0 && (
        <div>
          <SectionHeader icon="📋">
            {isHi ? 'आगामी परीक्षाएँ' : 'Upcoming Exams'}
          </SectionHeader>
          <div className="space-y-2">
            {upcomingExams.map((exam) => {
              const isUrgent = exam.days_left <= 7;
              const examMeta = allowedSubjects.find((s) => s.code === exam.subject);
              const typeLabel =
                exam.exam_type === 'unit_test'
                  ? isHi
                    ? 'UT'
                    : 'UT'
                  : exam.exam_type === 'half_yearly'
                    ? isHi
                      ? 'अर्ध-वार्षिक'
                      : 'Half-Yearly'
                    : isHi
                      ? 'वार्षिक'
                      : 'Annual';
              return (
                <button
                  key={exam.id}
                  onClick={() => router.push('/exams')}
                  className="w-full"
                >
                  <Card className="!p-3 flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                      style={{
                        background: isUrgent
                          ? 'rgba(220,38,38,0.1)'
                          : `${examMeta?.color ?? 'var(--orange)'}15`,
                      }}
                      aria-hidden="true"
                    >
                      {examMeta?.icon ?? '📋'}
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <div className="font-semibold text-sm truncate">{exam.exam_name}</div>
                      <div className="text-[10px] text-[var(--text-3)] mt-0.5">
                        {typeLabel} ·{' '}
                        {new Date(exam.exam_date).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                        })}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div
                        className="text-lg font-bold"
                        style={{
                          color: isUrgent ? 'var(--danger)' : 'var(--orange)',
                          fontFamily: 'var(--font-display)',
                        }}
                      >
                        {exam.days_left}
                      </div>
                      <div className="text-[10px] text-[var(--text-3)]">
                        {isHi ? 'दिन' : 'days'}
                      </div>
                    </div>
                  </Card>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
