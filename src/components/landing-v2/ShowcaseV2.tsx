'use client';

import { useWelcomeV2 } from './WelcomeV2Context';
import s from './welcome-v2.module.css';

export default function ShowcaseV2() {
  const { isHi, t } = useWelcomeV2();

  return (
    <section className={s.showcase} id="showcase" aria-labelledby="showcase-title">
      <div className={s.wrap}>
        <div className={s.showcaseHead}>
          <div className="left">
            <div className={s.label}>
              {t('Section iii · the workbench', 'खंड iii · कार्यस्थल')}
            </div>
            <h2 id="showcase-title">
              {t('Three tools, ', 'तीन औज़ार, ')}
              <em>{t('one workbook', 'एक कार्यपुस्तिका')}</em>
              {isHi ? '।' : '.'}
            </h2>
          </div>
          <div className="right">
            <p>
              {t(
                'The product is small on purpose. A tutor to talk to, a map to know yourself by, and a quiz that actually teaches you something when you are wrong.',
                'उत्पाद जान-बूझ कर छोटा है। बात करने के लिए एक शिक्षक, ख़ुद को पहचानने के लिए एक नक़्शा, और ग़लत होने पर सच में सिखाने वाला क्विज़।',
              )}
            </p>
          </div>
        </div>

        <div className={s.showGrid}>
          <article className={`${s.showCard} ${s.showCard1}`} aria-labelledby="card-1-title">
            <div className="lbl">{t('Tool i · the tutor', 'औज़ार i · शिक्षक')}</div>
            <div className="step" aria-hidden="true">i.</div>
            <h3 id="card-1-title">
              Foxy, who never <em>{t('sighs', 'थकता')}</em>
              {isHi ? ' है।' : '.'}
            </h3>
            <p>
              {t(
                'An AI tutor trained on the NCERT textbook for your grade. Answers in your language, never goes off-syllabus, never invents a fact. Asks better questions than it answers.',
                'आपकी कक्षा की NCERT पुस्तक पर प्रशिक्षित एक AI शिक्षक। आपकी भाषा में उत्तर, पाठ्यक्रम के भीतर, कभी कुछ गढ़ता नहीं।',
              )}
            </p>
            <div className={`${s.viz} ${s.vizChat}`} aria-hidden="true">
              <div className="bubble you">why does a leaf look green?</div>
              <div className="bubble foxy">
                good question — what part of the leaf do you think is doing the work?{' '}
                <em>(let's start there)</em>
              </div>
              <div className="bubble you">chlorophyll?</div>
              <div className="bubble foxy">
                yes. and chlorophyll absorbs red and blue light, but reflects green. so what colour reaches your eye?
              </div>
            </div>
          </article>

          <article className={`${s.showCard} ${s.showCard2}`} aria-labelledby="card-2-title">
            <div className="lbl">{t('Tool ii · the map', 'औज़ार ii · नक़्शा')}</div>
            <div className="step" aria-hidden="true">ii.</div>
            <h3 id="card-2-title">
              {t('The mastery ', 'महारत का ')}
              <em>{t('x-ray', 'एक्स-रे')}</em>
              {isHi ? '।' : '.'}
            </h3>
            <p>
              {t(
                'Every topic in your syllabus, scored honestly. Strong, mid, weak — no false confidence. Updated after every session by a Bayesian model that forgets nothing and forgives everything.',
                'पाठ्यक्रम का हर विषय, ईमानदारी से अंकित। मज़बूत, मध्यम, कमज़ोर — कोई झूठा आत्मविश्वास नहीं।',
              )}
            </p>
            <div className={s.viz} aria-hidden="true">
              <div className="row">
                <span className="pill">{t('Strong', 'मज़बूत')}</span>
                <div className="meter"><span className="meterFill meterStrong meterW88"></span></div>
                <span className="mono tabular">88</span>
              </div>
              <div className="row">
                <span className="pill">{t('Strong', 'मज़बूत')}</span>
                <div className="meter"><span className="meterFill meterStrong meterW81"></span></div>
                <span className="mono tabular">81</span>
              </div>
              <div className="row">
                <span className="pill">{t('Mid', 'मध्यम')}</span>
                <div className="meter"><span className="meterFill meterMid meterW54"></span></div>
                <span className="mono tabular">54</span>
              </div>
              <div className="row">
                <span className="pill">{t('Mid', 'मध्यम')}</span>
                <div className="meter"><span className="meterFill meterMid meterW47"></span></div>
                <span className="mono tabular">47</span>
              </div>
              <div className="row">
                <span className="pill">{t('Weak', 'कमज़ोर')}</span>
                <div className="meter"><span className="meterFill meterWeak meterW22"></span></div>
                <span className="mono tabular">22</span>
              </div>
            </div>
          </article>

          <article className={`${s.showCard} ${s.showCard3}`} aria-labelledby="card-3-title">
            <div className="lbl">{t('Tool iii · the workbook', 'औज़ार iii · कार्यपुस्तिका')}</div>
            <div className="step" aria-hidden="true">iii.</div>
            <h3 id="card-3-title">
              {t('Quiz that ', 'क्विज़ जो ')}
              <em>{t('teaches back', 'वापस सिखाती है')}</em>
              {isHi ? '।' : '.'}
            </h3>
            <p>
              {t(
                "Get it wrong and Foxy doesn't just mark it red — it walks you through the misconception, then re-asks in a different way three days later. That is how things actually stick.",
                'ग़लत होने पर फ़ॉक्सी सिर्फ़ लाल निशान नहीं लगाता — वह ग़लतफ़हमी समझाता है, और तीन दिन बाद उसी विचार को दूसरे ढंग से पूछता है।',
              )}
            </p>
            <div className={`${s.viz} ${s.vizQuiz}`} aria-hidden="true">
              <div className="q">
                Q3 · In photosynthesis, the primary site of the light reaction is —
              </div>
              <div className="opt"><span className="key">A</span>Cytoplasm</div>
              <div className="opt correct"><span className="key">B</span>Thylakoid membrane ✓</div>
              <div className="opt"><span className="key">C</span>Mitochondria</div>
              <div className="opt"><span className="key">D</span>Cell wall</div>
              <div className="progress"><span></span></div>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
