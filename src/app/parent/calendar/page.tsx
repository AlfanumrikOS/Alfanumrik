'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';

// ============================================================
// BILINGUAL HELPER (P7)
// ============================================================
const t = (isHi: boolean, en: string, hi: string) => isHi ? hi : en;

// ============================================================
// SESSION TYPES + LOADER (mirrors parent/page.tsx HMAC pattern)
// ============================================================
const SESSION_KEY = 'alfanumrik_parent_session';
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

interface ParentSession { id: string; name: string }
interface StudentSession { id: string; name: string; grade: string }

async function hmacSign(payload: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function loadParentSession(): Promise<{ guardian: ParentSession; student: StudentSession } | null> {
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

// ============================================================
// BOARD EXAM DATES (Grade 10 and 12 only) — P5: grades are strings
// ============================================================
const BOARD_EXAM_DATES: Record<string, Date> = {
  '10': new Date('2026-03-15'),
  '12': new Date('2026-03-01'),
};

function getDaysUntil(target: Date): number {
  return Math.max(0, Math.ceil((target.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
}

// ============================================================
// CALENDAR GRID HELPERS
// ============================================================
const DAY_HEADERS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_HEADERS_HI = ['रवि', 'सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि'];

const MONTH_NAMES_EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTH_NAMES_HI = ['जनवरी','फ़रवरी','मार्च','अप्रैल','मई','जून','जुलाई','अगस्त','सितंबर','अक्टूबर','नवंबर','दिसंबर'];

function getCalendarDays(year: number, month: number): Array<{ date: number | null; dateStr: string }> {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<{ date: number | null; dateStr: string }> = [];
  for (let i = 0; i < firstDay; i++) cells.push({ date: null, dateStr: '' });
  for (let d = 1; d <= daysInMonth; d++) {
    const m = String(month + 1).padStart(2, '0');
    const day = String(d).padStart(2, '0');
    cells.push({ date: d, dateStr: `${year}-${m}-${day}` });
  }
  return cells;
}

// ============================================================
// MAIN PAGE
// ============================================================
export default function ParentCalendarPage() {
  const auth = useAuth();
  const isHi = auth.isHi ?? false;

  const [guardian, setGuardian] = useState<ParentSession | null>(null);
  const [student, setStudent] = useState<StudentSession | null>(null);
  const [checking, setChecking] = useState(true);

  // Calendar state
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());

  // Activity data: set of dateStr strings with quiz activity
  const [activityDates, setActivityDates] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [monthQuizCount, setMonthQuizCount] = useState(0);
  const [monthActiveDays, setMonthActiveDays] = useState(0);

  // Auth resolution
  useEffect(() => {
    if (auth.isLoading) return;
    const resolve = (g: ParentSession | null, s: StudentSession | null) => {
      setGuardian(g);
      setStudent(s);
      setChecking(false);
    };
    if (auth.guardian) {
      loadParentSession().then(session => resolve(auth.guardian!, session?.student ?? null));
      return;
    }
    loadParentSession().then(session => {
      if (session) resolve(session.guardian, session.student);
      else { setChecking(false); }
    });
  }, [auth.isLoading, auth.guardian]);

  // Redirect if not authenticated
  useEffect(() => {
    if (!checking && !guardian && !student) {
      window.location.href = '/parent';
    }
  }, [checking, guardian, student]);

  // Fetch quiz activity for this month
  const fetchActivity = useCallback(async () => {
    if (!student) return;
    setLoading(true);
    try {
      const startOfMonth = new Date(viewYear, viewMonth, 1).toISOString();
      const endOfMonth = new Date(viewYear, viewMonth + 1, 0, 23, 59, 59).toISOString();
      const { data } = await supabase
        .from('quiz_sessions')
        .select('created_at')
        .eq('student_id', student.id)
        .gte('created_at', startOfMonth)
        .lte('created_at', endOfMonth);

      if (data && data.length > 0) {
        const dateSet = new Set<string>();
        let quizCount = 0;
        for (const row of data as Array<{ created_at: string }>) {
          const d = new Date(row.created_at);
          const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          dateSet.add(dateStr);
          quizCount++;
        }
        setActivityDates(dateSet);
        setMonthQuizCount(quizCount);
        setMonthActiveDays(dateSet.size);
      } else {
        setActivityDates(new Set());
        setMonthQuizCount(0);
        setMonthActiveDays(0);
      }
    } catch {
      setActivityDates(new Set());
    }
    setLoading(false);
  }, [student, viewYear, viewMonth]);

  useEffect(() => {
    if (student) fetchActivity();
  }, [student, fetchActivity]);

  const grade = student?.grade || '';
  const boardExamDate = BOARD_EXAM_DATES[grade] || null;
  const daysUntilBoard = boardExamDate ? getDaysUntil(boardExamDate) : null;

  const calendarDays = getCalendarDays(viewYear, viewMonth);
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const dayHeaders = isHi ? DAY_HEADERS_HI : DAY_HEADERS_EN;
  const monthName = isHi ? MONTH_NAMES_HI[viewMonth] : MONTH_NAMES_EN[viewMonth];

  const goToPrevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };
  const goToNextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };

  // Loading state
  if (checking || auth.isLoading) {
    return (
      <div style={pageStyle}>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <div style={{ textAlign: 'center', padding: 80, color: '#64748B' }}>
          <div style={{
            width: 40, height: 40,
            border: '3px solid #FDBA7444', borderTopColor: '#F97316',
            borderRadius: '50%', margin: '0 auto 16px',
            animation: 'spin 0.8s linear infinite',
          }} />
          {t(isHi, 'Loading...', 'लोड हो रहा है...')}
        </div>
      </div>
    );
  }

  if (!guardian || !student) return null;

  return (
    <div style={pageStyle}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.65; } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      {/* ── HEADER ── */}
      <div style={{
        background: 'linear-gradient(135deg, #F97316, #EA580C)',
        borderRadius: 16,
        padding: '24px 22px',
        marginBottom: 18,
        color: '#fff',
      }}>
        <button
          onClick={() => { window.location.href = '/parent'; }}
          style={{
            background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 6,
            padding: '4px 10px', color: '#fff', fontSize: 12, fontWeight: 600,
            cursor: 'pointer', marginBottom: 10,
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}
        >
          &larr; {t(isHi, 'Dashboard', 'डैशबोर्ड')}
        </button>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#fff', margin: '0 0 4px' }}>
          &#x1F4C5; {t(isHi, 'Academic Calendar', 'शैक्षणिक कैलेंडर')}
        </h1>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.85)', margin: 0 }}>
          {student.name} &bull; {t(isHi, 'Grade', 'कक्षा')} {student.grade}
        </p>
      </div>

      {/* ── BOARD EXAM COUNTDOWN (Grade 10 / 12 only) ── */}
      {boardExamDate && daysUntilBoard !== null && daysUntilBoard >= 0 && (
        <div style={{
          backgroundColor: '#FFF8F0',
          border: '2px solid #FDBA74',
          borderRadius: 14,
          padding: '16px 18px',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          animation: 'pulse 3s ease-in-out infinite',
        }}>
          <div style={{
            width: 52, height: 52, borderRadius: '50%',
            background: 'linear-gradient(135deg, #F97316, #EA580C)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <span style={{ fontSize: 18, fontWeight: 800, color: '#fff', lineHeight: 1 }}>
              {daysUntilBoard}
            </span>
            <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.85)', lineHeight: 1 }}>
              {t(isHi, 'DAYS', 'दिन')}
            </span>
          </div>
          <div>
            <p style={{ fontSize: 14, fontWeight: 700, color: '#1E293B', margin: '0 0 2px' }}>
              {t(isHi, 'CBSE Board Exam', 'CBSE बोर्ड परीक्षा')}
            </p>
            <p style={{ fontSize: 12, color: '#64748B', margin: 0 }}>
              {t(isHi, 'Grade', 'कक्षा')} {grade} &bull; {boardExamDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
            {daysUntilBoard <= 30 && (
              <p style={{ fontSize: 11, color: '#EF4444', margin: '4px 0 0', fontWeight: 600 }}>
                {t(isHi, 'Time to intensify preparation!', 'तैयारी तेज़ करने का समय!')}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── CALENDAR CARD ── */}
      <div style={cardStyle}>
        {/* Month navigation */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 14,
        }}>
          <button
            onClick={goToPrevMonth}
            style={navBtnStyle}
            aria-label={t(isHi, 'Previous month', 'पिछला महीना')}
          >
            &#8249;
          </button>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#1E293B' }}>
            {monthName} {viewYear}
          </span>
          <button
            onClick={goToNextMonth}
            style={navBtnStyle}
            aria-label={t(isHi, 'Next month', 'अगला महीना')}
          >
            &#8250;
          </button>
        </div>

        {/* Day headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 6 }}>
          {dayHeaders.map(d => (
            <div key={d} style={{
              textAlign: 'center', fontSize: 10, fontWeight: 700,
              color: '#94A3B8', textTransform: 'uppercase',
            }}>
              {d}
            </div>
          ))}
        </div>

        {/* Calendar cells */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {calendarDays.map((cell, idx) => {
            if (!cell.date) {
              return <div key={`empty-${idx}`} />;
            }
            const isToday = cell.dateStr === todayStr;
            const hasActivity = activityDates.has(cell.dateStr);
            return (
              <div
                key={cell.dateStr}
                style={{
                  aspectRatio: '1',
                  borderRadius: 10,
                  backgroundColor: isToday ? '#FFF3E0' : '#FAFAFA',
                  border: isToday ? '2px solid #F97316' : '1px solid #F1F5F9',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 3,
                  position: 'relative',
                }}
              >
                <span style={{
                  fontSize: 12,
                  fontWeight: isToday ? 700 : 400,
                  color: isToday ? '#EA580C' : '#475569',
                }}>
                  {cell.date}
                </span>
                {hasActivity && (
                  <div style={{
                    width: 6, height: 6, borderRadius: '50%',
                    backgroundColor: '#F97316',
                  }} />
                )}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 16, marginTop: 14, justifyContent: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#F97316' }} />
            <span style={{ fontSize: 11, color: '#64748B' }}>{t(isHi, 'Quiz activity', 'क्विज़ गतिविधि')}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 14, height: 14, borderRadius: 4, border: '2px solid #F97316', backgroundColor: '#FFF3E0' }} />
            <span style={{ fontSize: 11, color: '#64748B' }}>{t(isHi, 'Today', 'आज')}</span>
          </div>
        </div>
      </div>

      {/* ── MONTHLY SUMMARY ── */}
      <div style={cardStyle}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1E293B', margin: '0 0 12px' }}>
          &#x1F4CA; {t(isHi, 'Monthly Summary', 'मासिक सारांश')}
        </h3>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 20, color: '#94A3B8' }}>
            <div style={{
              width: 28, height: 28,
              border: '3px solid #FDBA7444', borderTopColor: '#F97316',
              borderRadius: '50%', margin: '0 auto 8px',
              animation: 'spin 0.8s linear infinite',
            }} />
            {t(isHi, 'Loading activity...', 'गतिविधि लोड हो रही है...')}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={summaryBoxStyle}>
              <span style={{ fontSize: 24, fontWeight: 800, color: '#F97316' }}>{monthQuizCount}</span>
              <span style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                {t(isHi, 'Quizzes', 'क्विज़')}
              </span>
            </div>
            <div style={summaryBoxStyle}>
              <span style={{ fontSize: 24, fontWeight: 800, color: '#16A34A' }}>{monthActiveDays}</span>
              <span style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                {t(isHi, 'Active Days', 'सक्रिय दिन')}
              </span>
            </div>
            <div style={summaryBoxStyle}>
              <span style={{ fontSize: 24, fontWeight: 800, color: '#8B5CF6' }}>
                {monthQuizCount > 0 && monthActiveDays > 0
                  ? Math.round(monthQuizCount / monthActiveDays * 10) / 10
                  : 0}
              </span>
              <span style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                {t(isHi, 'Avg/Day', 'औसत/दिन')}
              </span>
            </div>
          </div>
        )}

        {!loading && monthActiveDays === 0 && (
          <p style={{ fontSize: 13, color: '#94A3B8', textAlign: 'center', marginTop: 12, fontStyle: 'italic' }}>
            {t(isHi,
              `No quiz activity recorded for ${monthName}.`,
              `${monthName} में कोई क्विज़ गतिविधि दर्ज नहीं हुई।`
            )}
          </p>
        )}
      </div>

      {/* ── UPCOMING EVENTS ── */}
      <div style={cardStyle}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1E293B', margin: '0 0 14px' }}>
          &#x1F4CC; {t(isHi, 'Upcoming Events', 'आगामी कार्यक्रम')}
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Board exam event (if applicable) */}
          {boardExamDate && daysUntilBoard !== null && daysUntilBoard >= 0 && (
            <EventRow
              dateLabel={boardExamDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
              title={`${t(isHi, 'CBSE Board Exam', 'CBSE बोर्ड परीक्षा')} (${t(isHi, 'Grade', 'कक्षा')} ${grade})`}
              chipLabel={t(isHi, 'Board', 'बोर्ड')}
              chipColor="#EF4444"
              daysLeft={daysUntilBoard}
            />
          )}

          {/* Placeholder upcoming events for exam prep */}
          <EventRow
            dateLabel={t(isHi, 'Ongoing', 'जारी')}
            title={t(isHi, 'Daily Practice Goal — 1 quiz per day', 'दैनिक अभ्यास लक्ष्य — प्रति दिन 1 क्विज़')}
            chipLabel={t(isHi, 'Goal', 'लक्ष्य')}
            chipColor="#F97316"
            daysLeft={null}
          />

          <EventRow
            dateLabel={t(isHi, 'Ongoing', 'जारी')}
            title={t(isHi, 'Weekly revision — Sundays recommended', 'साप्ताहिक दोहराई — रविवार की सलाह')}
            chipLabel={t(isHi, 'Habit', 'आदत')}
            chipColor="#8B5CF6"
            daysLeft={null}
          />
        </div>
      </div>

      {/* Footer */}
      <p style={{ textAlign: 'center', fontSize: 11, color: '#475569', margin: '20px 0 12px' }}>
        Alfanumrik Learning OS | {t(isHi, 'Parent Portal', 'अभिभावक पोर्टल')}
      </p>
    </div>
  );
}

// ============================================================
// EVENT ROW COMPONENT
// ============================================================
function EventRow({ dateLabel, title, chipLabel, chipColor, daysLeft }: {
  dateLabel: string;
  title: string;
  chipLabel: string;
  chipColor: string;
  daysLeft: number | null;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 12px',
      backgroundColor: '#FFF8F0',
      borderRadius: 12,
      border: '1px solid #FDBA7444',
    }}>
      {/* Date chip */}
      <div style={{
        flexShrink: 0,
        minWidth: 52,
        textAlign: 'center',
        padding: '4px 6px',
        backgroundColor: '#FFF3E0',
        borderRadius: 8,
        border: '1px solid #FDBA7455',
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#EA580C' }}>{dateLabel}</span>
      </div>

      {/* Title */}
      <span style={{ flex: 1, fontSize: 13, color: '#1E293B', fontWeight: 500 }}>
        {title}
      </span>

      {/* Labels */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, color: chipColor,
          backgroundColor: `${chipColor}18`,
          borderRadius: 6, padding: '2px 8px',
        }}>
          {chipLabel}
        </span>
        {daysLeft !== null && (
          <span style={{ fontSize: 10, color: '#64748B' }}>
            {daysLeft}d left
          </span>
        )}
      </div>
    </div>
  );
}

// ============================================================
// STYLES
// ============================================================
const pageStyle: React.CSSProperties = {
  maxWidth: 600,
  margin: '0 auto',
  padding: '20px 16px 40px',
  fontFamily: "'Plus Jakarta Sans', 'Sora', system-ui, sans-serif",
  color: '#1E293B',
  backgroundColor: '#FFF8F0',
  minHeight: '100vh',
};

const cardStyle: React.CSSProperties = {
  backgroundColor: '#FFFFFF',
  borderRadius: 16,
  padding: '18px 18px',
  border: '1px solid #FDBA7444',
  marginBottom: 14,
};

const navBtnStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 10,
  border: '1px solid #FDBA7444',
  backgroundColor: '#FFF8F0',
  color: '#F97316',
  fontSize: 20,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 700,
  lineHeight: 1,
};

const summaryBoxStyle: React.CSSProperties = {
  flex: 1,
  backgroundColor: '#FFF8F0',
  borderRadius: 12,
  border: '1px solid #FDBA7444',
  padding: '12px 10px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 0,
};
