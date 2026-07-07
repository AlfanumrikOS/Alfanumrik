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
 * Phase 8 rebuild: Card container + Button CTA + token-only colour. The
 * Supabase query, filters, routing target and data-testid are UNCHANGED.
 *
 * Auto-hides (renders null) when no tests are pending.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { supabase } from '@alfanumrik/lib/supabase';
import { Card, Button } from '@alfanumrik/ui/ui/primitives';

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
        <h2 className="text-fluid-base font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
          {isHi ? '🧠 याददाश्त परीक्षा' : '🧠 Retention Tests'}
        </h2>
      </header>

      <Card
        variant="flat"
        className="p-4"
        style={{
          background: 'color-mix(in srgb, var(--purple) 6%, var(--surface-1))',
          borderColor: 'color-mix(in srgb, var(--purple) 15%, transparent)',
        }}
      >
        <div className="space-y-1.5">
          {tests.map(test => {
            const low = test.predicted_retention < 0.5;
            return (
              <div key={test.id} className="flex items-center gap-2 text-fluid-xs">
                <span
                  className="h-2 w-2 flex-shrink-0 rounded-full"
                  style={{ background: low ? 'var(--danger)' : 'var(--warning)' }}
                  aria-hidden="true"
                />
                <span className="flex-1 truncate font-medium" style={{ color: 'var(--text-2)' }}>
                  {test.topic_title}
                </span>
                <span className="flex-shrink-0 tabular-nums text-muted-foreground">
                  {Math.round((test.predicted_retention ?? 0) * 100)}% {isHi ? 'याददाश्त' : 'retention'}
                </span>
              </div>
            );
          })}
        </div>
        <Button
          variant="secondary"
          fullWidth
          onClick={() => router.push('/quiz?mode=cognitive')}
          leadingIcon={<span>🧠</span>}
          className="mt-3"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--purple) 12%, var(--surface-1))',
            borderColor: 'color-mix(in srgb, var(--purple) 34%, transparent)',
            color: 'var(--text-1)',
          }}
        >
          {isHi ? 'रिटेंशन टेस्ट लो' : 'Take Retention Test'}
        </Button>
      </Card>
    </section>
  );
}
