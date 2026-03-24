'use client';

import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';

/* ═══════════════════════════════════════════════════════════════
   FOCUS MODE — Distraction-Free Study Component
   Pomodoro-style timer with minimal UI for deep study sessions.
   ═══════════════════════════════════════════════════════════════ */

type TimerPhase = 'study' | 'break';

interface FocusModeConfig {
  studyMinutes: number;
  breakMinutes: number;
}

const DEFAULT_CONFIG: FocusModeConfig = { studyMinutes: 25, breakMinutes: 5 };

const PRESETS: { label: string; study: number; brk: number }[] = [
  { label: '25/5', study: 25, brk: 5 },
  { label: '50/10', study: 50, brk: 10 },
  { label: '15/3', study: 15, brk: 3 },
];

interface FocusModeProps {
  children: ReactNode;
  active: boolean;
  onExit: () => void;
  subjectColor?: string;
  subjectIcon?: string;
  subjectName?: string;
}

export function FocusMode({
  children,
  active,
  onExit,
  subjectColor = '#0EA5E9',
  subjectIcon = '📖',
  subjectName = 'Study',
}: FocusModeProps) {
  const [config, setConfig] = useState<FocusModeConfig>(DEFAULT_CONFIG);
  const [secondsLeft, setSecondsLeft] = useState(DEFAULT_CONFIG.studyMinutes * 60);
  const [phase, setPhase] = useState<TimerPhase>('study');
  const [running, setRunning] = useState(false);
  const [sessionsCompleted, setSessions] = useState(0);
  const [totalStudySeconds, setTotalStudy] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseStartRef = useRef<number>(0);

  // Total duration for current phase (for progress bar)
  const totalPhaseSeconds = phase === 'study' ? config.studyMinutes * 60 : config.breakMinutes * 60;
  const progress = totalPhaseSeconds > 0 ? ((totalPhaseSeconds - secondsLeft) / totalPhaseSeconds) * 100 : 0;

  // Manage body class for hiding nav
  useEffect(() => {
    if (active) {
      document.body.classList.add('focus-mode-active');
    } else {
      document.body.classList.remove('focus-mode-active');
    }
    return () => {
      document.body.classList.remove('focus-mode-active');
    };
  }, [active]);

  // Auto-start timer when focus mode activates
  useEffect(() => {
    if (active && !running) {
      setRunning(true);
      phaseStartRef.current = Date.now();
    }
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  // Timer tick
  useEffect(() => {
    if (!running || !active) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          // Phase complete
          if (phase === 'study') {
            setSessions((s) => s + 1);
            setTotalStudy((t) => t + config.studyMinutes * 60);
            setPhase('break');
            return config.breakMinutes * 60;
          } else {
            setPhase('study');
            return config.studyMinutes * 60;
          }
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running, active, phase, config]);

  // Track study time even between ticks
  useEffect(() => {
    if (running && phase === 'study') {
      phaseStartRef.current = Date.now();
    }
  }, [running, phase]);

  const togglePause = useCallback(() => {
    if (running && phase === 'study') {
      // accumulate partial study time
      const elapsed = Math.floor((Date.now() - phaseStartRef.current) / 1000);
      setTotalStudy((t) => t + elapsed);
    }
    setRunning((r) => !r);
  }, [running, phase]);

  const resetTimer = useCallback(() => {
    setSecondsLeft(config.studyMinutes * 60);
    setPhase('study');
    setRunning(false);
  }, [config]);

  const applyPreset = useCallback((study: number, brk: number) => {
    const newConfig = { studyMinutes: study, breakMinutes: brk };
    setConfig(newConfig);
    setSecondsLeft(study * 60);
    setPhase('study');
    setRunning(false);
    setShowSettings(false);
  }, []);

  const handleExit = useCallback(() => {
    setRunning(false);
    if (intervalRef.current) clearInterval(intervalRef.current);
    // accumulate remaining study time
    if (phase === 'study' && phaseStartRef.current > 0) {
      const elapsed = Math.floor((Date.now() - phaseStartRef.current) / 1000);
      setTotalStudy((t) => t + elapsed);
    }
    onExit();
  }, [onExit, phase]);

  // Format mm:ss
  const fmt = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const fmtTotal = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  if (!active) return null;

  return (
    <div className="focus-mode-overlay">
      {/* ── Minimal Top Bar ── */}
      <div className="focus-mode-topbar">
        <button
          onClick={handleExit}
          className="focus-mode-btn"
          style={{ color: 'var(--text-3)' }}
          aria-label="Go back"
        >
          <span style={{ fontSize: 18 }}>←</span>
        </button>

        {/* Timer display */}
        <div className="focus-mode-timer-group">
          <span
            className="focus-mode-phase-badge"
            style={{
              background: phase === 'study' ? `${subjectColor}15` : '#16A34A15',
              color: phase === 'study' ? subjectColor : '#16A34A',
              border: `1px solid ${phase === 'study' ? `${subjectColor}30` : '#16A34A30'}`,
            }}
          >
            {phase === 'study' ? `${subjectIcon} Study` : '☕ Break'}
          </span>
          <button
            onClick={togglePause}
            className="focus-mode-timer-display"
            style={{ color: phase === 'study' ? subjectColor : '#16A34A' }}
            aria-label={running ? 'Pause timer' : 'Resume timer'}
          >
            <span style={{ fontSize: 11, marginRight: 4, opacity: 0.6 }}>
              {running ? '⏸' : '▶'}
            </span>
            {fmt(secondsLeft)}
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="focus-mode-btn"
            style={{ color: 'var(--text-3)', fontSize: 14 }}
            aria-label="Timer settings"
          >
            ⚙
          </button>
          <button
            onClick={handleExit}
            className="focus-mode-exit-btn"
            style={{ background: `${subjectColor}12`, color: subjectColor, border: `1.5px solid ${subjectColor}25` }}
          >
            Exit Focus
          </button>
        </div>
      </div>

      {/* ── Progress indicator ── */}
      <div className="focus-mode-progress-track">
        <div
          className="focus-mode-progress-bar"
          style={{
            width: `${progress}%`,
            background: phase === 'study'
              ? `linear-gradient(90deg, ${subjectColor}, ${subjectColor}bb)`
              : 'linear-gradient(90deg, #16A34A, #16A34Abb)',
          }}
        />
      </div>

      {/* ── Settings popover ── */}
      {showSettings && (
        <>
          <div className="fixed inset-0 z-[52]" onClick={() => setShowSettings(false)} />
          <div className="focus-mode-settings">
            <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-3)' }}>
              Timer Presets
            </div>
            <div className="flex gap-2 mb-3">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => applyPreset(p.study, p.brk)}
                  className="flex-1 py-2 rounded-xl text-xs font-bold transition-all active:scale-95"
                  style={{
                    background: config.studyMinutes === p.study ? `${subjectColor}15` : 'var(--surface-2)',
                    color: config.studyMinutes === p.study ? subjectColor : 'var(--text-3)',
                    border: `1.5px solid ${config.studyMinutes === p.study ? `${subjectColor}30` : 'var(--border)'}`,
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button
              onClick={resetTimer}
              className="w-full py-2 rounded-xl text-xs font-semibold transition-all active:scale-95"
              style={{ background: 'var(--surface-2)', color: 'var(--text-3)', border: '1px solid var(--border)' }}
            >
              Reset Timer
            </button>
            {/* Session stats */}
            <div className="mt-3 pt-3 flex gap-3" style={{ borderTop: '1px solid var(--border)' }}>
              <div className="text-center flex-1">
                <div className="text-lg font-bold" style={{ color: subjectColor }}>{sessionsCompleted}</div>
                <div className="text-[10px] text-[var(--text-3)]">Sessions</div>
              </div>
              <div className="text-center flex-1">
                <div className="text-lg font-bold" style={{ color: subjectColor }}>{fmtTotal(totalStudySeconds)}</div>
                <div className="text-[10px] text-[var(--text-3)]">Study Time</div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Content area with reading-optimized typography ── */}
      <div className="focus-mode-content">
        {children}
      </div>
    </div>
  );
}

export default FocusMode;
