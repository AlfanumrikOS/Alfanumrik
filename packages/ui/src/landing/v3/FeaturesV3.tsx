'use client';

import { useWelcomeV2 } from '../WelcomeV2Context';
import { useReveal } from '../useReveal';
import { ThinkingGlyph } from './MotionPrimitives';
import s from './welcome-v3.module.css';

/**
 * V3 features grid — Tailark features-1 anatomy: 6 centered cards with cream
 * icon tiles. Section carries id="how" (hard contract: the how-it-works
 * anchor other surfaces deep-link to).
 *
 * Icons: inline lucide-style SVG, 1.9px stroke, no icon library dependency.
 */

interface Feature {
  icon: React.ReactNode;
  titleEn: React.ReactNode;
  titleHi: React.ReactNode;
  bodyEn: React.ReactNode;
  bodyHi: React.ReactNode;
}

const FEATURES: Feature[] = [
  {
    icon: (
      <svg className={s.icon} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 7v14" />
        <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
      </svg>
    ),
    titleEn: 'Ask anything from NCERT',
    titleHi: 'NCERT से कुछ भी पूछो',
    bodyEn: 'Foxy answers from your own textbook — chapter, page and example — never from thin air.',
    bodyHi: 'फ़ॉक्सी आपकी अपनी पाठ्यपुस्तक से जवाब देता है — पाठ, पृष्ठ और उदाहरण सहित — कभी हवा से नहीं।',
  },
  {
    icon: (
      <svg className={s.icon} viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="2" />
      </svg>
    ),
    titleEn: 'Bloom’s-tracked practice',
    titleHi: 'Bloom’s-स्तर पर आँका अभ्यास',
    bodyEn: 'Every question is tagged recall → analyse → create, so practice climbs instead of circling.',
    bodyHi: 'हर प्रश्न recall → analyse → create स्तर से जुड़ा है — ताकि अभ्यास गोल-गोल न घूमे, ऊपर चढ़े।',
  },
  {
    icon: (
      <svg className={s.icon} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14.1 6 9 3 3.6 4.9a1 1 0 0 0-.6.9v13.4a1 1 0 0 0 1.3.9L9 18l6 3 5.4-1.9a1 1 0 0 0 .6-.9V5.2a1 1 0 0 0-1.3-.9L15 6z" />
        <path d="M9 3v15" />
        <path d="M15 6v15" />
      </svg>
    ),
    titleEn: 'Mastery map',
    titleHi: 'महारत का नक़्शा',
    bodyEn: 'A living map of every chapter — what’s solid, what’s shaky, what to touch tonight.',
    bodyHi: 'हर अध्याय का जीवित नक़्शा — क्या पक्का है, क्या कच्चा, और आज रात क्या दोहराना है।',
  },
  {
    icon: (
      <svg className={s.icon} viewBox="0 0 24 24" aria-hidden="true">
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="m22 7-10 6L2 7" />
        <path
          d="M12 17.2c-1.4-1.2-2.4-2.1-2.4-3.1a1.4 1.4 0 0 1 2.4-1 1.4 1.4 0 0 1 2.4 1c0 1-1 1.9-2.4 3.1z"
          fill="currentColor"
          stroke="none"
        />
      </svg>
    ),
    titleEn: 'Sunday parent letter',
    titleHi: 'रविवार का अभिभावक पत्र',
    bodyEn: 'Every Sunday, a short letter home: what moved, what needs work, in plain words.',
    bodyHi: 'हर रविवार घर के लिए एक छोटा पत्र: क्या आगे बढ़ा, कहाँ मेहनत चाहिए — सीधी भाषा में।',
  },
  {
    icon: (
      <svg className={s.icon} viewBox="0 0 24 24" aria-hidden="true">
        <rect x="8" y="2" width="8" height="4" rx="1" />
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
        <path d="M12 11h4" />
        <path d="M12 16h4" />
        <path d="M8 11h.01" />
        <path d="M8 16h.01" />
      </svg>
    ),
    titleEn: 'Teacher Monday brief',
    titleHi: 'शिक्षक का सोमवार ब्रीफ़',
    bodyEn: 'Class-level signal each Monday: who’s stuck where, before the unit test — not after.',
    bodyHi: 'हर सोमवार कक्षा-स्तर का संकेत: कौन कहाँ अटका है — यूनिट टेस्ट से पहले, बाद में नहीं।',
  },
  {
    icon: (
      <svg className={s.icon} viewBox="0 0 24 24" aria-hidden="true">
        <path d="m5 8 6 6" />
        <path d="m4 14 6-6 2-3" />
        <path d="M2 5h12" />
        <path d="M7 2h1" />
        <path d="m22 22-5-10-5 10" />
        <path d="M14 18h6" />
      </svg>
    ),
    titleEn: (
      <>
        Bilingual — EN &amp; <span lang="hi">हिंदी</span>
      </>
    ),
    titleHi: (
      <>
        द्विभाषी — अंग्रेज़ी और <span lang="hi">हिंदी</span>
      </>
    ),
    bodyEn: (
      <>
        Learn in English, ask in <span lang="hi">हिंदी</span>, switch mid-sentence. Foxy keeps up.
      </>
    ),
    bodyHi: (
      <>
        अंग्रेज़ी में सीखो, <span lang="hi">हिंदी</span> में पूछो, वाक्य के बीच में भाषा बदलो।
        फ़ॉक्सी साथ चलता है।
      </>
    ),
  },
];

export default function FeaturesV3() {
  const { isHi, t } = useWelcomeV2();
  const revealRef = useReveal(50);

  return (
    <section className={s.section} id="how" aria-labelledby="features-v3-title">
      <div className={s.wrap} ref={revealRef as React.RefObject<HTMLDivElement>}>
        <div className={`${s.sectionHead} ${s.revealUp}`} data-reveal>
          <span className={s.eyebrow}>
            <ThinkingGlyph />
            {t('What you get', 'आपको क्या मिलता है')}
          </span>
          <h2 id="features-v3-title">
            {t(
              'Built for the way CBSE actually examines',
              'जैसे CBSE सच में परखता है, वैसे ही बनाया गया',
            )}
          </h2>
          <p>
            {t(
              'Six quiet superpowers, working every school night.',
              'छह शांत महाशक्तियाँ, हर स्कूल-रात काम पर।',
            )}
          </p>
        </div>
        <div className={s.featuresGrid}>
          {FEATURES.map((feature, i) => (
            <div key={i} className={`${s.featureCard} ${s.revealUp}`} data-reveal>
              <div className={s.iconTile}>{feature.icon}</div>
              <h3>{isHi ? feature.titleHi : feature.titleEn}</h3>
              <p>{isHi ? feature.bodyHi : feature.bodyEn}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
