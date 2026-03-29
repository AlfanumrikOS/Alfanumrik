'use client';

import { FoxyAvatar, Button } from '@/components/ui';

/**
 * FoxySessionStart — Mode and subject picker for starting a Foxy session.
 * Replaces the complex toolbar with a clean, guided selection.
 * Foxy leads: "What shall we do?"
 */

interface SessionMode {
  id: string;
  emoji: string;
  label: string;
  labelHi: string;
  desc: string;
  descHi: string;
}

const SESSION_MODES: SessionMode[] = [
  { id: 'learn', emoji: '📖', label: 'Learn', labelHi: 'सीखो', desc: 'Step-by-step concept teaching', descHi: 'कदम-दर-कदम कॉन्सेप्ट सीखो' },
  { id: 'practice', emoji: '✏️', label: 'Practice', labelHi: 'अभ्यास', desc: 'Solve problems with guidance', descHi: 'मदद के साथ सवाल हल करो' },
  { id: 'quiz', emoji: '⚡', label: 'Quiz', labelHi: 'क्विज़', desc: 'Test your understanding', descHi: 'अपनी समझ परखो' },
  { id: 'doubt', emoji: '❓', label: 'Ask Doubt', labelHi: 'डाउट पूछो', desc: 'Ask anything you don\'t understand', descHi: 'जो नहीं समझ आया वो पूछो' },
];

interface SubjectOption {
  code: string;
  name: string;
  icon: string;
  color: string;
}

interface FoxySessionStartProps {
  isHi: boolean;
  subjects: SubjectOption[];
  selectedSubject: string;
  onSelectSubject: (code: string) => void;
  onSelectMode: (modeId: string) => void;
  foxyRecommendation?: { mode: string; topic: string } | null;
}

export default function FoxySessionStart({
  isHi,
  subjects,
  selectedSubject,
  onSelectSubject,
  onSelectMode,
  foxyRecommendation,
}: FoxySessionStartProps) {
  return (
    <div className="flex flex-col items-center px-4 py-6 animate-fade-in">
      {/* Foxy greeting */}
      <FoxyAvatar state="idle" size="lg" />
      <h2 className="text-lg font-bold mt-4" style={{ fontFamily: 'var(--font-display)' }}>
        {isHi ? 'आज क्या करें?' : 'What shall we do?'}
      </h2>

      {/* Subject pills */}
      {subjects.length > 1 && (
        <div className="flex flex-wrap gap-2 justify-center mt-4">
          {subjects.map((s) => (
            <button
              key={s.code}
              onClick={() => onSelectSubject(s.code)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all"
              style={{
                background: selectedSubject === s.code ? `${s.color}15` : 'var(--surface-1)',
                border: `1.5px solid ${selectedSubject === s.code ? s.color : 'var(--border)'}`,
                color: selectedSubject === s.code ? s.color : 'var(--text-2)',
              }}
            >
              <span>{s.icon}</span>
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* Foxy recommendation */}
      {foxyRecommendation && (
        <button
          onClick={() => onSelectMode(foxyRecommendation.mode)}
          className="w-full max-w-sm mt-5 p-4 rounded-xl text-left transition-all active:scale-[0.98]"
          style={{
            background: 'linear-gradient(135deg, #FFF7ED, #FEF3E2)',
            border: '1.5px solid rgba(232,88,28,0.2)',
          }}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm">🦊</span>
            <span className="text-xs font-bold" style={{ color: 'var(--orange)' }}>
              {isHi ? 'Foxy सुझाव' : 'Foxy suggests'}
            </span>
          </div>
          <p className="text-sm font-semibold text-[var(--text-1)]">{foxyRecommendation.topic}</p>
        </button>
      )}

      {/* Mode cards */}
      <div className="w-full max-w-sm mt-5 space-y-2">
        {SESSION_MODES.map((mode) => (
          <button
            key={mode.id}
            onClick={() => onSelectMode(mode.id)}
            className="w-full p-4 rounded-xl text-left flex items-center gap-3 transition-all active:scale-[0.98]"
            style={{
              background: 'var(--surface-1)',
              border: '1px solid var(--border)',
            }}
          >
            <span className="text-2xl">{mode.emoji}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">{isHi ? mode.labelHi : mode.label}</div>
              <div className="text-xs text-[var(--text-3)] mt-0.5">{isHi ? mode.descHi : mode.desc}</div>
            </div>
            <span className="text-[var(--text-3)]">→</span>
          </button>
        ))}
      </div>
    </div>
  );
}
