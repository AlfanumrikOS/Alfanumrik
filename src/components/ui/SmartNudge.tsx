'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

/* ═══════════════════════════════════════════════════════════════
   SMART NUDGE ENGINE — Contextual, psychological nudging system
   Subtle, helpful, WhatsApp-like simplicity. Never spammy.
   ═══════════════════════════════════════════════════════════════ */

// ─── Types ─────────────────────────────────────────────────────

interface StudentData {
  subjects?: Array<{ name: string; last_studied?: string; streak?: number }>;
  studyPlan?: { completed_pct?: number; total_tasks?: number; completed_tasks?: number };
  upcomingExams?: Array<{ name: string; date: string; syllabus_pct?: number }>;
  retentionTopics?: Array<{ topic: string; retention_pct?: number; due_date?: string }>;
  stats?: { problems_solved_today?: number; weekly_rank_pct?: number };
}

interface SmartNudgeProps {
  studentData?: StudentData;
  maxNudges?: number;
  className?: string;
}

type NudgeType = 'exam' | 'behavior' | 'retention' | 'time' | 'motivational';

interface Nudge {
  id: string;
  type: NudgeType;
  priority: number;
  icon: string;
  message: string;
  cta?: { label: string; href: string };
}

// ─── Constants ─────────────────────────────────────────────────

const NUDGE_COLORS: Record<NudgeType, string> = {
  exam: '#DC2626',
  behavior: '#E8581C',
  retention: '#0891B2',
  time: '#7C3AED',
  motivational: '#16A34A',
};

const DISMISS_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const MIN_GAP_MS = 30 * 60 * 1000; // 30 minutes between nudge rotations
const LS_KEY_DISMISSED = 'alfanumrik_nudge_dismissed';
const LS_KEY_LAST_SHOWN = 'alfanumrik_nudge_last_shown';
const LS_KEY_HISTORY = 'alfanumrik_nudge_history';

// ─── LocalStorage helpers ──────────────────────────────────────

function getDismissed(): Record<string, number> {
  try {
    const raw = localStorage.getItem(LS_KEY_DISMISSED);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    const now = Date.now();
    // Prune expired entries
    const cleaned: Record<string, number> = {};
    for (const [key, ts] of Object.entries(parsed)) {
      if (now - ts < DISMISS_TTL_MS) cleaned[key] = ts;
    }
    return cleaned;
  } catch {
    return {};
  }
}

function dismissNudge(id: string) {
  const dismissed = getDismissed();
  dismissed[id] = Date.now();
  try {
    localStorage.setItem(LS_KEY_DISMISSED, JSON.stringify(dismissed));
  } catch {}
}

function getLastShownTime(): number {
  try {
    return Number(localStorage.getItem(LS_KEY_LAST_SHOWN)) || 0;
  } catch {
    return 0;
  }
}

function setLastShownTime() {
  try {
    localStorage.setItem(LS_KEY_LAST_SHOWN, String(Date.now()));
  } catch {}
}

function getHistory(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEY_HISTORY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function pushHistory(ids: string[]) {
  try {
    const hist = getHistory().slice(-20); // keep last 20
    hist.push(...ids);
    localStorage.setItem(LS_KEY_HISTORY, JSON.stringify(hist.slice(-20)));
  } catch {}
}

// ─── Nudge Generators ──────────────────────────────────────────

function generateExamNudges(data: StudentData): Nudge[] {
  const nudges: Nudge[] = [];
  if (!data.upcomingExams?.length) return nudges;

  for (const exam of data.upcomingExams) {
    const daysLeft = Math.max(0, Math.ceil((new Date(exam.date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
    if (daysLeft > 90) continue;

    const syllabusPct = exam.syllabus_pct ?? 0;

    if (daysLeft <= 7) {
      nudges.push({
        id: `exam-urgent-${exam.name}`,
        type: 'exam',
        priority: 100,
        icon: '🚨',
        message: `Exam in ${daysLeft} day${daysLeft !== 1 ? 's' : ''} — ${syllabusPct}% syllabus covered`,
        cta: { label: 'Study Now', href: '/study-plan' },
      });
    } else if (daysLeft <= 30) {
      nudges.push({
        id: `exam-soon-${exam.name}`,
        type: 'exam',
        priority: 80,
        icon: '📋',
        message: `${exam.name} in ${daysLeft} days — ${syllabusPct}% done`,
        cta: { label: 'View Plan', href: '/study-plan' },
      });
    } else {
      nudges.push({
        id: `exam-prep-${exam.name}`,
        type: 'exam',
        priority: 40,
        icon: '📝',
        message: `Practice previous year questions for ${exam.name}`,
        cta: { label: 'Practice', href: '/quiz?mode=board' },
      });
    }
  }

  return nudges;
}

function generateBehaviorNudges(data: StudentData): Nudge[] {
  const nudges: Nudge[] = [];

  if (data.subjects) {
    for (const subject of data.subjects) {
      if (subject.last_studied) {
        const daysSince = Math.floor((Date.now() - new Date(subject.last_studied).getTime()) / (1000 * 60 * 60 * 24));
        if (daysSince > 2) {
          nudges.push({
            id: `gap-${subject.name}`,
            type: 'behavior',
            priority: 70,
            icon: '📚',
            message: `You haven't studied ${subject.name} in ${daysSince} days`,
            cta: { label: 'Study Now', href: '/foxy' },
          });
        }
      }

      if (subject.streak && subject.streak >= 3) {
        nudges.push({
          id: `streak-${subject.name}-${subject.streak}`,
          type: 'behavior',
          priority: 55,
          icon: '🔥',
          message: `You're on a ${subject.streak}-day streak! Keep it going!`,
        });
      }
    }
  }

  if (data.studyPlan) {
    const pct = data.studyPlan.completed_pct ?? 0;
    if (pct >= 70 && pct < 100) {
      const remaining = (data.studyPlan.total_tasks ?? 0) - (data.studyPlan.completed_tasks ?? 0);
      nudges.push({
        id: `plan-finish-${Math.round(pct)}`,
        type: 'behavior',
        priority: 65,
        icon: '💪',
        message: `You've completed ${Math.round(pct)}% of today's plan — ${remaining} task${remaining !== 1 ? 's' : ''} left!`,
        cta: { label: 'Finish Strong', href: '/study-plan' },
      });
    }
  }

  return nudges;
}

function generateRetentionNudges(data: StudentData): Nudge[] {
  const nudges: Nudge[] = [];
  if (!data.retentionTopics?.length) return nudges;

  const dueTopics = data.retentionTopics.filter(t => {
    if (!t.due_date) return false;
    return new Date(t.due_date).getTime() <= Date.now();
  });

  if (dueTopics.length > 0) {
    const lowestRetention = dueTopics.reduce((low, t) =>
      (t.retention_pct ?? 100) < (low.retention_pct ?? 100) ? t : low, dueTopics[0]);

    if (lowestRetention.retention_pct != null && lowestRetention.retention_pct < 60) {
      nudges.push({
        id: `retention-drop-${lowestRetention.topic}`,
        type: 'retention',
        priority: 60,
        icon: '📉',
        message: `Your retention for ${lowestRetention.topic} is dropping — quick review?`,
        cta: { label: 'Review', href: '/review' },
      });
    }

    if (dueTopics.length >= 2) {
      nudges.push({
        id: `retention-due-${dueTopics.length}`,
        type: 'retention',
        priority: 55,
        icon: '🔄',
        message: `${dueTopics.length} topics due for review today`,
        cta: { label: 'Review All', href: '/review' },
      });
    }

    nudges.push({
      id: `retention-boost-${dueTopics[0].topic}`,
      type: 'retention',
      priority: 50,
      icon: '🧠',
      message: `Revise ${dueTopics[0].topic} now to improve memory by 40%`,
      cta: { label: 'Revise', href: '/review' },
    });
  }

  return nudges;
}

function generateTimeNudges(): Nudge[] {
  const nudges: Nudge[] = [];
  const hour = new Date().getHours();

  if (hour >= 6 && hour < 10) {
    nudges.push({
      id: 'time-morning',
      type: 'time',
      priority: 30,
      icon: '🌅',
      message: 'Morning study sessions improve retention by 30%',
      cta: { label: 'Start Now', href: '/foxy' },
    });
  } else if (hour >= 10 && hour < 12) {
    nudges.push({
      id: 'time-midmorning',
      type: 'time',
      priority: 25,
      icon: '☀️',
      message: "Best time to study now — you're usually active around this hour",
      cta: { label: 'Study', href: '/foxy' },
    });
  } else if (hour >= 14 && hour < 17) {
    nudges.push({
      id: 'time-afternoon',
      type: 'time',
      priority: 25,
      icon: '⏰',
      message: 'Quick afternoon practice session? Just 15 minutes helps',
      cta: { label: 'Quick Quiz', href: '/quiz' },
    });
  } else if (hour >= 21 && hour < 23) {
    nudges.push({
      id: 'time-night',
      type: 'time',
      priority: 30,
      icon: '🌙',
      message: "Quick 10-min review before bed locks in today's learning",
      cta: { label: 'Review', href: '/review' },
    });
  }

  return nudges;
}

function generateMotivationalNudges(data: StudentData): Nudge[] {
  const nudges: Nudge[] = [];

  if (data.stats?.problems_solved_today && data.stats.problems_solved_today > 10) {
    nudges.push({
      id: `motivation-solved-${data.stats.problems_solved_today}`,
      type: 'motivational',
      priority: 20,
      icon: '⭐',
      message: `You solved ${data.stats.problems_solved_today} problems today — personal best!`,
    });
  }

  if (data.stats?.weekly_rank_pct && data.stats.weekly_rank_pct <= 20) {
    nudges.push({
      id: `motivation-rank-${data.stats.weekly_rank_pct}`,
      type: 'motivational',
      priority: 15,
      icon: '🏆',
      message: `You're in the top ${data.stats.weekly_rank_pct}% this week`,
    });
  }

  nudges.push({
    id: 'motivation-daily',
    type: 'motivational',
    priority: 10,
    icon: '✨',
    message: "Small progress daily beats cramming — you're doing great",
  });

  return nudges;
}

// ─── Nudge Selection ───────────────────────────────────────────

function selectNudges(data: StudentData, maxNudges: number): Nudge[] {
  const all: Nudge[] = [
    ...generateExamNudges(data),
    ...generateBehaviorNudges(data),
    ...generateRetentionNudges(data),
    ...generateTimeNudges(),
    ...generateMotivationalNudges(data),
  ];

  // Filter out dismissed nudges
  const dismissed = getDismissed();
  const filtered = all.filter(n => !dismissed[n.id]);

  // Sort by priority descending
  filtered.sort((a, b) => b.priority - a.priority);

  // Avoid showing the same nudges as last time
  const history = getHistory();
  const lastShown = new Set(history.slice(-maxNudges));

  // Prefer nudges not recently shown, but fall back if needed
  const fresh = filtered.filter(n => !lastShown.has(n.id));
  const stale = filtered.filter(n => lastShown.has(n.id));

  const selected: Nudge[] = [];
  const seenTypes = new Set<NudgeType>();

  // Pick from fresh first, then stale — diversify by type
  for (const pool of [fresh, stale]) {
    for (const nudge of pool) {
      if (selected.length >= maxNudges) break;
      // Allow at most 1 per type to keep variety, unless we need more
      if (seenTypes.has(nudge.type) && selected.length < maxNudges - 1) continue;
      selected.push(nudge);
      seenTypes.add(nudge.type);
    }
    if (selected.length >= maxNudges) break;
  }

  // If still under limit, fill from any remaining
  if (selected.length < maxNudges) {
    const selectedIds = new Set(selected.map(n => n.id));
    for (const nudge of filtered) {
      if (selected.length >= maxNudges) break;
      if (!selectedIds.has(nudge.id)) selected.push(nudge);
    }
  }

  return selected.slice(0, maxNudges);
}

// ─── Component ─────────────────────────────────────────────────

export default function SmartNudge({ studentData, maxNudges = 2, className = '' }: SmartNudgeProps) {
  const [nudges, setNudges] = useState<Nudge[]>([]);
  const [dismissing, setDismissing] = useState<Set<string>>(new Set());
  const initialized = useRef(false);

  // Generate nudges on mount / data change
  useEffect(() => {
    if (!studentData) return;

    // Respect minimum gap between nudge changes (except first load)
    const lastShown = getLastShownTime();
    const now = Date.now();
    if (initialized.current && now - lastShown < MIN_GAP_MS) return;

    const selected = selectNudges(studentData, maxNudges);
    setNudges(selected);
    setLastShownTime();
    pushHistory(selected.map(n => n.id));
    initialized.current = true;
  }, [studentData, maxNudges]);

  const handleDismiss = useCallback((id: string) => {
    setDismissing(prev => new Set(prev).add(id));
    dismissNudge(id);
    // Remove after animation
    setTimeout(() => {
      setNudges(prev => prev.filter(n => n.id !== id));
      setDismissing(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 300);
  }, []);

  if (nudges.length === 0) return null;

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <style jsx global>{`
        @keyframes nudgeSlideIn {
          0% { transform: translateX(24px); opacity: 0; }
          100% { transform: translateX(0); opacity: 1; }
        }
        @keyframes nudgeFadeOut {
          0% { transform: translateX(0); opacity: 1; }
          100% { transform: translateX(24px); opacity: 0; }
        }
      `}</style>
      {nudges.map((nudge, i) => (
        <NudgeCard
          key={nudge.id}
          nudge={nudge}
          index={i}
          isDismissing={dismissing.has(nudge.id)}
          onDismiss={handleDismiss}
        />
      ))}
    </div>
  );
}

// ─── Nudge Card ────────────────────────────────────────────────

function NudgeCard({
  nudge,
  index,
  isDismissing,
  onDismiss,
}: {
  nudge: Nudge;
  index: number;
  isDismissing: boolean;
  onDismiss: (id: string) => void;
}) {
  const accentColor = NUDGE_COLORS[nudge.type];

  return (
    <div
      className="nudge-card"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        padding: '10px 12px',
        borderRadius: '12px',
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${accentColor}`,
        boxShadow: '0 1px 6px rgba(0,0,0,0.03)',
        animation: isDismissing
          ? 'nudgeFadeOut 0.3s ease forwards'
          : `nudgeSlideIn 0.35s cubic-bezier(0.4, 0, 0.2, 1) ${index * 0.08}s both`,
        position: 'relative',
        overflow: 'hidden',
        minHeight: '44px',
      }}
    >
      {/* Subtle type-colored background wash */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(135deg, ${accentColor}06 0%, transparent 60%)`,
          pointerEvents: 'none',
        }}
      />

      {/* Icon */}
      <span
        style={{
          fontSize: '18px',
          lineHeight: '24px',
          flexShrink: 0,
          position: 'relative',
        }}
      >
        {nudge.icon}
      </span>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
        <p
          style={{
            fontSize: '13px',
            lineHeight: '18px',
            color: 'var(--text-1)',
            fontWeight: 500,
            margin: 0,
          }}
        >
          {nudge.message}
        </p>

        {nudge.cta && (
          <a
            href={nudge.cta.href}
            style={{
              display: 'inline-block',
              marginTop: '5px',
              fontSize: '12px',
              fontWeight: 700,
              color: accentColor,
              textDecoration: 'none',
              fontFamily: 'var(--font-display)',
              letterSpacing: '0.02em',
            }}
          >
            {nudge.cta.label} &rarr;
          </a>
        )}
      </div>

      {/* Dismiss button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(nudge.id);
        }}
        aria-label="Dismiss nudge"
        style={{
          flexShrink: 0,
          width: '24px',
          height: '24px',
          minHeight: '24px',
          minWidth: '24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '6px',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          color: 'var(--text-3)',
          fontSize: '14px',
          lineHeight: 1,
          padding: 0,
          transition: 'background 0.15s, color 0.15s',
          position: 'relative',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--surface-2)';
          e.currentTarget.style.color = 'var(--text-1)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = 'var(--text-3)';
        }}
      >
        &#x2715;
      </button>

    </div>
  );
}
