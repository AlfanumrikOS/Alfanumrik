'use client';

import { useRef, useEffect } from 'react';
import { useWelcomeV2 } from './WelcomeV2Context';
import s from './welcome-v2.module.css';

interface Stat {
  num: React.ReactNode;
  lblEn: string;
  lblHi: string;
  ctxEn: string;
  ctxHi: string;
}

const STATS: Stat[] = [
  {
    num: <>12<em>k</em></>,
    lblEn: 'students learning',
    lblHi: 'विद्यार्थी सीख रहे हैं',
    ctxEn: 'across 247 cities, mostly tier-2 and tier-3',
    ctxHi: '247 शहरों में, ज़्यादातर टियर-2 और टियर-3',
  },
  {
    num: <>94<small>%</small></>,
    lblEn: 'say it feels easier',
    lblHi: 'कहते हैं अब आसान लगता है',
    ctxEn: 'on the standard 21-day usage survey',
    ctxHi: '21-दिवसीय उपयोग सर्वेक्षण के आधार पर',
  },
  // CATALOGUE-CLAIM FIX (2026-08-12): this tile read "16" over
  // "subjects · grades 6—12", with a supporting list naming English, Hindi,
  // Social, Sanskrit and Computer. `subjects.is_active` is true for exactly
  // five codes — math, science, physics, chemistry, biology — so both the count
  // and five of the seven names were false. /welcome renders V3 by default but
  // this V2 tree is the live `?v=2` rollback path, so it is reachable copy, not
  // dead code. The tile now leads with the grade range, which is true, and the
  // supporting line states the catalogue honestly.
  {
    num: <>6–12</>,
    lblEn: 'grades · Maths & Science',
    lblHi: 'कक्षाएँ · गणित और विज्ञान',
    ctxEn: 'the whole catalogue — Maths and Science, covered properly',
    ctxHi: 'यही पूरा catalogue — गणित और विज्ञान, ठीक से पढ़ाए गए',
  },
  {
    num: <>₹<em>0</em></>,
    lblEn: 'to start · Explorer plan',
    lblHi: 'शुरू करने के लिए · एक्सप्लोरर',
    ctxEn: 'no card required — upgrade when ready',
    ctxHi: 'कोई कार्ड नहीं — जब तैयार हों, अपग्रेड करें',
  },
];

export default function StatsV2() {
  const { isHi, t } = useWelcomeV2();
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 },
    );
    el.querySelectorAll('[data-reveal]').forEach(child => obs.observe(child));
    return () => obs.disconnect();
  }, []);

  return (
    <section className={s.stats} id="stats" aria-labelledby="stats-title">
      <div className={s.wrap}>
        <div className={s.statsHead}>
          <span className={s.label}>
            {t('By the numbers · June 2026', 'आँकड़ों में · जून 2026')}
          </span>
          <h2 id="stats-title">
            {t('Built quietly, used ', 'चुपचाप बनाया, गंभीरता से ')}
            <em>{t('seriously', 'इस्तेमाल')}</em>
            {isHi ? ' किया गया।' : '.'}
          </h2>
        </div>
        <div className={s.statsGrid} ref={gridRef}>
          {STATS.map((stat, i) => (
            <div
              key={i}
              data-reveal
              className={`${s.statRow} ${s.reveal}`}
            >
              <div className="statRowTop">
                <span className="statNum tabular">{stat.num}</span>
                <span className="statLbl">{t(stat.lblEn, stat.lblHi)}</span>
              </div>
              <div className="statCtx">
                {t(stat.ctxEn, stat.ctxHi)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
