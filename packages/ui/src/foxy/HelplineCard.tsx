'use client';

/**
 * HelplineCard — Foxy North-Star Phase 1 safeguarding surface.
 *
 * Rendered by the Foxy chat (MessageList) beneath a tutor bubble whose
 * response envelope carried `safeguarding: { helpline }` (badgeState
 * 'safeguarding'). Purely presentational and envelope-driven: the client
 * never classifies disclosures — the server decides when this appears.
 *
 * Design intent: warm, non-alarming, prominent helpline number with a
 * tap-to-call tel: link (44px+ touch target). Bilingual (P7).
 */

export interface HelplineInfo {
  name: string;   // e.g. 'Childline'
  number: string; // e.g. '1098'
}

export interface HelplineCardProps {
  helpline: HelplineInfo;
  isHi: boolean;
}

export default function HelplineCard({ helpline, isHi }: HelplineCardProps) {
  return (
    <div
      data-testid="safeguarding-helpline-card"
      role="note"
      aria-label={
        isHi
          ? `${helpline.name} हेल्पलाइन ${helpline.number}`
          : `${helpline.name} helpline ${helpline.number}`
      }
      className="mb-4 ml-11 max-w-[440px] rounded-2xl p-4"
      style={{
        background: 'linear-gradient(135deg, rgba(245,166,35,0.10), rgba(124,58,237,0.08))',
        border: '1.5px solid rgba(245,166,35,0.35)',
        boxShadow: '0 2px 10px rgba(0,0,0,0.05)',
      }}
    >
      <div className="flex items-start gap-3">
        <div className="text-2xl leading-none pt-0.5" aria-hidden="true">🤝</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold mb-1" style={{ color: 'var(--text-1)', fontFamily: 'var(--font-display)' }}>
            {isHi ? 'तुम अकेले नहीं हो' : "You're not alone"}
          </p>
          <p className="text-xs leading-relaxed mb-3" style={{ color: 'var(--text-2)' }}>
            {isHi
              ? 'किसी भरोसेमंद बड़े से बात करना मदद कर सकता है। तुम किसी भी समय मुफ़्त में यहाँ कॉल कर सकते हो:'
              : 'Talking to a trusted adult can help. You can also call this free helpline any time:'}
          </p>
          <a
            href={`tel:${helpline.number}`}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-3 min-h-[44px] text-on-accent font-bold text-sm transition-all active:scale-[0.97]"
            style={{ background: 'var(--accent-warm-strong)' }}
          >
            <span aria-hidden="true">📞</span>
            <span>
              {helpline.name} — {helpline.number}
            </span>
          </a>
          <p className="text-[10px] mt-2" style={{ color: 'var(--text-3)' }}>
            {isHi ? 'मुफ़्त • गोपनीय • 24x7' : 'Free • Confidential • 24x7'}
          </p>
        </div>
      </div>
    </div>
  );
}
