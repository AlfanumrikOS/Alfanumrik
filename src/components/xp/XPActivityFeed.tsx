'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { XP_RULES } from '@/lib/xp-rules';
import { Card, ProgressBar, Skeleton, EmptyState } from '@/components/ui';

/* ─── Types ──────────────────────────────────────────────── */

interface XPTransaction {
  id: string;
  amount: number;
  source: string;
  subject: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface XPActivityFeedProps {
  studentId: string;
  isHi: boolean;
  limit?: number;
}

/* ─── Source Config ───────────────────────────────────────── */

const SOURCE_CONFIG: Record<string, { icon: string; color: string; labelEn: string; labelHi: string }> = {
  quiz: { icon: '\u26A1', color: 'var(--orange)', labelEn: 'Quiz', labelHi: '\u0915\u094D\u0935\u093F\u095B\u093C' },
  chat: { icon: '\uD83E\uDD8A', color: '#3B82F6', labelEn: 'Chat', labelHi: '\u091A\u0948\u091F' },
  streak: { icon: '\uD83D\uDD25', color: '#EF4444', labelEn: 'Streak', labelHi: '\u0938\u094D\u091F\u094D\u0930\u0940\u0915' },
  mastery: { icon: '\uD83C\uDFC6', color: '#9333EA', labelEn: 'Mastery', labelHi: '\u092E\u093E\u0938\u094D\u091F\u0930\u0940' },
  study: { icon: '\uD83D\uDCC5', color: '#22C55E', labelEn: 'Study', labelHi: '\u0905\u0927\u094D\u092F\u092F\u0928' },
  challenge: { icon: '\u2694\uFE0F', color: '#F59E0B', labelEn: 'Challenge', labelHi: '\u091A\u0941\u0928\u094C\u0924\u0940' },
};

function getSourceConfig(source: string) {
  return SOURCE_CONFIG[source] ?? { icon: '\u2B50', color: 'var(--text-3)', labelEn: source, labelHi: source };
}

/* ─── Relative Time ──────────────────────────────────────── */

function relativeTime(dateStr: string, isHi: boolean): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return isHi ? '\u0905\u092D\u0940' : 'just now';
  if (diffMin < 60) return isHi ? `${diffMin} \u092E\u093F\u0928\u091F \u092A\u0939\u0932\u0947` : `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return isHi ? `${diffHr} \u0918\u0902\u091F\u0947 \u092A\u0939\u0932\u0947` : `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return isHi ? `${diffDay} \u0926\u093F\u0928 \u092A\u0939\u0932\u0947` : `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString(isHi ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short' });
}

/* ─── Component ──────────────────────────────────────────── */

export default function XPActivityFeed({ studentId, isHi, limit = 20 }: XPActivityFeedProps) {
  const [transactions, setTransactions] = useState<XPTransaction[]>([]);
  const [dailyQuizXp, setDailyQuizXp] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setIsLoading(true);
      setError(null);
      try {
        // Fetch recent transactions
        const { data: txns, error: txnErr } = await supabase
          .from('xp_transactions')
          .select('*')
          .eq('student_id', studentId)
          .order('created_at', { ascending: false })
          .limit(limit);

        if (txnErr) throw txnErr;
        if (cancelled) return;

        setTransactions(txns ?? []);

        // Calculate daily quiz XP from today's transactions
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayQuizXp = (txns ?? [])
          .filter(
            (t: XPTransaction) => t.source === 'quiz' && new Date(t.created_at) >= todayStart
          )
          .reduce((sum: number, t: XPTransaction) => sum + t.amount, 0);
        setDailyQuizXp(todayQuizXp);
      } catch (err) {
        if (!cancelled) {
          setError(isHi ? '\u0921\u0947\u091F\u093E \u0932\u094B\u0921 \u0928\u0939\u0940\u0902 \u0939\u094B \u0938\u0915\u093E' : 'Could not load activity');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [studentId, limit, isHi]);

  /* ─── Loading ─── */
  if (isLoading) {
    return (
      <Card className="space-y-3">
        <Skeleton variant="text" width="40%" />
        <Skeleton variant="text" />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton variant="circle" width={36} height={36} />
            <div className="flex-1 space-y-1">
              <Skeleton variant="text" width="70%" />
              <Skeleton variant="text" width="30%" />
            </div>
          </div>
        ))}
      </Card>
    );
  }

  /* ─── Error ─── */
  if (error) {
    return (
      <Card>
        <p className="text-sm text-center py-4" style={{ color: '#DC2626' }}>
          {error}
        </p>
      </Card>
    );
  }

  /* ─── Empty ─── */
  if (transactions.length === 0) {
    return (
      <Card>
        <EmptyState
          icon="\u26A1"
          title={isHi ? '\u0905\u092D\u0940 \u0915\u094B\u0908 XP \u0928\u0939\u0940\u0902' : 'No XP yet'}
          description={isHi ? '\u0915\u094D\u0935\u093F\u095B\u093C \u0916\u0947\u0932\u094B \u0914\u0930 XP \u0915\u092E\u093E\u0913!' : 'Take a quiz and start earning XP!'}
        />
      </Card>
    );
  }

  const dailyCapPercent = Math.min(100, Math.round((dailyQuizXp / XP_RULES.quiz_daily_cap) * 100));

  return (
    <Card className="space-y-4">
      {/* Header */}
      <h3
        className="text-sm font-bold uppercase tracking-wider"
        style={{ color: 'var(--text-3)', fontFamily: 'var(--font-display)' }}
      >
        {isHi ? 'XP \u0917\u0924\u093F\u0935\u093F\u0927\u093F' : 'XP Activity'}
      </h3>

      {/* Daily quiz cap progress */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs">
          <span className="text-[var(--text-3)] font-medium">
            {isHi ? '\u0906\u091C \u0915\u094D\u0935\u093F\u095B\u093C XP' : 'Quiz XP today'}
          </span>
          <span className="font-bold" style={{ color: 'var(--orange)' }}>
            {dailyQuizXp}/{XP_RULES.quiz_daily_cap}
          </span>
        </div>
        <ProgressBar value={dailyCapPercent} color="var(--orange)" height={6} />
      </div>

      {/* Transaction list */}
      <div className="space-y-1 max-h-[320px] overflow-y-auto -mx-1 px-1">
        {transactions.map((txn: XPTransaction) => {
          const config = getSourceConfig(txn.source);
          return (
            <div
              key={txn.id}
              className="flex items-center gap-3 py-2 border-b last:border-b-0"
              style={{ borderColor: 'var(--border)' }}
            >
              {/* Source icon */}
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-base"
                style={{ background: `${config.color}12`, border: `1px solid ${config.color}20` }}
              >
                {config.icon}
              </div>

              {/* Description */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[var(--text-1)] truncate">
                  {isHi ? config.labelHi : config.labelEn}
                  {txn.subject && (
                    <span className="text-[var(--text-3)] font-normal">
                      {' '}&middot; {txn.subject}
                    </span>
                  )}
                </p>
                <p className="text-xs text-[var(--text-3)]">
                  {relativeTime(txn.created_at, isHi)}
                </p>
              </div>

              {/* Amount */}
              <span
                className="text-sm font-bold flex-shrink-0"
                style={{ color: config.color }}
              >
                +{txn.amount} XP
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
