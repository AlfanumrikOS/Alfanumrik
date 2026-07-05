'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Card, CardBody, Button, Alert, Skeleton } from '@/components/ui/primitives';

// ─── Bilingual helper (P7) ─────────────────────────────────────
const t = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

// ─── Interfaces ─────────────────────────────────────────────────

interface ReportStats {
  quizzes_completed: number;
  avg_score: number;
  xp_earned: number;
  time_spent_minutes: number;
  topics_mastered: number;
  streak: number;
}

interface Report {
  period: string;
  highlights: string[];
  concerns: string[];
  suggestion: string;
  stats: ReportStats;
}

interface WeeklyReportProps {
  studentId: string;
  guardianId: string;
  isHi: boolean;
}

// ─── Stat Cell ──────────────────────────────────────────────────

function StatCell({
  icon,
  label,
  value,
  valueClass,
}: {
  icon: string;
  label: string;
  value: string | number;
  /** Token text-colour class for the value (presentation only). */
  valueClass: string;
}) {
  return (
    <div className="flex flex-col items-center px-2 py-2.5">
      <span className="mb-0.5 text-base" aria-hidden="true">
        {icon}
      </span>
      <span className={`text-lg font-bold ${valueClass}`}>{value}</span>
      <span className="text-center text-2xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

// ─── Loading Skeleton ───────────────────────────────────────────

function ReportSkeleton() {
  return (
    <Card>
      <CardBody className="space-y-4">
        <Skeleton className="h-5 w-3/4" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-4 w-2/3" />
      </CardBody>
    </Card>
  );
}

// ─── Main Component ─────────────────────────────────────────────

export default function WeeklyReport({ studentId, guardianId, isHi }: WeeklyReportProps) {
  const [report, setReport] = useState<Report | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCached, setIsCached] = useState(false);

  const canGenerate = useCallback(() => {
    if (!generatedAt) return true;
    const hoursSince = (Date.now() - new Date(generatedAt).getTime()) / (1000 * 60 * 60);
    return hoursSince >= 24;
  }, [generatedAt]);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Get session for auth token
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }

      const res = await fetch('/api/parent/report', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          student_id: studentId,
          language: isHi ? 'hi' : 'en',
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || t(isHi, 'Failed to load report', 'रिपोर्ट लोड करने में विफल'));
        setLoading(false);
        return;
      }

      setReport(data.data.report);
      setGeneratedAt(data.data.generated_at);
      setIsCached(data.data.cached || false);
    } catch {
      setError(t(isHi, 'Connection error. Please try again.', 'कनेक्शन एरर। कृपया पुनः प्रयास करें।'));
    } finally {
      setLoading(false);
    }
  }, [studentId, isHi]);

  // Auto-fetch on mount
  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  // ─── Loading state ──
  if (loading && !report) {
    return <ReportSkeleton />;
  }

  // ─── Error state ──
  if (error && !report) {
    return (
      <Card>
        <CardBody>
          <h3 className="mb-2 text-base font-semibold text-foreground">
            {t(isHi, 'AI Weekly Report', 'AI साप्ताहिक रिपोर्ट')}
          </h3>
          <Alert tone="danger" className="mb-3">
            {error}
          </Alert>
          <Button size="sm" onClick={fetchReport} loading={loading} disabled={loading}>
            {t(isHi, 'Try Again', 'पुनः प्रयास करें')}
          </Button>
        </CardBody>
      </Card>
    );
  }

  if (!report) return null;

  const s = report.stats;

  return (
    <Card className="mb-3.5">
      <CardBody>
        {/* Header */}
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h3 className="mb-0.5 text-base font-semibold text-foreground">
              {t(isHi, 'AI Weekly Report', 'AI साप्ताहिक रिपोर्ट')}
            </h3>
            <p className="text-xs text-muted-foreground">{report.period}</p>
          </div>
          {canGenerate() && (
            <Button size="sm" variant="secondary" onClick={fetchReport} loading={loading} disabled={loading}>
              {loading ? t(isHi, 'Generating...', 'बना रहे हैं...') : t(isHi, 'Generate New', 'नई रिपोर्ट')}
            </Button>
          )}
        </div>

        {/* Highlights */}
        {report.highlights.length > 0 && (
          <div className="mb-3">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-success">
              {t(isHi, 'Highlights', 'मुख्य बातें')}
            </p>
            {report.highlights.map((h, i) => (
              <div key={i} className="mb-1.5 flex items-start gap-2">
                <span className="mt-0.5 flex-shrink-0 text-sm text-success" aria-hidden="true">
                  &#x2713;
                </span>
                <p className="text-sm leading-relaxed text-foreground">{h}</p>
              </div>
            ))}
          </div>
        )}

        {/* Concerns */}
        {report.concerns.length > 0 && (
          <div className="mb-3">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-warning">
              {t(isHi, 'Areas to Watch', 'ध्यान देने योग्य')}
            </p>
            {report.concerns.map((c, i) => (
              <div key={i} className="mb-1.5 flex items-start gap-2">
                <span className="mt-0.5 flex-shrink-0 text-sm text-warning" aria-hidden="true">
                  &#x26A0;
                </span>
                <p className="text-sm leading-relaxed text-foreground">{c}</p>
              </div>
            ))}
          </div>
        )}

        {/* Suggestion */}
        {report.suggestion && (
          <div className="mb-3 rounded-lg border-l-[3px] border-primary bg-surface-2 px-3.5 py-2.5">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary">
              {t(isHi, 'Suggestion for You', 'आपके लिए सुझाव')}
            </p>
            <p className="text-sm leading-relaxed text-foreground">{report.suggestion}</p>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-1 overflow-hidden rounded-lg bg-surface-2">
          <StatCell
            icon="&#x1F4DA;"
            label={t(isHi, 'Quizzes', 'क्विज़')}
            value={s.quizzes_completed}
            valueClass="text-info"
          />
          <StatCell
            icon="&#x1F3AF;"
            label={t(isHi, 'Avg Score', 'औसत स्कोर')}
            value={`${s.avg_score}%`}
            valueClass="text-success"
          />
          <StatCell icon="&#x2B50;" label="XP" value={s.xp_earned} valueClass="text-xp" />
          <StatCell
            icon="&#x23F1;"
            label={t(isHi, 'Minutes', 'मिनट')}
            value={s.time_spent_minutes}
            valueClass="text-secondary"
          />
          <StatCell
            icon="&#x1F4D6;"
            label={t(isHi, 'Mastered', 'महारत')}
            value={s.topics_mastered}
            valueClass="text-info"
          />
          <StatCell
            icon="&#x1F525;"
            label={t(isHi, 'Streak', 'स्ट्रीक')}
            value={`${s.streak}d`}
            valueClass="text-streak"
          />
        </div>

        {/* Footer */}
        <p className="mb-0 mt-2.5 text-center text-2xs text-muted-foreground">
          {isCached
            ? t(isHi, 'Showing cached report', 'कैश्ड रिपोर्ट दिखा रहे हैं')
            : t(isHi, 'Freshly generated', 'अभी बनाई गई')}{' '}
          {generatedAt &&
            `| ${new Date(generatedAt).toLocaleDateString(isHi ? 'hi-IN' : 'en-IN', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}`}
        </p>
      </CardBody>
    </Card>
  );
}
