'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

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
  color,
}: {
  icon: string;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div className="flex flex-col items-center px-2 py-2.5">
      <span className="text-base mb-0.5">{icon}</span>
      <span className="text-lg font-bold" style={{ color }}>
        {value}
      </span>
      <span className="text-[10px] text-gray-500 uppercase tracking-wide text-center">
        {label}
      </span>
    </div>
  );
}

// ─── Loading Skeleton ───────────────────────────────────────────

function ReportSkeleton() {
  return (
    <div className="bg-white rounded-[14px] px-[18px] py-4 border border-orange-200 animate-pulse">
      <div className="h-5 bg-orange-100 rounded w-3/4 mb-4" />
      <div className="space-y-2 mb-4">
        <div className="h-4 bg-orange-50 rounded w-full" />
        <div className="h-4 bg-orange-50 rounded w-5/6" />
        <div className="h-4 bg-orange-50 rounded w-4/6" />
      </div>
      <div className="grid grid-cols-3 gap-2 mb-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 bg-orange-50 rounded-lg" />
        ))}
      </div>
      <div className="h-4 bg-orange-50 rounded w-2/3" />
    </div>
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
      <div className="bg-white rounded-[14px] px-[18px] py-4 border border-orange-200">
        <h3 className="text-[15px] font-semibold text-gray-900 mb-2">
          {t(isHi, 'AI Weekly Report', 'AI साप्ताहिक रिपोर्ट')}
        </h3>
        <p className="text-[13px] text-red-500 mb-3">{error}</p>
        <button
          onClick={fetchReport}
          disabled={loading}
          className="px-4 py-2 bg-orange-500 text-white text-[13px] font-semibold rounded-lg border-none cursor-pointer disabled:opacity-50"
        >
          {t(isHi, 'Try Again', 'पुनः प्रयास करें')}
        </button>
      </div>
    );
  }

  if (!report) return null;

  const s = report.stats;

  return (
    <div className="bg-white rounded-[14px] px-[18px] py-4 border border-orange-200 mb-3.5">
      {/* Header */}
      <div className="flex justify-between items-start mb-3">
        <div>
          <h3 className="text-[15px] font-semibold text-gray-900 mb-0.5">
            {t(isHi, 'AI Weekly Report', 'AI साप्ताहिक रिपोर्ट')}
          </h3>
          <p className="text-[11px] text-gray-400 m-0">{report.period}</p>
        </div>
        {canGenerate() && (
          <button
            onClick={fetchReport}
            disabled={loading}
            className="px-3 py-1.5 bg-transparent text-orange-500 border border-orange-200 rounded-md text-[11px] cursor-pointer disabled:opacity-50"
          >
            {loading
              ? t(isHi, 'Generating...', 'बना रहे हैं...')
              : t(isHi, 'Generate New', 'नई रिपोर्ट')}
          </button>
        )}
      </div>

      {/* Highlights */}
      {report.highlights.length > 0 && (
        <div className="mb-3">
          <p className="text-[11px] text-emerald-600 font-semibold uppercase tracking-wide mb-1.5">
            {t(isHi, 'Highlights', 'मुख्य बातें')}
          </p>
          {report.highlights.map((h, i) => (
            <div key={i} className="flex items-start gap-2 mb-1.5">
              <span className="text-emerald-500 text-sm mt-0.5 flex-shrink-0">&#x2713;</span>
              <p className="text-[13px] text-gray-700 m-0 leading-relaxed">{h}</p>
            </div>
          ))}
        </div>
      )}

      {/* Concerns */}
      {report.concerns.length > 0 && (
        <div className="mb-3">
          <p className="text-[11px] text-amber-600 font-semibold uppercase tracking-wide mb-1.5">
            {t(isHi, 'Areas to Watch', 'ध्यान देने योग्य')}
          </p>
          {report.concerns.map((c, i) => (
            <div key={i} className="flex items-start gap-2 mb-1.5">
              <span className="text-amber-500 text-sm mt-0.5 flex-shrink-0">&#x26A0;</span>
              <p className="text-[13px] text-gray-700 m-0 leading-relaxed">{c}</p>
            </div>
          ))}
        </div>
      )}

      {/* Suggestion */}
      {report.suggestion && (
        <div className="bg-orange-50 rounded-lg px-3.5 py-2.5 mb-3 border-l-[3px] border-orange-400">
          <p className="text-[11px] text-orange-600 font-semibold uppercase tracking-wide mb-1">
            {t(isHi, 'Suggestion for You', 'आपके लिए सुझाव')}
          </p>
          <p className="text-[13px] text-gray-700 m-0 leading-relaxed">{report.suggestion}</p>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-1 bg-orange-50 rounded-lg overflow-hidden">
        <StatCell
          icon="&#x1F4DA;"
          label={t(isHi, 'Quizzes', 'क्विज़')}
          value={s.quizzes_completed}
          color="#6366F1"
        />
        <StatCell
          icon="&#x1F3AF;"
          label={t(isHi, 'Avg Score', 'औसत स्कोर')}
          value={`${s.avg_score}%`}
          color="#059669"
        />
        <StatCell
          icon="&#x2B50;"
          label="XP"
          value={s.xp_earned}
          color="#F59E0B"
        />
        <StatCell
          icon="&#x23F1;"
          label={t(isHi, 'Minutes', 'मिनट')}
          value={s.time_spent_minutes}
          color="#8B5CF6"
        />
        <StatCell
          icon="&#x1F4D6;"
          label={t(isHi, 'Mastered', 'महारत')}
          value={s.topics_mastered}
          color="#2563EB"
        />
        <StatCell
          icon="&#x1F525;"
          label={t(isHi, 'Streak', 'स्ट्रीक')}
          value={`${s.streak}d`}
          color="#EF4444"
        />
      </div>

      {/* Footer */}
      <p className="text-[10px] text-gray-400 mt-2.5 mb-0 text-center">
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
    </div>
  );
}
