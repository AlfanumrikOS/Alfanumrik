'use client';

/**
 * AlfaBotEscapeHatch — "Need a human?" links below the input.
 *
 * Three entry points:
 *   - Submit your query (inline form via the inquiry POST route — primary)
 *   - /contact
 *   - WhatsApp (via NEXT_PUBLIC_ALFANUMRIK_WA env var, falls back to /contact
 *     when unset so we never expose a dead `https://wa.me/` URL).
 *
 * Analytics:
 *   - alfabot_inquiry_opened (provider fires it on view switch)
 *   - alfabot_escape_to_contact with the destination
 */

import { useAlfaBot } from './AlfaBotProvider';
import { useWelcomeV2 } from '@/components/landing/WelcomeV2Context';
import { track } from '@/lib/posthog/client';
import s from './alfabot.module.css';

export default function AlfaBotEscapeHatch() {
  const { audience, lang, openInquiry } = useAlfaBot();
  const { t } = useWelcomeV2();
  const waNumber = process.env.NEXT_PUBLIC_ALFANUMRIK_WA;
  const waHref = waNumber ? `https://wa.me/${waNumber.replace(/[^0-9]/g, '')}` : '/contact';

  const fire = (destination: 'contact_page' | 'whatsapp') => {
    track('alfabot_escape_to_contact', { audience, language: lang, destination });
  };

  return (
    <div className={s.escape}>
      <span className={s.escapeLabel}>{t('Need a human?', 'इंसान से बात करनी है?')}</span>
      <button
        type="button"
        className={s.escapeInquiryBtn}
        onClick={() => openInquiry('escape_hatch')}
        data-testid="alfabot-escape-inquiry"
      >
        {t('Submit your query', 'अपना सवाल भेजें')}
      </button>
      <a
        href="/contact"
        className={s.escapeLink}
        onClick={() => fire('contact_page')}
        target="_blank"
        rel="noopener noreferrer"
      >
        {t('Contact us', 'संपर्क करें')}
      </a>
      <a
        href={waHref}
        className={s.escapeLink}
        onClick={() => fire('whatsapp')}
        target="_blank"
        rel="noopener noreferrer"
      >
        {t('WhatsApp', 'WhatsApp')}
      </a>
    </div>
  );
}
