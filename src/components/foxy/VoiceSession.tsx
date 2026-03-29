'use client';

import { useFoxyVoice, type VoiceStatus } from '@/hooks/useFoxyVoice';
import type { SessionMode } from '@/lib/foxy-voice-engine';

interface VoiceSessionProps {
  studentId: string;
  studentName: string;
  grade: string;
  subject: string;
  topic: string;
  language: 'en' | 'hi' | 'hinglish';
  mode: SessionMode;
  onClose: () => void;
}

const STATUS_CONFIG: Record<VoiceStatus, { label: string; labelHi: string; icon: string; color: string }> = {
  idle: { label: 'Tap to start', labelHi: 'शुरू करने के लिए टैप करो', icon: '🎙️', color: '#64748B' },
  requesting_mic: { label: 'Allowing microphone...', labelHi: 'माइक अनुमति...', icon: '🎤', color: '#F59E0B' },
  listening: { label: 'Listening...', labelHi: 'सुन रहा हूँ...', icon: '👂', color: '#16A34A' },
  thinking: { label: 'Foxy is thinking...', labelHi: 'Foxy सोच रहा है...', icon: '🤔', color: '#7C3AED' },
  speaking: { label: 'Foxy is speaking', labelHi: 'Foxy बोल रहा है', icon: '🦊', color: '#E8581C' },
  error: { label: 'Issue detected', labelHi: 'समस्या मिली', icon: '⚠️', color: '#EF4444' },
};

export default function VoiceSession({
  studentId, studentName, grade, subject, topic, language, mode, onClose,
}: VoiceSessionProps) {
  const isHi = language === 'hi';
  const {
    status, isSessionActive, currentTranscript, foxyText,
    startSession, endSession, toggleMute, isMuted, error,
    micPermission, requestMicPermission,
  } = useFoxyVoice({ studentId, studentName, grade, subject, topic, language, mode });

  const cfg = STATUS_CONFIG[status];

  const handleMainAction = () => {
    if (!isSessionActive) {
      startSession();
    }
  };

  const handleEnd = async () => {
    await endSession();
    onClose();
  };

  return (
    <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) handleEnd(); }}>
      <div style={container}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 22 }}>🦊</span>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-display)' }}>Foxy Voice</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{topic}</div>
            </div>
          </div>
          <button onClick={handleEnd} style={endBtn}>
            {isHi ? 'बंद करो' : 'End'}
          </button>
        </div>

        {/* Main Area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, gap: 16, overflow: 'auto' }}>

          {/* Error state with retry */}
          {!isSessionActive && error && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A520', borderRadius: 14, padding: 16, maxWidth: 320, textAlign: 'center' }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#DC2626', marginBottom: 8 }}>
                {isHi ? 'माइक्रोफ़ोन समस्या' : 'Microphone Issue'}
              </p>
              <p style={{ fontSize: 12, color: '#666', lineHeight: 1.6, marginBottom: 12 }}>
                {error}
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button onClick={() => startSession()} style={{ ...primaryBtn, fontSize: 12, padding: '8px 16px' }}>
                  {isHi ? 'फिर से कोशिश करो' : 'Try Again'}
                </button>
                {micPermission === 'denied' && (
                  <button onClick={() => window.location.reload()} style={{ fontSize: 12, padding: '8px 16px', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface-1)', cursor: 'pointer', color: 'var(--text-2)' }}>
                    {isHi ? 'रीफ्रेश' : 'Refresh'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Pre-session: show start button */}
          {!isSessionActive && !error && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🦊</div>
              <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
                {isHi ? `${studentName.split(' ')[0]}, Foxy से बात करो` : `Talk to Foxy, ${studentName.split(' ')[0]}`}
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 20, maxWidth: 260 }}>
                {isHi
                  ? 'माइक की अनुमति दो और Foxy से बोलकर पढ़ो।'
                  : 'Allow microphone access and start a voice study session with Foxy.'}
              </p>
              <button onClick={handleMainAction} style={primaryBtn}>
                {isHi ? '🎙️ सेशन शुरू करो' : '🎙️ Start Voice Session'}
              </button>
            </div>
          )}

          {/* Active session */}
          {isSessionActive && (
            <>
              {/* Foxy's spoken text */}
              {foxyText && (
                <div style={{
                  background: 'var(--surface-1)', border: '1px solid var(--border)',
                  borderRadius: 16, padding: 14, maxWidth: 300, textAlign: 'center',
                  fontSize: 14, lineHeight: 1.6, color: 'var(--text-1)',
                }}>
                  {foxyText}
                </div>
              )}

              {/* Voice orb */}
              <div
                style={{
                  width: 110, height: 110, borderRadius: '50%',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 2,
                  background: `linear-gradient(135deg, ${cfg.color}, ${cfg.color}cc)`,
                  boxShadow: `0 0 ${status === 'listening' ? 40 : 20}px ${cfg.color}40`,
                  transition: 'all 0.3s ease',
                  animation: status === 'listening' ? 'voicePulse 1.5s ease-in-out infinite' : 'none',
                }}
              >
                <span style={{ fontSize: 28 }}>{cfg.icon}</span>
                <span style={{ fontSize: 9, fontWeight: 600, color: '#fff', opacity: 0.9 }}>
                  {isHi ? cfg.labelHi : cfg.label}
                </span>
              </div>

              {/* Live transcript */}
              {currentTranscript && (
                <div style={{ fontSize: 13, color: 'var(--text-2)', fontStyle: 'italic', textAlign: 'center', maxWidth: 280 }}>
                  &ldquo;{currentTranscript}&rdquo;
                </div>
              )}
            </>
          )}

          {/* In-session error (connection issues etc.) */}
          {isSessionActive && error && (
            <div style={{ fontSize: 12, color: '#EF4444', textAlign: 'center', maxWidth: 280 }}>
              {error}
            </div>
          )}
        </div>

        {/* Bottom controls */}
        {isSessionActive && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 14, padding: 14, borderTop: '1px solid var(--border)' }}>
            <button onClick={toggleMute} style={controlBtn}>
              <span style={{ fontSize: 18 }}>{isMuted ? '🔇' : '🔊'}</span>
              <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{isMuted ? 'Muted' : 'Sound'}</span>
            </button>
          </div>
        )}

        <style jsx>{`
          @keyframes voicePulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.06); }
          }
        `}</style>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 100,
  background: 'rgba(0,0,0,0.5)', display: 'flex',
  alignItems: 'center', justifyContent: 'center', padding: 16,
};
const container: React.CSSProperties = {
  background: 'var(--bg, #FBF8F4)', borderRadius: 24,
  width: '100%', maxWidth: 380, maxHeight: '80vh',
  display: 'flex', flexDirection: 'column', overflow: 'hidden',
  boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
};
const primaryBtn: React.CSSProperties = {
  padding: '12px 24px', borderRadius: 14, border: 'none',
  fontSize: 14, fontWeight: 700, cursor: 'pointer',
  background: 'linear-gradient(135deg, #E8581C, #F5A623)', color: '#fff',
  fontFamily: 'var(--font-display)',
};
const endBtn: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: '#EF4444', padding: '6px 14px',
  borderRadius: 8, border: '1px solid #EF444430', background: '#EF444408', cursor: 'pointer',
};
const controlBtn: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
  padding: '8px 20px', borderRadius: 12, border: '1px solid var(--border)',
  background: 'var(--surface-1)', cursor: 'pointer',
};
