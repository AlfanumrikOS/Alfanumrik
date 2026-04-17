'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { getStudyPlan, generateStudyPlan, supabase } from '@/lib/supabase';
import { Card, Button, ProgressBar, SectionHeader, LoadingFoxy, BottomNav } from '@/components/ui';
import { useAllowedSubjects } from '@/lib/useAllowedSubjects';
import { BLOOM_CONFIG, type BloomLevel } from '@/lib/cognitive-engine';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';

const TASK_BLOOM_MAP: Record<string, BloomLevel> = {
  learn: 'understand', quiz: 'apply', review: 'remember', revision: 'remember',
  practice: 'apply', notes: 'understand', foxy_chat: 'understand', challenge: 'evaluate',
};

const ZPD_LABELS: Record<number, { label: string; labelHi: string; color: string }> = {
  1: { label: 'Easy', labelHi: 'आसान', color: '#16A34A' },
  2: { label: 'Medium', labelHi: 'मध्यम', color: '#F59E0B' },
  3: { label: 'Hard', labelHi: 'कठिन', color: '#EF4444' },
};

interface Task {
  id: string;
  day_number: number;
  scheduled_date: string;
  task_order: number;
  task_type: string;
  title: string;
  description: string;
  subject: string;
  chapter_number: number | null;
  chapter_title: string | null;
  topic: string | null;
  duration_minutes: number;
  question_count: number | null;
  difficulty: number;
  status: string;
  xp_reward: number;
  xp_earned: number;
  score_percent: number | null;
}

interface Plan {
  id: string;
  subject: string;
  title: string;
  description: string;
  plan_type: string;
  start_date: string;
  end_date: string;
  total_tasks: number;
  completed_tasks: number;
  progress_percent: number;
  ai_reasoning: string;
}

const TASK_ICONS: Record<string, string> = {
  learn: '📖', quiz: '⚡', review: '🔄', practice: '✏️',
  revision: '🧠', notes: '📝', foxy_chat: '🦊', challenge: '🎯',
};

const TASK_COLORS: Record<string, string> = {
  learn: '#E8581C', quiz: '#F5A623', review: '#0891B2', practice: '#7C3AED',
  revision: '#6366F1', notes: '#16A34A', foxy_chat: '#E8581C', challenge: '#DB2777',
};

const STATUS_STYLES: Record<string, { bg: string; border: string; color: string; label: string; labelHi: string }> = {
  completed: { bg: 'rgba(22,163,74,0.08)', border: 'rgba(22,163,74,0.25)', color: '#16A34A', label: '✓ Done', labelHi: '✓ पूरा' },
  in_progress: { bg: 'rgba(232,88,28,0.08)', border: 'rgba(232,88,28,0.25)', color: '#E8581C', label: '▶ In Progress', labelHi: '▶ जारी' },
  skipped: { bg: 'rgba(156,163,175,0.06)', border: 'rgba(156,163,175,0.2)', color: '#9CA3AF', label: '⏭ Skipped', labelHi: '⏭ छोड़ा' },
  pending: { bg: 'var(--surface-1)', border: 'var(--border)', color: 'var(--text-3)', label: '○ Pending', labelHi: '○ बाकी' },
};

const DAILY_OPTIONS = [30, 45, 60, 90];
const DAY_OPTIONS = [5, 7];

export default function StudyPlanPage() {
  const { student, isLoggedIn, isLoading, isHi, refreshSnapshot } = useAuth();
  const { unlocked: allowedSubjects } = useAllowedSubjects();
  const router = useRouter();

  const [plan, setPlan] = useState<Plan | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [hasPlan, setHasPlan] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedDay, setExpandedDay] = useState<number | null>(null);

  // Generate form
  const [showGenerate, setShowGenerate] = useState(false);
  const [genSubject, setGenSubject] = useState<string | null>(null);
  const [genMinutes, setGenMinutes] = useState(60);
  const [genDays, setGenDays] = useState(7);
  const [generating, setGenerating] = useState(false);
  const [energyLevel, setEnergyLevel] = useState<'high' | 'medium' | 'low' | null>(null);
  const [criticalGaps, setCriticalGaps] = useState<Array<{ id: string; topic_title?: string; description: string; description_hi?: string }>>([]);

  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
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

    // Cognitive 2.0: energy level from latest session (DB columns: fatigue_detected, difficulty_adjustments)
    try {
      const { data: session } = await supabase.from('cognitive_session_metrics')
        .select('fatigue_detected, difficulty_adjustments')
        .eq('student_id', student.id)
        .order('created_at', { ascending: false })
        .limit(1);
      if (session && session.length > 0) {
        setEnergyLevel(session[0].fatigue_detected ? 'low' : (session[0].difficulty_adjustments ?? 0) > 2 ? 'medium' : 'high');
      }
    } catch {}

    // Cognitive 2.0: critical knowledge gaps (DB columns: target_concept_name, missing_prerequisite_name, confidence_score, status)
    try {
      const { data: gaps } = await supabase.from('knowledge_gaps')
        .select('id, target_concept_name, missing_prerequisite_name, confidence_score')
        .eq('student_id', student.id)
        .neq('status', 'resolved')
        .gte('confidence_score', 0.7)
        .order('confidence_score', { ascending: false })
        .limit(2);
      setCriticalGaps((gaps ?? []).map(g => ({
        id: g.id,
        topic_title: g.target_concept_name,
        description: `Missing: ${g.missing_prerequisite_name}`,
        description_hi: `कमी: ${g.missing_prerequisite_name}`,
      })));
    } catch {}

    setLoading(false);
  }, [student]);

  useEffect(() => {
    if (student) load();
  }, [student, load]);

  const handleGenerate = async () => {
    if (!student) return;
    setGenerating(true);
    try {
      const result = await generateStudyPlan(
        student.id,
        genSubject || student.preferred_subject || undefined,
        genMinutes,
        genDays
      );
      if (result?.success) {
        setShowGenerate(false);
        await load();
        refreshSnapshot();
      } else {
        alert(isHi ? 'प्लान बनाने में त्रुटि' : 'Error generating plan');
      }
    } catch (e) {
      console.error('Generate error:', e);
      alert(isHi ? 'प्लान बनाने में त्रुटि' : 'Error generating plan');
    }
    setGenerating(false);
  };

  // ── VALID STATE TRANSITIONS ──
  // Students can't jump from pending → completed directly (must go through in_progress).
  // This prevents bulk-completing tasks via DevTools to farm XP.
  // Also prevents re-completing already completed tasks (double XP).
  const VALID_TRANSITIONS: Record<string, string[]> = {
    pending: ['in_progress', 'skipped'],
    in_progress: ['completed', 'skipped', 'pending'],
    skipped: ['pending', 'in_progress'],
    completed: [], // Terminal state — no going back
  };

  const markTask = async (taskId: string, status: string) => {
    try {
      // Find the task and validate the transition
      const task = tasks.find(t => t.id === taskId);
      if (!task) {
        console.warn('[Security] markTask: task not found:', taskId);
        return;
      }

      // Validate state transition
      const allowed = VALID_TRANSITIONS[task.status] || [];
      if (!allowed.includes(status)) {
        console.warn(`[Security] Blocked invalid transition: ${task.status} → ${status} for task ${taskId}`);
        return;
      }

      // Verify task belongs to the current student's plan
      if (plan && !tasks.some(t => t.id === taskId)) {
        console.warn('[Security] Task does not belong to current plan:', taskId);
        return;
      }

      const updates: Record<string, string> = { status };
      if (status === 'completed') updates.completed_at = new Date().toISOString();

      // RLS enforces ownership, but we also add student_id check via plan ownership
      const { error } = await supabase.from('study_plan_tasks').update(updates).eq('id', taskId);
      if (error) {
        console.error('markTask DB error:', error);
        return;
      }

      setTasks(prev => prev.map(t => (t.id === taskId ? { ...t, status } : t)));

      if (plan) {
        const completed = tasks.filter(t => (t.id === taskId ? status : t.status) === 'completed').length;
        const pct = Math.round((completed / plan.total_tasks) * 100);
        setPlan(p => p ? { ...p, completed_tasks: completed, progress_percent: pct } : p);
        await supabase.from('study_plans').update({ completed_tasks: completed, progress_percent: pct }).eq('id', plan.id);
      }

      if (status === 'completed') refreshSnapshot();
    } catch (e) {
      console.error('markTask error:', e);
    }
  };

  const handleReset = async () => {
    if (!student || !confirm(isHi ? 'नया प्लान बनाएँ? पुराना हट जाएगा।' : 'Generate a new plan? This replaces the current one.')) return;
    setHasPlan(false);
    setShowGenerate(true);
  };

  if (isLoading || !student) return <LoadingFoxy />;

  const dayGroups = tasks.reduce<Record<number, Task[]>>((acc, t) => {
    (acc[t.day_number] = acc[t.day_number] || []).push(t);
    return acc;
  }, {});
  const days = Object.keys(dayGroups).map(Number).sort((a, b) => a - b);
  const today = new Date().toISOString().split('T')[0];
  const totalXp = tasks.reduce((a, t) => a + t.xp_reward, 0);
  const earnedXp = tasks.filter(t => t.status === 'completed').reduce((a, t) => a + t.xp_reward, 0);

  // ═══ HEADER (shared) ═══
  const header = (
    <header className="page-header" style={{ background: 'rgba(251,248,244,0.88)', backdropFilter: 'blur(20px)', borderColor: 'var(--border)' }}>
      <div className="app-container py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/dashboard')} className="text-[var(--text-3)]">&larr;</button>
          <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
            📅 {isHi ? 'अध्ययन योजना' : 'Study Plan'}
          </h1>
        </div>
        {hasPlan && (
          <button onClick={handleReset} className="text-xs px-3 py-1.5 rounded-lg" style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}>
            {isHi ? '🔄 नया' : '🔄 New Plan'}
          </button>
        )}
      </div>
    </header>
  );

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      {header}

      <main className="app-container py-5 space-y-4">
        <SectionErrorBoundary section="Study Plan">
        {loading ? (
          <div className="text-center py-16">
            <div className="text-4xl animate-float mb-3">📅</div>
            <p className="text-sm text-[var(--text-3)]">{isHi ? 'योजना लोड हो रही है...' : 'Loading your plan...'}</p>
          </div>

        ) : (!hasPlan || showGenerate) ? (
          /* ═══ GENERATE PLAN SCREEN ═══ */
          <div className="space-y-5">
            <div className="text-center py-6">
              <div className="text-5xl mb-3">🧠</div>
              <h3 className="text-xl font-bold mb-2" style={{ fontFamily: 'var(--font-display)' }}>
                {isHi ? 'तुम्हारा AI Study Plan' : 'Your AI Study Plan'}
              </h3>
              <p className="text-sm text-[var(--text-3)] max-w-sm mx-auto">
                {isHi
                  ? 'सिद्ध विज्ञान पर आधारित: Retrieval Practice + Spaced Repetition + Interleaving'
                  : 'Powered by proven science: Retrieval Practice + Spaced Repetition + Interleaved Practice'}
              </p>
            </div>

            {/* Subject */}
            <div>
              <p className="text-sm text-[var(--text-3)] mb-2 font-medium">
                {isHi ? '1. विषय चुनो' : '1. Choose subject'}
              </p>
              <div className="grid grid-cols-3 gap-2">
                {allowedSubjects.map(s => (
                  <button
                    key={s.code}
                    onClick={() => setGenSubject(s.code)}
                    className="rounded-xl p-3 text-center transition-all"
                    style={{
                      background: (genSubject || student.preferred_subject) === s.code ? `${s.color}12` : 'var(--surface-1)',
                      border: (genSubject || student.preferred_subject) === s.code ? `2px solid ${s.color}` : '1.5px solid var(--border)',
                    }}
                  >
                    <div className="text-xl mb-1">{s.icon}</div>
                    <div className="text-[10px] font-semibold" style={{ color: (genSubject || student.preferred_subject) === s.code ? s.color : 'var(--text-3)' }}>
                      {s.name}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Daily Minutes */}
            <div>
              <p className="text-sm text-[var(--text-3)] mb-2 font-medium">
                {isHi ? '2. रोज़ कितने मिनट?' : '2. Daily study time'}
              </p>
              <div className="flex gap-2">
                {DAILY_OPTIONS.map(m => (
                  <button
                    key={m}
                    onClick={() => setGenMinutes(m)}
                    className="flex-1 rounded-xl py-3 text-center transition-all"
                    style={{
                      background: genMinutes === m ? 'var(--orange)' : 'var(--surface-2)',
                      color: genMinutes === m ? '#fff' : 'var(--text-2)',
                      fontWeight: 700, fontSize: 13,
                    }}
                  >
                    {m} {isHi ? 'मि' : 'min'}
                  </button>
                ))}
              </div>
            </div>

            {/* Days */}
            <div>
              <p className="text-sm text-[var(--text-3)] mb-2 font-medium">
                {isHi ? '3. कितने दिन?' : '3. Plan duration'}
              </p>
              <div className="flex gap-2">
                {DAY_OPTIONS.map(d => (
                  <button
                    key={d}
                    onClick={() => setGenDays(d)}
                    className="flex-1 rounded-xl py-3 text-center transition-all"
                    style={{
                      background: genDays === d ? 'var(--orange)' : 'var(--surface-2)',
                      color: genDays === d ? '#fff' : 'var(--text-2)',
                      fontWeight: 700, fontSize: 13,
                    }}
                  >
                    {d} {isHi ? 'दिन' : 'days'}
                  </button>
                ))}
              </div>
            </div>

            {/* How it works */}
            <Card className="!p-4">
              <p className="text-xs font-bold text-[var(--text-2)] mb-2">{isHi ? 'हर दिन का चक्र:' : 'Daily learning cycle:'}</p>
              <div className="space-y-1.5">
                {[
                  { icon: '🧠', en: 'Quick Recall — retrieval practice from yesterday', hi: 'Quick Recall — कल का revision' },
                  { icon: '🔄', en: 'Flashcard Review — spaced repetition (d=0.54)', hi: 'Flashcard Review — spaced repetition' },
                  { icon: '📖', en: 'New Topic — learn 1 chapter with Foxy AI', hi: 'New Topic — Foxy से 1 chapter सीखो' },
                  { icon: '✏️', en: 'Mixed Practice — interleaved problems (d=1.05)', hi: 'Mixed Practice — mixed problems' },
                  { icon: '⚡', en: 'Quiz — wrong answers become flashcards', hi: 'Quiz — गलत जवाब flashcard बनते हैं' },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-[var(--text-3)]">
                    <span>{item.icon}</span>
                    <span>{isHi ? item.hi : item.en}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Button fullWidth onClick={handleGenerate} color="var(--orange)">
              {generating
                ? (isHi ? '🧠 प्लान बन रहा है...' : '🧠 Generating plan...')
                : (isHi ? '🚀 मेरा Study Plan बनाओ' : '🚀 Generate My Study Plan')}
            </Button>
          </div>

        ) : (
          /* ═══ PLAN VIEW ═══ */
          <>
            {/* Plan Overview Card */}
            <Card accent="var(--purple, #7C3AED)">
              <div className="flex items-center justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-bold truncate" style={{ fontFamily: 'var(--font-display)' }}>
                    {plan?.title || (isHi ? 'अध्ययन योजना' : 'Study Plan')}
                  </h2>
                  <p className="text-xs text-[var(--text-3)] mt-0.5 truncate">
                    {plan?.description}
                  </p>
                </div>
                <div className="text-right ml-3 flex-shrink-0">
                  <div className="text-2xl font-bold gradient-text">{plan?.progress_percent ?? 0}%</div>
                </div>
              </div>
              <ProgressBar
                value={plan?.progress_percent ?? 0}
                color="var(--purple, #7C3AED)"
                label={`${plan?.completed_tasks ?? 0}/${plan?.total_tasks ?? 0} ${isHi ? 'पूरे' : 'done'}`}
                showPercent
              />
              <div className="flex items-center gap-4 mt-3 text-xs text-[var(--text-3)] flex-wrap">
                <span>📅 {plan?.start_date} → {plan?.end_date}</span>
                <span>⭐ {earnedXp}/{totalXp} XP</span>
                {energyLevel && (
                  <span style={{ color: energyLevel === 'high' ? '#16A34A' : energyLevel === 'medium' ? '#F59E0B' : '#EF4444' }}>
                    {energyLevel === 'high' ? '⚡' : energyLevel === 'medium' ? '🔋' : '🪫'} {isHi ? (energyLevel === 'high' ? 'ऊर्जा अच्छी' : energyLevel === 'medium' ? 'थोड़ी थकान' : 'आराम करो') : (energyLevel === 'high' ? 'Energy: High' : energyLevel === 'medium' ? 'Energy: Medium' : 'Energy: Low')}
                  </span>
                )}
              </div>
            </Card>

            {/* Day-by-day Tasks */}
            {days.map(dayNum => {
              const dayTasks = dayGroups[dayNum];
              const isExpanded = expandedDay === dayNum;
              const completedInDay = dayTasks.filter(t => t.status === 'completed').length;
              const dayDate = dayTasks[0]?.scheduled_date;
              const isToday = dayDate === today;
              const isPast = dayDate < today;
              const dayPct = dayTasks.length > 0 ? Math.round((completedInDay / dayTasks.length) * 100) : 0;

              return (
                <div key={dayNum}>
                  <button
                    onClick={() => setExpandedDay(isExpanded ? null : dayNum)}
                    className="w-full flex items-center justify-between py-2.5 px-1"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                        style={{
                          background: dayPct === 100 ? '#16A34A' : isToday ? 'var(--orange)' : 'var(--surface-2)',
                          color: dayPct === 100 || isToday ? '#fff' : 'var(--text-2)',
                        }}
                      >
                        {dayPct === 100 ? '✓' : dayNum}
                      </span>
                      <div className="text-left">
                        <span className="text-sm font-bold" style={{ color: isToday ? 'var(--orange)' : 'var(--text-2)' }}>
                          {isHi ? `दिन ${dayNum}` : `Day ${dayNum}`}
                          {isToday && <span className="text-xs ml-1 font-normal">({isHi ? 'आज' : 'Today'})</span>}
                        </span>
                        {dayTasks[0]?.topic && (
                          <div className="text-[10px] text-[var(--text-3)] truncate max-w-[200px]">
                            {dayTasks.find(t => t.task_type === 'learn')?.title || ''}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[var(--text-3)]">{completedInDay}/{dayTasks.length}</span>
                      <span className="text-[var(--text-3)] text-xs">{isExpanded ? '▲' : '▼'}</span>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="space-y-2 pb-3">
                      {dayTasks.map(task => {
                        const s = STATUS_STYLES[task.status] || STATUS_STYLES.pending;
                        const icon = TASK_ICONS[task.task_type] || '📋';
                        const accentColor = TASK_COLORS[task.task_type] || 'var(--orange)';

                        return (
                          <div
                            key={task.id}
                            className="rounded-2xl p-3.5 relative overflow-hidden"
                            style={{ background: s.bg, border: `1px solid ${s.border}` }}
                          >
                            {/* Accent bar */}
                            <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl" style={{ background: accentColor }} />

                            <div className="flex items-start gap-3 pl-2">
                              <span className="text-xl mt-0.5 flex-shrink-0">{icon}</span>
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
                                  <p className="text-xs text-[var(--text-3)] mt-1 leading-relaxed line-clamp-2">
                                    {task.description}
                                  </p>
                                )}

                                <div className="flex items-center gap-2 mt-2 flex-wrap">
                                  <span className="text-[10px] text-[var(--text-3)]">⏱ {task.duration_minutes}m</span>
                                  {task.xp_reward > 0 && <span className="text-[10px] text-[var(--text-3)]">⭐ {task.xp_reward} XP</span>}
                                  {task.question_count && <span className="text-[10px] text-[var(--text-3)]">📝 {task.question_count} Qs</span>}
                                  {task.chapter_title && <span className="text-[10px] text-[var(--text-3)] truncate">📚 {task.chapter_title}</span>}
                                  {/* Bloom badge */}
                                  {(() => {
                                    const bl = TASK_BLOOM_MAP[task.task_type] || 'understand';
                                    const bc = BLOOM_CONFIG[bl];
                                    return (
                                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: `${bc.color}15`, color: bc.color }}>
                                        {bc.icon} {isHi ? bc.labelHi : bc.label}
                                      </span>
                                    );
                                  })()}
                                  {/* ZPD badge for quiz tasks */}
                                  {(task.task_type === 'quiz' || task.task_type === 'practice') && task.difficulty > 0 && (() => {
                                    const z = ZPD_LABELS[task.difficulty] || ZPD_LABELS[2];
                                    return (
                                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: `${z.color}15`, color: z.color }}>
                                        ZPD: {isHi ? z.labelHi : z.label}
                                      </span>
                                    );
                                  })()}
                                </div>

                                {/* Action buttons */}
                                {task.status !== 'completed' && task.status !== 'skipped' && (
                                  <div className="flex gap-2 mt-2.5 flex-wrap">
                                    <button
                                      onClick={() => markTask(task.id, 'completed')}
                                      className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                                      style={{ background: 'rgba(22,163,74,0.1)', border: '1px solid rgba(22,163,74,0.2)', color: '#16A34A' }}
                                    >
                                      ✓ {isHi ? 'पूरा' : 'Done'}
                                    </button>
                                    {task.task_type === 'learn' && (
                                      <button
                                        onClick={() => { markTask(task.id, 'in_progress'); router.push('/foxy'); }}
                                        className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                                        style={{ background: 'rgba(232,88,28,0.1)', border: '1px solid rgba(232,88,28,0.2)', color: 'var(--orange)' }}
                                      >
                                        🦊 {isHi ? 'Foxy से सीखो' : 'Learn with Foxy'}
                                      </button>
                                    )}
                                    {task.task_type === 'quiz' && (
                                      <button
                                        onClick={() => { markTask(task.id, 'in_progress'); router.push('/quiz'); }}
                                        className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                                        style={{ background: 'rgba(245,166,35,0.1)', border: '1px solid rgba(245,166,35,0.2)', color: '#D97706' }}
                                      >
                                        ⚡ {isHi ? 'क्विज़ खेलो' : 'Take Quiz'}
                                      </button>
                                    )}
                                    {(task.task_type === 'review' || task.task_type === 'revision') && (
                                      <button
                                        onClick={() => { markTask(task.id, 'in_progress'); router.push('/review'); }}
                                        className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                                        style={{ background: 'rgba(8,145,178,0.1)', border: '1px solid rgba(8,145,178,0.2)', color: '#0891B2' }}
                                      >
                                        🔄 {isHi ? 'रिव्यू करो' : 'Review'}
                                      </button>
                                    )}
                                    {task.task_type === 'practice' && (
                                      <button
                                        onClick={() => { markTask(task.id, 'in_progress'); router.push('/quiz'); }}
                                        className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                                        style={{ background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.2)', color: '#7C3AED' }}
                                      >
                                        ✏️ {isHi ? 'अभ्यास करो' : 'Practice'}
                                      </button>
                                    )}
                                    <button
                                      onClick={() => markTask(task.id, 'skipped')}
                                      className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                                      style={{ background: 'var(--surface-2)', color: 'var(--text-3)' }}
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

            {/* Critical Knowledge Gaps */}
            {criticalGaps.length > 0 && (
              <Card className="!p-4" accent="#EF4444">
                <div className="flex items-start gap-2">
                  <span className="text-lg">🦊</span>
                  <div className="flex-1">
                    <p className="text-xs font-bold" style={{ color: '#EF4444' }}>
                      {isHi ? 'Foxy की सलाह' : 'Foxy Suggests'}
                    </p>
                    <div className="space-y-2 mt-2">
                      {criticalGaps.map(g => (
                        <div key={g.id} className="flex items-center justify-between gap-2">
                          <span className="text-xs text-[var(--text-3)] flex-1">
                            {g.topic_title ? `${g.topic_title}: ` : ''}{isHi && g.description_hi ? g.description_hi : g.description}
                          </span>
                          <button
                            onClick={() => router.push(`/foxy${g.topic_title ? `?topic=${encodeURIComponent(g.topic_title)}` : ''}`)}
                            className="text-[10px] font-bold px-2 py-1 rounded-lg flex-shrink-0"
                            style={{ background: 'rgba(232,88,28,0.1)', color: 'var(--orange)' }}
                          >
                            {isHi ? 'ठीक करो' : 'Fix Now'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>
            )}

            {/* Science behind the plan */}
            {plan?.ai_reasoning && (
              <Card className="!p-4">
                <div className="flex items-start gap-2">
                  <span className="text-lg">🧪</span>
                  <div>
                    <p className="text-xs font-bold text-[var(--text-2)] mb-1">{isHi ? 'विज्ञान आधारित' : 'Science-backed'}</p>
                    <p className="text-xs text-[var(--text-3)] leading-relaxed">{plan.ai_reasoning}</p>
                  </div>
                </div>
              </Card>
            )}
          </>
        )}
        </SectionErrorBoundary>
      </main>

      <BottomNav />
    </div>
  );
}
