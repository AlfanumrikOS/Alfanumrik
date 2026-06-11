'use client';

/**
 * PrincipalAiStarters — the empty-state guidance for a fresh Principal Assistant
 * conversation. Clicking a starter sends it as the principal's first message.
 *
 * Executive examples (school-leadership framing), per the Track 2 design. We do
 * NOT suggest syllabus-pacing as a starter because the assistant honestly DECLINES
 * pacing questions (its scope-lock prompt) — surfacing it would invite a guaranteed
 * abstain on the very first interaction.
 *
 * Bilingual (P7) via `isHi`. Technical terms (Mathematics subject names etc.) are
 * not translated where they are proper CBSE labels.
 */

const tt = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

const STARTERS: ReadonlyArray<{ en: string; hi: string }> = [
  {
    en: 'Which classes are weakest in Mathematics?',
    hi: 'गणित में कौन-सी कक्षाएँ सबसे कमज़ोर हैं?',
  },
  {
    en: "Which teachers' classes are most at-risk?",
    hi: 'किन शिक्षकों की कक्षाएँ सबसे अधिक जोखिम में हैं?',
  },
  {
    en: 'What content gaps should we prioritise?',
    hi: 'हमें किन सामग्री अंतरालों को प्राथमिकता देनी चाहिए?',
  },
];

interface PrincipalAiStartersProps {
  isHi: boolean;
  /** Disabled while a turn is in flight or the quota is exhausted. */
  disabled: boolean;
  onPick: (text: string) => void;
}

export default function PrincipalAiStarters({ isHi, disabled, onPick }: PrincipalAiStartersProps) {
  return (
    <div className="mx-auto max-w-xl px-4 py-10 text-center">
      <div className="mb-2 text-3xl" aria-hidden="true">
        ◈
      </div>
      <h2
        className="text-base font-bold text-[var(--text-1)]"
        style={{ fontFamily: 'Sora, system-ui, sans-serif' }}
      >
        {tt(isHi, 'Principal Assistant', 'Principal सहायक')}
      </h2>
      <p className="mt-1.5 text-sm text-[var(--text-3)]">
        {tt(
          isHi,
          'Ask in plain language about your school’s performance. Answers draw only on your school’s own aggregate signals.',
          'अपने स्कूल के प्रदर्शन के बारे में सरल भाषा में पूछें। उत्तर केवल आपके स्कूल के समग्र संकेतों पर आधारित होते हैं।',
        )}
      </p>

      <div className="mt-6 flex flex-col gap-2" role="list">
        {STARTERS.map((starter) => {
          const label = isHi ? starter.hi : starter.en;
          return (
            <button
              key={starter.en}
              type="button"
              role="listitem"
              disabled={disabled}
              onClick={() => onPick(isHi ? starter.hi : starter.en)}
              className="min-h-[48px] rounded-xl border border-[var(--border)] bg-[var(--surface-1)] px-4 py-3 text-left text-sm font-medium text-[var(--text-1)] transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--purple,#7C3AED)] disabled:opacity-50"
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
