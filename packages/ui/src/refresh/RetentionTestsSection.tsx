'use client';

/**
 * Refresh page — Section C "Retention Tests".
 *
 * Renders pending retention quizzes from the `retention_tests` table
 * where scheduled_date <= today and status = 'pending'. CTA routes the
 * student to /quiz?mode=cognitive to take one.
 *
 * Extracted from src/app/review/page.tsx (2026-05-20).
 *
 * Auto-hides (renders null) when no tests are pending.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { supabase } from '@alfanumrik/lib/supabase';

interface RetentionTest {
  id: string;
  topic_title: string;
  subject: string;
  predicted_retention: number;
  scheduled_date: string;
}

export default function RetentionTestsSection() {
  const { student, isHi } = useAuth();
  const router = useRouter();
  const [tests, setTests] = useState<RetentionTest[] | null>(null);

  useEffect(() => {
    if (!student) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('retention_tests')
          .select('id, topic_title, subject, predicted_retention, scheduled_date')
          .eq('student_id', student.id)
          .eq('status', 'pending')
          .lte('scheduled_date', new Date().toISOString().split('T')[0])
          .order('scheduled_date')
          .limit(5);
        if (!cancelled) setTests(data ?? []);
      } catch {
        if (!cancelled) setTests([]);
      }
    })();
    return () => { cancelled = true; };
  }, [student]);

  if (tests === null || tests.length === 0) return null;

  return (
    <section data-testid="refresh-section-c" className="space-y-3">
      <header>
        <h2 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)' }}>
          {isHi ? '🧠 याददाश्त परीक्षा' : '🧠 Retention Tests'}
        </h2>
      </header>

      <div className="rounded-2xl p-4" style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.15)' }}>
        <div className="space-y-1.5">
          {tests.map(test => (
            <div key={test.id} className="flex items-center gap-2 text-xs">
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: test.predicted_retention < 0.5 ? '#EF4444' : '#F59E0B' }}
              />
              <span className="flex-1 truncate font-medium" style={{ color: 'var(--text-2)' }}>
                {test.topic_title}
              </span>
              <span className="text-[var(--text-3)] flex-shrink-0">
                {Math.round((test.predicted_retention ?? 0) * 100)}% {isHi ? 'याददाश्त' : 'retention'}
              </span>
            </div>
          ))}
        </div>
        <button
          onClick={() => router.push('/quiz?mode=cognitive')}
          className="mt-3 w-full py-2 rounded-xl text-xs font-bold"
          style={{ background: 'rgba(124,58,237,0.1)', color: '#7C3AED', border: '1px solid rgba(124,58,237,0.2)' }}
        >
          🧠 {isHi ? 'रिटेंशन टेस्ट लो' : 'Take Retention Test'}
        </button>
      </div>
    </section>
  );
}
