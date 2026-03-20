'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { getStudyPlan, supabase } from '@/lib/supabase';
import { Card, Button, ProgressBar, SectionHeader, LoadingFoxy, BottomNav } from '@/components/ui';

interface Task {
  id: string;
  day_number: number;
  scheduled_date: string;
  task_type: string;
  title: string;
  description: string;
  subject: string;
  chapter_title: string;
  duration_minutes: number;
  status: string;
  xp_reward: number;
}

interface Plan {
  id: string;
  subject: string;
  title: string;
  start_date: string;
  end_date: string;
  total_tasks: number;
  completed_tasks: number;
  progress_percent: number;
}

const TASK_ICONS: Record<string, string> = {
  learn: '📖',
  quiz: '⚡',
  review: '🔄',
  practice: '✏️',
  read: '📚',
  watch: '🎬',
  default: '📋',
};

const STATUS_STYLES: Record<string, { bg: string; border: string; color: string; label: string; labelHi: string }> = {
  completed: { bg: 'rgba(22,163,74,0.08)', border: 'rgba(22,163,74,0.2)', color: '#16A34A', label: '✓ Done', labelHi: '✓ पूरा' },
  in_progress: { bg: 'rgba(232,88,28,0.08)', border: 'rgba(232,88,28,0.2)', color: '#E8581C', label: '▶ In Progress', labelHi: '▶ जारी' },
  skipped: { bg: 'rgba(156,163,175,0.08)', border: 'rgba(156,163,175,0.2)', color: '#9CA3AF', label: '⏭ Skipped', labelHi: '⏭ छोड़ा' },
  pending: { bg: 'var(--surface-1)', border: 'var(--border)', color: 'var(--text-3)', label: '○ Pending', labelHi: '○ बाकी' },
};

export default function StudyPlanPage() {
  const { student, isLoggedIn, isLoading, isHi } = useAuth();
  const router = useRouter();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [hasPlan, setHasPlan] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedDay, setExpandedDay] = useState<number | null>(null);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/');
  }, [isLoading, isLoggedIn, router]);

  const load = useCallback(async () => {
    if (!student) return;
    setLoading(true);
    try {
      const data = await getStudyPlan(student.id);
      if (data?.has_plan) {
        setPlan(data.plan);
        setTasks(Array.isArray(data.tasks) ? data.tasks : []);
        setHasPlan(true);
        // Auto-expand today's tasks
        const today = new Date().toISOString().split('T')[0];
        const todayTask = (data.tasks || []).find((t: Task) => t.scheduled_date === today);
        if (todayTask) setExpandedDay(todayTask.day_number);
        else setExpandedDay(1);
      } else {
        setHasPlan(false);
      }
    } catch {
      setHasPlan(false);
    }
    setLoading(false);
  }, [student]);

  useEffect(() => {
    if (student) load();
  }, [student?.id, load]);

  const markTask = async (taskId: string, status: string) => {
    try {
      await supabase.from('study_plan_tasks').update({ status }).eq('id', taskId);
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status } : t))
      );
      // Update plan progress
      if (plan) {
        const completed = tasks.filter(
          (t) => (t.id === taskId ? status : t.status) === 'completed'
        ).length;
        const pct = Math.round((completed / plan.total_tasks) * 100);
        setPlan((p) => p ? { ...p, completed_tasks: completed, progress_percent: pct } : p);
      }
    } catch (e) {
      console.error('markTask error:', e);
    }
  };

  if (isLoading || !student) return <LoadingFoxy />;

  // Group tasks by day
  const dayGroups = tasks.reduce<Record<number, Task[]>>((acc, t) => {
    (acc[t.day_number] = acc[t.day_number] || []).push(t);
    return acc;
  }, {});
  const days = Object.keys(dayGroups)
    .map(Number)
    .sort((a, b) => a - b);

  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      {/* Header */}
      <header
        className="page-header"
        style={{
          background: 'rgba(251,248,244,0.88)',
          backdropFilter: 'blur(20px)',
          borderColor: 'var(--border)',
        }}
      >
        <div className="app-container py-3 flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)]">
            ←
          </button>
          <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
            📅 {isHi ? 'अध्ययन योजना' : 'Study Plan'}
          </h1>
        </div>
      </header>

      <main className="app-container py-6 space-y-4">
        {loading ? (
          <div className="text-center py-12">
            <div className="text-4xl animate-float mb-3">📅</div>
            <p className="text-sm text-[var(--text-3)]">
              {isHi ? 'योजना लोड हो रही है...' : 'Loading your plan...'}
            </p>
          </div>
        ) : !hasPlan ? (
          /* No Plan */
          <div className="text-center py-12">
            <div className="text-5xl mb-4">📋</div>
            <h3 className="text-xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
              {isHi ? 'कोई अध्ययन योजना नहीं' : 'No Study Plan Yet'}
            </h3>
            <p className="text-sm text-[var(--text-3)] max-w-xs mx-auto mb-6">
              {isHi
                ? 'Foxy से कहो "मेरा study plan बनाओ" — वो तुम्हारे लिए personalized plan बनाएगा!'
                : 'Ask Foxy "Create my study plan" — Foxy will generate a personalized weekly plan!'}
            </p>
            <div className="flex gap-2 justify-center">
              <Button onClick={() => router.push('/foxy')}>
                🦊 {isHi ? 'Foxy से पूछो' : 'Ask Foxy'}
              </Button>
              <Button variant="ghost" onClick={() => router.push('/dashboard')}>
                {isHi ? 'होम' : 'Home'}
              </Button>
            </div>
          </div>
        ) : (
          /* Plan exists */
          <>
            {/* Plan Overview */}
            <Card accent="var(--purple, #7C3AED)">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)' }}>
                    {plan?.title || (isHi ? 'अध्ययन योजना' : 'Study Plan')}
                  </h2>
                  <p className="text-xs text-[var(--text-3)] mt-0.5">
                    {plan?.subject} · {plan?.start_date} → {plan?.end_date}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold gradient-text">
                    {plan?.progress_percent ?? 0}%
                  </div>
                </div>
              </div>
              <ProgressBar
                value={plan?.progress_percent ?? 0}
                color="var(--purple, #7C3AED)"
                label={`${plan?.completed_tasks ?? 0}/${plan?.total_tasks ?? 0} ${isHi ? 'पूरे' : 'done'}`}
                showPercent
              />
            </Card>

            {/* Day-by-day Tasks */}
            {days.map((dayNum) => {
              const dayTasks = dayGroups[dayNum];
              const isExpanded = expandedDay === dayNum;
              const completedInDay = dayTasks.filter((t) => t.status === 'completed').length;
              const dayDate = dayTasks[0]?.scheduled_date;
              const isToday = dayDate === today;

              return (
                <div key={dayNum}>
                  <button
                    onClick={() => setExpandedDay(isExpanded ? null : dayNum)}
                    className="w-full flex items-center justify-between py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold" style={{ color: isToday ? 'var(--orange)' : 'var(--text-2)' }}>
                        {isHi ? `दिन ${dayNum}` : `Day ${dayNum}`}
                        {isToday && (
                          <span className="text-xs ml-1 font-normal text-[var(--orange)]">
                            ({isHi ? 'आज' : 'Today'})
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[var(--text-3)]">
                        {completedInDay}/{dayTasks.length}
                      </span>
                      <span className="text-[var(--text-3)] text-xs">
                        {isExpanded ? '▲' : '▼'}
                      </span>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="space-y-2 pb-2">
                      {dayTasks.map((task) => {
                        const s = STATUS_STYLES[task.status] || STATUS_STYLES.pending;
                        const icon = TASK_ICONS[task.task_type] || TASK_ICONS.default;
                        return (
                          <div
                            key={task.id}
                            className="rounded-2xl p-3.5 relative overflow-hidden"
                            style={{
                              background: s.bg,
                              border: `1px solid ${s.border}`,
                            }}
                          >
                            <div className="flex items-start gap-3">
                              <span className="text-xl mt-0.5">{icon}</span>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between">
                                  <span
                                    className="text-sm font-semibold truncate"
                                    style={{
                                      textDecoration: task.status === 'completed' ? 'line-through' : 'none',
                                      opacity: task.status === 'completed' ? 0.6 : 1,
                                    }}
                                  >
                                    {task.title}
                                  </span>
                                  <span className="text-[10px] font-semibold ml-2 flex-shrink-0" style={{ color: s.color }}>
                                    {isHi ? s.labelHi : s.label}
                                  </span>
                                </div>
                                {task.description && (
                                  <p className="text-xs text-[var(--text-3)] mt-0.5 line-clamp-2">
                                    {task.description}
                                  </p>
                                )}
                                <div className="flex items-center gap-3 mt-2">
                                  {task.duration_minutes > 0 && (
                                    <span className="text-[10px] text-[var(--text-3)]">
                                      ⏱ {task.duration_minutes}m
                                    </span>
                                  )}
                                  {task.xp_reward > 0 && (
                                    <span className="text-[10px] text-[var(--text-3)]">
                                      ⭐ {task.xp_reward} XP
                                    </span>
                                  )}
                                  {task.chapter_title && (
                                    <span className="text-[10px] text-[var(--text-3)] truncate">
                                      📚 {task.chapter_title}
                                    </span>
                                  )}
                                </div>

                                {/* Action buttons for pending/in_progress tasks */}
                                {task.status !== 'completed' && task.status !== 'skipped' && (
                                  <div className="flex gap-2 mt-2.5">
                                    <button
                                      onClick={() => markTask(task.id, 'completed')}
                                      className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                                      style={{
                                        background: 'rgba(22,163,74,0.1)',
                                        border: '1px solid rgba(22,163,74,0.2)',
                                        color: '#16A34A',
                                      }}
                                    >
                                      ✓ {isHi ? 'पूरा' : 'Done'}
                                    </button>
                                    {task.task_type === 'learn' && (
                                      <button
                                        onClick={() => {
                                          markTask(task.id, 'in_progress');
                                          router.push('/foxy');
                                        }}
                                        className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                                        style={{
                                          background: 'rgba(232,88,28,0.1)',
                                          border: '1px solid rgba(232,88,28,0.2)',
                                          color: 'var(--orange)',
                                        }}
                                      >
                                        🦊 {isHi ? 'Foxy से सीखो' : 'Learn with Foxy'}
                                      </button>
                                    )}
                                    {task.task_type === 'quiz' && (
                                      <button
                                        onClick={() => {
                                          markTask(task.id, 'in_progress');
                                          router.push('/quiz');
                                        }}
                                        className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                                        style={{
                                          background: 'rgba(245,166,35,0.1)',
                                          border: '1px solid rgba(245,166,35,0.2)',
                                          color: '#D97706',
                                        }}
                                      >
                                        ⚡ {isHi ? 'क्विज़ खेलो' : 'Take Quiz'}
                                      </button>
                                    )}
                                    <button
                                      onClick={() => markTask(task.id, 'skipped')}
                                      className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                                      style={{
                                        background: 'var(--surface-2)',
                                        color: 'var(--text-3)',
                                      }}
                                    >
                                      {isHi ? 'छोड़ो' : 'Skip'}
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
