'use client';

import Link from 'next/link';
import { useWelcomeV2 } from '../../WelcomeV2Context';
import { track } from '@alfanumrik/lib/posthog/client';
import { V3_ACTIVE_ROLE } from '../NavV3';
import s from '../welcome-v3.module.css';
import m from './marketing-v3.module.css';

/**
 * CrossLinkStripV3 — hairline band of ghost-button links to sibling
 * marketing pages ("Also on Alfanumrik: parents / schools / pricing").
 * 44px targets; tracks the house landing_nav_click event.
 */

export interface CrossLink {
  href: string;
  en: string;
  hi: string;
}

export interface CrossLinkStripV3Props {
  headingId: string;
  links: CrossLink[];
  /** Analytics source, e.g. "for_teachers_cross_links". */
  location: string;
}

export default function CrossLinkStripV3({
  headingId,
  links,
  location,
}: CrossLinkStripV3Props) {
  const { isHi, t } = useWelcomeV2();

  return (
    <section className={m.linkStrip} aria-labelledby={headingId}>
      <h2 id={headingId} className={s.srOnly}>
        {t('More on Alfanumrik', 'Alfanumrik पर और')}
      </h2>
      <div className={`${s.wrap} ${m.linkStripInner}`}>
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`${s.btn} ${s.btnGhost} ${s.btnSm}`}
            onClick={() =>
              track('landing_nav_click', {
                source: location,
                destination: link.href,
                label: t(link.en, link.hi),
                active_role: V3_ACTIVE_ROLE,
              })
            }
          >
            {t(link.en, link.hi)}
          </Link>
        ))}
      </div>
    </section>
  );
}
