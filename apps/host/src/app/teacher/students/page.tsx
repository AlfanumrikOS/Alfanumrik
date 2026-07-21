'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@alfanumrik/lib/supabase';
import { authHeader } from '@alfanumrik/lib/api/auth-header';
import { usePermissions } from '@alfanumrik/lib/usePermissions';
import { usePulse } from '@alfanumrik/lib/pulse/use-pulse';
import { StudentPulse } from '@alfanumrik/ui/pulse';
import { SectionErrorBoundary } from '@alfanumrik/ui/SectionErrorBoundary';
import { Bone, TeacherTableSkeleton } from '@alfanumrik/ui/Skeleton';

// ============================================================
// BILINGUAL HELPERS (P7)
// ============================================================
const tt = (isHi: boolean, en: string, hi: string) => isHi ? hi : en;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

async function api(action: string, params: Record<string, unknown> = {}) {
  // Build headers — always include apikey; add Bearer token when a session
  // exists so teacher-dashboard can authenticate the caller via JWT (P13).
  // Pattern mirrors src/app/teacher/page.tsx api() helper.
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON,
  };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
  } catch { /* no session — request will be rejected by Edge Function */ }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/teacher-dashboard`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, ...params }),
  });
  if (!res.ok) {
    const errorText = await res.text().catch(() => 'Unknown error');
    throw new Error(`API error ${res.status}: ${errorText}`);
  }
  return res.json();
}

/* ─── Types ─── */
interface StudentData {
  id: string;
  class_id: string;
  name: string;
  grade: string;
  xp: number | null;
  streak: number | null;
  mastery: number | null;
  accuracy: number | null;
  subjects?: SubjectBreakdown[];
  recent_scores?: number[];
  strengths?: string[];
  improvements?: string[];
}

interface SubjectBreakdown {
  name: string;
  mastery: number;
  color: string;
}

interface ClassData {
  id: string;
  name: string;
  student_count: number;
  students?: Array<{
    id: string;
    class_id?: string;
    name: string;
    grade?: string | null;
    xp?: number | null;
    streak?: number | null;
    mastery?: number | null;
    accuracy?: number | null;
  }>;
}

/* ─── Helpers ─── */
const AVATAR_COLORS = ['#E8581C', '#7C3AED', '#059669', '#D97706', '#DC2626', '#0891B2', '#DB2777', '#4F46E5'];

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function accuracyColor(pct: number): string {
  if (pct > 80) return '#059669';
  if (pct >= 50) return '#D97706';
  return '#DC2626';
}

function finiteMetric(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function riskRank(student: StudentData): 0 | 1 | 2 {
  const observed = [student.mastery, student.accuracy].filter(
    (value): value is number => value !== null,
  );
  if (observed.some((value) => value < 30)) return 2;
  if (observed.some((value) => value < 50)) return 1;
  return 0;
}

function formatMetric(value: number | null, suffix = ''): string {
  return value === null ? '\u2014' : `${value.toLocaleString()}${suffix}`;
}

/* ─── Teacher Student Pulse (teacher single-student lens) ─── */
/** Renders one student's Pulse inside the expanded card. Gated by the host on
 *  can('class.view_analytics'); fetch is enabled only while expanded (id=undefined
 *  ⇒ no request). usePermissions is UX-only — /api/pulse/student/[id] enforces the
 *  teacher↔assigned-student boundary server-side (canAccessStudent). */
function TeacherStudentPulseSection({
  studentId,
  studentName,
  enabled,
  isHi,
}: {
  studentId: string;
  studentName: string;
  enabled: boolean;
  isHi: boolean;
}) {
  const { data, error, isLoading, mutate } = usePulse(enabled ? studentId : undefined);
  return (
    <div style={{ marginTop: 14 }}>
      <h4 style={{ fontSize: 13, fontWeight: 600, color: '#1A1207', margin: '0 0 10px' }}>
        🩺 {tt(isHi, 'Learning Pulse', 'सीखने का पल्स')}
      </h4>
      <StudentPulse
        variant="teacher"
        isHi={isHi}
        pulse={data}
        isLoading={isLoading}
        error={error}
        displayName={studentName}
        onRetry={() => mutate()}
      />
    </div>
  );
}

/* ─── Student Card ─── */
function StudentCard({
  student,
  teacherId,
  isHi,
  router,
  canViewAnalytics,
}: {
  student: StudentData;
  teacherId: string;
  isHi: boolean;
  router: ReturnType<typeof useRouter>;
  canViewAnalytics: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState('');
  const [goal, setGoal] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // T13 — Escalate to school admin (RCA follow-up).
  const [escalating, setEscalating] = useState(false);
  const [escalateNote, setEscalateNote] = useState('');
  const [escalateStatus, setEscalateStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [escalateError, setEscalateError] = useState<string | null>(null);

  const sendEscalation = async () => {
    if (!escalateNote.trim()) return;
    setEscalateStatus('sending');
    setEscalateError(null);
    try {
      const res = await fetch('/api/teacher/escalate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ student_id: student.id, note: escalateNote.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setEscalateStatus('sent');
      setEscalateNote('');
      setTimeout(() => {
        setEscalateStatus('idle');
        setEscalating(false);
      }, 2000);
    } catch (e: any) {
      setEscalateStatus('error');
      setEscalateError(e?.message || tt(isHi, 'Failed to escalate', 'एस्केलेट करने में विफल'));
    }
  };

  const saveNote = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/teacher/students/${student.id}/notes`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ note, customGoal: goal }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // Backend errors surface via UI elsewhere; note state already
      // reflects the latest edit, so we don't roll back the textarea.
    }
    setSaving(false);
  };

  const subjects: SubjectBreakdown[] = student.subjects ?? [];

  const recentScores = student.recent_scores || [];
  const strengths = student.strengths || [];
  const improvements = student.improvements || [];

  // Missing metrics are unknown, not low performance. Only observed values can
  // place a student in an intervention band.
  const studentRisk = riskRank(student);
  const isStruggling = studentRisk === 2;
  const needsAttention = studentRisk === 1;

  return (
    <div
      data-testid={`student-card-${student.id}-${student.class_id}`}
      style={{
        backgroundColor: '#FFFFFF',
        borderRadius: 14,
        border: isStruggling ? '1px solid #DC262666' : needsAttention ? '1px solid #D9770644' : '1px solid var(--surface-2)',
        overflow: 'hidden',
        transition: 'all 0.3s ease',
        position: 'relative',
      }}
    >
      {/* Struggling student indicator */}
      {isStruggling && (
        <div style={{
          backgroundColor: '#FCEEEE',
          borderBottom: '1px solid #DC262633',
          padding: '6px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, backgroundColor: '#DC2626', color: '#fff', textTransform: 'uppercase' }}>{tt(isHi, 'Needs help', 'मदद चाहिए')}</span>
          <span style={{ fontSize: 11, color: '#B91C1C' }}>{tt(isHi, 'Low mastery and accuracy — consider targeted revision', 'कम मास्टरी और सटीकता — लक्षित रिवीज़न पर विचार करें')}</span>
        </div>
      )}
      {needsAttention && !isStruggling && (
        <div style={{
          backgroundColor: '#FBEBD2',
          borderBottom: '1px solid #D9770633',
          padding: '6px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, backgroundColor: '#D97706', color: '#fff', textTransform: 'uppercase' }}>{tt(isHi, 'At risk', 'जोखिम में')}</span>
          <span style={{ fontSize: 11, color: '#9A5B16' }}>{tt(isHi, 'Below average — monitor closely', 'औसत से नीचे — ध्यान से देखें')}</span>
        </div>
      )}
      {/* Card Header */}
      <div style={{ padding: '16px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          {/* Avatar */}
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: '50%',
              backgroundColor: isStruggling ? '#DC2626' : avatarColor(student.name),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
              fontWeight: 700,
              color: '#fff',
              flexShrink: 0,
            }}
          >
            {student.name.charAt(0).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#1A1207', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {student.name}
            </h3>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#7D7264' }}>
              {tt(isHi, 'Grade', 'कक्षा')} {student.grade}
            </p>
          </div>
        </div>

        {/* Stats Row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
          <div style={{ backgroundColor: 'var(--surface-2)', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 10, color: '#7D7264', textTransform: 'uppercase', letterSpacing: 0.5 }}>XP</p>
            <p style={{ margin: '2px 0 0', fontSize: 16, fontWeight: 700, color: '#7C3AED' }}>{formatMetric(student.xp)}</p>
          </div>
          <div style={{ backgroundColor: 'var(--surface-2)', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 10, color: '#7D7264', textTransform: 'uppercase', letterSpacing: 0.5 }}>{tt(isHi, 'Streak', 'स्ट्रीक')}</p>
            <p style={{ margin: '2px 0 0', fontSize: 16, fontWeight: 700, color: '#F59E0B' }}>{formatMetric(student.streak, 'd')}</p>
          </div>
          <div style={{ backgroundColor: 'var(--surface-2)', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 10, color: '#7D7264', textTransform: 'uppercase', letterSpacing: 0.5 }}>{tt(isHi, 'Mastery', 'मास्टरी')}</p>
            <p style={{ margin: '2px 0 0', fontSize: 16, fontWeight: 700, color: 'var(--orange)' }}>{formatMetric(student.mastery, '%')}</p>
          </div>
        </div>

        {/* Accuracy */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: '#7D7264' }}>{tt(isHi, 'Accuracy', 'सटीकता')}:</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: student.accuracy === null ? '#7D7264' : accuracyColor(student.accuracy) }}>
            {formatMetric(student.accuracy, '%')}
          </span>
        </div>

        {/* Mastery Progress Bar */}
        <div style={{ backgroundColor: 'var(--surface-2)', borderRadius: 6, height: 6, overflow: 'hidden' }}>
          <div
            style={{
              width: `${student.mastery === null ? 0 : Math.min(student.mastery, 100)}%`,
              height: '100%',
              backgroundColor: 'var(--orange)',
              borderRadius: 6,
              transition: 'width 0.5s ease',
            }}
          />
        </div>

        {/* Action Row — View Details + Message Parent (Phase C.3) */}
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              flex: 1,
              padding: '8px 0',
              backgroundColor: expanded ? '#C2410C' : 'transparent',
              color: expanded ? '#fff' : '#E8581C',
              border: expanded ? 'none' : '1px solid #E8581C',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            {expanded ? tt(isHi, 'Hide Details', 'विवरण छुपाएं') : tt(isHi, 'View Details', 'विवरण देखें')}
          </button>
          <button
            onClick={() => router.push(`/teacher/messages?student=${encodeURIComponent(student.id)}`)}
            style={{
              flex: 1,
              padding: '8px 0',
              backgroundColor: 'transparent',
              color: '#7C3AED',
              border: '1px solid #7C3AED',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
            title={tt(isHi, 'Send a message to this student\'s parent', 'इस छात्र के अभिभावक को संदेश भेजें')}
          >
            ✉ {tt(isHi, 'Message Parent', 'संदेश भेजें')}
          </button>
        </div>

        {/* Escalate to school admin — only surfaced for flagged/at-risk students (T13) */}
        {(isStruggling || needsAttention) && (
          <div style={{ marginTop: 8 }}>
            {!escalating ? (
              <button
                onClick={() => setEscalating(true)}
                style={{
                  width: '100%',
                  padding: '8px 0',
                  backgroundColor: 'transparent',
                  color: '#DC2626',
                  border: '1px solid #DC262666',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
                title={tt(isHi, 'Raise this case with your school admin', 'इस मामले को अपने स्कूल एडमिन के पास भेजें')}
                data-testid={`escalate-cta-${student.id}`}
              >
                🚩 {tt(isHi, 'Escalate to school admin', 'स्कूल एडमिन को भेजें')}
              </button>
            ) : (
              <div style={{ padding: '10px', backgroundColor: '#FCEEEE', border: '1px solid #DC262633', borderRadius: 8 }}>
                <textarea
                  value={escalateNote}
                  onChange={(e) => setEscalateNote(e.target.value)}
                  placeholder={tt(isHi, 'Briefly describe the concern for the school admin...', 'स्कूल एडमिन के लिए संक्षेप में समस्या बताएं...')}
                  disabled={escalateStatus === 'sending' || escalateStatus === 'sent'}
                  style={{
                    width: '100%',
                    minHeight: 56,
                    padding: '8px 10px',
                    backgroundColor: '#fff',
                    border: '1px solid #EDE6DC',
                    borderRadius: 8,
                    color: '#1A1207',
                    fontSize: 13,
                    resize: 'vertical',
                    outline: 'none',
                    boxSizing: 'border-box',
                    fontFamily: "'Sora', system-ui, sans-serif",
                  }}
                />
                {escalateStatus === 'error' && escalateError && (
                  <p style={{ margin: '6px 0 0', fontSize: 12, color: '#DC2626' }}>{escalateError}</p>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button
                    onClick={sendEscalation}
                    disabled={escalateStatus === 'sending' || escalateStatus === 'sent' || !escalateNote.trim()}
                    data-testid={`escalate-send-${student.id}`}
                    style={{
                      flex: 1,
                      padding: '8px 0',
                      backgroundColor: escalateStatus === 'sent' ? '#059669' : '#DC2626',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: escalateStatus === 'sending' ? 'default' : 'pointer',
                      opacity: escalateStatus === 'sending' ? 0.6 : 1,
                    }}
                  >
                    {escalateStatus === 'sending'
                      ? tt(isHi, 'Sending...', 'भेज रहे हैं...')
                      : escalateStatus === 'sent'
                        ? tt(isHi, 'Sent!', 'भेज दिया!')
                        : tt(isHi, 'Send to school admin', 'स्कूल एडमिन को भेजें')}
                  </button>
                  <button
                    onClick={() => {
                      setEscalating(false);
                      setEscalateNote('');
                      setEscalateStatus('idle');
                      setEscalateError(null);
                    }}
                    disabled={escalateStatus === 'sending'}
                    style={{
                      flex: '0 0 auto',
                      padding: '8px 14px',
                      backgroundColor: 'transparent',
                      color: '#7D7264',
                      border: '1px solid #EDE6DC',
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {tt(isHi, 'Cancel', 'रद्द करें')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Expanded Details */}
      <div
        style={{
          maxHeight: expanded ? 600 : 0,
          overflow: 'hidden',
          transition: 'max-height 0.4s ease',
        }}
      >
        <div style={{ padding: '0 18px 18px', borderTop: '1px solid var(--surface-2)' }}>
          {/* Subject Breakdown */}
          <h4 style={{ fontSize: 13, fontWeight: 600, color: '#1A1207', margin: '14px 0 10px' }}>{tt(isHi, 'Subject Breakdown', 'विषयवार विवरण')}</h4>
          {subjects.length === 0 ? (
            <p style={{ fontSize: 13, color: '#7D7264', fontStyle: 'italic', margin: 0 }}>
              {tt(isHi, 'Subject breakdown not yet available', 'विषय डेटा उपलब्ध नहीं')}
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {subjects.map((subj) => (
                <div key={subj.name}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: '#7D7264' }}>{subj.name}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: subj.color }}>{Math.min(subj.mastery, 100)}%</span>
                  </div>
                  <div style={{ backgroundColor: 'var(--surface-2)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${Math.min(subj.mastery, 100)}%`,
                        height: '100%',
                        backgroundColor: subj.color,
                        borderRadius: 4,
                        transition: 'width 0.5s ease',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Recent Quiz Scores */}
          {recentScores.length > 0 && (
            <>
              <h4 style={{ fontSize: 13, fontWeight: 600, color: '#1A1207', margin: '14px 0 10px' }}>{tt(isHi, 'Recent Quiz Scores', 'हाल की क्विज़ स्कोर')}</h4>
              <div style={{ display: 'flex', gap: 6 }}>
                {recentScores.slice(-5).map((score, i) => (
                  <div
                    key={i}
                    style={{
                      flex: 1,
                      backgroundColor: 'var(--surface-2)',
                      borderRadius: 8,
                      padding: '8px 4px',
                      textAlign: 'center',
                    }}
                  >
                    <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: accuracyColor(score) }}>{score}%</p>
                    <p style={{ margin: '2px 0 0', fontSize: 10, color: '#A89B86' }}>{tt(isHi, `Quiz ${i + 1}`, `क्विज़ ${i + 1}`)}</p>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Strengths & Improvements */}
          {strengths.length > 0 && (
            <>
              <h4 style={{ fontSize: 13, fontWeight: 600, color: '#059669', margin: '14px 0 8px' }}>{tt(isHi, 'Strengths', 'मज़बूत पक्ष')}</h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {strengths.map((s, i) => (
                  <span key={i} style={{ fontSize: 11, padding: '4px 10px', backgroundColor: '#DDEFE3', color: '#1F7A4C', borderRadius: 99 }}>{s}</span>
                ))}
              </div>
            </>
          )}
          {improvements.length > 0 && (
            <>
              <h4 style={{ fontSize: 13, fontWeight: 600, color: '#D97706', margin: '14px 0 8px' }}>{tt(isHi, 'Areas for Improvement', 'सुधार के क्षेत्र')}</h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {improvements.map((s, i) => (
                  <span key={i} style={{ fontSize: 11, padding: '4px 10px', backgroundColor: '#FBEBD2', color: '#9A5B16', borderRadius: 99 }}>{s}</span>
                ))}
              </div>
            </>
          )}

          {/* Teacher Note */}
          <h4 style={{ fontSize: 13, fontWeight: 600, color: '#1A1207', margin: '14px 0 8px' }}>{tt(isHi, 'Teacher Note', 'शिक्षक नोट')}</h4>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={tt(isHi, 'Add a note about this student...', 'इस छात्र के बारे में नोट जोड़ें...')}
            style={{
              width: '100%',
              minHeight: 60,
              padding: '10px 12px',
              backgroundColor: 'var(--surface-2)',
              border: '1px solid #EDE6DC',
              borderRadius: 8,
              color: '#1A1207',
              fontSize: 13,
              resize: 'vertical',
              outline: 'none',
              boxSizing: 'border-box',
              fontFamily: "'Sora', system-ui, sans-serif",
            }}
          />

          {/* Custom Goal */}
          <h4 style={{ fontSize: 13, fontWeight: 600, color: '#1A1207', margin: '12px 0 8px' }}>{tt(isHi, 'Custom Goal', 'कस्टम लक्ष्य')}</h4>
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder={tt(isHi, 'Set a custom goal for this student...', 'इस छात्र के लिए कस्टम लक्ष्य सेट करें...')}
            style={{
              width: '100%',
              padding: '10px 12px',
              backgroundColor: 'var(--surface-2)',
              border: '1px solid #EDE6DC',
              borderRadius: 8,
              color: '#1A1207',
              fontSize: 13,
              outline: 'none',
              boxSizing: 'border-box',
              fontFamily: "'Sora', system-ui, sans-serif",
            }}
          />

          <button
            onClick={saveNote}
            disabled={saving}
            style={{
              marginTop: 12,
              width: '100%',
              padding: '10px 0',
              backgroundColor: saved ? '#059669' : 'var(--orange)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: saving ? 'default' : 'pointer',
              opacity: saving ? 0.6 : 1,
              transition: 'background-color 0.3s ease',
            }}
          >
            {saving ? tt(isHi, 'Saving...', 'सहेज रहे हैं...') : saved ? tt(isHi, 'Saved!', 'सहेज लिया!') : tt(isHi, 'Save Note & Goal', 'नोट और लक्ष्य सहेजें')}
          </button>

          {/* Learning Pulse (teacher single-student lens) — gated by
              class.view_analytics (UX only; server enforces teacher↔assigned
              boundary). Fetch enabled only while the card is expanded. */}
          {canViewAnalytics && (
            <TeacherStudentPulseSection
              studentId={student.id}
              studentName={student.name}
              enabled={expanded}
              isHi={isHi}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Main Page ─── */
function LegacyTeacherStudentsPage() {
  const { teacher, isLoading: authLoading, isLoggedIn, activeRole, isHi } = useAuth();
  const { can } = usePermissions();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [classes, setClasses] = useState<ClassData[]>([]);
  const [allStudents, setAllStudents] = useState<StudentData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedClass, setSelectedClass] = useState('all');
  const [filterStruggling, setFilterStruggling] = useState(false);

  const teacherId = teacher?.id || '';

  // Auth guard
  useEffect(() => {
    if (!authLoading && (!isLoggedIn || (activeRole !== 'teacher' && !teacher))) {
      router.replace('/login');
    }
  }, [authLoading, isLoggedIn, activeRole, teacher, router]);

  // Fetch data
  const load = useCallback(async () => {
    if (!teacherId) return;
    setLoading(true);
    setError('');
    try {
      const dashData = await api('get_dashboard', { teacher_id: teacherId });
      const classList: ClassData[] = dashData?.classes || [];
      setClasses(classList);

      // Keep one row per class membership. A student can belong to more than
      // one class, and collapsing by student id would make later filters omit
      // a valid membership.
      const students: StudentData[] = [];
      const seenMemberships = new Set<string>();

      for (const cls of classList) {
        const rosterById = new Map((cls.students || []).map((student) => [student.id, student]));
        let heatData: Record<string, unknown> | null = null;
        try {
          heatData = await api('get_heatmap', {
            teacher_id: teacherId,
            class_id: cls.id,
          });
        } catch {
          // The dashboard roster remains usable when one heatmap read fails.
        }

        const heatClassId = typeof heatData?.class_id === 'string' ? heatData.class_id : null;
        const heatRows = Array.isArray(heatData?.matrix) ? heatData.matrix : [];
        if (heatClassId === cls.id) {
          for (const rawRow of heatRows) {
            if (!rawRow || typeof rawRow !== 'object') continue;
            const row = rawRow as Record<string, unknown>;
            const rowClassId = typeof row.class_id === 'string' ? row.class_id : heatClassId;
            const studentId = typeof row.student_id === 'string' ? row.student_id : '';
            if (!studentId || rowClassId !== cls.id) continue;

            const membershipKey = `${rowClassId}:${studentId}`;
            if (seenMemberships.has(membershipKey)) continue;
            seenMemberships.add(membershipKey);

            const rosterStudent = rosterById.get(studentId);
            students.push({
              id: studentId,
              class_id: rowClassId,
              name: typeof row.student_name === 'string' ? row.student_name : rosterStudent?.name || 'Unknown',
              grade: String(row.grade ?? rosterStudent?.grade ?? '\u2013'),
              // Accept observed API fields only. Do not manufacture XP from
              // attempts or accuracy from mastery.
              xp: finiteMetric(row.xp ?? row.total_xp ?? rosterStudent?.xp),
              streak: finiteMetric(row.streak ?? row.streak_days ?? rosterStudent?.streak),
              mastery: finiteMetric(row.avg_mastery ?? rosterStudent?.mastery),
              accuracy: finiteMetric(row.accuracy ?? rosterStudent?.accuracy),
              subjects: Array.isArray(row.subjects) ? row.subjects as SubjectBreakdown[] : undefined,
              recent_scores: Array.isArray(row.recent_scores) ? row.recent_scores as number[] : undefined,
              strengths: Array.isArray(row.strengths) ? row.strengths as string[] : undefined,
              improvements: Array.isArray(row.improvements) ? row.improvements as string[] : undefined,
            });
          }
        }

        // Dashboard roster is the fail-safe for an empty/failed heatmap.
        for (const student of cls.students || []) {
          const classId = student.class_id || cls.id;
          if (classId !== cls.id) continue;
          const membershipKey = `${classId}:${student.id}`;
          if (seenMemberships.has(membershipKey)) continue;
          seenMemberships.add(membershipKey);
          students.push({
            id: student.id,
            class_id: classId,
            name: student.name || 'Unknown',
            grade: String(student.grade ?? '\u2013'),
            xp: finiteMetric(student.xp),
            streak: finiteMetric(student.streak),
            mastery: finiteMetric(student.mastery),
            accuracy: finiteMetric(student.accuracy),
          });
        }
      }

      setAllStudents(students);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load student data';
      setError(message);
    }
    setLoading(false);
  }, [teacherId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const requested = searchParams?.get('class');
    if (requested && classes.some((item) => item.id === requested)) {
      setSelectedClass(requested);
    }
  }, [classes, searchParams]);

  // Filter and sort students — struggling students first when filter is active
  const filtered = allStudents
    .filter((s) => {
      const matchesSearch = !search || s.name.toLowerCase().includes(search.toLowerCase());
      const matchesClass = selectedClass === 'all' || s.class_id === selectedClass;
      const matchesStruggling = !filterStruggling || riskRank(s) > 0;
      return matchesSearch && matchesClass && matchesStruggling;
    })
    .sort((a, b) => {
      return riskRank(b) - riskRank(a);
    });

  const strugglingCount = allStudents.filter((student) => riskRank(student) > 0).length;

  // Loading state — shared warm-cream roster skeleton.
  if (authLoading || (loading && !error)) {
    return (
      <div
        style={pageStyle}
        role="status"
        aria-busy="true"
        aria-label={tt(isHi, 'Loading students…', 'छात्र लोड हो रहे हैं…')}
      >
        <span className="sr-only">{tt(isHi, 'Loading students…', 'छात्र लोड हो रहे हैं…')}</span>
        <div style={{ paddingTop: 16, marginBottom: 20 }}>
          <Bone width={220} height={28} />
        </div>
        <TeacherTableSkeleton rows={8} />
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {/* Header */}
      <header
        style={{
          background: 'linear-gradient(135deg, #E8581C, #C2410C)',
          borderRadius: 16,
          padding: '24px 28px',
          marginBottom: 24,
        }}
      >
        <button
          onClick={() => router.push('/teacher')}
          style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 6, padding: '4px 10px', color: 'rgba(255,255,255,0.9)', fontSize: 12, fontWeight: 600, cursor: 'pointer', marginBottom: 8, display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          &larr; {tt(isHi, 'Dashboard', 'डैशबोर्ड')}
        </button>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: '#fff' }}>
          {'👨‍🎓'} {tt(isHi, 'My Students', 'मेरे छात्र')}
        </h1>
        <p style={{ margin: '6px 0 0', fontSize: 14, color: 'rgba(255,255,255,0.75)' }}>
          {tt(isHi,
            `${allStudents.length} student${allStudents.length !== 1 ? 's' : ''} across ${classes.length} class${classes.length !== 1 ? 'es' : ''}`,
            `${classes.length} कक्षाओं में ${allStudents.length} छात्र`
          )}
        </p>
      </header>

      {/* Error */}
      {error && (
        <div
          style={{
            backgroundColor: 'var(--danger-light)',
            border: '1px solid var(--danger)',
            borderRadius: 10,
            padding: '14px 18px',
            marginBottom: 16,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span style={{ color: 'var(--danger)', fontSize: 14 }}>{error}</span>
          <button
            onClick={load}
            style={{
              padding: '6px 14px',
              backgroundColor: 'var(--danger)',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {tt(isHi, 'Retry', 'पुनः प्रयास')}
          </button>
        </div>
      )}

      {/* Search & Filters */}
      {classes.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 10,
            marginBottom: 20,
            flexWrap: 'wrap',
          }}
        >
          {/* Search */}
          <div style={{ flex: 1, minWidth: 200 }}>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tt(isHi, 'Search students by name...', 'नाम से छात्र खोजें...')}
              style={{
                width: '100%',
                padding: '11px 14px 11px 38px',
                backgroundColor: '#FFFFFF',
                border: '1px solid var(--surface-2)',
                borderRadius: 10,
                color: '#1A1207',
                fontSize: 14,
                outline: 'none',
                boxSizing: 'border-box',
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='%237D7264' viewBox='0 0 16 16'%3E%3Cpath d='M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85zm-5.442.156a5 5 0 1 1 0-10 5 5 0 0 1 0 10z'/%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: '12px center',
                fontFamily: "'Sora', system-ui, sans-serif",
              }}
            />
          </div>

          {/* Class Filter */}
          <select
            value={selectedClass}
            onChange={(e) => {
              const nextClass = e.target.value;
              if (nextClass !== 'all' && !classes.some((item) => item.id === nextClass)) return;
              setSelectedClass(nextClass);
              const params = new URLSearchParams(searchParams?.toString() ?? '');
              if (nextClass === 'all') params.delete('class');
              else params.set('class', nextClass);
              const query = params.toString();
              router.replace(`${pathname ?? '/teacher/students'}${query ? `?${query}` : ''}`);
            }}
            style={{
              padding: '11px 14px',
              backgroundColor: '#FFFFFF',
              border: '1px solid var(--surface-2)',
              borderRadius: 10,
              color: '#1A1207',
              fontSize: 14,
              outline: 'none',
              cursor: 'pointer',
              minWidth: 160,
              fontFamily: "'Sora', system-ui, sans-serif",
            }}
          >
            <option value="all">{tt(isHi, 'All Classes', 'सभी कक्षाएं')}</option>
            {classes.map((cls) => (
              <option key={cls.id} value={cls.id}>
                {cls.name} ({cls.student_count})
              </option>
            ))}
          </select>

          {/* Struggling filter */}
          {strugglingCount > 0 && (
            <button
              onClick={() => setFilterStruggling(!filterStruggling)}
              style={{
                padding: '11px 16px',
                backgroundColor: filterStruggling ? '#DC2626' : '#FFFFFF',
                border: filterStruggling ? '1px solid #DC2626' : '1px solid #DC262666',
                borderRadius: 10,
                color: filterStruggling ? '#fff' : '#B91C1C',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                fontFamily: "'Sora', system-ui, sans-serif",
              }}
            >
              {filterStruggling
                ? tt(isHi, `Showing ${filtered.length} struggling`, `${filtered.length} कमज़ोर छात्र दिखा रहे हैं`)
                : tt(isHi, `Needs help (${strugglingCount})`, `मदद चाहिए (${strugglingCount})`)
              }
            </button>
          )}
        </div>
      )}

      {/* Struggling students summary */}
      {strugglingCount > 0 && !filterStruggling && allStudents.length > 0 && (
        <div style={{
          backgroundColor: '#FFFFFF',
          borderRadius: 14,
          border: '1px solid #DC262633',
          padding: '14px 18px',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 4, backgroundColor: '#DC2626', color: '#fff', textTransform: 'uppercase' }}>
              {tt(isHi, 'Alert', 'अलर्ट')}
            </span>
            <span style={{ fontSize: 14, color: '#B91C1C' }}>
              <strong>{strugglingCount}</strong> {tt(isHi,
                `out of ${allStudents.length} student${allStudents.length > 1 ? 's' : ''} ${strugglingCount > 1 ? 'are' : 'is'} below 50% mastery or accuracy`,
                `/ ${allStudents.length} छात्र 50% से कम मास्टरी या सटीकता पर हैं`
              )}
            </span>
          </div>
          <button
            onClick={() => setFilterStruggling(true)}
            style={{
              padding: '6px 14px',
              backgroundColor: 'transparent',
              color: '#E8581C',
              border: '1px solid #E8581C',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {tt(isHi, 'Show only', 'केवल दिखाएं')}
          </button>
        </div>
      )}

      {/* Empty States */}
      {classes.length === 0 && !loading && (
        <div
          style={{
            backgroundColor: '#FFFFFF',
            borderRadius: 14,
            border: '1px solid var(--surface-2)',
            padding: '60px 24px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 16 }}>{'📚'}</div>
          <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 600, color: '#1A1207' }}>{tt(isHi, 'No Classes Yet', 'अभी तक कोई कक्षा नहीं')}</h2>
          <p style={{ margin: 0, fontSize: 14, color: '#7D7264', maxWidth: 400, marginLeft: 'auto', marginRight: 'auto' }}>
            {tt(isHi, 'Create a class from the Dashboard to start tracking students.', 'छात्रों को ट्रैक करने के लिए डैशबोर्ड से कक्षा बनाएं।')}
          </p>
          <button
            onClick={() => router.push('/teacher')}
            style={{
              marginTop: 20,
              padding: '10px 24px',
              backgroundColor: 'var(--orange)',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {tt(isHi, 'Go to Dashboard', 'डैशबोर्ड पर जाएं')}
          </button>
        </div>
      )}

      {classes.length > 0 && allStudents.length === 0 && !loading && (
        <div
          style={{
            backgroundColor: '#FFFFFF',
            borderRadius: 14,
            border: '1px solid var(--surface-2)',
            padding: '60px 24px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 16 }}>{'👋'}</div>
          <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 600, color: '#1A1207' }}>{tt(isHi, 'No Students Yet', 'अभी तक कोई छात्र नहीं')}</h2>
          <p style={{ margin: 0, fontSize: 14, color: '#7D7264', maxWidth: 400, marginLeft: 'auto', marginRight: 'auto' }}>
            {tt(isHi, 'No students have joined this class yet. Share the class code!', 'अभी तक कोई छात्र इस कक्षा में शामिल नहीं हुआ। कक्षा कोड साझा करें!')}
          </p>
        </div>
      )}

      {/* No search results */}
      {allStudents.length > 0 && filtered.length === 0 && (
        <div
          style={{
            backgroundColor: '#FFFFFF',
            borderRadius: 14,
            border: '1px solid var(--surface-2)',
            padding: '40px 24px',
            textAlign: 'center',
          }}
        >
          <p style={{ margin: 0, fontSize: 14, color: '#7D7264' }}>
            {tt(isHi, `No students match "${search}"`, `"${search}" से कोई छात्र नहीं मिला`)}
          </p>
        </div>
      )}

      {/* Student Grid */}
      {filtered.length > 0 && (
        <SectionErrorBoundary section="Student Grid">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: 16,
            }}
          >
            {filtered.map((student) => (
              <StudentCard key={`${student.class_id}:${student.id}`} student={student} teacherId={teacherId} isHi={isHi} router={router} canViewAnalytics={can('class.view_analytics')} />
            ))}
          </div>
        </SectionErrorBoundary>
      )}
      
    </div>
  );
}

export default function TeacherStudentsPage() {
  return <LegacyTeacherStudentsPage />;
}

const pageStyle: React.CSSProperties = {
  maxWidth: 1100,
  margin: '0 auto',
  padding: '20px 16px',
  fontFamily: "'Sora', system-ui, sans-serif",
  color: '#1A1207',
  backgroundColor: '#FBF8F4',
  minHeight: '100dvh',
};
