'use client';

import { useState } from 'react';
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
  {
    num: <>07</>,
    lblEn: 'subjects · grades 6—12',
    lblHi: 'विषय · कक्षा 6—12',
    ctxEn: 'English, Hindi, Maths, Science, Social, Sanskrit, Computer',
    ctxHi: 'अंग्रेज़ी, हिन्दी, गणित, विज्ञान, सामाजिक, संस्कृत, कंप्यूटर',
  },
  {
    num: <>₹<em>699</em></>,
    lblEn: 'a month, all-in',
    lblHi: 'प्रति माह, सब कुछ शामिल',
    ctxEn: 'no upsells, no franchise fees, no coaching auntie',
    ctxHi: 'कोई अतिरिक्त बिक्री नहीं, कोई फ़्रैंचाइज़ शुल्क नहीं',
  },
];

export default function StatsV2() {
  const { isHi, t } = useWelcomeV2();
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  return (
    <section className={s.stats} id="stats" aria-labelledby="stats-title">
      <div className={s.wrap}>
        <div className={s.statsHead}>
          <span className={s.label}>
            {t('By the numbers · April 2026', 'आँकड़ों में · अप्रैल 2026')}
          </span>
          <h2 id="stats-title">
            {t('Built quietly, used ', 'चुपचाप बनाया, गंभीरता से ')}
            <em>{t('seriously', 'इस्तेमाल')}</em>
            {isHi ? ' किया गया।' : '.'}
          </h2>
        </div>
        <div className={s.statsGrid}>
          {STATS.map((stat, i) => {
            const isOpen = openIdx === i;
            return (
              <button
                key={i}
                className={s.statRow}
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpenIdx(isOpen ? null : i)}
              >
                <div className="statRowTop">
                  <span className={`statNum tabular`}>{stat.num}</span>
                  <span className="statLbl">{t(stat.lblEn, stat.lblHi)}</span>
                </div>
                <div className="statCtx">
                  {t(stat.ctxEn, stat.ctxHi)}
                  <span className="chev" aria-hidden="true"> →</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
