'use client';

import { useWelcomeV2 } from './WelcomeV2Context';
import s from './welcome-v2.module.css';

export default function TrustV2() {
  const { isHi, t } = useWelcomeV2();

  return (
    <section className={s.trust} id="trust" aria-labelledby="trust-title">
      <div className={s.wrap}>
        <div className={s.trustHead}>
          <h2 id="trust-title">
            {t('Voices from the ', 'मेज़ से आती ')}
            <em>{t('desk', 'आवाज़ें')}</em>
            {isHi ? '।' : '.'}
          </h2>
          <div className="meta">
            {t('Sec. iv · letters received', 'खंड iv · आए हुए पत्र')}
          </div>
        </div>

        <div className={s.trustGrid}>
          <div className={s.trustCol}>
            <h3 className="head">
              {t('A note from the founder', 'संस्थापक का एक नोट')}
            </h3>
            <div className={s.trustQuote}>
              {isHi ? (
                <>
                  हमने अल्फ़ान्यूमरिक इसलिए बनाया क्योंकि हमारी अपनी बेटी का रिपोर्ट कार्ड बार-बार
                  <em> &quot;औसत&quot;</em> कहता था — एक शब्द जो सब कुछ छुपाता है, कुछ नहीं समझाता। हम जानना
                  चाहते थे कि वह क्या जानती है और क्या नहीं। अब वह भी जानती है।
                </>
              ) : (
                <>
                  We built Alfanumrik because our own daughter&#39;s report card kept saying{' '}
                  <em>&quot;average&quot;</em> — a word that hides everything and explains nothing. We
                  wanted to know exactly what she knew and exactly what she did not. Now she does too.
                </>
              )}
            </div>
            <div className={s.trustAttrib}>
              <div className="avatar" aria-hidden="true">PS</div>
              <div>
                <div className="who">Pradeep Sharma</div>
                <div className="role">
                  {t('Founder · Alfanumrik · Bengaluru', 'संस्थापक · अल्फ़ान्यूमरिक · बेंगलुरु')}
                </div>
              </div>
            </div>
          </div>

          <div className={s.trustCol}>
            <h3 className="head">{t('From a teacher', 'एक शिक्षक से')}</h3>
            <div className={s.trustQuote}>
              {isHi ? (
                <>
                  पहली बार मेरी कक्षा 9 के बच्चे पाठ <em>सच में</em> पढ़ कर आते हैं। ब्लूम-स्तर का
                  डैशबोर्ड बताता है कि सोमवार सुबह किस बच्चे को मेरी ज़रूरत है — एक मिनट भी बर्बाद नहीं
                  होता।
                </>
              ) : (
                <>
                  For the first time my Class 9 children walk into the lesson having{' '}
                  <em>actually</em> read the previous chapter. The Bloom&#39;s-level dashboard
                  tells me who needs me on Monday morning — I do not waste a single minute.
                </>
              )}
            </div>
            <div className={`${s.trustAttrib} va2`}>
              <div className="avatar" aria-hidden="true">MI</div>
              <div>
                <div className="who">Meera Iyer</div>
                <div className="role">
                  {t('Maths · DPS Lucknow · 12 yrs', 'गणित · DPS लखनऊ · 12 वर्ष')}
                </div>
              </div>
            </div>
          </div>

          <div className={s.trustCol}>
            <h3 className="head">{t('From a parent', 'एक अभिभावक से')}</h3>
            <div className={s.trustQuote}>
              {isHi ? (
                <>
                  रविवार का पत्र वह करता है जो पंद्रह ट्यूशन के WhatsApp ग्रुप कभी नहीं कर पाए —
                  <em> वह सच, नर्मी से बताता है।</em> अब मुझे पता है कि बेटा गति-ग्राफ़ में फँसता है
                  और रासायनिक समीकरणों में बहुत अच्छा है।
                </>
              ) : (
                <>
                  The Sunday letter does what fifteen tuition WhatsApp groups never did —{' '}
                  <em>it tells me the truth, kindly.</em> I now know my son struggles with
                  motion graphs and is excellent at chemical equations. I can actually help him.
                </>
              )}
            </div>
            <div className={`${s.trustAttrib} va3`}>
              <div className="avatar" aria-hidden="true">RD</div>
              <div>
                <div className="who">Rohini D</div>
                <div className="role">
                  {t('Mother · Class 10 · Kanpur', 'माँ · कक्षा 10 · कानपुर')}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          className={s.liveCounter}
          aria-live="polite"
          aria-label={t(
            'Currently active learners',
            'अभी सक्रिय विद्यार्थी',
          )}
        >
          <span className="pulse" aria-hidden="true"></span>
          <div className="liveText">
            {/* TODO(ops): wire to /api/v1/live-learners endpoint when shipped. Static fallback for design preview. */}
            <span className="num tabular">142</span>{' '}
            {t('students learning right now', 'विद्यार्थी अभी सीख रहे हैं')}{' '}
            <span className="devaNum" lang="hi">१४२</span>
          </div>
          <div
            className="liveMeta"
            title={t(
              'Updated every 5 minutes from active sessions.',
              'हर 5 मिनट में सक्रिय सत्रों से अपडेट।',
            )}
          >
            {t('Refreshed every 5 min', 'हर 5 मिनट में ताज़ा')}
          </div>
        </div>

        {/* Phase 3 — editorial Recognition strip. Compliance band below stays
            unchanged as the quick-glance footer; this expands the same proof
            points into something a discerning parent can actually read. */}
        <div className={s.recognition}>
          <div className={s.recognitionHead}>
            <span className={s.label}>
              {t('Recognition · proof, not promises', 'मान्यता · वादे नहीं, सबूत')}
            </span>
            <h3>
              {t(
                'Recognised. Aligned. Built right.',
                'मान्यता प्राप्त। संरेखित। सही ढंग से बनाया गया।',
              )}
            </h3>
          </div>
          <div className={s.recognitionGrid}>
            <div className={s.recognitionCard}>
              <div className={s.recognitionLbl}>DPIIT</div>
              <div className={s.recognitionMeta}>
                {t(
                  'Recognised Indian startup, Department for Promotion of Industry and Internal Trade.',
                  'भारतीय स्टार्टअप, उद्योग संवर्धन एवं आंतरिक व्यापार विभाग द्वारा मान्यता प्राप्त।',
                )}
              </div>
            </div>
            <div className={s.recognitionCard}>
              <div className={s.recognitionLbl}>DPDPA</div>
              <div className={s.recognitionMeta}>
                {t(
                  'Aligned with the Digital Personal Data Protection Act, 2023.',
                  'डिजिटल पर्सनल डेटा प्रोटेक्शन अधिनियम, 2023 के अनुरूप।',
                )}
              </div>
            </div>
            <div className={s.recognitionCard}>
              <div className={s.recognitionLbl}>NCERT</div>
              <div className={s.recognitionMeta}>
                {t(
                  'Every question and explanation grounded in the NCERT textbook.',
                  'हर प्रश्न और व्याख्या NCERT पुस्तक पर आधारित।',
                )}
              </div>
            </div>
            <div className={s.recognitionCard}>
              <div className={s.recognitionLbl}>{t('Made in India', 'भारत में निर्मित')}</div>
              <div className={s.recognitionMeta}>
                {t(
                  'Designed in Bengaluru. Hosted in India. Built for Indian classrooms.',
                  'बेंगलुरु में डिज़ाइन। भारत में होस्ट। भारतीय कक्षाओं के लिए बनाया गया।',
                )}
              </div>
            </div>
          </div>
        </div>

        <div className={s.compliance}>
          <span>{t('DPIIT Recognised', 'DPIIT मान्यता प्राप्त')}</span>
          <span>DPDPA Aligned</span>
          <span>NCERT Mapped</span>
          <span>{t('End-to-End Encrypted', 'एंड-टू-एंड एन्क्रिप्टेड')}</span>
          <span>{t('No Ads · Ever', 'कोई विज्ञापन नहीं · कभी नहीं')}</span>
        </div>
      </div>
      {/* Phase 3 — Review JSON-LD for the three on-page testimonials. Attached
          to the same WebApplication @id we declare in JsonLd.tsx so Google
          merges the entities. English only, in line with the FAQPage policy. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'WebApplication',
            '@id': 'https://alfanumrik.com/#webapp',
            name: 'Alfanumrik',
            review: [
              {
                '@type': 'Review',
                author: { '@type': 'Person', name: 'Pradeep Sharma' },
                reviewBody:
                  "We built Alfanumrik because our own daughter's report card kept saying \"average\" — a word that hides everything and explains nothing.",
                reviewRating: { '@type': 'Rating', ratingValue: '5', bestRating: '5' },
              },
              {
                '@type': 'Review',
                author: { '@type': 'Person', name: 'Meera Iyer' },
                reviewBody:
                  "For the first time my Class 9 children walk into the lesson having actually read the previous chapter. The Bloom's-level dashboard tells me who needs me on Monday morning.",
                reviewRating: { '@type': 'Rating', ratingValue: '5', bestRating: '5' },
              },
              {
                '@type': 'Review',
                author: { '@type': 'Person', name: 'Rohini D' },
                reviewBody:
                  'The Sunday letter does what fifteen tuition WhatsApp groups never did — it tells me the truth, kindly. I now know my son struggles with motion graphs and is excellent at chemical equations.',
                reviewRating: { '@type': 'Rating', ratingValue: '5', bestRating: '5' },
              },
            ],
          }),
        }}
      />
    </section>
  );
}
