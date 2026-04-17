'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Avatar, Skeleton, EmptyState } from '@/components/ui';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import StreakBadge from './StreakBadge';

/* ═══════════════════════════════════════════════════════════════
   ClassChallengeBoard — Class Participation Board
   Shows students who solved today's challenge, sorted by streak.
   Only shows solvers — NEVER names non-solvers (privacy).
   Uses client supabase (RLS handles access).
   ═══════════════════════════════════════════════════════════════ */

interface ClassChallengeBoardProps {
  grade: string;
  studentId: string;
  challengeDate: string;
  isHi: boolean;
}

interface SolverRow {
  studentId: string;
  name: string;
  streak: number;
  badges: string[];
}

export default function ClassChallengeBoard({
  grade,
  studentId,
  challengeDate,
  isHi,
}: ClassChallengeBoardProps) {
  const [solvers, setSolvers] = useState<SolverRow[]>([]);
  const [totalStudents, setTotalStudents] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchBoard() {
      setLoading(true);
      setError(null);

      try {
        // Fetch challenge attempts for this date and grade, joined with students + streaks
        const { data: attemptData, error: attemptError } = await supabase
          .from('challenge_attempts')
          .select(`
            student_id,
            students!inner ( id, first_name, last_name, grade ),
            challenge_streaks ( current_streak, badges )
          `)
          .eq('challenge_date', challengeDate)
          .eq('students.grade', grade)
          .eq('solved', true);

        if (attemptError) throw attemptError;

        if (!cancelled) {
          const rows: SolverRow[] = (attemptData || []).map((row: any) => ({
            studentId: row.student_id,
            name: row.students
              ? `${row.students.first_name || ''} ${(row.students.last_name || '').charAt(0)}.`.trim()
              : '?',
            streak: row.challenge_streaks?.[0]?.current_streak ?? row.challenge_streaks?.current_streak ?? 0,
            badges: row.challenge_streaks?.[0]?.badges ?? row.challenge_streaks?.badges ?? [],
          }));

          // Sort by streak descending
          rows.sort((a, b) => b.streak - a.streak);
          setSolvers(rows);
        }

        // Get total student count for grade (separate query)
        const { count, error: countError } = await supabase
          .from('students')
          .select('id', { count: 'exact', head: true })
          .eq('grade', grade);

        if (!countError && !cancelled) {
          setTotalStudents(count ?? 0);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || (isHi ? 'लोड करने में समस्या' : 'Failed to load'));
        }
      }

      if (!cancelled) setLoading(false);
    }

    fetchBoard();
    return () => { cancelled = true; };
  }, [grade, challengeDate, isHi]);

  // ── Loading state ──
  if (loading) {
    return (
      <div className="space-y-2">
        <p className="text-xs font-bold text-[var(--text-3)] uppercase tracking-wider mb-2">
          {isHi ? 'क्लास बोर्ड' : 'Class Board'}
        </p>
        {[1, 2, 3].map(i => (
          <div key={i} className="flex items-center gap-3 py-2">
            <Skeleton variant="circle" width={32} height={32} />
            <Skeleton width="60%" height={14} />
          </div>
        ))}
      </div>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <SectionErrorBoundary section={isHi ? 'क्लास बोर्ड' : 'Class Board'}>
        <p className="text-sm text-[var(--text-3)]">{error}</p>
      </SectionErrorBoundary>
    );
  }

  // ── Empty state ──
  if (solvers.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-xs font-bold text-[var(--text-3)] uppercase tracking-wider mb-2">
          {isHi ? 'क्लास बोर्ड' : 'Class Board'}
        </p>
        <EmptyState
          icon={'\uD83C\uDFC6'}
          title={isHi ? 'सबसे पहले हल करो!' : 'Be the first to solve today!'}
          description={
            isHi
              ? 'अभी तक किसी ने आज का चैलेंज हल नहीं किया'
              : 'No one has solved today\'s challenge yet'
          }
        />
      </div>
    );
  }

  // ── Calculate class average streak ──
  const avgStreak = solvers.length > 0
    ? Math.round(solvers.reduce((sum, s) => sum + s.streak, 0) / solvers.length)
    : 0;

  // ── Render solver list ──
  return (
    <div className="space-y-2">
      <p className="text-xs font-bold text-[var(--text-3)] uppercase tracking-wider mb-2">
        {isHi ? 'क्लास बोर्ड' : 'Class Board'}
      </p>

      <div
        className="rounded-xl overflow-hidden"
        style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
      >
        {solvers.map((solver, idx) => {
          const isCurrentStudent = solver.studentId === studentId;
          return (
            <div
              key={solver.studentId}
              className="flex items-center gap-3 px-3.5 py-2.5"
              style={{
                background: isCurrentStudent ? 'rgba(249, 115, 22, 0.06)' : 'transparent',
                borderBottom: idx < solvers.length - 1 ? '1px solid var(--border)' : 'none',
              }}
            >
              {/* Avatar initials */}
              <Avatar name={solver.name} size={32} />

              {/* Name */}
              <span className={`text-sm flex-1 min-w-0 truncate ${isCurrentStudent ? 'font-bold' : 'font-medium'}`} style={{
                color: isCurrentStudent ? '#F97316' : 'var(--text-1)',
              }}>
                {solver.name}
                {isCurrentStudent && (
                  <span className="text-[10px] text-[var(--text-3)] ml-1">
                    ({isHi ? 'तुम' : 'You'})
                  </span>
                )}
              </span>

              {/* Streak badge */}
              <StreakBadge streak={solver.streak} badges={solver.badges} isHi={isHi} size="sm" />

              {/* Solved indicator */}
              <span className="text-xs flex-shrink-0" aria-label={isHi ? 'हल किया' : 'Solved'}>
                {'\u2705'}
              </span>
            </div>
          );
        })}
      </div>

      {/* Bottom stat */}
      <p className="text-[10px] text-center text-[var(--text-3)] mt-2">
        {isHi
          ? `${solvers.length} / ${totalStudents || '?'} छात्रों ने आज हल किया \u00B7 क्लास औसत: ${avgStreak} दिन`
          : `${solvers.length} of ${totalStudents || '?'} students solved today \u00B7 Class avg: ${avgStreak} day${avgStreak !== 1 ? 's' : ''}`
        }
      </p>
    </div>
  );
}
