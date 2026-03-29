'use client';

import { useState } from 'react';
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

const STATUS_LABELS: Record<VoiceStatus, { en: string; hi: string; icon: string }> = {
  idle: { en: 'Tap to start', hi: 'शुरू करने के लिए टैप करो', icon: '🎙️' },
  listening: { en: 'Listening...', hi: 'सुन रहा हूँ...', icon: '👂' },
  thinking: { en: 'Thinking...', hi: 'सोच रहा हूँ...', icon: '🤔' },
  speaking: { en: 'Foxy is speaking', hi: 'Foxy बोल रहा है', icon: '🦊' },
  error: { en: 'Connection issue', hi: 'कनेक्शन समस्या', icon: '⚠️' },
};

export default function VoiceSession({
  studentId, studentName, grade, subject, topic, language, mode, onClose,
}: VoiceSessionProps) {
  const isHi = language === 'hi';
  const {
    status, isSessionActive, currentTranscript, foxyText,
    startSession, endSession, toggleMute, isMuted, error,
  } = useFoxyVoice({ studentId, studentName, grade, subject, topic, language, mode });

  const [showTranscript, setShowTranscript] = useState(false);
  const statusInfo = STATUS_LABELS[status];

  const handleMainButton = () => {
    if (!isSessionActive) {
      startSession();
    }
  };

  const handleEnd = async () => {
    await endSession();
    onClose();
  };

  return (
    <div style={overlay}>
      <div style={container}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 20 }}>🦊</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-display)' }}>
                Foxy Voice
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                {topic} · {subject}
              </div>
            </div>
          </div>
          <button onClick={handleEnd} style={{ fontSize: 12, fontWeight: 600, color: '#EF4444', padding: '6px 14px', borderRadius: 8, border: '1px solid #EF444430', background: '#EF444408', cursor: 'pointer' }}>
            {isHi ? 'समाप्त करो' : 'End Session'}
          </button>
        </div>

        {/* Main Voice Area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 20 }}>

          {/* Foxy's spoken text */}
          {foxyText && (
            <div style={{
              background: 'var(--surface-1)', border: '1px solid var(--border)',
              borderRadius: 16, padding: 16, maxWidth: 320, textAlign: 'center',
              fontSize: 14, lineHeight: 1.6, color: 'var(--text-1)',
            }}>
              {foxyText}
            </div>
          )}

          {/* Voice orb — pulsing circle */}
          <button
            onClick={handleMainButton}
            disabled={isSessionActive && status !== 'idle'}
            style={{
              width: 120, height: 120, borderRadius: '50%', border: 'none',
              cursor: 'pointer', display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 4,
              background: status === 'listening'
                ? 'linear-gradient(135deg, #16A34A, #22C55E)'
                : status === 'speaking'
                ? 'linear-gradient(135deg, #E8581C, #F5A623)'
                : status === 'thinking'
                ? 'linear-gradient(135deg, #7C3AED, #A855F7)'
                : 'linear-gradient(135deg, #64748B, #94A3B8)',
              boxShadow: status === 'listening'
                ? '0 0 40px rgba(22, 163, 74, 0.3)'
                : status === 'speaking'
                ? '0 0 40px rgba(232, 88, 28, 0.3)'
                : '0 0 20px rgba(0,0,0,0.1)',
              animation: status === 'listening' ? 'voicePulse 1.5s ease-in-out infinite' : 'none',
              transition: 'all 0.3s ease',
            }}
          >
            <span style={{ fontSize: 32 }}>{statusInfo.icon}</span>
            <span style={{ fontSize: 10, fontWeight: 600, color: '#fff' }}>
              {isHi ? statusInfo.hi : statusInfo.en}
            </span>
          </button>

          {/* Live transcript */}
          {currentTranscript && (
            <div style={{
              fontSize: 13, color: 'var(--text-2)', fontStyle: 'italic',
              textAlign: 'center', maxWidth: 280,
            }}>
              &ldquo;{currentTranscript}&rdquo;
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ fontSize: 12, color: '#EF4444', textAlign: 'center', maxWidth: 280 }}>
              {error}
            </div>
          )}
        </div>

        {/* Bottom Controls */}
        <div style={{
          display: 'flex', justifyContent: 'center', gap: 16, padding: 16,
          borderTop: '1px solid var(--border)',
        }}>
          <button onClick={toggleMute} style={controlBtn}>
            <span>{isMuted ? '🔇' : '🔊'}</span>
            <span style={{ fontSize: 10 }}>{isMuted ? (isHi ? 'म्यूट' : 'Muted') : (isHi ? 'आवाज़' : 'Sound')}</span>
          </button>
          <button onClick={() => setShowTranscript(!showTranscript)} style={controlBtn}>
            <span>📝</span>
            <span style={{ fontSize: 10 }}>{isHi ? 'ट्रांसक्रिप्ट' : 'Transcript'}</span>
          </button>
        </div>

        {/* CSS animation */}
        <style jsx>{`
          @keyframes voicePulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.08); }
          }
        `}</style>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 100,
  background: 'rgba(0,0,0,0.6)', display: 'flex',
  alignItems: 'center', justifyContent: 'center', padding: 16,
};

const container: React.CSSProperties = {
  background: 'var(--bg, #FBF8F4)', borderRadius: 24,
  width: '100%', maxWidth: 400, height: '80vh', maxHeight: 600,
  display: 'flex', flexDirection: 'column', overflow: 'hidden',
  boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
};

const controlBtn: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
  padding: '8px 16px', borderRadius: 12, border: '1px solid var(--border)',
  background: 'var(--surface-1)', cursor: 'pointer', fontSize: 18,
  color: 'var(--text-2)',
};
