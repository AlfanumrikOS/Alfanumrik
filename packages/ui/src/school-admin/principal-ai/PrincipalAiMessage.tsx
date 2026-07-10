'use client';

/**
 * PrincipalAiMessage — a single chat bubble for the Principal AI Assistant.
 *
 * Tone: EXECUTIVE, not gamified. No mascots, no XP, no streaming cursor flourish.
 * Cosmic/school-admin theming via the portal CSS vars (--surface-*, --text-*,
 * --border, --purple) so it matches the rest of the school-admin command center.
 *
 * Variants:
 *   - user      → right-aligned, accent (purple) background, white text
 *   - assistant → left-aligned, surface card; renders a subtle model-provenance
 *                 footnote (REG-67 transparency) and, when the turn was an
 *                 abstain, a muted tone so the polite decline reads as such
 *
 * The assistant's polite abstain copy ALWAYS arrives in `content` (the route puts
 * its decline text in the `response`/`content` field), so we just render it plainly
 * — no special-casing of wording here.
 *
 * A11y: assistant bubbles are wrapped by an aria-live="polite" region at the list
 * level (see PrincipalAiChat), so we do not double-announce here. Plain text only.
 */

const tt = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

export interface PrincipalAiMessageModel {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Model id stamped on assistant rows (REG-67); null for user rows / abstains. */
  model: string | null;
  /** Set when the assistant declined to answer (degraded / no_data / unavailable). */
  abstainReason: string | null;
}

interface PrincipalAiMessageProps {
  message: PrincipalAiMessageModel;
  isHi: boolean;
}

export default function PrincipalAiMessage({ message, isHi }: PrincipalAiMessageProps) {
  const { role, content, model, abstainReason } = message;

  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[85%] rounded-2xl rounded-br-md px-4 py-2.5 text-sm leading-relaxed text-white shadow-sm"
          style={{ background: 'var(--purple,#7C3AED)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
        >
          {content}
        </div>
      </div>
    );
  }

  // assistant
  const isAbstain = abstainReason != null;
  return (
    <div className="flex justify-start">
      <div
        className={`max-w-[85%] rounded-2xl rounded-bl-md border px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
          isAbstain
            ? 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-2)]'
            : 'border-[var(--border)] bg-[var(--surface-1)] text-[var(--text-1)]'
        }`}
        style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
      >
        {content}
        {/* Model-provenance footnote (REG-67). Only on real answers — abstains
            carry no model. */}
        {model && !isAbstain && (
          <span className="mt-1.5 block text-[10px] font-medium text-[var(--text-3)]">
            {tt(isHi, 'via', 'द्वारा')} {model}
          </span>
        )}
      </div>
    </div>
  );
}
