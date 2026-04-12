'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAdmin } from '../../../_components/AdminShell';
import { colors, S } from '../../../_components/admin-styles';

interface Session {
  id: string;
  admin_id: string;
  student_id: string;
  started_at: string;
  expires_at: string;
  pages_viewed: string[];
  ip_address: string | null;
}

interface LiveViewFrameProps {
  studentId: string;
}

const TABS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'progress', label: 'Progress' },
  { key: 'foxy', label: 'Foxy' },
  { key: 'quizzes', label: 'Quizzes' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default function LiveViewFrame({ studentId }: LiveViewFrameProps) {
  const { apiFetch } = useAdmin();
  const [session, setSession] = useState<Session | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [studentName, setStudentName] = useState<string>('');
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionActiveRef = useRef(false);

  /* ---------- Start / check session ---------- */
  const startSession = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Check for existing session first
      const checkRes = await apiFetch(
        `/api/super-admin/students/${studentId}/impersonate`
      );
      if (checkRes.ok) {
        const checkData = await checkRes.json();
        if (checkData.active && checkData.session) {
          setSession(checkData.session);
          setRemaining(checkData.remainingSeconds);
          sessionActiveRef.current = true;
          setLoading(false);
          return;
        }
      }

      // Start new session
      const res = await apiFetch(
        `/api/super-admin/students/${studentId}/impersonate`,
        { method: 'POST' }
      );
      if (!res.ok) {
        const body = await res
          .json()
          .catch(() => ({ error: 'Failed to start session' }));
        setError(body.error || 'Failed to start impersonation session');
        setLoading(false);
        return;
      }
      const data = await res.json();
      setSession(data.session);
      // Default session is 30 minutes
      const expiresAt = new Date(data.session.expires_at).getTime();
      setRemaining(Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)));
      sessionActiveRef.current = true;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to start session'
      );
    } finally {
      setLoading(false);
    }
  }, [apiFetch, studentId]);

  /* ---------- End session ---------- */
  const endSession = useCallback(async () => {
    sessionActiveRef.current = false;
    try {
      await apiFetch(
        `/api/super-admin/students/${studentId}/impersonate`,
        { method: 'PATCH' }
      );
    } catch {
      // Fire-and-forget
    }
    setSession(null);
    setRemaining(0);
  }, [apiFetch, studentId]);

  /* ---------- Lifecycle ---------- */
  useEffect(() => {
    startSession();
    return () => {
      // End session on unmount
      if (sessionActiveRef.current) {
        // Use a fire-and-forget fetch for cleanup
        const path = `/api/super-admin/students/${studentId}/impersonate`;
        fetch(path, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          keepalive: true,
        }).catch(() => {});
        sessionActiveRef.current = false;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- Fetch student name once session is active ---------- */
  useEffect(() => {
    if (!session) return;
    apiFetch(`/api/super-admin/students/${studentId}/dashboard`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.student?.name) setStudentName(data.student.name);
      })
      .catch(() => {});
  }, [session, apiFetch, studentId]);

  /* ---------- Countdown timer ---------- */
  useEffect(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    if (!session || remaining <= 0) return;

    countdownRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          sessionActiveRef.current = false;
          setSession(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [session, remaining]);

  /* ---------- Format seconds as mm:ss ---------- */
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  /* ---------- Loading ---------- */
  if (loading) {
    return (
      <div
        style={{
          padding: 32,
          textAlign: 'center',
          color: colors.text3,
          fontSize: 13,
        }}
      >
        Starting impersonation session...
      </div>
    );
  }

  /* ---------- Error ---------- */
  if (error) {
    return (
      <div
        style={{
          padding: 16,
          color: colors.danger,
          background: colors.dangerLight,
          borderRadius: 8,
          fontSize: 13,
        }}
      >
        {error}
        <div style={{ marginTop: 12 }}>
          <button onClick={startSession} style={S.primaryBtn}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  /* ---------- Session expired ---------- */
  if (!session) {
    return (
      <div
        style={{
          padding: 32,
          textAlign: 'center',
          color: colors.text3,
          fontSize: 14,
        }}
      >
        <div style={{ marginBottom: 12 }}>Session expired or not started.</div>
        <button onClick={startSession} style={S.primaryBtn}>
          Start New Session
        </button>
      </div>
    );
  }

  /* ---------- Active session ---------- */
  const iframeSrc = `/super-admin/view-as/${studentId}/${activeTab}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* Red banner */}
      <div
        style={{
          background: colors.danger,
          color: '#fff',
          padding: '10px 16px',
          fontSize: 13,
          fontWeight: 600,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderRadius: '8px 8px 0 0',
        }}
      >
        <span>
          VIEWING AS {studentName || 'Student'} &mdash; READ ONLY
        </span>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 12, opacity: 0.9 }}>
            Expires in {formatTime(remaining)}
          </span>
          <button
            onClick={endSession}
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: '1px solid rgba(255,255,255,0.4)',
              color: '#fff',
              borderRadius: 5,
              padding: '4px 12px',
              fontSize: 12,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            End Session
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          gap: 0,
          borderBottom: `1px solid ${colors.border}`,
          background: colors.surface,
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: '10px 20px',
              fontSize: 13,
              fontWeight: activeTab === tab.key ? 600 : 400,
              color: activeTab === tab.key ? colors.text1 : colors.text2,
              background: activeTab === tab.key ? colors.bg : 'transparent',
              borderBottom:
                activeTab === tab.key
                  ? `2px solid ${colors.text1}`
                  : '2px solid transparent',
              border: 'none',
              borderBottomStyle: 'solid',
              borderBottomWidth: 2,
              borderBottomColor:
                activeTab === tab.key ? colors.text1 : 'transparent',
              cursor: 'pointer',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* iframe */}
      <iframe
        src={iframeSrc}
        style={{
          width: '100%',
          height: 'calc(100vh - 220px)',
          minHeight: 500,
          border: `1px solid ${colors.border}`,
          borderTop: 'none',
          borderRadius: '0 0 8px 8px',
          background: colors.bg,
        }}
        title="Student Live View"
      />
    </div>
  );
}