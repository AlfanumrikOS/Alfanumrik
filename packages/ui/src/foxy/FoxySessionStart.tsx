'use client';

import { FoxyAvatar } from '@alfanumrik/ui/ui';
import { Chip, Button } from '@alfanumrik/ui/ui/primitives';

/**
 * FoxySessionStart — Mode and subject picker for starting a Foxy session.
 * Replaces the complex toolbar with a clean, guided selection.
 * Foxy leads: "What shall we do?"
 *
 * Presentation-only, token-driven: subject pills → Chip, mode + Foxy
 * recommendation → Button (real buttons, 44px, AA, no clickable divs).
 * Bilingual via `isHi` (P7).
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
      <h2 className="mt-4 text-fluid-lg font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
        {isHi ? 'आज क्या करें?' : 'What shall we do?'}
      </h2>

      {/* Subject pills */}
      {subjects.length > 1 && (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {subjects.map((s) => (
            <Chip
              key={s.code}
              selected={selectedSubject === s.code}
              onClick={() => onSelectSubject(s.code)}
              icon={<span aria-hidden="true">{s.icon}</span>}
            >
              {s.name}
            </Chip>
          ))}
        </div>
      )}

      {/* Foxy recommendation */}
      {foxyRecommendation && (
        <Button
          variant="secondary"
          fullWidth
          onClick={() => onSelectMode(foxyRecommendation.mode)}
          className="mt-5 h-auto max-w-sm justify-start rounded-xl py-4 text-left"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--accent-warm) 10%, var(--surface-1))',
            borderColor: 'color-mix(in srgb, var(--accent-warm) 25%, transparent)',
          }}
        >
          <span className="flex min-w-0 flex-col">
            <span className="flex items-center gap-2">
              <span aria-hidden="true">🦊</span>
              <span className="text-fluid-xs font-bold" style={{ color: 'var(--accent-warm)' }}>
                {isHi ? 'Foxy का सुझाव' : 'Foxy suggests'}
              </span>
            </span>
            <span className="mt-1 text-fluid-sm font-semibold text-foreground">
              {foxyRecommendation.topic}
            </span>
          </span>
        </Button>
      )}

      {/* Mode cards */}
      <div className="mt-5 w-full max-w-sm space-y-2">
        {SESSION_MODES.map((mode) => (
          <Button
            key={mode.id}
            variant="secondary"
            fullWidth
            onClick={() => onSelectMode(mode.id)}
            leadingIcon={<span className="text-2xl">{mode.emoji}</span>}
            trailingIcon={<span aria-hidden="true" style={{ color: 'var(--text-3)' }}>→</span>}
            className="h-auto justify-start gap-3 rounded-xl py-4 text-left"
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-fluid-sm font-semibold text-foreground">
                {isHi ? mode.labelHi : mode.label}
              </span>
              <span className="mt-0.5 text-fluid-xs" style={{ color: 'var(--text-3)' }}>
                {isHi ? mode.descHi : mode.desc}
              </span>
            </span>
          </Button>
        ))}
      </div>
    </div>
  );
}
