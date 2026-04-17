'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import { getLevelFromScore } from '@/lib/score-config';
import { REPORT_MONTHS_COUNT } from '@/lib/constants';
import { BottomNav } from '@/components/ui';

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const SESSION_KEY = 'alfanumrik_parent_session';
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

const t = (isHi: boolean, en: string, hi: string) => isHi ? hi : en;

// ============================================================
// SESSION HELPERS (mirrors parent/page.tsx)
// ============================================================
async function hmacSign(payload: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

interface ReportParentSession {
  id: string;
  name: string;
}

interface ReportStudentSession {
  id: string;
  name: string;
  grade: string;
}

interface SubjectData {
  name: string;
  mastery?: number;
  recentScore?: number;
  topicsMastered?: number;
  totalTopics?: number;
  strongTopics?: string[];
  weakTopics?: string[];
}

interface DayActivity {
  quizzes: number;
  xp: number;
  label?: string;
  day?: string;
  studyTime?: number;
}

interface ConceptItem {
  name: string;
  subject?: string;
  level: string;
}

interface QuizRecord {
  topic?: string;
  subject?: string;
  score?: number;
  date?: string;
  created_at?: string;
  timeSpent?: number;
}

interface InsightItem {
  text?: string;
  message?: string;
}

interface TipItem {
  icon?: string;
  title?: string;
  description?: string;
  text?: string;
}

interface ReportStats {
  overallMastery?: number;
  accuracy?: number;
  avgScore?: number;
  streak?: number;
  xp?: number;
  totalQuizzes?: number;
  accuracyTrend?: string;
  trend?: string;
}

interface ReportData {
  error?: string;
  stats?: ReportStats;
  subjects?: SubjectData[];
  dailyActivity?: DayActivity[];
  concepts?: ConceptItem[];
  bktMastery?: { concepts?: ConceptItem[] };
  quizHistory?: QuizRecord[];
  recentQuizzes?: QuizRecord[];
  insights?: Array<string | InsightItem>;
  parentTips?: Array<string | TipItem>;
  tips?: Array<string | TipItem>;
}

interface MonthlyReportData {
  conceptMasteryPct?: number;
  retentionScore?: number;
  weakChapters?: string[];
  strongChapters?: string[];
  predictedScore?: number | string;
  syllabusCompletionPct?: number;
  accuracyTrend?: number[];
  timeEfficiency?: number;
  studyConsistencyPct?: number;
  totalStudyMinutes?: number;
  totalQuestionsAttempted?: number;
  improvementAreas?: string[];
  achievements?: string[];
}

async function loadParentSession(): Promise<{ guardian: ReportParentSession; student: ReportStudentSession } | null> {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const { payload, hmac, nonce } = JSON.parse(raw);
    if (!payload || !hmac || !nonce) return null;
    const expected = await hmacSign(payload, nonce);
    if (expected !== hmac) { sessionStorage.removeItem(SESSION_KEY); return null; }
    const { guardian, student, issuedAt } = JSON.parse(payload);
    if (Date.now() - issuedAt > SESSION_TTL_MS) { sessionStorage.removeItem(SESSION_KEY); return null; }
    return { guardian, student };
  } catch { sessionStorage.removeItem(SESSION_KEY); return null; }
}

async function api(action: string, params: Record<string, unknown> = {}) {
  const res = await fetch(`${SB_URL}/functions/v1/parent-portal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SB_KEY },
    body: JSON.stringify({ action, ...params }),
  });
  if (!res.ok) {
    const errorText = await res.text().catch(() => 'Unknown error');
    throw new Error(`API error ${res.status}: ${errorText}`);
  }
  return res.json();
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================
function getScoreColor(score: number): string {
  if (score >= 80) return '#16A34A';
  if (score >= 50) return '#D97706';
  return '#EF4444';
}

function getMasteryColor(level: string): string {
  switch (level) {
    case 'mastered': return '#16A34A';
    case 'proficient': return '#7C3AED';
    case 'familiar': return '#2563EB';
    case 'developing': return '#D97706';
    default: return '#64748B';
  }
}

function getMasteryLabel(level: string, isHi = false): string {
  switch (level) {
    case 'mastered': return t(isHi, 'Mastered', 'माहिर');
    case 'proficient': return t(isHi, 'Proficient', 'कुशल');
    case 'familiar': return t(isHi, 'Familiar', 'परिचित');
    case 'developing': return t(isHi, 'Developing', 'विकासशील');
    default: return t(isHi, 'Not Started', 'शुरू नहीं हुआ');
  }
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return dateStr; }
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

const dayNamesEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayNamesHi = ['रवि', 'सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि'];

// ============================================================
// STYLES
// ============================================================
const pageStyle: React.CSSProperties = {
  maxWidth: 700,
  margin: '0 auto',
  padding: '0 0 40px',
  fontFamily: "'Plus Jakarta Sans', 'Sora', system-ui, sans-serif",
  color: '#1E293B',
  backgroundColor: '#F0FDF4',
  minHeight: '100vh',
};

const cardStyle: React.CSSProperties = {
  backgroundColor: '#FFFFFF',
  borderRadius: 16,
  padding: '20px 22px',
  border: '1px solid #E2E8F0',
  marginBottom: 16,
  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
};

const cardTitle: React.CSSProperties = {
  fontSize: 17,
  fontWeight: 700,
  color: '#1E293B',
  margin: '0 0 14px',
};

const sectionHeading: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: '#16A34A',
  textTransform: 'uppercase' as const,
  letterSpacing: 0.8,
  margin: '0 0 8px',
};

const emptyText: React.CSSProperties = {
  fontSize: 14,
  color: '#64748B',
  fontStyle: 'italic',
  textAlign: 'center',
  padding: '20px 16px',
  lineHeight: 1.6,
};

// ============================================================
// PERFORMANCE SUMMARY CARD
// ============================================================
function SummaryCard({ icon, label, value, sub, ringColor }: {
  icon: string; label: string; value: string; sub?: string; ringColor?: string;
  }) {
  return (
    <div style={{
      backgroundColor: '#FFFFFF',
      borderRadius: 14,
      padding: '16px 14px',
      border: '1px solid #E2E8F0',
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      textAlign: 'center',
      position: 'relative',
    }}>
      {ringColor && (
        <div style={{
          width: 48, height: 48, borderRadius: '50%',
          border: `4px solid ${ringColor}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 8px', fontSize: 20,
        }}>{icon}</div>
      )}
      {!ringColor && <div style={{ fontSize: 24, marginBottom: 6 }}>{icon}</div>}
      <div style={{ fontSize: 11, color: '#64748B', textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: '#1E293B' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ============================================================
// SUBJECT PERFORMANCE CARD
// ============================================================
function SubjectCard({ subject, isHi = false }: { subject: SubjectData; isHi?: boolean }) {
  const mastery = subject.mastery ?? 0;
  const barColor = mastery >= 80 ? '#16A34A' : mastery >= 50 ? '#D97706' : '#EF4444';
  const subjectColors: Record<string, string> = {
    math: '#2563EB', science: '#16A34A', english: '#7C3AED',
    hindi: '#D97706', social: '#EC4899', evs: '#059669',
  };
  const subjectIcons: Record<string, string> = {
    math: '\u2795', science: '\uD83E\uDDEA', english: '\uD83D\uDCD6',
    hindi: '\uD83C\uDDEE\uD83C\uDDF3', social: '\uD83C\uDF0D', evs: '\uD83C\uDF3F',
  };
  const key = (subject.name || '').toLowerCase();
  const color = subjectColors[key] || '#6366F1';
  const icon = subjectIcons[key] || '\uD83D\uDCDA';

  return (
    <div style={{ ...cardStyle, borderLeft: `4px solid ${color}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 22 }}>{icon}</span>
        <span style={{ fontSize: 16, fontWeight: 700, color: '#1E293B' }}>{subject.name}</span>
        {subject.recentScore != null && (
          <span style={{
            marginLeft: 'auto', fontSize: 12, fontWeight: 600,
            color: getScoreColor(subject.recentScore),
            backgroundColor: `${getScoreColor(subject.recentScore)}15`,
            padding: '3px 10px', borderRadius: 20,
          }}>
            {t(isHi, 'Last quiz', 'पिछली क्विज़')}: {subject.recentScore}%
          </span>
        )}
      </div>

      {/* Mastery bar */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 12, color: '#64748B' }}>{t(isHi, 'Mastery', 'महारत')}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: barColor }}>{mastery}%</span>
        </div>
        <div style={{ height: 10, backgroundColor: '#F1F5F9', borderRadius: 5, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${mastery}%`, backgroundColor: barColor, borderRadius: 5, transition: 'width 0.5s ease' }} />
        </div>
      </div>

      {/* Topics count */}
      {subject.topicsMastered != null && subject.totalTopics != null && (
        <div style={{ fontSize: 13, color: '#475569', marginBottom: 8 }}>
          {t(isHi, `${subject.topicsMastered} of ${subject.totalTopics} topics mastered`, `${subject.totalTopics} में से ${subject.topicsMastered} विषय पूरे`)}
        </div>
      )}

      {/* Strong / Weak topics */}
      {subject.strongTopics && subject.strongTopics.length > 0 && (
        <div style={{ fontSize: 13, color: '#16A34A', marginBottom: 4 }}>
          {t(isHi, 'Strong in', 'मजबूत')}: {subject.strongTopics.join(', ')}
        </div>
      )}
      {subject.weakTopics && subject.weakTopics.length > 0 && (
        <div style={{ fontSize: 13, color: '#D97706' }}>
          {t(isHi, 'Needs practice', 'अभ्यास चाहिए')}: {subject.weakTopics.join(', ')}
        </div>
      )}
    </div>
  );
}

// ============================================================
// WEEKLY ACTIVITY TIMELINE
// ============================================================
function WeeklyTimeline({ days, mostActiveDay, isHi = false }: { days: DayActivity[]; mostActiveDay?: string; isHi?: boolean }) {
  const dayNames = isHi ? dayNamesHi : dayNamesEn;
  return (
    <div style={cardStyle}>
      <h3 style={cardTitle}>{t(isHi, 'Weekly Activity Timeline', 'साप्ताहिक गतिविधि')}</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
        {days.map((day: DayActivity, i: number) => {
          const active = day.quizzes > 0 || day.xp > 0;
          return (
            <div key={i} style={{
              backgroundColor: active ? '#F0FDF4' : '#F8FAFC',
              borderRadius: 12,
              padding: '10px 6px',
              textAlign: 'center',
              border: active ? '1px solid #BBF7D0' : '1px solid #E2E8F0',
              opacity: active ? 1 : 0.5,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: active ? '#16A34A' : '#94A3B8', marginBottom: 6 }}>
                {day.label || dayNames[i]}
              </div>
              {active ? (
                <>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#1E293B' }}>{day.quizzes}</div>
                  <div style={{ fontSize: 10, color: '#64748B' }}>{t(isHi, 'quizzes', 'क्विज़')}</div>
                  {day.studyTime != null && (
                    <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>{formatTime(day.studyTime)}</div>
                  )}
                  <div style={{ fontSize: 10, color: '#F59E0B', fontWeight: 600, marginTop: 3 }}>+{day.xp} XP</div>
                </>
              ) : (
                <div style={{ fontSize: 10, color: '#CBD5E1', marginTop: 8 }}>{t(isHi, 'Rest day', 'आराम का दिन')}</div>
              )}
            </div>
          );
        })}
      </div>
      {mostActiveDay && (
        <div style={{ fontSize: 13, color: '#16A34A', marginTop: 12, textAlign: 'center', fontWeight: 600 }}>
          {t(isHi, `Your child was most active on ${mostActiveDay}!`, `आपका बच्चा ${mostActiveDay} को सबसे ज़्यादा सक्रिय था!`)}
        </div>
      )}
    </div>
  );
}

// ============================================================
// CONCEPT MASTERY MAP
// ============================================================
function ConceptMasteryMap({ concepts, isHi = false }: { concepts: ConceptItem[]; isHi?: boolean }) {
  if (!concepts || concepts.length === 0) {
    return (
      <div style={cardStyle}>
        <h3 style={cardTitle}>{t(isHi, 'Concept Mastery Map', 'अवधारणा महारत मानचित्र')}</h3>
        <p style={emptyText}>{t(isHi, "Your child hasn't started exploring concepts yet. Encourage them to take a few quizzes to see their mastery map grow!", 'आपके बच्चे ने अभी तक अवधारणाएँ नहीं शुरू की हैं। उन्हें कुछ क्विज़ लेने के लिए प्रोत्साहित करें!')}</p>
      </div>
    );
  }

  // Group by subject
  const grouped: Record<string, ConceptItem[]> = {};
  concepts.forEach((c: ConceptItem) => {
    const subj = c.subject || 'General';
    if (!grouped[subj]) grouped[subj] = [];
    grouped[subj].push(c);
  });

  return (
    <div style={cardStyle}>
      <h3 style={cardTitle}>{t(isHi, 'Concept Mastery Map', 'अवधारणा महारत मानचित्र')}</h3>

      {/* Legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        {[
          { label: t(isHi, 'Mastered', 'माहिर'), color: '#16A34A' },
          { label: t(isHi, 'Proficient', 'कुशल'), color: '#7C3AED' },
          { label: t(isHi, 'Familiar', 'परिचित'), color: '#2563EB' },
          { label: t(isHi, 'Developing', 'विकासशील'), color: '#D97706' },
          { label: t(isHi, 'Not Started', 'शुरू नहीं हुआ'), color: '#CBD5E1' },
        ].map(l => (
          <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: l.color }} />
            <span style={{ fontSize: 11, color: '#64748B' }}>{l.label}</span>
          </div>
        ))}
      </div>

      {Object.entries(grouped).map(([subject, items]) => (
        <div key={subject} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#475569', marginBottom: 6 }}>{subject}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {items.map((c: ConceptItem, i: number) => (
              <div key={i} style={{
                backgroundColor: `${getMasteryColor(c.level)}18`,
                border: `1px solid ${getMasteryColor(c.level)}40`,
                borderRadius: 8,
                padding: '6px 10px',
                fontSize: 12,
                color: getMasteryColor(c.level),
                fontWeight: 600,
              }}>
                {c.name}
                <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 4 }}>
                  {getMasteryLabel(c.level, isHi)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// QUIZ HISTORY
// ============================================================
function QuizHistory({ quizzes, isHi = false }: { quizzes: QuizRecord[]; isHi?: boolean }) {
  if (!quizzes || quizzes.length === 0) {
    return (
      <div style={cardStyle}>
        <h3 style={cardTitle}>{t(isHi, 'Recent Quiz History', 'हाल की क्विज़')}</h3>
        <p style={emptyText}>{t(isHi, 'No quizzes completed yet. When your child takes quizzes, their results will appear here!', 'अभी तक कोई क्विज़ पूरी नहीं हुई। जब आपका बच्चा क्विज़ देगा, तो परिणाम यहाँ दिखेंगे!')}</p>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <h3 style={cardTitle}>{t(isHi, 'Recent Quiz History', 'हाल की क्विज़')}</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {quizzes.slice(0, 10).map((q: QuizRecord, i: number) => {
          const scoreColor = getScoreColor(q.score ?? 0);
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 14px',
              backgroundColor: '#F8FAFC',
              borderRadius: 10,
              borderLeft: `3px solid ${scoreColor}`,
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1E293B' }}>{q.topic || q.subject || 'Quiz'}</div>
                <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
                  {q.subject && q.topic ? `${q.subject} \u00B7 ` : ''}{formatDate(q.date || q.created_at || '')}
                  {q.timeSpent != null && ` \u00B7 ${formatTime(q.timeSpent)}`}
                </div>
              </div>
              <div style={{
                fontSize: 18, fontWeight: 800, color: scoreColor,
                backgroundColor: `${scoreColor}12`,
                padding: '4px 12px', borderRadius: 10,
              }}>
                {q.score ?? 0}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// INSIGHTS & RECOMMENDATIONS
// ============================================================
function InsightsSection({ insights, tips, isHi = false }: { insights: Array<string | InsightItem>; tips: Array<string | TipItem>; isHi?: boolean }) {
  return (
    <div style={cardStyle}>
      <h3 style={cardTitle}>{t(isHi, 'Insights & Recommendations', 'जानकारी और सुझाव')}</h3>

      {insights && insights.length > 0 ? (
        <div style={{ marginBottom: 16 }}>
          {insights.map((insight: string | InsightItem, i: number) => (
            <div key={i} style={{
              padding: '12px 14px',
              backgroundColor: '#F0FDF4',
              borderRadius: 10,
              marginBottom: 8,
              borderLeft: '3px solid #16A34A',
              fontSize: 14,
              color: '#1E293B',
              lineHeight: 1.6,
            }}>
              {typeof insight === 'string' ? insight : insight.text || insight.message || ''}
            </div>
          ))}
        </div>
      ) : (
        <p style={{ ...emptyText, textAlign: 'left', padding: '0 0 12px' }}>
          {t(isHi, 'Keep encouraging your child to practice! Insights will appear as they make progress.', 'अपने बच्चे को अभ्यास के लिए प्रोत्साहित करें! प्रगति के साथ जानकारी यहाँ दिखेगी।')}
        </p>
      )}

      {/* How to Help at Home */}
      <div style={{ marginTop: 8 }}>
        <div style={{ ...sectionHeading, color: '#15803D', fontSize: 13 }}>{t(isHi, 'How to Help at Home', 'घर पर कैसे मदद करें')}</div>
        {tips && tips.length > 0 ? (
          tips.map((tip: string | TipItem, i: number) => (
            <div key={i} style={{
              display: 'flex', gap: 10, padding: '10px 0',
              borderBottom: i < tips.length - 1 ? '1px solid #F1F5F9' : 'none',
            }}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>{(typeof tip === 'string' ? undefined : tip.icon) || '\uD83D\uDCA1'}</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1E293B' }}>{(typeof tip === 'string' ? undefined : tip.title) || `Tip ${i + 1}`}</div>
                <div style={{ fontSize: 13, color: '#64748B', marginTop: 2, lineHeight: 1.5 }}>{typeof tip === 'string' ? tip : tip.description || tip.text || ''}</div>
              </div>
            </div>
          ))
        ) : (
          <div style={{ fontSize: 13, color: '#64748B', lineHeight: 1.6 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}><span>\uD83D\uDCDA</span><span>{t(isHi, 'Set aside 15-20 minutes daily for focused learning time.', 'हर दिन 15-20 मिनट पढ़ाई के लिए अलग रखें।')}</span></div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}><span>\uD83C\uDFC6</span><span>{t(isHi, 'Celebrate small wins and streaks to keep motivation high.', 'छोटी सफलताओं को मनाएँ और प्रेरणा बनाए रखें।')}</span></div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}><span>\uD83D\uDDE3\uFE0F</span><span>{t(isHi, 'Ask your child to explain what they learned today - teaching reinforces learning.', 'अपने बच्चे से पूछें कि आज उन्होंने क्या सीखा - सिखाने से सीखना मजबूत होता है।')}</span></div>
            <div style={{ display: 'flex', gap: 8 }}><span>\uD83C\uDF1F</span><span>{t(isHi, 'Focus on progress, not perfection. Every attempt is a step forward!', 'प्रगति पर ध्यान दें, पूर्णता पर नहीं। हर प्रयास एक कदम आगे है!')}</span></div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// PERFORMANCE SCORE TREND SECTION
// ============================================================
interface ScoreTrendEntry {
  subject: string;
  currentScore: number;
  previousScore: number | null;
  levelName: string;
}

function PerformanceScoreTrends({ trends, isHi = false }: { trends: ScoreTrendEntry[]; isHi?: boolean }) {
  if (!trends || trends.length === 0) return null;

  const avgCurrent = Math.round(trends.reduce((s, t) => s + t.currentScore, 0) / trends.length);

  return (
    <div style={cardStyle}>
      <h3 style={cardTitle}>
        {t(isHi, 'Performance Score Trends', 'प्रदर्शन स्कोर रुझान')}
      </h3>
      <p style={{ fontSize: 13, color: '#64748B', marginBottom: 14, lineHeight: 1.5 }}>
        {t(isHi,
          `समग्र औसत: ${avgCurrent}/100 — ${getLevelFromScore(avgCurrent)}`,
          `Overall average: ${avgCurrent}/100 — ${getLevelFromScore(avgCurrent)}`
        )}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {trends.map((tr) => {
          const delta = tr.previousScore != null ? tr.currentScore - tr.previousScore : null;
          const deltaColor = delta != null ? (delta > 0 ? '#16A34A' : delta < 0 ? '#EF4444' : '#64748B') : '#64748B';
          const barColor = tr.currentScore >= 75 ? '#16A34A' : tr.currentScore >= 50 ? '#D97706' : '#EF4444';
          const subjectHiMap: Record<string, string> = {
            math: 'गणित', science: 'विज्ञान', english: 'अंग्रेज़ी',
            hindi: 'हिंदी', social: 'सामाजिक विज्ञान', evs: 'पर्यावरण',
            physics: 'भौतिकी', chemistry: 'रसायन', biology: 'जीवविज्ञान',
          };
          const subKey = tr.subject.toLowerCase();
          const displaySubject = isHi ? (subjectHiMap[subKey] || tr.subject) : tr.subject;

          return (
            <div key={tr.subject} style={{
              padding: '12px 14px',
              backgroundColor: '#F8FAFC',
              borderRadius: 10,
              borderLeft: `3px solid ${barColor}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div>
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#1E293B' }}>{displaySubject}</span>
                  <span style={{ fontSize: 11, color: '#94A3B8', marginLeft: 8 }}>{tr.levelName}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 18, fontWeight: 800, color: barColor }}>{tr.currentScore}</span>
                  <span style={{ fontSize: 11, color: '#94A3B8' }}>/100</span>
                </div>
              </div>
              {/* Progress bar */}
              <div style={{ height: 6, backgroundColor: '#E2E8F0', borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
                <div style={{
                  height: '100%',
                  width: `${tr.currentScore}%`,
                  backgroundColor: barColor,
                  borderRadius: 3,
                  transition: 'width 0.5s ease',
                }} />
              </div>
              {/* Delta line */}
              {delta != null && (
                <div style={{ fontSize: 12, color: deltaColor, fontWeight: 600 }}>
                  {delta > 0 ? '\u2B06\uFE0F' : delta < 0 ? '\u2B07\uFE0F' : '\u2796'}
                  {' '}
                  {delta > 0
                    ? t(isHi, `${delta} अंक ऊपर पिछले सप्ताह से`, `Up ${delta} point${delta !== 1 ? 's' : ''} from last week`)
                    : delta < 0
                    ? t(isHi, `${Math.abs(delta)} अंक नीचे पिछले सप्ताह से`, `Down ${Math.abs(delta)} point${Math.abs(delta) !== 1 ? 's' : ''} from last week`)
                    : t(isHi, 'पिछले सप्ताह जैसा ही', 'Same as last week')
                  }
                </div>
              )}
              {delta == null && (
                <div style={{ fontSize: 11, color: '#94A3B8' }}>
                  {t(isHi, 'पिछले सप्ताह का डेटा उपलब्ध नहीं', 'No data from last week')}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// PDF DOWNLOAD HELPERS
// ============================================================
function downloadReportPDF(studentName: string, grade: string, reportData: ReportData | null) {
  const stats = reportData?.stats || {};
  const subjects = reportData?.subjects || [];
  const quizzes = (reportData?.quizHistory || reportData?.recentQuizzes || []).slice(0, 5);
  const insights = reportData?.insights || [];
  const now = new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });

  const subjectRows = subjects.map((s: SubjectData) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-weight:600">${s.name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:center">
        <span style="color:${(s.mastery ?? 0) >= 80 ? '#16A34A' : (s.mastery ?? 0) >= 50 ? '#D97706' : '#EF4444'};font-weight:700">
          ${s.mastery ?? 0}%
        </span>
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;text-align:center">
        ${s.recentScore != null ? `${s.recentScore}%` : '--'}
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #f1f5f9;font-size:11px;color:#64748B">
        ${(s.weakTopics || []).slice(0, 2).join(', ') || '—'}
      </td>
    </tr>
  `).join('');

  const quizRows = quizzes.map((q: QuizRecord) => `
    <tr>
      <td style="padding:7px 12px;border-bottom:1px solid #f1f5f9">${q.topic || q.subject || 'Quiz'}</td>
      <td style="padding:7px 12px;border-bottom:1px solid #f1f5f9;text-align:center;font-weight:700;color:${(q.score ?? 0) >= 80 ? '#16A34A' : (q.score ?? 0) >= 50 ? '#D97706' : '#EF4444'}">${q.score ?? 0}%</td>
      <td style="padding:7px 12px;border-bottom:1px solid #f1f5f9;font-size:11px;color:#94A3B8">${q.date || q.created_at ? new Date(q.date || q.created_at || '').toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }) : ''}</td>
    </tr>
  `).join('');

  const insightHtml = insights.slice(0, 3).map((ins: string | InsightItem) =>
    `<li style="margin-bottom:6px;color:#1E293B;font-size:13px">${typeof ins === 'string' ? ins : ins.text || ins.message || ''}</li>`
  ).join('');

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Report — ${studentName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, 'Plus Jakarta Sans', sans-serif; background: #fff; color: #1E293B; font-size: 13px; }
    .header { background: linear-gradient(135deg, #F97316, #EA580C); color: #fff; padding: 24px 28px; margin-bottom: 24px; }
    .header h1 { font-size: 22px; font-weight: 800; margin-bottom: 4px; }
    .header p { font-size: 13px; opacity: 0.9; }
    .container { padding: 0 28px 28px; }
    .section { margin-bottom: 22px; }
    .section-title { font-size: 14px; font-weight: 700; color: #F97316; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; border-bottom: 2px solid #FFF3E0; padding-bottom: 4px; }
    .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 10px; }
    .stat-box { background: #FFF8F0; border-radius: 10px; padding: 12px; text-align: center; border: 1px solid #FDBA7444; }
    .stat-value { font-size: 22px; font-weight: 800; color: #F97316; }
    .stat-label { font-size: 10px; color: #64748B; text-transform: uppercase; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 10px; overflow: hidden; border: 1px solid #F1F5F9; }
    th { background: #FFF8F0; padding: 10px 12px; font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase; text-align: left; }
    .footer { text-align: center; margin-top: 28px; padding-top: 14px; border-top: 1px solid #F1F5F9; font-size: 11px; color: #94A3B8; }
    ul { padding-left: 18px; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Alfanumrik Learning Report</h1>
    <p>${studentName} &bull; Grade ${grade} &bull; Generated ${now}</p>
  </div>
  <div class="container">
    <div class="section">
      <div class="section-title">Performance Summary</div>
      <div class="stats-grid">
        <div class="stat-box"><div class="stat-value">${stats.overallMastery ?? stats.accuracy ?? 0}%</div><div class="stat-label">Mastery</div></div>
        <div class="stat-box"><div class="stat-value">${stats.accuracy ?? 0}%</div><div class="stat-label">Accuracy</div></div>
        <div class="stat-box"><div class="stat-value">${stats.streak ?? 0}d</div><div class="stat-label">Streak</div></div>
        <div class="stat-box"><div class="stat-value">${stats.xp ?? 0}</div><div class="stat-label">XP Earned</div></div>
        <div class="stat-box"><div class="stat-value">${stats.totalQuizzes ?? 0}</div><div class="stat-label">Quizzes</div></div>
        <div class="stat-box"><div class="stat-value">${stats.avgScore ?? 0}%</div><div class="stat-label">Avg Score</div></div>
      </div>
    </div>

    ${subjects.length > 0 ? `
    <div class="section">
      <div class="section-title">Subject Performance</div>
      <table>
        <thead><tr>
          <th>Subject</th><th style="text-align:center">Mastery</th><th style="text-align:center">Last Quiz</th><th>Needs Practice</th>
        </tr></thead>
        <tbody>${subjectRows}</tbody>
      </table>
    </div>` : ''}

    ${quizzes.length > 0 ? `
    <div class="section">
      <div class="section-title">Recent Quiz Scores</div>
      <table>
        <thead><tr><th>Topic</th><th style="text-align:center">Score</th><th>Date</th></tr></thead>
        <tbody>${quizRows}</tbody>
      </table>
    </div>` : ''}

    ${insights.length > 0 ? `
    <div class="section">
      <div class="section-title">AI Recommendations</div>
      <ul>${insightHtml}</ul>
    </div>` : ''}

    <div class="footer">Generated by Alfanumrik Learning OS &bull; alfanumrik.com</div>
  </div>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=800,height=900');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  // Give CSS time to paint before printing
  setTimeout(() => {
    win.focus();
    win.print();
  }, 400);
}

// ============================================================
// PRINT / SHARE SECTION
// ============================================================
function PrintShareSection({ studentName, grade, reportData, isHi = false }: { studentName: string; grade: string; reportData: ReportData | null; isHi?: boolean }) {
  const handlePrint = () => {
    window.print();
  };

  const handleWhatsApp = () => {
    const stats = reportData?.stats || {};
    const subjects = reportData?.subjects || [];
    const subjectSummary = subjects.map((s: SubjectData) =>
      `${s.name}: ${s.mastery ?? 0}% mastery`
    ).join('\n');

    const message = [
      `Learning Report for ${studentName}`,
      ``,
      `Overall Mastery: ${stats.overallMastery ?? 0}%`,
      `Accuracy: ${stats.accuracy ?? 0}%`,
      `Streak: ${stats.streak ?? 0} days`,
      `XP Earned: ${stats.xp ?? 0}`,
      ``,
      subjects.length > 0 ? `Subject Performance:\n${subjectSummary}` : '',
      ``,
      `Generated by Alfanumrik Learning OS`,
    ].filter(Boolean).join('\n');

    const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  };

  return (
    <div style={{ ...cardStyle, textAlign: 'center' }} className="no-print">
      <h3 style={{ ...cardTitle, textAlign: 'center' }}>{t(isHi, 'Share This Report', 'यह रिपोर्ट साझा करें')}</h3>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => downloadReportPDF(studentName, grade, reportData)} style={{
          padding: '12px 24px', backgroundColor: '#F97316', color: '#fff',
          border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 700,
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span>&#x1F4C4;</span> {t(isHi, 'Download PDF', 'PDF डाउनलोड करें')}
        </button>
        <button onClick={handlePrint} style={{
          padding: '12px 24px', backgroundColor: '#16A34A', color: '#fff',
          border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 700,
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span>\uD83D\uDDA8\uFE0F</span> {t(isHi, 'Print Report', 'रिपोर्ट प्रिंट करें')}
        </button>
        <button onClick={handleWhatsApp} style={{
          padding: '12px 24px', backgroundColor: '#25D366', color: '#fff',
          border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 700,
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span>\uD83D\uDCF1</span> {t(isHi, 'Share via WhatsApp', 'WhatsApp पर साझा करें')}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// HELPERS: Month list for monthly reports
// ============================================================
function getLastNMonths(n: number): { label: string; value: string }[] {
  const months: { label: string; value: string }[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = d.getMonth();
    const label = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    const value = `${year}-${String(month + 1).padStart(2, '0')}`;
    months.push({ label, value });
  }
  return months;
}

// ============================================================
// CIRCULAR PROGRESS (for monthly report)
// ============================================================
function CircularProgressRing({ value, size = 72, color = '#16A34A', label }: {
  value: number; size?: number; color?: string; label?: string;
}) {
  const pct = Math.min(100, Math.max(0, value));
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#F1F5F9" strokeWidth={6} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={color} strokeWidth={6} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
        <text
          x={size / 2} y={size / 2}
          textAnchor="middle" dominantBaseline="central"
          fill="#1E293B" fontSize={size * 0.22} fontWeight={700}
          transform={`rotate(90, ${size / 2}, ${size / 2})`}
        >
          {Math.round(pct)}%
        </text>
      </svg>
      {label && <span style={{ fontSize: 10, color: '#64748B', fontWeight: 600 }}>{label}</span>}
    </div>
  );
}

// ============================================================
// MONTHLY REPORT SECTION (Parent read-only view)
// ============================================================
function MonthlyReportSection({ guardianId, studentId, studentName, isHi = false }: {
  guardianId: string; studentId: string; studentName: string; isHi?: boolean;
}) {
  const months = useMemo(() => getLastNMonths(REPORT_MONTHS_COUNT), []);
  const [selectedMonth, setSelectedMonth] = useState(months[0]?.value ?? '');
  const [monthlyData, setMonthlyData] = useState<MonthlyReportData | null>(null);
  const [monthlyLoading, setMonthlyLoading] = useState(false);

  useEffect(() => {
    if (!studentId || !selectedMonth) return;
    const fetchMonthlyReport = async () => {
      setMonthlyLoading(true);
      try {
        const res = await api('get_monthly_report', {
          guardian_id: guardianId,
          student_id: studentId,
          report_month: selectedMonth,
        });
        if (res && !res.error) {
          setMonthlyData(res.report_data ?? res);
        } else {
          setMonthlyData(null);
        }
      } catch {
        setMonthlyData(null);
      }
      setMonthlyLoading(false);
    };
    fetchMonthlyReport();
  }, [guardianId, studentId, selectedMonth]);

  const handlePrintMonthly = () => {
    window.print();
  };

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={sectionHeading}>{t(isHi, 'Monthly Report', 'मासिक रिपोर्ट')}</div>

      {/* Month selector pills */}
      <div className="no-print" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8, marginBottom: 12 }}>
        {months.map((m) => (
          <button
            key={m.value}
            onClick={() => setSelectedMonth(m.value)}
            style={{
              padding: '6px 14px',
              borderRadius: 20,
              border: 'none',
              fontSize: 12,
              fontWeight: selectedMonth === m.value ? 700 : 500,
              backgroundColor: selectedMonth === m.value ? '#16A34A' : '#F1F5F9',
              color: selectedMonth === m.value ? '#fff' : '#64748B',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.2s',
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {monthlyLoading && (
        <div style={{ ...cardStyle, textAlign: 'center', padding: 40 }}>
          <div style={{ width: 32, height: 32, border: '3px solid #E2E8F0', borderTopColor: '#16A34A', borderRadius: '50%', margin: '0 auto 12px', animation: 'spin 0.8s linear infinite' }} />
          <span style={{ fontSize: 13, color: '#64748B' }}>{t(isHi, 'Loading monthly report...', 'मासिक रिपोर्ट लोड हो रही है...')}</span>
        </div>
      )}

      {!monthlyLoading && !monthlyData && (
        <div style={{ ...cardStyle, textAlign: 'center', padding: 30 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>{'\uD83D\uDCCA'}</div>
          <p style={{ fontSize: 14, color: '#64748B' }}>{t(isHi, 'No monthly report available for this period.', 'इस अवधि के लिए कोई मासिक रिपोर्ट उपलब्ध नहीं है।')}</p>
        </div>
      )}

      {!monthlyLoading && monthlyData && (
        <>
          {/* Learning Metrics */}
          <div style={cardStyle}>
            <h3 style={cardTitle}>{t(isHi, 'Learning Metrics', 'सीखने के आँकड़े')}</h3>
            <div style={{ display: 'flex', justifyContent: 'space-around', marginBottom: 16 }}>
              <CircularProgressRing
                value={monthlyData.conceptMasteryPct ?? 0}
                color="#16A34A"
                label={t(isHi, 'Concept Mastery', 'अवधारणा महारत')}
              />
              <CircularProgressRing
                value={monthlyData.retentionScore ?? 0}
                color="#0891B2"
                label={t(isHi, '7-Day Retention', '7-दिन याददाश्त')}
              />
            </div>

            {/* Weak areas prominently displayed */}
            {monthlyData.weakChapters && monthlyData.weakChapters.length > 0 && (
              <div style={{
                backgroundColor: '#FEF2F2',
                borderRadius: 12,
                padding: '12px 14px',
                marginBottom: 10,
                border: '1px solid #FECACA',
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#DC2626', marginBottom: 6 }}>
                  {'\u26A0\uFE0F'} {t(isHi, 'Needs Attention', 'ध्यान देने की ज़रूरत')}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {monthlyData.weakChapters.map((ch: string, i: number) => (
                    <span key={i} style={{
                      fontSize: 11, padding: '3px 10px', borderRadius: 12,
                      backgroundColor: '#FEE2E2', color: '#DC2626', fontWeight: 600,
                    }}>
                      {ch}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {monthlyData.strongChapters && monthlyData.strongChapters.length > 0 && (
              <div style={{
                backgroundColor: '#F0FDF4',
                borderRadius: 12,
                padding: '12px 14px',
                border: '1px solid #BBF7D0',
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#16A34A', marginBottom: 6 }}>
                  {'\u2705'} {t(isHi, 'Strong In', 'मजबूत')}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {monthlyData.strongChapters.map((ch: string, i: number) => (
                    <span key={i} style={{
                      fontSize: 11, padding: '3px 10px', borderRadius: 12,
                      backgroundColor: '#DCFCE7', color: '#16A34A', fontWeight: 600,
                    }}>
                      {ch}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Performance & Exam Readiness */}
          <div style={cardStyle}>
            <h3 style={cardTitle}>{t(isHi, 'Performance & Exam Readiness', 'प्रदर्शन और परीक्षा तैयारी')}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 12 }}>
              <div style={{ textAlign: 'center', padding: 12, backgroundColor: '#F8FAFC', borderRadius: 12 }}>
                <div style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase' as const }}>{t(isHi, 'Predicted Score', 'अनुमानित अंक')}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#E8581C' }}>
                  {monthlyData.predictedScore ?? '--'}
                </div>
                <div style={{ fontSize: 10, color: '#94A3B8' }}>/80</div>
              </div>
              <div style={{ textAlign: 'center', padding: 12, backgroundColor: '#F8FAFC', borderRadius: 12 }}>
                <div style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase' as const }}>{t(isHi, 'Syllabus Done', 'पाठ्यक्रम पूरा')}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#0891B2' }}>
                  {monthlyData.syllabusCompletionPct ?? 0}%
                </div>
              </div>
            </div>

            {/* Accuracy trend bars */}
            {monthlyData.accuracyTrend && monthlyData.accuracyTrend.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>{t(isHi, 'Weekly Accuracy', 'साप्ताहिक सटीकता')}</div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 60 }}>
                  {monthlyData.accuracyTrend.map((val: number, i: number) => {
                    const h = Math.max(4, (val / 100) * 100);
                    return (
                      <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                        <span style={{ fontSize: 10, fontWeight: 600, color: '#64748B' }}>{Math.round(val)}%</span>
                        <div style={{
                          width: '100%', borderRadius: '4px 4px 0 0',
                          height: `${h}%`,
                          backgroundColor: val >= 70 ? '#16A34A' : val >= 40 ? '#F59E0B' : '#EF4444',
                          transition: 'height 0.4s ease',
                        }} />
                        <span style={{ fontSize: 10, color: '#94A3B8' }}>W{i + 1}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={{ fontSize: 13, color: '#475569' }}>
              {t(isHi, 'Time Efficiency', 'समय दक्षता')}: <strong>{(monthlyData.timeEfficiency ?? 0).toFixed(2)} {t(isHi, 'questions/min', 'प्रश्न/मिनट')}</strong>
            </div>
          </div>

          {/* Study Consistency */}
          <div style={cardStyle}>
            <h3 style={cardTitle}>{t(isHi, 'Study Consistency', 'अध्ययन नियमितता')}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 10 }}>
              <div style={{ textAlign: 'center', padding: 10, backgroundColor: '#F8FAFC', borderRadius: 10 }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#16A34A' }}>{monthlyData.studyConsistencyPct ?? 0}%</div>
                <div style={{ fontSize: 10, color: '#64748B' }}>{t(isHi, 'Consistency', 'नियमितता')}</div>
              </div>
              <div style={{ textAlign: 'center', padding: 10, backgroundColor: '#F8FAFC', borderRadius: 10 }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#0891B2' }}>{monthlyData.totalStudyMinutes ?? 0}m</div>
                <div style={{ fontSize: 10, color: '#64748B' }}>{t(isHi, 'Study Time', 'अध्ययन समय')}</div>
              </div>
              <div style={{ textAlign: 'center', padding: 10, backgroundColor: '#F8FAFC', borderRadius: 10 }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: '#7C3AED' }}>{monthlyData.totalQuestionsAttempted ?? 0}</div>
                <div style={{ fontSize: 10, color: '#64748B' }}>{t(isHi, 'Questions', 'प्रश्न')}</div>
              </div>
            </div>
          </div>

          {/* Improvements & Achievements */}
          {((monthlyData.improvementAreas && monthlyData.improvementAreas.length > 0) ||
            (monthlyData.achievements && monthlyData.achievements.length > 0)) && (
            <div style={cardStyle}>
              <h3 style={cardTitle}>{t(isHi, 'Improvements & Achievements', 'सुधार और उपलब्धियाँ')}</h3>
              {monthlyData.achievements && monthlyData.achievements.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  {monthlyData.achievements.map((a: string, i: number) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 14 }}>{'\u2705'}</span>
                      <span style={{ fontSize: 13, color: '#1E293B' }}>{a}</span>
                    </div>
                  ))}
                </div>
              )}
              {monthlyData.improvementAreas && monthlyData.improvementAreas.length > 0 && (
                <div>
                  {monthlyData.improvementAreas.map((a: string, i: number) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 14 }}>{'\uD83D\uDCA1'}</span>
                      <span style={{ fontSize: 13, color: '#475569' }}>{a}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Download PDF */}
          <div className="no-print" style={{ textAlign: 'center', marginTop: 12 }}>
            <button onClick={handlePrintMonthly} style={{
              padding: '12px 28px', backgroundColor: '#16A34A', color: '#fff',
              border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 700,
              cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8,
            }}>
              {'\uD83D\uDDA8\uFE0F'} {t(isHi, 'Download PDF', 'PDF डाउनलोड करें')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================
// CHILD SELECTOR
// ============================================================
function ChildSelector({ childList, selectedId, onSelect }: {
  childList: Array<{ id: string; name: string; grade?: string }>;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  if (childList.length <= 1) return null;
  return (
    <div className="no-print" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, marginBottom: 12 }}>
      {childList.map((child) => (
        <button
          key={child.id}
          onClick={() => onSelect(child.id)}
          style={{
            padding: '8px 16px',
            borderRadius: 12,
            border: selectedId === child.id ? '2px solid #16A34A' : '1px solid #E2E8F0',
            backgroundColor: selectedId === child.id ? '#F0FDF4' : '#FFFFFF',
            color: selectedId === child.id ? '#16A34A' : '#475569',
            fontSize: 13,
            fontWeight: selectedId === child.id ? 700 : 500,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            transition: 'all 0.2s',
          }}
        >
          {child.name}{child.grade ? ` (${child.grade})` : ''}
        </button>
      ))}
    </div>
  );
}

// ============================================================
// MAIN REPORT PAGE
// ============================================================
export default function ParentReportsPage() {
  const auth = useAuth();
  const isHi = auth.isHi ?? false;
  const [guardian, setGuardian] = useState<ReportParentSession | null>(null);
  const [student, setStudent] = useState<ReportStudentSession | null>(null);
  const [children, setChildren] = useState<Array<{ id: string; name: string; grade?: string }>>([]);
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<ReportData | null>(null);
  const [scoreTrends, setScoreTrends] = useState<ScoreTrendEntry[]>([]);
  const [error, setError] = useState('');
  const [dateRange, setDateRange] = useState<'week' | 'month' | 'all'>('week');
  const [viewMode, setViewMode] = useState<'weekly' | 'monthly'>('weekly');
  const hasFetched = useRef(false);

  // Auth: resolve guardian + student + children list
  useEffect(() => {
    if (auth.isLoading) return;

    const resolveSession = async (g: ReportParentSession | null, s: ReportStudentSession | null) => {
      setGuardian(g);
      setStudent(s);
      // Load all children for this guardian
      if (g?.id) {
        try {
          const res = await api('get_children', { guardian_id: g.id });
          if (res?.children && Array.isArray(res.children)) {
            setChildren(res.children);
          } else if (s) {
            setChildren([{ id: s.id, name: s.name, grade: s.grade }]);
          }
        } catch {
          if (s) setChildren([{ id: s.id, name: s.name, grade: s.grade }]);
        }
      }
      setChecking(false);
    };

    if (auth.guardian) {
      loadParentSession().then(session => {
        resolveSession(auth.guardian, session?.student ?? null);
      });
      return;
    }

    loadParentSession().then(session => {
      if (session) {
        resolveSession(session.guardian, session.student);
      } else {
        setChecking(false);
      }
    });
  }, [auth.isLoading, auth.guardian]);

  // Handle child selection
  const handleSelectChild = (childId: string) => {
    const child = children.find(c => c.id === childId);
    if (child) setStudent({ id: child.id, name: child.name, grade: child.grade || '' });
  };

  // Auth guard: redirect if not logged in
  useEffect(() => {
    if (checking || auth.isLoading) return;
    if (!guardian && !student) {
      window.location.href = '/';
    }
  }, [checking, auth.isLoading, guardian, student]);

  // Fetch report data
  const fetchReport = useCallback(async () => {
    if (!guardian || !student) return;
    setLoading(true);
    setError('');
    try {
      const res = await api('get_child_dashboard', {
        guardian_id: guardian.id,
        student_id: student.id,
        date_range: dateRange,
      });
      if (res.error) {
        setError(res.error);
      } else {
        setReport(res);
      }
    } catch (err) {
      setError(isHi ? 'रिपोर्ट लोड नहीं हो सकी। कृपया बाद में फिर कोशिश करें।' : 'Could not load report. Please try again later.');
    }

    // Fetch Performance Score trends from score_history + performance_scores
    // RLS handles parent access via guardian_student_links policies
    try {
      // Get current scores
      const { data: currentScores } = await supabase
        .from('performance_scores')
        .select('subject, overall_score, level_name')
        .eq('student_id', student.id);

      if (currentScores && currentScores.length > 0) {
        // Get previous week scores for trend comparison
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        const twoWeeksAgo = new Date();
        twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

        const { data: histData } = await supabase
          .from('score_history')
          .select('subject, score, recorded_at')
          .eq('student_id', student.id)
          .gte('recorded_at', twoWeeksAgo.toISOString().split('T')[0])
          .lt('recorded_at', oneWeekAgo.toISOString().split('T')[0])
          .order('recorded_at', { ascending: false });

        // Build a map of previous week's latest score per subject
        const prevScoreMap: Record<string, number> = {};
        if (histData) {
          for (const row of histData) {
            const subj = String(row.subject);
            // Take the first (most recent) entry per subject
            if (!(subj in prevScoreMap)) {
              prevScoreMap[subj] = Number(row.score);
            }
          }
        }

        const trends: ScoreTrendEntry[] = currentScores.map((cs: Record<string, unknown>) => {
          const subject = String(cs.subject || '');
          const currentScore = Number(cs.overall_score ?? 0);
          const prev = prevScoreMap[subject];
          return {
            subject,
            currentScore: Math.round(currentScore),
            previousScore: prev != null ? Math.round(prev) : null,
            levelName: String(cs.level_name || getLevelFromScore(currentScore)),
          };
        });
        setScoreTrends(trends);
      } else {
        setScoreTrends([]);
      }
    } catch {
      // Non-fatal: score trends are additive
      setScoreTrends([]);
    }

    setLoading(false);
  }, [guardian, student, dateRange, isHi]);

  useEffect(() => {
    if (guardian && student) {
      fetchReport();
    }
  }, [fetchReport, guardian, student]);

  // Print styles
  const printStyles = `
    @media print {
      body { background: #fff !important; }
      .no-print { display: none !important; }
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  `;

  // Loading state
  if (checking || auth.isLoading) {
    return (
      <div style={pageStyle}>
        <style>{printStyles}</style>
        <div style={{ textAlign: 'center', padding: 80, color: '#64748B' }}>
          <div style={{ width: 40, height: 40, border: '3px solid #E2E8F0', borderTopColor: '#16A34A', borderRadius: '50%', margin: '0 auto 16px', animation: 'spin 0.8s linear infinite' }} />
          {t(isHi, 'Loading...', 'लोड हो रहा है...')}
        </div>
      </div>
    );
  }

  if (!guardian || !student) {
    return (
      <div style={pageStyle}>
        <style>{printStyles}</style>
        <div style={{ textAlign: 'center', padding: 80, color: '#64748B' }}>{t(isHi, 'Redirecting...', 'रीडायरेक्ट हो रहा है...')}</div>
      </div>
    );
  }

  const stats = report?.stats || {};
  const subjects = report?.subjects || [];
  const dailyActivity = report?.dailyActivity || [];
  const concepts = report?.concepts || report?.bktMastery?.concepts || [];
  const quizzes = report?.quizHistory || report?.recentQuizzes || [];
  const insights = report?.insights || [];
  const tips = report?.parentTips || report?.tips || [];

  // Determine most active day
  let mostActiveDay = '';
  if (dailyActivity.length > 0) {
    let maxXp = 0;
    dailyActivity.forEach((d: DayActivity) => {
      if ((d.xp || 0) > maxXp) {
        maxXp = d.xp || 0;
        mostActiveDay = d.label || d.day || '';
      }
    });
  }

  // Compute active days count
  const activeDays = dailyActivity.filter((d: DayActivity) => d.quizzes > 0 || d.xp > 0).length;

  // Trend arrow for accuracy
  const accuracyTrend = stats.accuracyTrend || stats.trend || null;

  return (
    <div style={pageStyle}>
      <style>{printStyles}</style>

      {/* ── HEADER ── */}
      <div style={{
        background: 'linear-gradient(135deg, #16A34A, #15803D)',
        padding: '28px 22px 22px',
        borderRadius: '0 0 24px 24px',
        marginBottom: 20,
        color: '#FFFFFF',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 6px', color: '#FFFFFF' }}>
              {'\uD83D\uDCCA'} {t(isHi, 'Learning Report', 'लर्निंग रिपोर्ट')}
            </h1>
            <div style={{ fontSize: 16, fontWeight: 600, opacity: 0.95 }}>{student.name}</div>
            <div style={{ fontSize: 13, opacity: 0.8, marginTop: 2 }}>{t(isHi, 'Grade', 'कक्षा')} {student.grade}</div>
          </div>
          <a href="/parent" className="no-print" style={{
            padding: '8px 14px', backgroundColor: 'rgba(255,255,255,0.2)',
            color: '#fff', border: 'none', borderRadius: 8,
            fontSize: 12, fontWeight: 600, cursor: 'pointer', textDecoration: 'none',
          }}>
            {'\u2190'} {t(isHi, 'Dashboard', 'डैशबोर्ड')}
          </a>
        </div>

        {/* View mode toggle */}
        <div className="no-print" style={{ display: 'flex', gap: 8, marginTop: 16, marginBottom: 8 }}>
          <button
            onClick={() => setViewMode('weekly')}
            style={{
              padding: '7px 16px',
              backgroundColor: viewMode === 'weekly' ? '#FFFFFF' : 'rgba(255,255,255,0.15)',
              color: viewMode === 'weekly' ? '#15803D' : 'rgba(255,255,255,0.9)',
              border: 'none', borderRadius: 20, fontSize: 13,
              fontWeight: viewMode === 'weekly' ? 700 : 500,
              cursor: 'pointer', transition: 'all 0.2s',
            }}
          >
            {t(isHi, 'Weekly / Range', 'साप्ताहिक / अवधि')}
          </button>
          <button
            onClick={() => setViewMode('monthly')}
            style={{
              padding: '7px 16px',
              backgroundColor: viewMode === 'monthly' ? '#FFFFFF' : 'rgba(255,255,255,0.15)',
              color: viewMode === 'monthly' ? '#15803D' : 'rgba(255,255,255,0.9)',
              border: 'none', borderRadius: 20, fontSize: 13,
              fontWeight: viewMode === 'monthly' ? 700 : 500,
              cursor: 'pointer', transition: 'all 0.2s',
            }}
          >
            {t(isHi, 'Monthly Report', 'मासिक रिपोर्ट')}
          </button>
        </div>

        {/* Date range selector (only in weekly mode) */}
        {viewMode === 'weekly' && (
          <div className="no-print" style={{ display: 'flex', gap: 8 }}>
            {([
              { key: 'week' as const, label: t(isHi, 'This Week', 'इस सप्ताह') },
              { key: 'month' as const, label: t(isHi, 'This Month', 'इस महीने') },
              { key: 'all' as const, label: t(isHi, 'All Time', 'सभी समय') },
            ]).map(opt => (
              <button
                key={opt.key}
                onClick={() => setDateRange(opt.key)}
                style={{
                  padding: '7px 16px',
                  backgroundColor: dateRange === opt.key ? '#FFFFFF' : 'rgba(255,255,255,0.15)',
                  color: dateRange === opt.key ? '#15803D' : 'rgba(255,255,255,0.9)',
                  border: 'none',
                  borderRadius: 20,
                  fontSize: 13,
                  fontWeight: dateRange === opt.key ? 700 : 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: '0 16px' }}>
        {/* ── CHILD SELECTOR ── */}
        <ChildSelector
          childList={children}
          selectedId={student?.id ?? ''}
          onSelect={handleSelectChild}
        />

        {/* ── MONTHLY REPORT VIEW ── */}
        {viewMode === 'monthly' && guardian && student && (
          <MonthlyReportSection
            guardianId={guardian.id}
            studentId={student.id}
            studentName={student.name}
            isHi={isHi}
          />
        )}

        {/* ── WEEKLY / RANGE VIEW ── */}
        {viewMode === 'weekly' && loading && (
          <div style={{ textAlign: 'center', padding: 60, color: '#64748B' }}>
            <div style={{ width: 36, height: 36, border: '3px solid #E2E8F0', borderTopColor: '#16A34A', borderRadius: '50%', margin: '0 auto 14px', animation: 'spin 0.8s linear infinite' }} />
            {t(isHi, `Loading ${student.name}'s report...`, `${student.name} की रिपोर्ट लोड हो रही है...`)}
          </div>
        )}

        {viewMode === 'weekly' && error && !loading && (
          <div style={{ ...cardStyle, textAlign: 'center', color: '#EF4444' }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>{'\uD83D\uDE1F'}</div>
            <p style={{ fontSize: 15, fontWeight: 600 }}>{error}</p>
            <button onClick={fetchReport} style={{
              marginTop: 12, padding: '8px 20px', backgroundColor: '#16A34A',
              color: '#fff', border: 'none', borderRadius: 8, fontSize: 13,
              fontWeight: 600, cursor: 'pointer',
            }}>{t(isHi, 'Try Again', 'फिर से कोशिश करें')}</button>
          </div>
        )}

        {viewMode === 'weekly' && !loading && !error && (
          <>
            {/* ── 1. PERFORMANCE SUMMARY CARDS ── */}
            <div style={{ marginBottom: 20 }}>
              <div style={sectionHeading}>{t(isHi, 'Performance Summary', 'प्रदर्शन सारांश')}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                <SummaryCard
                  icon={'\uD83C\uDFAF'}
                  label={t(isHi, 'Overall Mastery', 'कुल महारत')}
                  value={`${stats.overallMastery ?? stats.accuracy ?? 0}%`}
                  ringColor={getScoreColor(stats.overallMastery ?? stats.accuracy ?? 0)}
                />
                <SummaryCard
                  icon={'\uD83D\uDD25'}
                  label={t(isHi, 'Consistency', 'नियमितता')}
                  value={`${stats.streak ?? 0} ${t(isHi, 'days', 'दिन')}`}
                  sub={t(isHi, `Active ${activeDays} of last 7 days`, `पिछले 7 दिनों में ${activeDays} दिन सक्रिय`)}
                />
                <SummaryCard
                  icon={accuracyTrend === 'up' ? '\u2B06\uFE0F' : accuracyTrend === 'down' ? '\u2B07\uFE0F' : '\uD83C\uDFAF'}
                  label={t(isHi, 'Accuracy', 'सटीकता')}
                  value={`${stats.accuracy ?? stats.avgScore ?? 0}%`}
                  sub={accuracyTrend === 'up' ? t(isHi, 'Trending up!', 'बढ़ रहा है!') : accuracyTrend === 'down' ? t(isHi, 'Needs focus', 'ध्यान चाहिए') : undefined}
                />
                <SummaryCard
                  icon={'\u2728'}
                  label="XP"
                  value={`${stats.xp ?? 0}`}
                  sub={t(isHi, 'Keep it up!', 'ऐसे ही करते रहो!')}
                />
              </div>
            </div>

            {/* ── 1b. PERFORMANCE SCORE TRENDS ── */}
            {scoreTrends.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={sectionHeading}>{t(isHi, 'Performance Score', 'प्रदर्शन स्कोर')}</div>
                <PerformanceScoreTrends trends={scoreTrends} isHi={isHi} />
              </div>
            )}

            {/* ── 2. SUBJECT-WISE PERFORMANCE ── */}
            <div style={{ marginBottom: 20 }}>
              <div style={sectionHeading}>{t(isHi, 'Subject Performance', 'विषय प्रदर्शन')}</div>
              {subjects.length > 0 ? (
                subjects.map((subj: SubjectData, i: number) => (
                  <SubjectCard key={i} subject={subj} isHi={isHi} />
                ))
              ) : (
                <div style={cardStyle}>
                  <p style={emptyText}>
                    {t(isHi, "Your child hasn't started any subjects yet. Encourage them to explore and take their first quiz!", 'आपके बच्चे ने अभी तक कोई विषय शुरू नहीं किया है। उन्हें अपनी पहली क्विज़ देने के लिए प्रोत्साहित करें!')}
                  </p>
                </div>
              )}
            </div>

            {/* ── 3. WEEKLY ACTIVITY TIMELINE ── */}
            {dailyActivity.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={sectionHeading}>{t(isHi, 'Weekly Activity', 'साप्ताहिक गतिविधि')}</div>
                <WeeklyTimeline days={dailyActivity} mostActiveDay={mostActiveDay} isHi={isHi} />
              </div>
            )}

            {/* ── 4. CONCEPT MASTERY MAP ── */}
            <div style={{ marginBottom: 20 }}>
              <div style={sectionHeading}>{t(isHi, 'Concept Mastery', 'अवधारणा महारत')}</div>
              <ConceptMasteryMap concepts={concepts} isHi={isHi} />
            </div>

            {/* ── 5. QUIZ HISTORY ── */}
            <div style={{ marginBottom: 20 }}>
              <div style={sectionHeading}>{t(isHi, 'Quiz History', 'क्विज़ इतिहास')}</div>
              <QuizHistory quizzes={quizzes} isHi={isHi} />
            </div>

            {/* ── 6. INSIGHTS & RECOMMENDATIONS ── */}
            <div style={{ marginBottom: 20 }}>
              <div style={sectionHeading}>{t(isHi, 'For You', 'आपके लिए')}</div>
              <InsightsSection insights={insights} tips={tips} isHi={isHi} />
            </div>

            {/* ── 7. PRINT / SHARE ── */}
            <PrintShareSection studentName={student.name} grade={student.grade} reportData={report} isHi={isHi} />

            {/* Footer */}
            <p style={{ textAlign: 'center', fontSize: 11, color: '#94A3B8', margin: '24px 0 8px' }}>
              Alfanumrik Learning OS | {t(isHi, 'Learning Report', 'लर्निंग रिपोर्ट')} | {student.name}, {t(isHi, 'Grade', 'कक्षा')} {student.grade}
            </p>
          </>
        )}
      </div>
      <BottomNav />
    </div>
  );
}
