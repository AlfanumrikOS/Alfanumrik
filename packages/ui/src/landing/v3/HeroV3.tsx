'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useWelcomeV2 } from '../WelcomeV2Context';
import { usePrefersReducedMotion } from '@alfanumrik/ui/cosmic/usePrefersReducedMotion';
import { track } from '@alfanumrik/lib/posthog/client';
import { useReveal } from '../useReveal';
import FoxyMascot, { type FoxyGesture } from './FoxyMascot';
import { CountUp } from './MotionPrimitives';
import { V3_ACTIVE_ROLE } from './NavV3';
import s from './welcome-v3.module.css';

/**
 * V3 hero — Tailark hero-section-1 anatomy + twblocks rotating word + the
 * framed Foxy-chat product panel that plays a scripted exchange once when it
 * scrolls into view. Under prefers-reduced-motion the rotor freezes on the
 * first word and the chat renders in its full final state.
 */

interface RotorWord {
  text: string;
  /** BCP-47 tag when the word is not in the page's active language. */
  lang?: 'hi' | 'en';
}

const ROTOR_EN: RotorWord[] = [
  { text: 'mastered' },
  { text: 'समझा', lang: 'hi' },
  { text: 'measured' },
  { text: 'practised' },
];

/* Mirrors the EN rotation's one-word language wink: one English word inside
   the Hindi rotation. */
const ROTOR_HI: RotorWord[] = [
  { text: 'समझा' },
  { text: 'mastered', lang: 'en' },
  { text: 'मापा गया' },
  { text: 'दोहराया गया' },
];

const ROTOR_INTERVAL_MS = 2600;

function Rotor() {
  const { isHi } = useWelcomeV2();
  const reduced = usePrefersReducedMotion();
  const words = isHi ? ROTOR_HI : ROTOR_EN;
  const [current, setCurrent] = useState(0);
  const [leaving, setLeaving] = useState<number | null>(null);

  // Reset when the language flips so we never index past either array.
  useEffect(() => {
    setCurrent(0);
    setLeaving(null);
  }, [isHi]);

  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => {
      setCurrent((prev) => {
        setLeaving(prev);
        return (prev + 1) % words.length;
      });
    }, ROTOR_INTERVAL_MS);
    return () => clearInterval(id);
  }, [reduced, words.length]);

  // Clear the leaving class after its exit transition so the span snaps back
  // below the mask (its default state) ready for the next cycle.
  useEffect(() => {
    if (leaving === null) return;
    const id = setTimeout(() => setLeaving(null), 520);
    return () => clearTimeout(id);
  }, [leaving]);

  return (
    <span className={s.rotor} aria-hidden="true">
      {words.map((word, i) => (
        <span
          key={word.text}
          lang={word.lang}
          className={
            i === current ? s.rotCurrent : i === leaving ? s.rotLeaving : undefined
          }
        >
          {word.text}
        </span>
      ))}
    </span>
  );
}

/** Chat-demo phases the hero fox reacts to. */
export type ChatDemoPhase = 'typing' | 'answered';

const PLAY_THRESHOLD = 0.35;
/** Never leave the panel blank: force-complete if playback hasn't begun. */
const FAILSAFE_MS = 2500;

/**
 * Scripted Foxy exchange — plays once when ~35% of the panel is visible.
 *
 * 2026-07-17 blank-demo fix (production bug): the previous implementation
 * kept the play-once guard in React STATE and in the effect's dependency
 * array. The moment the IntersectionObserver fired, `setPlayed(true)`
 * re-ran the effect — whose CLEANUP cleared the four just-scheduled script
 * timers before any could fire. The demo stayed at step 0 forever and the
 * message area (everything `msgPending`, opacity 0) rendered blank.
 *
 * The guard is now a ref (`startedRef`) so starting playback never re-runs
 * the effect, plus three independent safety nets:
 *  (a) an immediate mount-time rect check — if the panel is already >= 35%
 *      visible at hydration, play without waiting for IO;
 *  (b) the IntersectionObserver (normal scroll-into-view path);
 *  (c) a 2.5s failsafe that force-completes the conversation if playback
 *      has not begun (IO quirks in embeds/scroll containers).
 * Reduced motion renders the COMPLETED conversation statically (never an
 * empty panel).
 */
function ChatDemo({ onPhase }: { onPhase?: (phase: ChatDemoPhase) => void }) {
  const { isHi, t } = useWelcomeV2();
  const reduced = usePrefersReducedMotion();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const startedRef = useRef(false);
  const onPhaseRef = useRef(onPhase);
  onPhaseRef.current = onPhase;
  // step: 0 nothing · 1 student msg · 2 foxy typing · 3 foxy text · 4 quick chip
  const [step, setStep] = useState(0);

  useEffect(() => {
    // Stable array identity; captured so the cleanup clears the same timers
    // this effect run scheduled (react-hooks/exhaustive-deps hygiene).
    const timers = timersRef.current;

    /** Schedule the scripted playback exactly once per effect lifetime. */
    const play = () => {
      if (startedRef.current) return;
      startedRef.current = true;
      // Calm timing lifted from the approved preview.
      timers.push(setTimeout(() => setStep(1), 600));
      timers.push(
        setTimeout(() => {
          setStep(2);
          onPhaseRef.current?.('typing');
        }, 1700),
      );
      timers.push(
        setTimeout(() => {
          setStep(3);
          onPhaseRef.current?.('answered');
        }, 3400),
      );
      timers.push(setTimeout(() => setStep(4), 4200));
    };

    /** Jump straight to the completed conversation. */
    const finishNow = () => {
      startedRef.current = true;
      setStep(4);
      onPhaseRef.current?.('answered');
    };

    if (reduced) {
      finishNow();
      return;
    }
    const el = bodyRef.current;
    if (el === null || typeof IntersectionObserver === 'undefined') {
      finishNow();
      return;
    }

    // (a) already sufficiently visible at mount — IO can fire late or, in
    // some embed/scroll containers, never with this threshold.
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    const rect = el.getBoundingClientRect();
    const visiblePx = Math.min(rect.bottom, vh) - Math.max(rect.top, 0);
    if (rect.height > 0 && visiblePx / rect.height >= PLAY_THRESHOLD) {
      play();
    }

    // (b) normal path: play when the panel scrolls into view.
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          obs.disconnect();
          play();
        });
      },
      { threshold: PLAY_THRESHOLD },
    );
    obs.observe(el);

    // (c) failsafe: the panel must NEVER stay blank.
    const failsafe = setTimeout(() => {
      if (!startedRef.current) {
        obs.disconnect();
        finishNow();
      }
    }, FAILSAFE_MS);

    return () => {
      obs.disconnect();
      clearTimeout(failsafe);
      timers.forEach(clearTimeout);
      timers.length = 0;
      // Full reset: the cleanup cancelled any in-flight playback, so the
      // guard must open again or a re-run (React StrictMode's dev
      // mount→cleanup→remount, or a reduced-motion flip) would early-return
      // with the timers gone — the exact shape of the original blank-panel
      // bug. A re-run either replays or (reduced) force-completes; both are
      // idempotent.
      startedRef.current = false;
    };
  }, [reduced]);

  return (
    <div className={s.chat} aria-label={t('Foxy chat preview', 'फ़ॉक्सी चैट पूर्वावलोकन')}>
      <div className={s.chatHead}>
        <span style={{ fontSize: 18 }} aria-hidden="true">
          🦊
        </span>
        <span className={s.chatTitle}>Foxy</span>
        <span className={s.chatSub}>{t('Class 8 · Science', 'कक्षा 8 · विज्ञान')}</span>
      </div>
      {/* Decorative mode chips — the real product strings, non-interactive here. */}
      <div className={s.chatModes} aria-hidden="true">
        <span className={s.chatModeActive}>{t('📖 Learn', '📖 सीखें')}</span>
        <span>{t('✏️ Practice', '✏️ अभ्यास')}</span>
        <span>{t('⚡ Quiz', '⚡ क्विज़')}</span>
      </div>
      <div className={s.chatBody} ref={bodyRef} data-chat-step={step}>
        <div className={`${s.msg} ${s.msgStudent} ${step < 1 ? s.msgPending : ''}`}>
          <div className={s.bubble}>
            {t(
              'Which part of a candle flame is the hottest? Test tomorrow 😅',
              'मोमबत्ती की लौ का कौन-सा भाग सबसे गर्म होता है? कल टेस्ट है 😅',
            )}
          </div>
        </div>
        <div className={`${s.msg} ${s.msgFoxy} ${step < 2 ? s.msgPending : ''}`}>
          <span className={s.avatar}>
            <FoxyMascot size={30} />
          </span>
          <div className={s.bubble}>
            {step === 2 ? (
              <span className={s.typing} aria-hidden="true">
                <i></i>
                <i></i>
                <i></i>
              </span>
            ) : (
              <span>
                {isHi ? (
                  <>
                    अच्छा सवाल! मोमबत्ती की लौ के <strong>तीन क्षेत्र</strong> होते हैं 🕯️ —{' '}
                    <strong>सबसे बाहरी क्षेत्र</strong> सबसे गर्म होता है, क्योंकि वहाँ पूर्ण दहन
                    होता है। बीच का प्रदीप्त क्षेत्र चमकता है, और सबसे भीतरी काला क्षेत्र सिर्फ़
                    बिना जला मोम-वाष्प है। (NCERT कक्षा 8 विज्ञान — दहन और ज्वाला।) एक छोटी जाँच
                    करें?
                  </>
                ) : (
                  <>
                    Good question! A candle flame has <strong>three zones</strong> 🕯️ — the{' '}
                    <strong>outermost zone</strong> is the hottest, because complete combustion
                    happens there. The middle luminous zone glows, and the innermost dark zone is
                    just unburnt wax vapour. (NCERT Class 8 Science, Ch. Combustion &amp; Flame.)
                    Want a quick check?
                  </>
                )}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className={s.chatQuick} aria-hidden="true">
        <span className={`${s.msg} ${step < 4 ? s.msgPending : ''}`} style={{ display: 'inline-flex' }}>
          {t('⚡ Quiz me on this', '⚡ इस पर क्विज़ लो')}
        </span>
      </div>
      <div className={s.chatInput} aria-hidden="true">
        <span className={s.field}>
          {t('Ask anything from your chapter…', 'अपने पाठ से कुछ भी पूछो…')}
        </span>
        <span className={s.ask}>{t('🦊 Ask Foxy', '🦊 फ़ॉक्सी से पूछें')}</span>
      </div>
    </div>
  );
}

export default function HeroV3() {
  const { isHi, t } = useWelcomeV2();
  const revealRef = useReveal(50);
  // The panel fox reacts to the chat demo: thinks while the typing indicator
  // shows, celebrates (happy hop) when the answer lands, then settles.
  const [foxGesture, setFoxGesture] = useState<FoxyGesture>('idle');
  const foxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (foxTimerRef.current) clearTimeout(foxTimerRef.current);
    };
  }, []);

  const onDemoPhase = (phase: ChatDemoPhase) => {
    if (foxTimerRef.current) {
      clearTimeout(foxTimerRef.current);
      foxTimerRef.current = null;
    }
    if (phase === 'typing') {
      setFoxGesture('think');
      return;
    }
    // answered → brief happy hop, then back to idle life.
    setFoxGesture('happy');
    foxTimerRef.current = setTimeout(() => setFoxGesture('idle'), 1900);
  };

  return (
    <section className={s.hero} aria-labelledby="welcome-v3-hero-title">
      <div className={s.wrap} ref={revealRef as React.RefObject<HTMLDivElement>}>
        <a
          className={`${s.heroPill} ${s.revealUp}`}
          data-reveal
          href="#ladder"
          onClick={() =>
            track('landing_nav_click', {
              source: 'hero_pill',
              destination: '#ladder',
              label: t(
                "India's first AI Learning OS — CBSE Class 6–12",
                'भारत का पहला AI लर्निंग OS — CBSE कक्षा 6–12',
              ),
              active_role: V3_ACTIVE_ROLE,
            })
          }
        >
          <span className={s.pillText}>
            🇮🇳{' '}
            {t(
              'India’s first AI Learning OS — CBSE Class 6–12',
              'भारत का पहला AI लर्निंग OS — CBSE कक्षा 6–12',
            )}
          </span>
          <span className={s.pillDivider} aria-hidden="true"></span>
          <span className={s.pillArrow} aria-hidden="true">
            <svg className={s.icon} viewBox="0 0 24 24">
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </span>
        </a>

        <h1 id="welcome-v3-hero-title" className={`${s.heroH1} ${s.revealUp}`} data-reveal>
          {/* Static text for screen readers; rotor is decorative. */}
          <span className={s.srOnly} lang={isHi ? 'hi' : undefined}>
            {t('Every chapter mastered', 'हर अध्याय समझा')}
          </span>
          <span aria-hidden="true" lang={isHi ? 'hi' : undefined}>
            {t('Every chapter', 'हर अध्याय')}
            <br />
            <Rotor />
          </span>
        </h1>

        <p className={`${s.heroSub} ${s.revealUp}`} data-reveal>
          {t(
            'Foxy — the AI tutor built on your NCERT — takes your child from tonight’s homework to competition-level thinking. Measured, not promised.',
            'फ़ॉक्सी — आपकी NCERT पर बना AI शिक्षक — आपके बच्चे को आज के गृहकार्य से प्रतियोगिता-स्तर की सोच तक ले जाता है। मापा हुआ, वादा नहीं।',
          )}
        </p>

        <div className={`${s.heroCtas} ${s.revealUp}`} data-reveal>
          <span className={s.btnFrame}>
            <Link
              id="hero-cta"
              href="/login"
              className={`${s.btn} ${s.btnPrimary}`}
              onClick={() =>
                track('landing_cta_click', {
                  location: 'hero',
                  destination: '/login',
                  active_role: V3_ACTIVE_ROLE,
                  language: isHi ? 'hi' : 'en',
                })
              }
            >
              {t('Start free', 'मुफ्त शुरू करें')}
            </Link>
          </span>
          <a className={`${s.btn} ${s.btnGhost}`} href="#demo">
            <svg
              className={s.icon}
              viewBox="0 0 24 24"
              style={{ width: 18, height: 18 }}
              aria-hidden="true"
            >
              <polygon points="6 3 20 12 6 21 6 3" />
            </svg>
            {t('See how it works', 'देखें यह कैसे काम करता है')}
          </a>
        </div>
        <p className={`${s.heroTrust} ${s.revealUp}`} data-reveal>
          {t('No card', 'कोई कार्ड नहीं')}
          <span>·</span>
          {t('Cancel anytime', 'कभी भी रद्द करें')}
          <span>·</span>
          <CountUp
            to={12000}
            suffix="+"
            format={(n) => n.toLocaleString('en-IN')}
            className={s.heroNum}
          />{' '}
          {t('learners', 'विद्यार्थी')}
        </p>
      </div>

      {/* Large product panel in a bordered frame (hero-section-1 pattern),
          one subtle radial glow behind it (borrowed from cta-with-glow). */}
      <div className={s.heroStage} id="demo">
        <div className={s.heroGlow} aria-hidden="true"></div>
        <div className={s.panelFrame}>
          <FoxyMascot className={s.panelFox} gesture={foxGesture} interactive followCursor />
          <ChatDemo onPhase={onDemoPhase} />
          <div className={s.panelFade} aria-hidden="true"></div>
        </div>
      </div>
    </section>
  );
}
