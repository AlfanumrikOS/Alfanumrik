'use client';

import { useWelcomeV2 } from '../../WelcomeV2Context';
import { useReveal } from '../../useReveal';
import s from '../welcome-v3.module.css';
import m from './marketing-v3.module.css';

/**
 * QuoteBandV3 — one featured testimonial on the Tailark testimonial card
 * anatomy (cream-soft card, 19px quote, initials avatar + cite).
 *
 * NO Review JSON-LD here — the WebApplication/Review entity shape is a
 * /welcome-only SEO contract (exactly 2 reviews, Google-merged via @id with
 * JsonLd.tsx; pinned by e2e/landing-seo.spec.ts). Emitting more Review
 * entities from other pages would corrupt that merge.
 */

export interface QuoteBandV3Props {
  headingId: string;
  quoteEn: string;
  quoteHi: string;
  /** Speaker name (not translated — proper noun). */
  name: string;
  roleEn: string;
  roleHi: string;
  /** Avatar initials, e.g. "RS". */
  initials: string;
  /** Cream section tint. */
  tint?: boolean;
}

export default function QuoteBandV3({
  headingId,
  quoteEn,
  quoteHi,
  name,
  roleEn,
  roleHi,
  initials,
  tint = false,
}: QuoteBandV3Props) {
  const { t } = useWelcomeV2();
  const revealRef = useReveal(60);

  return (
    <section
      className={`${s.section} ${tint ? m.tintCream : ''}`.trim()}
      aria-labelledby={headingId}
    >
      <h2 id={headingId} className={s.srOnly}>
        {t('What families say', 'परिवार क्या कहते हैं')}
      </h2>
      <div className={s.wrap} ref={revealRef as React.RefObject<HTMLDivElement>}>
        <div className={m.quoteWrap}>
          <div className={`${m.quoteCard} ${s.revealUp}`} data-reveal>
            <blockquote>
              <p className={m.quoteText}>{t(quoteEn, quoteHi)}</p>
              <div className={s.testiWho}>
                <span className={s.avatar} aria-hidden="true">
                  {initials}
                </span>
                <span>
                  <cite>{name}</cite>
                  <span className={s.role}>{t(roleEn, roleHi)}</span>
                </span>
              </div>
            </blockquote>
          </div>
        </div>
      </div>
    </section>
  );
}
