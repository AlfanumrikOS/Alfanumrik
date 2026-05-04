'use client';

import { useWelcomeV2 } from './WelcomeV2Context';
import s from './welcome-v2.module.css';

interface Principle {
  en: string;
  hi: string;
}

const PRINCIPLES: Principle[] = [
  {
    en: 'Student-first — every decision starts with whether it helps the child learn better.',
    hi: 'विद्यार्थी सर्वप्रथम — हर निर्णय की शुरुआत यहीं से कि बच्चे को सीखने में सहायता मिल रही है या नहीं।',
  },
  {
    en: 'Privacy by design — data minimization, encryption, DPDPA-aligned from day one.',
    hi: 'गोपनीयता पहले से — डेटा न्यूनतम, एन्क्रिप्टेड, DPDPA-संरेखित — पहले दिन से।',
  },
  {
    en: "Research-backed — Bayesian Knowledge Tracing, Bloom's taxonomy, spaced repetition.",
    hi: 'शोध-आधारित — बायेसियन ज्ञान-ट्रेसिंग, ब्लूम स्तर, अंतराल-पुनरावृत्ति।',
  },
  {
    en: 'Bilingual by default — Hindi and English, equal weight, not afterthought.',
    hi: 'द्विभाषी सहज — हिन्दी और अंग्रेज़ी, बराबर वज़न।',
  },
  {
    en: 'Made in India — for Indian classrooms, Indian curricula, Indian languages.',
    hi: 'भारत में निर्मित — भारतीय कक्षाओं, पाठ्यक्रमों और भाषाओं के लिए।',
  },
];

export default function MissionV2() {
  const { isHi, t } = useWelcomeV2();
  return (
    <section className={s.mission} id="mission" aria-labelledby="mission-title">
      <div className={s.wrap}>
        <div className={s.missionHead}>
          <span className={s.label}>
            {t('Section · the why', 'खंड · हमारा प्रयोजन')}
          </span>
          <h2 id="mission-title">
            {t('What we are building, ', 'हम क्या बना रहे हैं, ')}
            <em>{t('and for whom', 'और किसके लिए')}</em>
            {isHi ? '।' : '.'}
          </h2>
        </div>

        <div className={s.missionGrid}>
          <article className={s.missionCol}>
            <div className={s.missionRoman}>i.</div>
            <h3>{t('Vision', 'दृष्टिकोण')}</h3>
            <p>
              {t(
                'An India where every child has a patient tutor — in their language, at their pace, without a single shouting leaderboard.',
                'एक ऐसा भारत, जहाँ हर बच्चे के पास एक धैर्यवान शिक्षक हो — अपनी भाषा में, अपनी रफ़्तार पर, बिना किसी शोर मचाते लीडरबोर्ड के।',
              )}
            </p>
          </article>

          <article className={s.missionCol}>
            <div className={s.missionRoman}>ii.</div>
            <h3>{t('Mission', 'मिशन')}</h3>
            <p>
              {t(
                'Build a learning workbook small enough for ten minutes a day, honest enough to tell parents the truth every Sunday, and rigorous enough to map every NCERT topic to Bloom’s taxonomy.',
                'एक सीखने की कार्यपुस्तिका बनाना — दस मिनट में पूरी, हर रविवार सच बताने वाली, और हर NCERT पाठ को ब्लूम के स्तर तक पहुँचाने वाली।',
              )}
            </p>
          </article>

          <article className={s.missionCol}>
            <div className={s.missionRoman}>iii.</div>
            <h3>{t('Principles', 'सिद्धांत')}</h3>
            <ul className={s.missionList}>
              {PRINCIPLES.map((p, i) => (
                <li key={i}>{isHi ? p.hi : p.en}</li>
              ))}
            </ul>
          </article>
        </div>

        <div className={s.missionFoot}>
          <a href="/about" className={s.missionLink}>
            {t('Read the full founder note ', 'पूरा संस्थापक-नोट पढ़ें ')}
            <span aria-hidden="true">→</span>
          </a>
        </div>
      </div>
    </section>
  );
}
