'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';

function t(isHi: boolean, en: string, hi: string): string { return isHi ? hi : en; }

interface Props {
  classId: string;
}

/**
 * Quick class performance summary card for teacher dashboard.
 * Shows student count, avg quiz score, and completion rate.
 */
export default function TeacherClassReport({ classId }: Props) {
  const { isHi } = useAuth();
  const [stats, setStats] = useState<{
    studentCount: number;
    avgScore: number;
    completionRate: number;
    className: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);

      const { data: cls } = await supabase
        .from('classes')
        .select('name, grade, section')
        .eq('id', classId)
        .single();

      const { data: enrollments } = await supabase
        .from('class_enrollments')
        .select('student_id')
        .eq('class_id', classId)
        .eq('is_active', true);

      const studentIds = (enrollments || []).map(e => e.student_id);
      const studentCount = studentIds.length;

      if (studentCount === 0) {
        setStats({ studentCount: 0, avgScore: 0, completionRate: 0, className: cls?.name || '' });
        setLoading(false);
        return;
      }

      const { data: quizzes } = await supabase
        .from('quiz_sessions')
        .select('student_id, score_percent')
        .in('student_id', studentIds.slice(0, 100));

      const allQuizzes = quizzes || [];
      const avgScore = allQuizzes.length > 0
        ? Math.round(allQuizzes.reduce((s, q) => s + (q.score_percent || 0), 0) / allQuizzes.length)
        : 0;

      const quizTakers = new Set(allQuizzes.map(q => q.student_id));
      const completionRate = Math.round((quizTakers.size / studentCount) * 100);

      setStats({
        studentCount,
        avgScore,
        completionRate,
        className: cls ? `${cls.grade}-${cls.section}` : '',
      });
      setLoading(false);
    })();
  }, [classId]);

  if (loading) {
    return <div style={{ padding: 16, background: 'var(--surface-2)', borderRadius: 12, height: 100 }} />;
  }

  if (!stats) return null;

  const scoreColor = stats.avgScore >= 70 ? 'var(--success)' : stats.avgScore >= 40 ? 'var(--warning)' : 'var(--danger)';

  return (
    <div style={{
      padding: 16,
      background: 'var(--surface-1)',
      borderRadius: 12,
      border: '1px solid var(--surface-3)',
      display: 'flex',
      gap: 20,
      alignItems: 'center',
      flexWrap: 'wrap',
    }}>
      <div>
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{t(isHi, 'Class', 'कक्षा')}</div>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{stats.className}</div>
      </div>
      <div>
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{t(isHi, 'Students', 'छात्र')}</div>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{stats.studentCount}</div>
      </div>
      <div>
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{t(isHi, 'Avg Score', 'औसत अंक')}</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: scoreColor }}>{stats.avgScore}%</div>
      </div>
      <div>
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{t(isHi, 'Quiz Completion', 'क्विज़ पूर्ण')}</div>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{stats.completionRate}%</div>
      </div>
    </div>
  );
}