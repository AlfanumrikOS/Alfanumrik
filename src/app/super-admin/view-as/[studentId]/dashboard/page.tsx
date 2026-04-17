'use client';

import { useState, useEffect, useCallback, use } from 'react';
import { colors, S } from '../../../_components/admin-styles';

interface StudentData {
  id: string;
  name: string;
  grade: string;
  board: string;
  xp_total: number;
  streak_days: number;
  language_preference: string;
  [key: string]: unknown;
}

interface DashboardData {
  xp?: number;
  streak?: number;
  quizzes_today?: number;
  mastery_count?: number;
  [key: string]: unknown;
}

/**
 * ViewAsDashboardPage renders inside the Live View iframe.
 * It does NOT wrap in AdminShell (layout.tsx provides the chrome).
 * Authentication works via Supabase session cookie (same origin).
 */
export default function ViewAsDashboardPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = use(params);
  const [student, setStudent] = useState<StudentData | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/super-admin/students/${studentId}/dashboard`,
        { credentials: 'include' }
      );
      if (!res.ok) {
        const body = await res
          .json()
          .catch(() => ({ error: 'Failed to load dashboard' }));
        setError(body.error || 'Failed to load dashboard');
        return;
      }
      const data = await res.json();
      setStudent(data.student || null);
      setDashboard(data.dashboard || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: colors.text3, fontSize: 13 }}>
        Loading dashboard...
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          padding: 16,
          color: colors.danger,
          background: colors.dangerLight,
          borderRadius: 8,
          fontSize: 13,
        }}
      >
        {error}
      </div>
    );
  }

  if (!student) return null;

  const xp = dashboard?.xp ?? student.xp_total ?? 0;
  const streak = dashboard?.streak ?? student.streak_days ?? 0;
  const level = Math.floor(xp / 500);

  return (
    <div>
      {/* Greeting */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ ...S.h1, fontSize: 18 }}>
          {student.name || 'Student'}&apos;s Dashboard
        </h1>
        <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>
          Grade {student.grade} &middot; {student.board || 'CBSE'} &middot;{' '}
          {student.language_preference === 'hi' ? 'Hindi' : 'English'}
        </p>
      </div>

      {/* Stats strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 12,
          marginBottom: 24,
        }}
      >
        {[
          { label: 'XP', value: xp },
          { label: 'Level', value: level },
          { label: 'Streak', value: `${streak}d` },
          { label: 'Quizzes Today', value: dashboard?.quizzes_today ?? '\u2014' },
          { label: 'Topics Mastered', value: dashboard?.mastery_count ?? '\u2014' },
        ].map(({ label, value }) => (
          <div
            key={label}
            style={{
              ...S.card,
              textAlign: 'center',
              padding: 16,
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 700, color: colors.text1 }}>
              {value}
            </div>
            <div style={{ fontSize: 11, color: colors.text3, marginTop: 2 }}>
              {label}
            </div>
          </div>
        ))}
      </div>

      {/* Note: No interactive elements in read-only view */}
      <div
        style={{
          padding: 16,
          background: colors.surface,
          borderRadius: 8,
          border: `1px solid ${colors.borderLight}`,
          fontSize: 13,
          color: colors.text3,
        }}
      >
        This is a read-only view of the student dashboard. Use the tabs above to
        view progress, Foxy chat history, and quiz history.
      </div>
    </div>
  );
}