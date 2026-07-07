'use client';

/**
 * /teacher/attendance — Daily roll-call page for teachers.
 *
 * Surfaces the new `student_attendance` table unlocked by migration
 * 20260621000000_phase1_academic_structure_attendance_boards.sql.
 *
 * Two teacher-dashboard Edge Function actions used:
 *   - get_dashboard        — loads the teacher's class list
 *   - mark_attendance      — persists a full day's attendance record
 *   - get_attendance_record — pre-fills existing marks for (class, date)
 *
 * P13: teacher-dashboard binds the caller to its JWT-derived teacher_id.
 * P7:  every user-facing string has both English and Hindi variants.
 * P8:  only the client-side Supabase instance is used (via auth.getSession()).
 * P10: no new icon libraries — plain Tailwind + inline styles only.
 */

import { useState, useEffect, useCallback } from 'react';
import { useRequireAuth } from '@alfanumrik/lib/useRequireAuth';
import { useRouter } from 'next/navigation';
import { supabase } from '@alfanumrik/lib/supabase';

// ── Bilingual helper (P7) ──────────────────────────────────────
const tt = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

// ── Edge Function helpers ──────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

async function api(action: string, params: Record<string, unknown> = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_ANON,
  };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
  } catch { /* no session — Edge Function will reject */ }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/teacher-dashboard`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action, ...params }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

// ── Types ─────────────────────────────────────────────────────
type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';

interface ClassRow {
  id: string;
  name: string;
  grade?: string;
  section?: string;
}

interface StudentRow {
  id: string;
  name: string;
}

interface AttendanceRecord {
  id?: string;
  student_id: string;
  status: AttendanceStatus;
  period?: string;
  notes?: string;
}

interface RosterEntry {
  student: StudentRow;
  status: AttendanceStatus;
  notes: string;
}

// ── Date helpers ───────────────────────────────────────────────
function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

// ── Style tokens ──────────────────────────────────────────────
const pageStyle: React.CSSProperties = {
  minHeight: '100dvh',
  backgroundColor: 'var(--surface-2)',
  color: 'var(--text-1)',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  padding: '24px 20px 80px',
  maxWidth: 900,
  margin: '0 auto',
};

const cardStyle: React.CSSProperties = {
  background: 'var(--surface-1)',
  borderRadius: 14,
  padding: '18px 20px',
  border: '1px solid var(--surface-3)',
  marginBottom: 16,
};

const spinnerStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  border: '3px solid var(--surface-3)',
  borderTopColor: 'var(--orange)',
  borderRadius: '50%',
  margin: '0 auto 14px',
  animation: 'spin 0.8s linear infinite',
};

// ── Status button config ──────────────────────────────────────
interface StatusConfig {
  status: AttendanceStatus;
  labelEn: string;
  labelHi: string;
  abbrev: string;
  activeBg: string;
  activeBorder: string;
  activeText: string;
}

const STATUS_CONFIGS: StatusConfig[] = [
  {
    status: 'present',
    labelEn: 'Present',
    labelHi: 'उपस्थित',
    abbrev: 'P',
    activeBg: 'var(--green-soft)',
    activeBorder: 'var(--success)',
    activeText: 'var(--success)',
  },
  {
    status: 'absent',
    labelEn: 'Absent',
    labelHi: 'अनुपस्थित',
    abbrev: 'A',
    activeBg: 'var(--red-soft)',
    activeBorder: 'var(--danger)',
    activeText: 'var(--danger)',
  },
  {
    status: 'late',
    labelEn: 'Late',
    labelHi: 'देर से',
    abbrev: 'L',
    activeBg: 'var(--gold-soft)',
    activeBorder: 'var(--warning)',
    activeText: 'var(--warning)',
  },
  {
    status: 'excused',
    labelEn: 'Excused',
    labelHi: 'माफी',
    abbrev: 'E',
    activeBg: 'var(--surface-3)',
    activeBorder: 'var(--text-3)',
    activeText: 'var(--text-2)',
  },
];

function getConfig(status: AttendanceStatus): StatusConfig {
  return STATUS_CONFIGS.find(c => c.status === status) ?? STATUS_CONFIGS[0];
}

// ── Sub-components ─────────────────────────────────────────────

/** 4-button status toggle for one student */
function StatusToggle({
  studentId,
  currentStatus,
  onChange,
  isHi,
}: {
  studentId: string;
  currentStatus: AttendanceStatus;
  onChange: (studentId: string, status: AttendanceStatus) => void;
  isHi: boolean;
}) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {STATUS_CONFIGS.map(cfg => {
        const active = cfg.status === currentStatus;
        return (
          <button
            key={cfg.status}
            onClick={() => onChange(studentId, cfg.status)}
            title={tt(isHi, cfg.labelEn, cfg.labelHi)}
            style={{
              width: 36,
              height: 36,
              minWidth: 36,
              borderRadius: 8,
              border: `2px solid ${active ? cfg.activeBorder : 'var(--surface-3)'}`,
              backgroundColor: active ? cfg.activeBg : 'var(--surface-2)',
              color: active ? cfg.activeText : 'var(--text-3)',
              fontWeight: 700,
              fontSize: 13,
              cursor: 'pointer',
              transition: 'all 0.15s',
              boxShadow: active ? `0 0 0 2px ${cfg.activeBorder}40` : 'none',
            }}
          >
            {cfg.abbrev}
          </button>
        );
      })}
    </div>
  );
}

/** Stats bar shown after saving */
function StatsBar({
  roster,
  isHi,
}: {
  roster: RosterEntry[];
  isHi: boolean;
}) {
  const counts: Record<AttendanceStatus, number> = {
    present: 0,
    absent: 0,
    late: 0,
    excused: 0,
  };
  roster.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; });

  return (
    <div style={{
      display: 'flex',
      gap: 10,
      flexWrap: 'wrap',
      padding: '12px 16px',
      backgroundColor: 'var(--surface-2)',
      borderRadius: 10,
      marginBottom: 16,
    }}>
      {STATUS_CONFIGS.map(cfg => (
        <div key={cfg.status} style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 13,
          fontWeight: 600,
          color: cfg.activeText,
        }}>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 26,
            height: 26,
            borderRadius: 6,
            backgroundColor: cfg.activeBg,
            border: `1px solid ${cfg.activeBorder}`,
            fontSize: 12,
            fontWeight: 700,
          }}>
            {cfg.abbrev}
          </span>
          {tt(isHi, cfg.labelEn, cfg.labelHi)}: {counts[cfg.status]}
        </div>
      ))}
    </div>
  );
}

/** Skeleton rows shown during loading */
function SkeletonRows() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {[1, 2, 3].map(i => (
        <div key={i} style={{
          height: 52,
          borderRadius: 10,
          backgroundColor: 'var(--surface-2)',
          animation: 'pulse 1.5s ease-in-out infinite',
        }} />
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────
export default function TeacherAttendancePage() {
  const { isHi, isLoading, teacher } = useRequireAuth('teacher');
  const isReady = !isLoading && !!teacher;
  const router = useRouter();

  const today = todayISO();

  // ── State ───────────────────────────────────────────────
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [classesLoading, setClassesLoading] = useState(true);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedDate, setSelectedDate] = useState(today);

  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState('');

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);

  const teacherId = teacher?.id ?? '';

  // ── Load classes via get_dashboard ───────────────────────
  const loadClasses = useCallback(async () => {
    if (!teacherId) return;
    setClassesLoading(true);
    try {
      const dash = await api('get_dashboard', { teacher_id: teacherId });
      const cls = (dash?.classes ?? []) as ClassRow[];
      setClasses(cls);
      if (cls.length > 0) setSelectedClassId(prev => prev || cls[0].id);
    } catch (e) {
      // Non-fatal — user will see "no classes" empty state
      setClasses([]);
    } finally {
      setClassesLoading(false);
    }
  }, [teacherId]);

  useEffect(() => { loadClasses(); }, [loadClasses]);

  // ── Load attendance record for (class, date) ─────────────
  const loadAttendance = useCallback(async () => {
    if (!teacherId || !selectedClassId) return;
    setRosterLoading(true);
    setRosterError('');
    setSaved(false);

    try {
      const result = await api('get_attendance_record', {
        teacher_id: teacherId,
        class_id: selectedClassId,
        date: selectedDate,
      });

      // result.records contains existing marks; result.students lists all class members
      const students: StudentRow[] = result?.students ?? [];
      const records: AttendanceRecord[] = result?.records ?? [];

      // Build a map of existing statuses
      const statusMap: Record<string, AttendanceStatus> = {};
      records.forEach((r: AttendanceRecord) => {
        statusMap[r.student_id] = r.status;
      });

      // Build roster — default unrecorded students to 'present' visually
      const newRoster: RosterEntry[] = students.map(s => ({
        student: s,
        status: statusMap[s.id] ?? 'present',
        notes: '',
      }));

      setRoster(newRoster);
    } catch (e) {
      setRosterError(
        e instanceof Error ? e.message :
        tt(isHi, 'Failed to load attendance', 'उपस्थिति लोड करने में विफल')
      );
      setRoster([]);
    } finally {
      setRosterLoading(false);
    }
  }, [teacherId, selectedClassId, selectedDate, isHi]);

  useEffect(() => {
    if (selectedClassId) loadAttendance();
  }, [loadAttendance, selectedClassId, selectedDate]);

  // ── Status change handler ────────────────────────────────
  const handleStatusChange = (studentId: string, status: AttendanceStatus) => {
    setSaved(false);
    setRoster(prev =>
      prev.map(entry =>
        entry.student.id === studentId ? { ...entry, status } : entry
      )
    );
  };

  // ── Save attendance ──────────────────────────────────────
  const handleSave = async () => {
    if (!teacherId || !selectedClassId || roster.length === 0) return;
    setSaving(true);
    setSaveError('');
    setSaved(false);

    const records = roster.map(entry => ({
      student_id: entry.student.id,
      status: entry.status,
      ...(entry.notes ? { notes: entry.notes } : {}),
    }));

    try {
      await api('mark_attendance', {
        teacher_id: teacherId,
        class_id: selectedClassId,
        date: selectedDate,
        records,
      });
      setSaved(true);
    } catch (e) {
      setSaveError(
        e instanceof Error ? e.message :
        tt(isHi, 'Failed to save attendance', 'उपस्थिति सेव करने में विफल')
      );
    } finally {
      setSaving(false);
    }
  };

  // ── Render: auth / classes loading ──────────────────────
  if (!isReady || classesLoading) {
    return (
      <div style={pageStyle}>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}`}</style>
        <div style={{ textAlign: 'center', padding: 80 }}>
          <div style={spinnerStyle} />
          <p style={{ color: 'var(--text-3)', fontSize: 13 }}>
            {tt(isHi, 'Loading attendance...', 'उपस्थिति लोड हो रही है...')}
          </p>
        </div>
      </div>
    );
  }

  // ── Render: no classes ───────────────────────────────────
  if (!classesLoading && classes.length === 0) {
    return (
      <div style={pageStyle}>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        <header style={{ marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--surface-2)' }}>
          <button
            onClick={() => router.push('/teacher')}
            style={{
              background: 'var(--surface-2)', border: 'none', borderRadius: 6,
              padding: '4px 10px', color: 'var(--orange)', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', marginBottom: 8,
            }}
          >
            &larr; {tt(isHi, 'Dashboard', 'डैशबोर्ड')}
          </button>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-1)', margin: 0 }}>
            {tt(isHi, 'Attendance', 'उपस्थिति')}
          </h1>
        </header>
        <div style={{ ...cardStyle, textAlign: 'center', padding: 48 }}>
          <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-2)', margin: '0 0 6px' }}>
            {tt(isHi, 'No classes assigned yet', 'अभी कोई कक्षा नहीं दी गई है')}
          </p>
          <p style={{ fontSize: 13, color: 'var(--text-3)', margin: 0 }}>
            {tt(isHi, 'Contact your admin to be assigned to a class.', 'एक कक्षा में असाइन होने के लिए अपने व्यवस्थापक से संपर्क करें।')}
          </p>
        </div>
      </div>
    );
  }

  const selectedClass = classes.find(c => c.id === selectedClassId);

  return (
    <div style={pageStyle}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}`}</style>

      {/* ── Header ── */}
      <header style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--surface-2)', flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <button
            onClick={() => router.push('/teacher')}
            style={{
              background: 'var(--surface-2)', border: 'none', borderRadius: 6,
              padding: '4px 10px', color: 'var(--orange)', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', marginBottom: 8,
            }}
          >
            &larr; {tt(isHi, 'Dashboard', 'डैशबोर्ड')}
          </button>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-1)', margin: 0 }}>
            {tt(isHi, 'Attendance', 'उपस्थिति')}
          </h1>
          <p style={{ fontSize: 13, color: 'var(--text-3)', margin: '4px 0 0' }}>
            {selectedClass?.name && `${selectedClass.name} · `}
            {tt(isHi, 'Daily roll call', 'दैनिक हाज़िरी')}
          </p>
        </div>
      </header>

      {/* ── Class + Date selectors ── */}
      <div style={{ ...cardStyle, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Class selector */}
        <div style={{ flex: '1 1 200px' }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-3)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            {tt(isHi, 'Select Class', 'कक्षा चुनें')}
          </label>
          <select
            value={selectedClassId}
            onChange={e => { setSelectedClassId(e.target.value); setSaved(false); }}
            style={{
              width: '100%', padding: '8px 10px', backgroundColor: 'var(--surface-2)',
              color: 'var(--text-1)', border: '1px solid var(--surface-3)', borderRadius: 8,
              fontSize: 13, outline: 'none', cursor: 'pointer',
            }}
          >
            {classes.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}{c.grade ? ` (Grade ${c.grade}${c.section ? ` ${c.section}` : ''})` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Date picker */}
        <div style={{ flex: '1 1 180px' }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-3)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            {tt(isHi, 'Date', 'तारीख')}
          </label>
          <input
            type="date"
            value={selectedDate}
            max={today}
            onChange={e => { setSelectedDate(e.target.value); setSaved(false); }}
            style={{
              width: '100%', padding: '8px 10px', backgroundColor: 'var(--surface-2)',
              color: 'var(--text-1)', border: '1px solid var(--surface-3)', borderRadius: 8,
              fontSize: 13, outline: 'none', cursor: 'pointer',
              boxSizing: 'border-box',
            }}
          />
        </div>
      </div>

      {/* ── Stats bar (shown after save) ── */}
      {saved && roster.length > 0 && (
        <StatsBar roster={roster} isHi={isHi} />
      )}

      {/* ── Save success / error banners ── */}
      {saved && (
        <div style={{
          backgroundColor: 'var(--green-soft)', border: '1px solid var(--success)', borderRadius: 10,
          padding: '10px 14px', marginBottom: 14, fontSize: 13, fontWeight: 600, color: 'var(--success)',
        }}>
          {tt(isHi, 'Attendance saved', 'उपस्थिति सेव हो गई')}
        </div>
      )}
      {saveError && (
        <div style={{
          backgroundColor: 'var(--red-soft)', border: '1px solid var(--danger)', borderRadius: 10,
          padding: '10px 14px', marginBottom: 14, fontSize: 13, color: 'var(--danger)',
        }}>
          {saveError}
        </div>
      )}

      {/* ── Roster ── */}
      <div style={cardStyle}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 14, flexWrap: 'wrap', gap: 8,
        }}>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', margin: 0 }}>
            {tt(isHi, 'Students', 'विद्यार्थी')}
            {!rosterLoading && roster.length > 0 && (
              <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-3)', marginLeft: 8 }}>
                ({roster.length})
              </span>
            )}
          </h2>

          {/* Status legend */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {STATUS_CONFIGS.map(cfg => (
              <span key={cfg.status} style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 6,
                backgroundColor: cfg.activeBg, border: `1px solid ${cfg.activeBorder}`,
                color: cfg.activeText, fontWeight: 600,
              }}>
                {cfg.abbrev} = {tt(isHi, cfg.labelEn, cfg.labelHi)}
              </span>
            ))}
          </div>
        </div>

        {/* Loading skeleton */}
        {rosterLoading && <SkeletonRows />}

        {/* Error */}
        {!rosterLoading && rosterError && (
          <div style={{
            backgroundColor: 'var(--red-soft)', border: '1px solid var(--red-soft)', borderRadius: 10,
            padding: '14px 16px', textAlign: 'center',
          }}>
            <p style={{ fontSize: 13, color: 'var(--danger)', margin: '0 0 10px' }}>{rosterError}</p>
            <button
              onClick={loadAttendance}
              style={{
                padding: '6px 14px', backgroundColor: 'var(--danger)', color: 'white',
                border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {tt(isHi, 'Retry', 'पुनः प्रयास करें')}
            </button>
          </div>
        )}

        {/* Empty */}
        {!rosterLoading && !rosterError && roster.length === 0 && (
          <div style={{ textAlign: 'center', padding: '32px 16px' }}>
            <p style={{ fontSize: 14, color: 'var(--text-3)', margin: 0 }}>
              {tt(isHi, 'No students enrolled in this class', 'इस कक्षा में कोई विद्यार्थी नहीं है')}
            </p>
          </div>
        )}

        {/* Student rows */}
        {!rosterLoading && !rosterError && roster.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {roster.map((entry, idx) => {
              const cfg = getConfig(entry.status);
              return (
                <div
                  key={entry.student.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 12px',
                    borderRadius: 10,
                    backgroundColor: idx % 2 === 0 ? 'var(--surface-2)' : 'var(--surface-1)',
                    border: `1px solid ${entry.status !== 'present' ? cfg.activeBorder + '60' : 'var(--surface-2)'}`,
                    flexWrap: 'wrap',
                  }}
                >
                  {/* Student name */}
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}>
                      {entry.student.name}
                    </span>
                    {entry.status !== 'present' && (
                      <span style={{
                        marginLeft: 8, fontSize: 11, fontWeight: 600,
                        color: cfg.activeText, backgroundColor: cfg.activeBg,
                        padding: '1px 6px', borderRadius: 4,
                      }}>
                        {tt(isHi, cfg.labelEn, cfg.labelHi)}
                      </span>
                    )}
                  </div>

                  {/* Status buttons */}
                  <StatusToggle
                    studentId={entry.student.id}
                    currentStatus={entry.status}
                    onChange={handleStatusChange}
                    isHi={isHi}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Save button ── */}
      {!rosterLoading && roster.length > 0 && (
        <div style={{ textAlign: 'right' }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '12px 28px',
              backgroundColor: saving ? 'var(--orange)' : 'var(--orange)',
              color: 'white',
              border: 'none',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 700,
              cursor: saving ? 'wait' : 'pointer',
              opacity: saving ? 0.85 : 1,
              transition: 'all 0.15s',
              minWidth: 180,
            }}
          >
            {saving
              ? tt(isHi, 'Saving...', 'सेव हो रहा है...')
              : tt(isHi, 'Save Attendance', 'उपस्थिति सेव करें')
            }
          </button>
        </div>
      )}
    </div>
  );
}
