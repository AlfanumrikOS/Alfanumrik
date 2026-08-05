'use client';

/**
 * ConversationPromptsCard — K8 "Ask your child" card. Renders up to 3 prompts
 * arriving in the parent's weekly report language (server sends
 * `conversation_prompts: string[]` already localized). The card CHROME (title
 * + hint text) is bilingual via `isHi`. If no prompts are provided, the card
 * renders nothing (defensive — this is a strictly additive surface).
 *
 * P7 bilingual. P13 no PII.
 */

const t = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

export function ConversationPromptsCard({
  prompts,
  isHi,
}: {
  prompts?: string[];
  isHi: boolean;
}) {
  const list = (prompts ?? []).filter((p) => p && p.trim().length > 0).slice(0, 3);
  if (list.length === 0) return null;
  return (
    <section
      data-testid="conversation-prompts-card"
      className="rounded-2xl p-4"
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <h3
        className="text-base font-bold m-0 font-heading"
        style={{ color: 'var(--text-1)' }}
      >
        {t(isHi, 'Ask your child', 'अपने बच्चे से पूछें')}
      </h3>
      <p className="text-[12px] mt-1 mb-2" style={{ color: 'var(--text-3)' }}>
        {t(
          isHi,
          'A few conversation starters based on this week.',
          'इस सप्ताह के आधार पर कुछ बातचीत के सुझाव।',
        )}
      </p>
      <ul className="list-none p-0 m-0 flex flex-col gap-1.5">
        {list.map((p, i) => (
          <li
            key={i}
            className="rounded-lg p-2.5 text-[13px]"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              color: 'var(--text-1)',
            }}
          >
            {p}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default ConversationPromptsCard;
