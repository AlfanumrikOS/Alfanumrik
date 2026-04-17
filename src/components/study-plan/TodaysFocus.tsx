'use client';

import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui';
import { useAllowedSubjects } from '@/lib/useAllowedSubjects';

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

interface KnowledgeGap {
  id: string;
  topic_title?: string;
  description: string;
  description_hi?: string;
}

interface TodaysFocusProps {
  tasks: Task[];
  allTasks: Task[];
  isHi: boolean;
  knowledgeGaps: KnowledgeGap[];
  onMarkInProgress: (taskId: string) => void;
}

const TASK_ICONS: Record<string, string> = {
  learn: '\uD83E\uDDCA', quiz: '\u26A1', review: '\uD83D\uDD04', practice: '\u270F\uFE0F',
  revision: '\uD83E\uDDE0', notes: '\uD83D\uDCDD', foxy_chat: '\uD83E\uDD8A', challenge: '\uD83C\uDFAF',
};

/** Build deep-link URL for a task action */
function getTaskDeepLink(task: Task, source: string): string {
  const subjectParam = task.subject ? `subject=${encodeURIComponent(task.subject)}` : '';
  const topicParam = task.topic ? `topic=${encodeURIComponent(task.topic)}` : '';
  const sourceParam = `source=${source}&task_id=${task.id}`;
  const params = [subjectParam, topicParam, sourceParam].filter(Boolean).join('&');

  switch (task.task_type) {
    case 'learn':
      return `/foxy?${[subjectParam, topicParam, 'mode=learn', sourceParam].filter(Boolean).join('&')}`;
    case 'quiz':
      return `/quiz?${[subjectParam, topicParam, sourceParam].filter(Boolean).join('&')}`;
    case 'review':
    case 'revision':
      return `/review?${sourceParam}`;
    case 'practice':
      return `/foxy?${[subjectParam, topicParam, 'mode=practice', sourceParam].filter(Boolean).join('&')}`;
    case 'notes':
      return `/foxy?${[subjectParam, topicParam, 'mode=notes', sourceParam].filter(Boolean).join('&')}`;
    case 'foxy_chat':
      return `/foxy?${[subjectParam, topicParam, sourceParam].filter(Boolean).join('&')}`;
    case 'challenge':
      return `/challenge?${[subjectParam, sourceParam].filter(Boolean).join('&')}`;
    default:
      return `/foxy?${params}`;
  }
}

/** Pick the highest-priority focus topic from today's tasks */
function pickFocusTopic(
  todayTasks: Task[],
  knowledgeGaps: KnowledgeGap[],
): { subject: string; topic: string | null; reason: string; reasonHi: string } | null {
  // Priority 1: knowledge gap topics that have tasks today
  if (knowledgeGaps.length > 0) {
    const gapTopic = knowledgeGaps[0].topic_title;
    const matchingTask = todayTasks.find(t => t.topic === gapTopic && t.status !== 'completed');
    if (matchingTask) {
      return {
        subject: matchingTask.subject,
        topic: matchingTask.topic,
        reason: `You have a knowledge gap here. Let's strengthen this.`,
        reasonHi: `यहाँ कमज़ोरी है। इसे मज़बूत करते हैं।`,
      };
    }
  }

  // Priority 2: lowest score task that isn't completed
  const incompleteTasks = todayTasks.filter(t => t.status !== 'completed' && t.status !== 'skipped');
  if (incompleteTasks.length > 0) {
    // Pick the first incomplete task (tasks are already ordered by task_order)
    const focus = incompleteTasks[0];
    return {
      subject: focus.subject,
      topic: focus.topic,
      reason: focus.description || `Focus on ${focus.title} today.`,
      reasonHi: focus.description || `आज ${focus.title} पर ध्यान दो।`,
    };
  }

  return null;
}

export default function TodaysFocus({ tasks, allTasks, isHi, knowledgeGaps, onMarkInProgress }: TodaysFocusProps) {
  const router = useRouter();
  const { unlocked: allowedSubjects } = useAllowedSubjects();

  const today = new Date().toISOString().split('T')[0];
  const todayTasks = tasks.filter(t => t.scheduled_date === today);

  // If no tasks for today, show nothing
  if (todayTasks.length === 0) return null;

  const focus = pickFocusTopic(todayTasks, knowledgeGaps);
  const incompleteTasks = todayTasks.filter(t => t.status !== 'completed' && t.status !== 'skipped');
  const completedToday = todayTasks.filter(t => t.status === 'completed').length;
  const totalToday = todayTasks.length;

  // Estimated time and XP for remaining tasks
  const estMinutes = incompleteTasks.reduce((a, t) => a + t.duration_minutes, 0);
  const estXp = incompleteTasks.reduce((a, t) => a + t.xp_reward, 0);

  // Subject meta for the focus topic
  const focusSubjectMeta = focus ? allowedSubjects.find(s => s.code === focus.subject) : null;

  // Weekly completion streak
  const daysWithTasks = new Set(allTasks.map(t => t.scheduled_date));
  const daysCompleted = [...daysWithTasks].filter(date => {
    const dayTasks = allTasks.filter(t => t.scheduled_date === date);
    return dayTasks.length > 0 && dayTasks.every(t => t.status === 'completed');
  });

  // All today tasks completed
  const allDone = completedToday === totalToday;

  if (allDone) {
    return (
      <Card accent="#16A34A">
        <div className="text-center py-3">
          <div className="text-4xl mb-2">&#127881;</div>
          <h3 className="text-base font-bold" style={{ fontFamily: 'var(--font-display)', color: '#16A34A' }}>
            {isHi ? 'आज का प्लान पूरा!' : "Today's Plan Complete!"}
          </h3>
          <p className="text-xs text-[var(--text-3)] mt-1">
            {isHi
              ? `${completedToday}/${totalToday} टास्क पूरे। शाबाश!`
              : `${completedToday}/${totalToday} tasks done. Great work!`}
          </p>
          {daysCompleted.length > 0 && (
            <p className="text-xs font-semibold mt-2" style={{ color: 'var(--orange)' }}>
              &#128293; {daysCompleted.length}/{daysWithTasks.size} {isHi ? 'दिन पूरे इस हफ्ते' : 'days completed this week'}
            </p>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card accent={focusSubjectMeta?.color || 'var(--orange)'}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--text-3)]">
          &#128197; {isHi ? 'आज का फोकस' : "Today's Focus"}
        </h3>
        <span className="text-xs text-[var(--text-3)]">
          {completedToday}/{totalToday} {isHi ? 'पूरे' : 'done'}
        </span>
      </div>

      {/* Focus Topic */}
      {focus && (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-1">
            {focusSubjectMeta && (
              <span className="text-lg">{focusSubjectMeta.icon}</span>
            )}
            <span className="text-base font-bold" style={{ fontFamily: 'var(--font-display)', color: focusSubjectMeta?.color || 'var(--text-1)' }}>
              {focusSubjectMeta?.name || focus.subject}
              {focus.topic && <span className="text-[var(--text-2)]"> — {focus.topic}</span>}
            </span>
          </div>
          <p className="text-xs text-[var(--text-3)] leading-relaxed">
            {isHi ? focus.reasonHi : focus.reason}
          </p>
        </div>
      )}

      {/* Action Buttons Grid */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        {incompleteTasks.slice(0, 4).map(task => {
          const icon = TASK_ICONS[task.task_type] || '\uD83D\uDCCB';
          const deepLink = getTaskDeepLink(task, 'study_plan');

          return (
            <button
              key={task.id}
              onClick={() => {
                onMarkInProgress(task.id);
                router.push(deepLink);
              }}
              className="flex items-center gap-2 rounded-xl p-3 text-left transition-all active:scale-[0.97]"
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
              }}
            >
              <span className="text-lg flex-shrink-0">{icon}</span>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-[var(--text-1)] truncate">
                  {task.title}
                </div>
                {task.question_count && (
                  <div className="text-[10px] text-[var(--text-3)]">
                    {task.question_count} Qs
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Time & XP estimate */}
      <div className="flex items-center gap-4 text-xs text-[var(--text-3)]">
        <span>&#9201; ~{estMinutes} {isHi ? 'मिनट' : 'min'}</span>
        <span>&#127942; +{estXp} XP {isHi ? 'संभव' : 'possible'}</span>
        {daysCompleted.length > 0 && (
          <span className="ml-auto font-semibold" style={{ color: 'var(--orange)' }}>
            &#128293; {daysCompleted.length}/{daysWithTasks.size}
          </span>
        )}
      </div>
    </Card>
  );
}

export { getTaskDeepLink };
export type { Task as StudyPlanTask, KnowledgeGap };
