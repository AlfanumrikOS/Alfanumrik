'use client';

import { Suspense, useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { supabase } from '@alfanumrik/lib/supabase';
import {
  loadParentSession,
  type ParentSession,
  type StudentSession,
} from '../_components/parent-session';
import {
  readParentChildId,
  replaceParentChildId,
  resolveLinkedChild,
  withParentChildId,
} from '../_components/parent-child-scope';

// ============================================================
// BILINGUAL HELPER (P7)
// ============================================================
const t = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

// ============================================================
// SESSION TYPES + LOADER (mirrors parent/page.tsx HMAC pattern)
// ============================================================
// ============================================================
// AUTHED FETCH (attaches the guardian's Supabase JWT)
// ============================================================
const PARENT_CALENDAR_TIMEOUT_MS = 15_000;

async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
  } catch {
    /* anonymous — server returns 401/403 */
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PARENT_CALENDAR_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================================
// CALENDAR API CONTRACT TYPES (matches /api/parent/calendar)
// ============================================================
type CalendarEventType = 'assignment' | 'school_exam' | 'quiz_activity';

interface CalendarEvent {
  date: string;
  type: CalendarEventType;
  title: string;
  subtitle?: string;
  id?: string;
}

interface CalendarResponse {
  success: boolean;
  data?: {
    student_id: string;
    grade: string | null;
    range: { from: string; to: string };
    events: CalendarEvent[];
  };
  error?: string;
}

interface LinkedChildrenResponse {
  success: boolean;
  data?: {
    children?: Array<{ student_id: string; name: string; grade: string | null }>;
  };
}

// Per-type styling — colors used for the calendar dot legend, event chips, and
// upcoming-events rows. quiz_activity is past engagement; the others upcoming.
const EVENT_STYLE: Record<CalendarEventType, { color: string; en: string; hi: string }> = {
  assignment: { color: '#2563EB', en: 'Assignment', hi: 'असाइनमेंट' },
  school_exam: { color: '#EF4444', en: 'School Exam', hi: 'स्कूल परीक्षा' },
  quiz_activity: { color: '#E8581C', en: 'Quiz activity', hi: 'क्विज़ गतिविधि' },
};

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

/** Convert an ISO timestamp to a local YYYY-MM-DD date key for calendar matching. */
function localDateKey(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ============================================================
// MAIN PAGE
// ============================================================
function ParentCalendarContent() {
  const auth = useAuth();
  const isHi = auth.isHi ?? false;
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedChildId = readParentChildId(searchParams);

  const [guardian, setGuardian] = useState<ParentSession | null>(null);
  const [student, setStudent] = useState<StudentSession | null>(null);
  const [checking, setChecking] = useState(true);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const [scopeAttempt, setScopeAttempt] = useState(0);

  // Calendar view state
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());

  // Server-aggregated events
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [notLinked, setNotLinked] = useState(false);

  // Resolve URL child scope only against a server-authorized guardian link
  // list. Link-code sessions remain pinned to their single signed child.
  useEffect(() => {
    if (auth.isLoading) return;
    let cancelled = false;

    const resolve = async () => {
      setChecking(true);
      setScopeError(null);

      if (auth.guardian) {
        setGuardian(auth.guardian);
        setStudent(null);
        try {
          const response = await authedFetch('/api/v2/parent/children');
          const json = (await response.json().catch(() => ({}))) as LinkedChildrenResponse;
          if (!response.ok || !json.success) throw new Error('parent.children_failed');
          const linkedChildren: StudentSession[] = (json.data?.children ?? [])
            .map((child) => ({
              id: child.student_id,
              name: child.name,
              grade: child.grade ?? '',
            }))
            .filter((child) => Boolean(child.id));
          const scopedChild = resolveLinkedChild(linkedChildren, requestedChildId, linkedChildren[0]?.id);
          if (cancelled) return;
          if (!scopedChild) {
            setScopeError(t(isHi, 'No linked child was found.', 'कोई जुड़ा हुआ बच्चा नहीं मिला।'));
            return;
          }
          setStudent(scopedChild);
          if (requestedChildId !== scopedChild.id) {
            router.replace(replaceParentChildId('/parent/calendar', searchParams, scopedChild.id));
          }
        } catch {
          if (!cancelled) {
            setScopeError(t(isHi, 'Could not load linked children. Please try again.', 'जुड़े हुए बच्चों को लोड नहीं किया जा सका। कृपया फिर से कोशिश करें।'));
          }
        } finally {
          if (!cancelled) setChecking(false);
        }
        return;
      }

      const session = await loadParentSession();
      if (cancelled) return;
      if (session) {
        setGuardian(session.guardian);
        setStudent(session.student);
        if (requestedChildId !== session.student.id) {
          router.replace(replaceParentChildId('/parent/calendar', searchParams, session.student.id));
        }
      }
      setChecking(false);
    };

    void resolve();
    return () => { cancelled = true; };
  }, [auth.isLoading, auth.guardian, isHi, requestedChildId, router, scopeAttempt, searchParams]);

  // Redirect if not authenticated
  useEffect(() => {
    if (!checking && !guardian && !student && !scopeError) {
      window.location.href = '/parent';
    }
  }, [checking, guardian, scopeError, student]);

  // Fetch aggregated calendar events for the active child from the API.
  // horizon_days=120 (the API max) so the whole forward window is covered;
  // the API also looks back 30 days for quiz_activity engagement markers.
  const fetchEvents = useCallback(async () => {
    if (!student) return;
    setEventsLoading(true);
    setEventsError(null);
    setNotLinked(false);
    try {
      const res = await authedFetch(
        `/api/parent/calendar?student_id=${encodeURIComponent(student.id)}&horizon_days=120`,
      );
      if (res.status === 403) {
        setNotLinked(true);
        setEvents([]);
        return;
      }
      if (res.status === 404) {
        setEventsError(t(isHi, 'Student record not found.', 'छात्र रिकॉर्ड नहीं मिला।'));
        setEvents([]);
        return;
      }
      if (res.status === 401) {
        setEventsError(t(isHi, 'Please sign in again.', 'कृपया दोबारा साइन इन करें।'));
        setEvents([]);
        return;
      }
      const json = (await res.json().catch(() => ({}))) as CalendarResponse;
      if (!res.ok || !json.success || !json.data) {
        setEventsError(t(isHi, 'Could not load calendar events.', 'कैलेंडर कार्यक्रम लोड नहीं हो सके।'));
        setEvents([]);
        return;
      }
      // API already returns events sorted ascending.
      setEvents(json.data.events);
    } catch {
      setEventsError(t(isHi, 'Network error. Please try again.', 'नेटवर्क त्रुटि। कृपया दोबारा कोशिश करें।'));
      setEvents([]);
    } finally {
      setEventsLoading(false);
    }
  }, [student, isHi]);

  useEffect(() => {
    if (student) fetchEvents();
  }, [student, fetchEvents]);

  // Map events onto the visible month's day cells, keyed by local date.
  // Each day can carry multiple event types; we collect the distinct set so the
  // grid can render one dot per type present that day.
  const eventTypesByDay: Record<string, Set<CalendarEventType>> = {};
  for (const ev of events) {
    const key = localDateKey(ev.date);
    if (!key) continue;
    if (!eventTypesByDay[key]) eventTypesByDay[key] = new Set();
    eventTypesByDay[key].add(ev.type);
  }

  // Upcoming events come only from live assignment and school-exam records.
  // quiz_activity is past engagement and is surfaced only as calendar dots.
  const nowMs = Date.now();
  const upcoming = events
    .filter((e) => (e.type === 'assignment' || e.type === 'school_exam') && new Date(e.date).getTime() >= nowMs)
    .slice(0, 30);

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

  // Loading state (auth resolving)
  if (checking || auth.isLoading) {
    return (
      <div style={pageStyle}>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <div style={{ textAlign: 'center', padding: 80, color: '#64748B' }}>
          <div style={{
            width: 40, height: 40,
            border: '3px solid #FDBA7444', borderTopColor: '#E8581C',
            borderRadius: '50%', margin: '0 auto 16px',
            animation: 'spin 0.8s linear infinite',
          }} />
          {t(isHi, 'Loading...', 'लोड हो रहा है...')}
        </div>
      </div>
    );
  }

  if (scopeError) {
    return (
      <div style={pageStyle}>
        <div role="alert" style={{ ...cardStyle, marginTop: 40, textAlign: 'center', color: '#B91C1C' }}>
          <p style={{ margin: '0 0 14px' }}>{scopeError}</p>
          <button
            type="button"
            onClick={() => setScopeAttempt((attempt) => attempt + 1)}
            style={{ ...navBtnStyle, width: 'auto', minWidth: 96, padding: '0 16px', color: '#C2410C' }}
          >
            {t(isHi, 'Try again', 'फिर से कोशिश करें')}
          </button>
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
          onClick={() => router.push(withParentChildId('/parent', student.id))}
          style={{
            background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 6,
            padding: '4px 10px', color: '#fff', fontSize: 12, fontWeight: 600,
            cursor: 'pointer', marginBottom: 10,
            display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 32,
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

      {/* ── NOT-LINKED STATE (403) ── */}
      {notLinked && (
        <div style={{
          backgroundColor: '#FEF2F2',
          border: '1px solid #FECACA',
          borderRadius: 14,
          padding: '18px',
          marginBottom: 16,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>&#x1F517;</div>
          <p style={{ fontSize: 14, fontWeight: 600, color: '#991B1B', margin: '0 0 4px' }}>
            {t(isHi, 'Not linked to this child', 'इस बच्चे से जुड़े नहीं हैं')}
          </p>
          <p style={{ fontSize: 12, color: '#B91C1C', margin: 0, lineHeight: 1.5 }}>
            {t(
              isHi,
              'You need an approved link to view this child’s calendar. Open the Children page to connect.',
              'इस बच्चे का कैलेंडर देखने के लिए आपको एक स्वीकृत लिंक चाहिए। जुड़ने के लिए बच्चे पेज खोलें।'
            )}
          </p>
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
            const dayTypes = eventTypesByDay[cell.dateStr];
            return (
              <div
                key={cell.dateStr}
                style={{
                  aspectRatio: '1',
                  borderRadius: 10,
                  backgroundColor: isToday ? '#FFF3E0' : '#FAFAFA',
                  border: isToday ? '2px solid #E8581C' : '1px solid #F1F5F9',
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
                {dayTypes && dayTypes.size > 0 && (
                  <div style={{ display: 'flex', gap: 2 }}>
                    {(['assignment', 'school_exam', 'quiz_activity'] as CalendarEventType[])
                      .filter((ty) => dayTypes.has(ty))
                      .map((ty) => (
                        <div
                          key={ty}
                          style={{
                            width: 5, height: 5, borderRadius: '50%',
                            backgroundColor: EVENT_STYLE[ty].color,
                          }}
                        />
                      ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 14, marginTop: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
          {(['assignment', 'school_exam', 'quiz_activity'] as CalendarEventType[]).map((ty) => (
            <div key={ty} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: EVENT_STYLE[ty].color }} />
              <span style={{ fontSize: 11, color: '#64748B' }}>{t(isHi, EVENT_STYLE[ty].en, EVENT_STYLE[ty].hi)}</span>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 14, height: 14, borderRadius: 4, border: '2px solid #E8581C', backgroundColor: '#FFF3E0' }} />
            <span style={{ fontSize: 11, color: '#64748B' }}>{t(isHi, 'Today', 'आज')}</span>
          </div>
        </div>
      </div>

      {/* ── UPCOMING EVENTS ── */}
      <div style={cardStyle}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1E293B', margin: '0 0 14px' }}>
          &#x1F4CC; {t(isHi, 'Upcoming Events', 'आगामी कार्यक्रम')}
        </h3>

        {eventsLoading ? (
          <div style={{ textAlign: 'center', padding: 20, color: '#94A3B8' }}>
            <div style={{
              width: 28, height: 28,
              border: '3px solid #FDBA7444', borderTopColor: '#E8581C',
              borderRadius: '50%', margin: '0 auto 8px',
              animation: 'spin 0.8s linear infinite',
            }} />
            {t(isHi, 'Loading events...', 'कार्यक्रम लोड हो रहे हैं...')}
          </div>
        ) : eventsError ? (
          <div style={{ textAlign: 'center', padding: '16px 8px' }}>
            <p style={{ fontSize: 13, color: '#DC2626', margin: '0 0 12px' }}>{eventsError}</p>
            <button
              onClick={fetchEvents}
              style={{
                padding: '8px 18px', backgroundColor: 'transparent', color: '#E8581C',
                border: '1px solid #FDBA74', borderRadius: 8, fontSize: 13, fontWeight: 600,
                cursor: 'pointer', minHeight: 44,
              }}
            >
              {t(isHi, 'Retry', 'दोबारा कोशिश करें')}
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Server-aggregated upcoming events (assignments + school exams) */}
            {upcoming.map((ev) => {
              const evDate = new Date(ev.date);
              const daysLeft = Math.max(0, Math.ceil((evDate.getTime() - nowMs) / (1000 * 60 * 60 * 24)));
              const style = EVENT_STYLE[ev.type];
              return (
                <EventRow
                  key={ev.id ?? `${ev.type}-${ev.date}-${ev.title}`}
                  dateLabel={evDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  title={`${ev.title}${ev.subtitle ? ' — ' + ev.subtitle : ''}`}
                  chipLabel={t(isHi, style.en, style.hi)}
                  chipColor={daysLeft <= 7 ? '#EF4444' : style.color}
                  daysLeft={daysLeft}
                  isHi={isHi}
                />
              );
            })}

            {/* Empty state — no upcoming events at all */}
            {upcoming.length === 0 && (
              <div style={{
                borderRadius: 12,
                border: '1px dashed #FDBA7488',
                backgroundColor: '#FFF8F0',
                padding: '18px 14px',
                textAlign: 'center',
              }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#9A3412', margin: '0 0 4px' }}>
                  {t(isHi, 'No upcoming events', 'कोई आगामी कार्यक्रम नहीं')}
                </p>
                <p style={{ fontSize: 11, color: '#B45309', margin: 0, lineHeight: 1.4 }}>
                  {t(
                    isHi,
                    "Assignments and exams added by your child's school will appear here.",
                    'आपके बच्चे के स्कूल द्वारा जोड़े गए असाइनमेंट और परीक्षाएँ यहाँ दिखाई देंगी।'
                  )}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── RECOMMENDED HABITS ── */}
      <div style={cardStyle}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: '#1E293B', margin: '0 0 14px' }}>
          &#x2728; {t(isHi, 'Recommended Habits', 'अनुशंसित आदतें')}
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <EventRow
            dateLabel={t(isHi, 'Ongoing', 'जारी')}
            title={t(isHi, 'Daily Practice Goal — 1 quiz per day', 'दैनिक अभ्यास लक्ष्य — प्रति दिन 1 क्विज़')}
            chipLabel={t(isHi, 'Goal', 'लक्ष्य')}
            chipColor="#E8581C"
            daysLeft={null}
            isHi={isHi}
          />
          <EventRow
            dateLabel={t(isHi, 'Ongoing', 'जारी')}
            title={t(isHi, 'Weekly revision — Sundays recommended', 'साप्ताहिक दोहराई — रविवार की सलाह')}
            chipLabel={t(isHi, 'Habit', 'आदत')}
            chipColor="#8B5CF6"
            daysLeft={null}
            isHi={isHi}
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

export default function ParentCalendarPage() {
  return (
    <Suspense>
      <ParentCalendarContent />
    </Suspense>
  );
}

// ============================================================
// EVENT ROW COMPONENT
// ============================================================
function EventRow({ dateLabel, title, chipLabel, chipColor, daysLeft, isHi }: {
  dateLabel: string;
  title: string;
  chipLabel: string;
  chipColor: string;
  daysLeft: number | null;
  isHi: boolean;
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
            {t(isHi, `${daysLeft}d left`, `${daysLeft} दिन शेष`)}
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
  minHeight: '100dvh',
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
  color: '#E8581C',
  fontSize: 20,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 700,
  lineHeight: 1,
};
