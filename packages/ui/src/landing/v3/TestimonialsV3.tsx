'use client';

import { useWelcomeV2 } from '../WelcomeV2Context';
import { useReveal } from '../useReveal';
import s from './welcome-v3.module.css';

/**
 * V3 testimonials — Tailark testimonials (variant One): 1 featured card,
 * 1 wide card, 2 standard cards.
 *
 * SEO: preserves the V2 (TrustV2.tsx) Review JSON-LD emission pattern —
 * a WebApplication entity with the SAME @id declared in JsonLd.tsx and
 * EXACTLY 2 English-only reviews (Google merges the entities; the e2e pins
 * the 2-review shape).
 */

const REVIEW_JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  '@id': 'https://alfanumrik.com/#webapp',
  name: 'Alfanumrik',
  review: [
    {
      '@type': 'Review',
      author: { '@type': 'Person', name: 'Rekha Sharma' },
      reviewBody:
        "For the first time I don't have to ask 'did you study?'. The Sunday letter tells me exactly what moved and what needs work — in numbers, not reassurances. It's measured, not promised.",
      reviewRating: { '@type': 'Rating', ratingValue: '5', bestRating: '5' },
    },
    {
      '@type': 'Review',
      author: { '@type': 'Person', name: 'Vikram Iyer' },
      reviewBody:
        'The Monday brief tells me which three students to sit with before the unit test. That used to take me a weekend of marking.',
      reviewRating: { '@type': 'Rating', ratingValue: '5', bestRating: '5' },
    },
  ],
};

export default function TestimonialsV3() {
  const { isHi, t } = useWelcomeV2();
  const revealRef = useReveal(60);

  return (
    <section className={s.section} aria-labelledby="testimonials-v3-title">
      <div className={s.wrap} ref={revealRef as React.RefObject<HTMLDivElement>}>
        <div className={`${s.sectionHead} ${s.revealUp}`} data-reveal>
          <span className={s.eyebrow}>
            {t('Families & classrooms', 'परिवार और कक्षाएँ')}
          </span>
          <h2 id="testimonials-v3-title">
            {t('Quiet confidence, every week', 'शांत आत्मविश्वास, हर सप्ताह')}
          </h2>
        </div>
        <div className={s.testiGrid}>
          <div className={`${s.testiCard} ${s.testiFeatured} ${s.revealUp}`} data-reveal>
            <blockquote>
              <p className={s.quote}>
                {t(
                  '“For the first time I don’t have to ask ‘did you study?’. The Sunday letter tells me exactly what moved and what needs work — in numbers, not reassurances. It’s measured, not promised.”',
                  '“पहली बार मुझे ‘पढ़ाई की?’ पूछना नहीं पड़ता। रविवार का पत्र ठीक-ठीक बताता है कि क्या आगे बढ़ा और कहाँ मेहनत चाहिए — संख्याओं में, दिलासों में नहीं। यह मापा हुआ है, वादा नहीं।”',
                )}
              </p>
              <div className={s.testiWho}>
                <span className={s.avatar} aria-hidden="true">
                  RS
                </span>
                <span>
                  <cite>Rekha Sharma</cite>
                  <span className={s.role}>
                    {t('Parent of a Class 8 student · Jaipur', 'कक्षा 8 विद्यार्थी की अभिभावक · जयपुर')}
                  </span>
                </span>
              </div>
            </blockquote>
          </div>

          <div className={`${s.testiCard} ${s.testiWide} ${s.revealUp}`} data-reveal>
            <blockquote>
              <p className={s.quote}>
                {t(
                  '“The Monday brief tells me which three students to sit with before the unit test. That used to take me a weekend of marking.”',
                  '“सोमवार का ब्रीफ़ बताता है कि यूनिट टेस्ट से पहले किन तीन बच्चों के साथ बैठना है। पहले इसमें मेरा पूरा वीकेंड जाता था।”',
                )}
              </p>
              <div className={s.testiWho}>
                <span className={s.avatar} aria-hidden="true">
                  VI
                </span>
                <span>
                  <cite>Vikram Iyer</cite>
                  <span className={s.role}>
                    {t('Mathematics teacher · Lucknow', 'गणित शिक्षक · लखनऊ')}
                  </span>
                </span>
              </div>
            </blockquote>
          </div>

          <div className={`${s.testiCard} ${s.revealUp}`} data-reveal>
            <blockquote>
              {/* Ananya's quote stays Devanagari in both languages — as in the
                  approved preview, where it reads in Hindi inside the EN page. */}
              <p className={s.quote} lang="hi">
                “फ़ॉक्सी से पूछने में कोई झिझक नहीं होती — यह डाँटता नहीं, समझाता है।”
              </p>
              <div className={s.testiWho}>
                <span className={s.avatar} aria-hidden="true" lang="hi">
                  अ
                </span>
                <span>
                  <cite>Ananya</cite>
                  <span className={s.role}>
                    {t('Class 9 student · Indore', 'कक्षा 9 विद्यार्थी · इंदौर')}
                  </span>
                </span>
              </div>
            </blockquote>
          </div>

          <div className={`${s.testiCard} ${s.revealUp}`} data-reveal>
            <blockquote>
              <p className={s.quote}>
                {t(
                  '“Went from dreading Science to finishing the NCERT exercises before dinner.”',
                  '“विज्ञान से डरने से लेकर रात के खाने से पहले NCERT अभ्यास पूरे करने तक।”',
                )}
              </p>
              <div className={s.testiWho}>
                <span className={s.avatar} aria-hidden="true">
                  AJ
                </span>
                <span>
                  <cite>Arjun</cite>
                  <span className={s.role}>
                    {t('Class 8 student · Pune', 'कक्षा 8 विद्यार्थी · पुणे')}
                  </span>
                </span>
              </div>
            </blockquote>
          </div>
        </div>
      </div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(REVIEW_JSON_LD) }}
      />
    </section>
  );
}
