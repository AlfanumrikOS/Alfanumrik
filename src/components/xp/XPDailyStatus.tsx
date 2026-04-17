'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { XP_RULES } from '@/lib/xp-rules';
import { Card, ProgressBar, Skeleton, StreakBadge } from '@/components/ui';

/* ─── Types ──────────────────────────────────────────────── */

interface XPDailyStatusProps {
  studentId: string;
  streak: number;
  isHi: boolean;
}

interface CategoryXP {
  quiz: number;
  chat: number;
  streak: number;
  mastery: number;
  study: number;
  other: number;
}

/* ─── Category Config ────────────────────────────────────── */

const CATEGORY_DISPLAY: Array<{
  key: keyof CategoryXP;
  cap: number;
  color: string;
  labelEn: string;
  labelHi: string;
  icon: string;
}> = [
  { key: 'quiz', cap: XP_RULES.quiz_daily_cap, color: 'var(--orange)', labelEn: 'Quiz', labelHi: '\u0915\u094D\u0935\u093F\u095B\u093C', icon: '\u26A1' },
  { key: 'chat', cap: XP_RULES.foxy_chat_daily_cap, color: '#3B82F6', labelEn: 'Chat', labelHi: '\u091A\u0948\u091F', icon: '\uD83E\uDD8A' },
];

/* ─── Component ──────────────────────────────────────────── */

export default function XPDailyStatus({ studentId, streak, isHi }: XPDailyStatusProps) {
  const [categories, setCategories] = useState<CategoryXP>({
    quiz: 0, chat: 0, streak: 0, mastery: 0, study: 0, other: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchDailyXP() {
      setIsLoading(true);
      setError(null);
      try {
        // Try RPC first, fall back to direct query
        const { data: rpcData, error: rpcErr } = await supabase.rpc(
          'get_daily_xp_by_category',
          { p_student_id: studentId }
        );

        if (!rpcErr && rpcData && !cancelled) {
          // RPC returns array of { source, total_xp }
          const mapped: CategoryXP = { quiz: 0, chat: 0, streak: 0, mastery: 0, study: 0, other: 0 };
          for (const row of rpcData as Array<{ source: string; total_xp: number }>) {
            const key = row.source as keyof CategoryXP;
            if (key in mapped) {
              mapped[key] = row.total_xp;
            } else {
              mapped.other += row.total_xp;
            }
          }
          setCategories(mapped);
          return;
        }

        // Fallback: query today's transactions directly
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const { data: txns, error: txnErr } = await supabase
          .from('xp_transactions')
          .select('source, amount')
          .eq('student_id', studentId)
          .gte('created_at', todayStart.toISOString());

        if (txnErr) throw txnErr;
        if (cancelled) return;

        const mapped: CategoryXP = { quiz: 0, chat: 0, streak: 0, mastery: 0, study: 0, other: 0 };
        for (const txn of txns ?? []) {
          const key = txn.source as keyof CategoryXP;
          if (key in mapped) {
            mapped[key] += txn.amount;
          } else {
            mapped.other += txn.amount;
          }
        }
        setCategories(mapped);
      } catch (err) {
        if (!cancelled) {
          setError(isHi ? '\u0921\u0947\u091F\u093E \u0932\u094B\u0921 \u0928\u0939\u0940\u0902 \u0939\u094B \u0938\u0915\u093E' : 'Could not load daily progress');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchDailyXP();
    return () => { cancelled = true; };
  }, [studentId, isHi]);

  const totalToday = (Object.values(categories) as number[]).reduce((a: number, b: number) => a + b, 0);

  /* ─── Loading ─── */
  if (isLoading) {
    return (
      <Card className="space-y-3">
        <Skeleton variant="text" width="50%" />
        <Skeleton variant="text" />
        <Skeleton variant="text" />
        <Skeleton variant="text" width="60%" />
      </Card>
    );
  }

  /* ─── Error ─── */
  if (error) {
    return (
      <Card>
        <p className="text-sm text-center py-4 text-red-600">{error}</p>
      </Card>
    );
  }

  /* ─── Next milestone ─── */
  const nextMilestone = 200;
  const remaining = Math.max(0, nextMilestone - totalToday);

  return (
    <Card className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h3
          className="text-sm font-bold uppercase tracking-wider"
          style={{ color: 'var(--text-3)', fontFamily: 'var(--font-display)' }}
        >
          {isHi ? '\u0906\u091C \u0915\u0940 \u092A\u094D\u0930\u0917\u0924\u093F' : "Today's Progress"}
        </h3>
        <StreakBadge count={streak} compact />
      </div>

      {/* Category bars */}
      <div className="space-y-3">
        {CATEGORY_DISPLAY.map((cat) => {
          const earned = categories[cat.key];
          const pct = Math.min(100, Math.round((earned / cat.cap) * 100));
          return (
            <div key={cat.key} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-[var(--text-2)] flex items-center gap-1">
                  <span>{cat.icon}</span>
                  {isHi ? cat.labelHi : cat.labelEn}
                </span>
                <span className="font-bold" style={{ color: cat.color }}>
                  {earned}/{cat.cap}
                </span>
              </div>
              <ProgressBar value={pct} color={cat.color} height={6} />
            </div>
          );
        })}
      </div>

      {/* Divider */}
      <div className="h-px" style={{ background: 'var(--border)' }} />

      {/* Total today */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-[var(--text-2)]">
          {isHi ? '\u0906\u091C \u0915\u0941\u0932' : 'Total today'}
        </span>
        <span
          className="text-lg font-bold"
          style={{ color: 'var(--orange)', fontFamily: 'var(--font-display)' }}
        >
          {totalToday} XP
        </span>
      </div>

      {/* Motivational hint */}
      {remaining > 0 && (
        <p className="text-xs text-center font-medium" style={{ color: 'var(--text-3)' }}>
          {isHi
            ? `\u0905\u0917\u0932\u0947 \u0907\u0928\u093E\u092E \u0915\u0947 \u0932\u093F\u090F ${remaining} XP \u0914\u0930 \u0915\u092E\u093E\u0913`
            : `Earn ${remaining} more XP to reach ${nextMilestone} today!`}
        </p>
      )}
      {remaining === 0 && (
        <p className="text-xs text-center font-bold" style={{ color: 'var(--green, #22C55E)' }}>
          {isHi ? '\u0936\u093E\u0928\u0926\u093E\u0930! \u0906\u091C \u0915\u093E \u0932\u0915\u094D\u0937\u094D\u092F \u092A\u0942\u0930\u093E \u0939\u0941\u0906!' : 'Awesome! You hit your daily goal!'}
        </p>
      )}
    </Card>
  );
}
