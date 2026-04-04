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
  color: string;
}

const PRIMARY_MODES: SessionMode[] = [
  { id: 'learn', emoji: '📖', label: 'Teach me', labelHi: 'मुझे सिखाओ', desc: 'Explain a concept step by step', descHi: 'एक concept step by step समझाओ', color: '#2563EB' },
  { id: 'doubt', emoji: '✏️', label: 'Help me solve', labelHi: 'हल करने में मदद करो', desc: 'I\'m stuck on a problem', descHi: 'एक सवाल में अटक गया हूँ', color: '#7C3AED' },
  { id: 'quiz', emoji: '⚡', label: 'Test me', labelHi: 'मेरा टेस्ट लो', desc: 'Quick quiz to check what I know', descHi: 'जो आता है उसका टेस्ट लो', color: '#F59E0B' },
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

      {/* Primary mode cards */}
      <div className="w-full max-w-sm mt-5 space-y-2">
        {PRIMARY_MODES.map((mode) => (
          <button
            key={mode.id}
            onClick={() => onSelectMode(mode.id)}
            className="w-full p-4 rounded-xl text-left flex items-center gap-3 transition-all active:scale-[0.98]"
            style={{
              background: `${mode.color}08`,
              border: `1.5px solid ${mode.color}30`,
            }}
          >
            <span className="text-2xl">{mode.emoji}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold" style={{ color: mode.color }}>{isHi ? mode.labelHi : mode.label}</div>
              <div className="text-xs text-[var(--text-3)] mt-0.5">{isHi ? mode.descHi : mode.desc}</div>
            </div>
            <span style={{ color: mode.color }}>→</span>
          </button>
        ))}
      </div>

      {/* Secondary mode links */}
      <div className="flex justify-center gap-4 mt-3">
        <button
          onClick={() => onSelectMode('revision')}
          className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
        >
          🔄 {isHi ? 'रिवीज़न' : 'Revision'}
        </button>
        <button
          onClick={() => onSelectMode('notes')}
          className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
        >
          📝 {isHi ? 'नोट्स बनाओ' : 'Make Notes'}
        </button>
      </div>
    </div>
  );
}
