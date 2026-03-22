'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/AuthContext';

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SB_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const SESSION_KEY = 'alfanumrik_parent_session';
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

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

async function loadParentSession(): Promise<{ guardian: any; student: any } | null> {
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

function getMasteryLabel(level: string): string {
  switch (level) {
    case 'mastered': return 'Mastered';
    case 'proficient': return 'Proficient';
    case 'familiar': return 'Familiar';
    case 'developing': return 'Developing';
    default: return 'Not Started';
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

const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
function SubjectCard({ subject }: { subject: any }) {
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
            Last quiz: {subject.recentScore}%
          </span>
        )}
      </div>

      {/* Mastery bar */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 12, color: '#64748B' }}>Mastery</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: barColor }}>{mastery}%</span>
        </div>
        <div style={{ height: 10, backgroundColor: '#F1F5F9', borderRadius: 5, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${mastery}%`, backgroundColor: barColor, borderRadius: 5, transition: 'width 0.5s ease' }} />
        </div>
      </div>

      {/* Topics count */}
      {subject.topicsMastered != null && subject.totalTopics != null && (
        <div style={{ fontSize: 13, color: '#475569', marginBottom: 8 }}>
          {subject.topicsMastered} of {subject.totalTopics} topics mastered
        </div>
      )}

      {/* Strong / Weak topics */}
      {subject.strongTopics && subject.strongTopics.length > 0 && (
        <div style={{ fontSize: 13, color: '#16A34A', marginBottom: 4 }}>
          Strong in: {subject.strongTopics.join(', ')}
        </div>
      )}
      {subject.weakTopics && subject.weakTopics.length > 0 && (
        <div style={{ fontSize: 13, color: '#D97706' }}>
          Needs practice: {subject.weakTopics.join(', ')}
        </div>
      )}
    </div>
  );
}

// ============================================================
// WEEKLY ACTIVITY TIMELINE
// ============================================================
function WeeklyTimeline({ days, mostActiveDay }: { days: any[]; mostActiveDay?: string }) {
  return (
    <div style={cardStyle}>
      <h3 style={cardTitle}>Weekly Activity Timeline</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
        {days.map((day: any, i: number) => {
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
                  <div style={{ fontSize: 9, color: '#64748B' }}>quizzes</div>
                  {day.studyTime != null && (
                    <div style={{ fontSize: 9, color: '#64748B', marginTop: 2 }}>{formatTime(day.studyTime)}</div>
                  )}
                  <div style={{ fontSize: 10, color: '#F59E0B', fontWeight: 600, marginTop: 3 }}>+{day.xp} XP</div>
                </>
              ) : (
                <div style={{ fontSize: 10, color: '#CBD5E1', marginTop: 8 }}>Rest day</div>
              )}
            </div>
          );
        })}
      </div>
      {mostActiveDay && (
        <div style={{ fontSize: 13, color: '#16A34A', marginTop: 12, textAlign: 'center', fontWeight: 600 }}>
          Your child was most active on {mostActiveDay}!
        </div>
      )}
    </div>
  );
}

// ============================================================
// CONCEPT MASTERY MAP
// ============================================================
function ConceptMasteryMap({ concepts }: { concepts: any[] }) {
  if (!concepts || concepts.length === 0) {
    return (
      <div style={cardStyle}>
        <h3 style={cardTitle}>Concept Mastery Map</h3>
        <p style={emptyText}>Your child hasn&apos;t started exploring concepts yet. Encourage them to take a few quizzes to see their mastery map grow!</p>
      </div>
    );
  }

  // Group by subject
  const grouped: Record<string, any[]> = {};
  concepts.forEach((c: any) => {
    const subj = c.subject || 'General';
    if (!grouped[subj]) grouped[subj] = [];
    grouped[subj].push(c);
  });

  return (
    <div style={cardStyle}>
      <h3 style={cardTitle}>Concept Mastery Map</h3>

      {/* Legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Mastered', color: '#16A34A' },
          { label: 'Proficient', color: '#7C3AED' },
          { label: 'Familiar', color: '#2563EB' },
          { label: 'Developing', color: '#D97706' },
          { label: 'Not Started', color: '#CBD5E1' },
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
            {items.map((c: any, i: number) => (
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
                  {getMasteryLabel(c.level)}
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
function QuizHistory({ quizzes }: { quizzes: any[] }) {
  if (!quizzes || quizzes.length === 0) {
    return (
      <div style={cardStyle}>
        <h3 style={cardTitle}>Recent Quiz History</h3>
        <p style={emptyText}>No quizzes completed yet. When your child takes quizzes, their results will appear here!</p>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <h3 style={cardTitle}>Recent Quiz History</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {quizzes.slice(0, 10).map((q: any, i: number) => {
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
function InsightsSection({ insights, tips }: { insights: any[]; tips: any[] }) {
  return (
    <div style={cardStyle}>
      <h3 style={cardTitle}>Insights &amp; Recommendations</h3>

      {insights && insights.length > 0 ? (
        <div style={{ marginBottom: 16 }}>
          {insights.map((insight: any, i: number) => (
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
          Keep encouraging your child to practice! Insights will appear as they make progress.
        </p>
      )}

      {/* How to Help at Home */}
      <div style={{ marginTop: 8 }}>
        <div style={{ ...sectionHeading, color: '#15803D', fontSize: 13 }}>How to Help at Home</div>
        {tips && tips.length > 0 ? (
          tips.map((tip: any, i: number) => (
            <div key={i} style={{
              display: 'flex', gap: 10, padding: '10px 0',
              borderBottom: i < tips.length - 1 ? '1px solid #F1F5F9' : 'none',
            }}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>{tip.icon || '\uD83D\uDCA1'}</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#1E293B' }}>{tip.title || `Tip ${i + 1}`}</div>
                <div style={{ fontSize: 13, color: '#64748B', marginTop: 2, lineHeight: 1.5 }}>{typeof tip === 'string' ? tip : tip.description || tip.text || ''}</div>
              </div>
            </div>
          ))
        ) : (
          <div style={{ fontSize: 13, color: '#64748B', lineHeight: 1.6 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}><span>\uD83D\uDCDA</span><span>Set aside 15-20 minutes daily for focused learning time.</span></div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}><span>\uD83C\uDFC6</span><span>Celebrate small wins and streaks to keep motivation high.</span></div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}><span>\uD83D\uDDE3\uFE0F</span><span>Ask your child to explain what they learned today - teaching reinforces learning.</span></div>
            <div style={{ display: 'flex', gap: 8 }}><span>\uD83C\uDF1F</span><span>Focus on progress, not perfection. Every attempt is a step forward!</span></div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// PRINT / SHARE SECTION
// ============================================================
function PrintShareSection({ studentName, reportData }: { studentName: string; reportData: any }) {
  const handlePrint = () => {
    window.print();
  };

  const handleWhatsApp = () => {
    const stats = reportData?.stats || {};
    const subjects = reportData?.subjects || [];
    const subjectSummary = subjects.map((s: any) =>
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
      <h3 style={{ ...cardTitle, textAlign: 'center' }}>Share This Report</h3>
      <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
        <button onClick={handlePrint} style={{
          padding: '12px 24px', backgroundColor: '#16A34A', color: '#fff',
          border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 700,
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span>\uD83D\uDDA8\uFE0F</span> Print Report
        </button>
        <button onClick={handleWhatsApp} style={{
          padding: '12px 24px', backgroundColor: '#25D366', color: '#fff',
          border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 700,
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span>\uD83D\uDCF1</span> Share via WhatsApp
        </button>
      </div>
    </div>
  );
}

// ============================================================
// MAIN REPORT PAGE
// ============================================================
export default function ParentReportsPage() {
  const auth = useAuth();
  const [guardian, setGuardian] = useState<any>(null);
  const [student, setStudent] = useState<any>(null);
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<any>(null);
  const [error, setError] = useState('');
  const [dateRange, setDateRange] = useState<'week' | 'month' | 'all'>('week');
  const hasFetched = useRef(false);

  // Auth: resolve guardian + student
  useEffect(() => {
    if (auth.isLoading) return;

    if (auth.guardian) {
      setGuardian(auth.guardian);
      loadParentSession().then(session => {
        if (session) setStudent(session.student);
        setChecking(false);
      });
      return;
    }

    loadParentSession().then(session => {
      if (session) {
        setGuardian(session.guardian);
        setStudent(session.student);
      }
      setChecking(false);
    });
  }, [auth.isLoading, auth.guardian]);

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
      setError('Could not load report. Please try again later.');
    }
    setLoading(false);
  }, [guardian, student, dateRange]);

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
          Loading...
        </div>
      </div>
    );
  }

  if (!guardian || !student) {
    return (
      <div style={pageStyle}>
        <style>{printStyles}</style>
        <div style={{ textAlign: 'center', padding: 80, color: '#64748B' }}>Redirecting...</div>
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
    dailyActivity.forEach((d: any) => {
      if ((d.xp || 0) > maxXp) {
        maxXp = d.xp || 0;
        mostActiveDay = d.label || d.day || '';
      }
    });
  }

  // Compute active days count
  const activeDays = dailyActivity.filter((d: any) => d.quizzes > 0 || d.xp > 0).length;

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
              {'\uD83D\uDCCA'} Learning Report
            </h1>
            <div style={{ fontSize: 16, fontWeight: 600, opacity: 0.95 }}>{student.name}</div>
            <div style={{ fontSize: 13, opacity: 0.8, marginTop: 2 }}>Grade {student.grade}</div>
          </div>
          <a href="/parent" className="no-print" style={{
            padding: '8px 14px', backgroundColor: 'rgba(255,255,255,0.2)',
            color: '#fff', border: 'none', borderRadius: 8,
            fontSize: 12, fontWeight: 600, cursor: 'pointer', textDecoration: 'none',
          }}>
            {'\u2190'} Dashboard
          </a>
        </div>

        {/* Date range selector */}
        <div className="no-print" style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          {([
            { key: 'week' as const, label: 'This Week' },
            { key: 'month' as const, label: 'This Month' },
            { key: 'all' as const, label: 'All Time' },
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
      </div>

      <div style={{ padding: '0 16px' }}>
        {/* ── LOADING / ERROR ── */}
        {loading && (
          <div style={{ textAlign: 'center', padding: 60, color: '#64748B' }}>
            <div style={{ width: 36, height: 36, border: '3px solid #E2E8F0', borderTopColor: '#16A34A', borderRadius: '50%', margin: '0 auto 14px', animation: 'spin 0.8s linear infinite' }} />
            Loading {student.name}&apos;s report...
          </div>
        )}

        {error && !loading && (
          <div style={{ ...cardStyle, textAlign: 'center', color: '#EF4444' }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>{'\uD83D\uDE1F'}</div>
            <p style={{ fontSize: 15, fontWeight: 600 }}>{error}</p>
            <button onClick={fetchReport} style={{
              marginTop: 12, padding: '8px 20px', backgroundColor: '#16A34A',
              color: '#fff', border: 'none', borderRadius: 8, fontSize: 13,
              fontWeight: 600, cursor: 'pointer',
            }}>Try Again</button>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* ── 1. PERFORMANCE SUMMARY CARDS ── */}
            <div style={{ marginBottom: 20 }}>
              <div style={sectionHeading}>Performance Summary</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                <SummaryCard
                  icon={'\uD83C\uDFAF'}
                  label="Overall Mastery"
                  value={`${stats.overallMastery ?? stats.accuracy ?? 0}%`}
                  ringColor={getScoreColor(stats.overallMastery ?? stats.accuracy ?? 0)}
                />
                <SummaryCard
                  icon={'\uD83D\uDD25'}
                  label="Consistency"
                  value={`${stats.streak ?? 0} days`}
                  sub={`Active ${activeDays} of last 7 days`}
                />
                <SummaryCard
                  icon={accuracyTrend === 'up' ? '\u2B06\uFE0F' : accuracyTrend === 'down' ? '\u2B07\uFE0F' : '\uD83C\uDFAF'}
                  label="Accuracy"
                  value={`${stats.accuracy ?? stats.avgScore ?? 0}%`}
                  sub={accuracyTrend === 'up' ? 'Trending up!' : accuracyTrend === 'down' ? 'Needs focus' : undefined}
                />
                <SummaryCard
                  icon={'\u2728'}
                  label="XP Earned"
                  value={`${stats.xp ?? 0}`}
                  sub="Keep it up!"
                />
              </div>
            </div>

            {/* ── 2. SUBJECT-WISE PERFORMANCE ── */}
            <div style={{ marginBottom: 20 }}>
              <div style={sectionHeading}>Subject Performance</div>
              {subjects.length > 0 ? (
                subjects.map((subj: any, i: number) => (
                  <SubjectCard key={i} subject={subj} />
                ))
              ) : (
                <div style={cardStyle}>
                  <p style={emptyText}>
                    Your child hasn&apos;t started any subjects yet. Encourage them to explore and take their first quiz!
                  </p>
                </div>
              )}
            </div>

            {/* ── 3. WEEKLY ACTIVITY TIMELINE ── */}
            {dailyActivity.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={sectionHeading}>Weekly Activity</div>
                <WeeklyTimeline days={dailyActivity} mostActiveDay={mostActiveDay} />
              </div>
            )}

            {/* ── 4. CONCEPT MASTERY MAP ── */}
            <div style={{ marginBottom: 20 }}>
              <div style={sectionHeading}>Concept Mastery</div>
              <ConceptMasteryMap concepts={concepts} />
            </div>

            {/* ── 5. QUIZ HISTORY ── */}
            <div style={{ marginBottom: 20 }}>
              <div style={sectionHeading}>Quiz History</div>
              <QuizHistory quizzes={quizzes} />
            </div>

            {/* ── 6. INSIGHTS & RECOMMENDATIONS ── */}
            <div style={{ marginBottom: 20 }}>
              <div style={sectionHeading}>For You</div>
              <InsightsSection insights={insights} tips={tips} />
            </div>

            {/* ── 7. PRINT / SHARE ── */}
            <PrintShareSection studentName={student.name} reportData={report} />

            {/* Footer */}
            <p style={{ textAlign: 'center', fontSize: 11, color: '#94A3B8', margin: '24px 0 8px' }}>
              Alfanumrik Learning OS | Learning Report | {student.name}, Grade {student.grade}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
