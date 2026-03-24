'use client';

import { useEffect, useRef, useState } from 'react';

/* ══════════════════════════════════════════════════════════════
   HOW IT WORKS — 3-step onboarding flow (Stripe-inspired)
   ══════════════════════════════════════════════════════════════ */

interface Step {
  number: number;
  title: string;
  description: string;
  icon: string;
  accentColor: string;
  visual: React.ReactNode;
}

/* ── Mini Visuals ─────────────────────────────────────────── */
function MiniSignupForm() {
  return (
    <div className="hiw-mini-form">
      <div className="hiw-mini-form__field">
        <span className="hiw-mini-form__label">Grade</span>
        <div className="hiw-mini-form__select">
          <span>Class 10</span>
          <span style={{ opacity: 0.7 }}>&#9662;</span>
        </div>
      </div>
      <div className="hiw-mini-form__field">
        <span className="hiw-mini-form__label">Board</span>
        <div className="hiw-mini-form__select">
          <span>CBSE</span>
          <span style={{ opacity: 0.7 }}>&#9662;</span>
        </div>
      </div>
      <div className="hiw-mini-form__chips">
        <span className="hiw-mini-chip hiw-mini-chip--active">Math</span>
        <span className="hiw-mini-chip hiw-mini-chip--active">Science</span>
        <span className="hiw-mini-chip">English</span>
      </div>
    </div>
  );
}

function MiniChatBubble() {
  return (
    <div className="hiw-mini-chat">
      <div className="hiw-mini-chat__bubble hiw-mini-chat__bubble--foxy">
        <span className="hiw-mini-chat__avatar">🦊</span>
        <div>
          <span style={{ fontWeight: 600, fontSize: 12 }}>Foxy</span>
          <p>Hi! Let&apos;s start with Quadratic Equations. Ready?</p>
        </div>
      </div>
      <div className="hiw-mini-chat__bubble hiw-mini-chat__bubble--user">
        <p>Yes! Let&apos;s go 🚀</p>
      </div>
    </div>
  );
}

function MiniProgressBar() {
  return (
    <div className="hiw-mini-progress">
      <div className="hiw-mini-progress__row">
        <span className="hiw-mini-progress__subject">Math</span>
        <div className="hiw-mini-progress__bar">
          <div
            className="hiw-mini-progress__fill"
            style={{ width: '78%', background: '#c4623f' }}
          />
        </div>
        <span className="hiw-mini-progress__pct">78%</span>
      </div>
      <div className="hiw-mini-progress__row">
        <span className="hiw-mini-progress__subject">Science</span>
        <div className="hiw-mini-progress__bar">
          <div
            className="hiw-mini-progress__fill"
            style={{ width: '62%', background: '#5589b8' }}
          />
        </div>
        <span className="hiw-mini-progress__pct">62%</span>
      </div>
      <div className="hiw-mini-progress__streak">
        <span>🔥</span>
        <span style={{ fontWeight: 600 }}>7-day streak!</span>
      </div>
    </div>
  );
}

const STEPS: Step[] = [
  {
    number: 1,
    title: 'Sign Up Free',
    description: 'Pick your grade, board, and subjects. Takes 30 seconds.',
    icon: '✨',
    accentColor: '#c4623f',
    visual: <MiniSignupForm />,
  },
  {
    number: 2,
    title: 'Meet Foxy',
    description:
      'Your AI tutor learns your strengths and gaps. Start with any topic or scan a question.',
    icon: '🦊',
    accentColor: '#5589b8',
    visual: <MiniChatBubble />,
  },
  {
    number: 3,
    title: 'Watch Progress',
    description:
      'Foxy builds your mastery day by day. Parents and teachers see real results.',
    icon: '📈',
    accentColor: '#6b7f50',
    visual: <MiniProgressBar />,
  },
];

/* ── Step Card ────────────────────────────────────────────── */
function StepCard({
  step,
  isVisible,
}: {
  step: Step;
  isVisible: boolean;
}) {
  return (
    <div
      className="hiw-step"
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(32px)',
        transitionDelay: `${(step.number - 1) * 200}ms`,
      }}
    >
      {/* Number circle */}
      <div
        className="hiw-step__number"
        style={{ background: step.accentColor }}
      >
        {step.number}
      </div>

      {/* Visual */}
      <div className="hiw-step__visual">{step.visual}</div>

      {/* Content */}
      <div className="hiw-step__content">
        <div className="hiw-step__icon">{step.icon}</div>
        <h3 className="hiw-step__title">{step.title}</h3>
        <p className="hiw-step__desc">{step.description}</p>
      </div>
    </div>
  );
}

/* ── Main Section ─────────────────────────────────────────── */
export default function HowItWorks() {
  const sectionRef = useRef<HTMLElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const prefersReduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    if (prefersReduced) {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
    );

    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={sectionRef} id="how-it-works" className="hiw-section">
      <style>{hiwCSS}</style>

      <div className="hiw-container">
        {/* Header */}
        <div className="hiw-header">
          <span className="hiw-header__badge">How It Works</span>
          <h2 className="hiw-header__title">
            Start Learning in{' '}
            <span className="hiw-header__accent">3 Steps</span>
          </h2>
        </div>

        {/* Steps */}
        <div className="hiw-steps">
          {/* Connector line */}
          <div className="hiw-connector" aria-hidden="true">
            <div
              className="hiw-connector__fill"
              style={{
                transform: isVisible ? 'scaleX(1)' : 'scaleX(0)',
              }}
            />
            <div className="hiw-connector__pulse" />
          </div>

          {STEPS.map((step) => (
            <StepCard key={step.number} step={step} isVisible={isVisible} />
          ))}
        </div>

        {/* CTA */}
        <div
          className="hiw-cta"
          style={{
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? 'translateY(0)' : 'translateY(20px)',
            transitionDelay: '800ms',
          }}
        >
          <a href="/auth/reset" className="hiw-cta__button">
            Get Started Free &mdash; It&apos;s 30 Seconds
            <span className="hiw-cta__arrow">&rarr;</span>
          </a>
          <p className="hiw-cta__note">No credit card required</p>
        </div>
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════
   STYLES
   ══════════════════════════════════════════════════════════════ */
const hiwCSS = `
/* ── Section ────────────────────────────────────────────────── */
.hiw-section {
  position: relative;
  padding: clamp(64px, 10vw, 120px) 0;
  background: var(--surface-2);
  overflow: hidden;
}

.hiw-container {
  max-width: 1120px;
  margin: 0 auto;
  padding: 0 20px;
}

/* ── Header ─────────────────────────────────────────────────── */
.hiw-header {
  text-align: center;
  margin-bottom: clamp(40px, 6vw, 72px);
}

.hiw-header__badge {
  display: inline-block;
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #c4623f;
  background: rgba(196, 98, 63,0.08);
  border: 1px solid rgba(196, 98, 63,0.18);
  border-radius: 100px;
  padding: 6px 16px;
  margin-bottom: 20px;
}

.hiw-header__title {
  font-family: var(--font-display);
  font-size: clamp(28px, 4.5vw, 44px);
  font-weight: 700;
  line-height: 1.15;
  color: var(--text-1);
  letter-spacing: -0.02em;
}

.hiw-header__accent {
  color: #c4623f;
  position: relative;
}

.hiw-header__accent::after {
  content: '';
  position: absolute;
  left: 0;
  bottom: -2px;
  width: 100%;
  height: 3px;
  background: linear-gradient(90deg, #c4623f, #b8922e);
  border-radius: 2px;
}

/* ── Steps container ────────────────────────────────────────── */
.hiw-steps {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 32px;
}

@media (min-width: 768px) {
  .hiw-steps {
    flex-direction: row;
    gap: 24px;
  }
}

/* ── Connector line ─────────────────────────────────────────── */
.hiw-connector {
  display: none;
}

@media (min-width: 768px) {
  .hiw-connector {
    display: block;
    position: absolute;
    top: 24px;
    left: calc(16.66% + 12px);
    right: calc(16.66% + 12px);
    height: 2px;
    background: var(--border);
    z-index: 1;
  }

  .hiw-connector__fill {
    width: 100%;
    height: 100%;
    background: linear-gradient(
      90deg,
      #c4623f,
      #5589b8,
      #6b7f50
    );
    border-radius: 2px;
    transform-origin: left;
    transition: transform 1s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.3s;
  }

  /* Jade pulse animation - bright spot traveling along the line */
  .hiw-connector__pulse {
    position: absolute;
    top: -2px;
    left: 0;
    width: 40px;
    height: 6px;
    border-radius: 3px;
    background: radial-gradient(ellipse at center, rgba(196, 98, 63, 0.7) 0%, transparent 70%);
    animation: hiw-pulse-travel 3s ease-in-out infinite 1.5s;
    pointer-events: none;
  }

  @keyframes hiw-pulse-travel {
    0% {
      left: 0%;
      opacity: 0;
    }
    10% {
      opacity: 1;
    }
    90% {
      opacity: 1;
    }
    100% {
      left: calc(100% - 40px);
      opacity: 0;
    }
  }
}

/* ── Step card ──────────────────────────────────────────────── */
.hiw-step {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  position: relative;
  z-index: 2;
  transition:
    opacity 0.6s ease,
    transform 0.6s ease;
}

.hiw-step__number {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 700;
  margin-bottom: 20px;
  box-shadow: 0 4px 12px rgba(20, 20, 19, 0.10), 0 0 0 4px rgba(20, 20, 19, 0.04);
  flex-shrink: 0;
}

/* Visual */
.hiw-step__visual {
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 16px;
  width: 100%;
  max-width: 280px;
  margin-bottom: 20px;
  transition: box-shadow 0.3s ease, transform 0.3s ease;
}

.hiw-step:hover .hiw-step__visual {
  box-shadow: 0 6px 20px rgba(20, 20, 19, 0.06);
  transform: translateY(-2px);
}

/* Content */
.hiw-step__content {
  max-width: 280px;
}

.hiw-step__icon {
  font-size: 24px;
  margin-bottom: 8px;
}

.hiw-step__title {
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 700;
  color: var(--text-1);
  margin-bottom: 6px;
  letter-spacing: -0.01em;
}

.hiw-step__desc {
  font-family: var(--font-body);
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-3);
}

/* ── Mini Form Visual ───────────────────────────────────────── */
.hiw-mini-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.hiw-mini-form__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.hiw-mini-form__label {
  font-family: var(--font-body);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-3);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.hiw-mini-form__select {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  font-family: var(--font-body);
  font-size: 13px;
  color: var(--text-1);
}

.hiw-mini-form__chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.hiw-mini-chip {
  font-family: var(--font-body);
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 100px;
  background: var(--surface-2);
  color: var(--text-3);
  border: 1px solid var(--border);
}

.hiw-mini-chip--active {
  background: rgba(196, 98, 63,0.10);
  color: #c4623f;
  border-color: rgba(196, 98, 63,0.25);
  font-weight: 600;
}

/* ── Mini Chat Visual ───────────────────────────────────────── */
.hiw-mini-chat {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.hiw-mini-chat__bubble {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.hiw-mini-chat__bubble p {
  font-family: var(--font-body);
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-2);
  margin: 0;
}

.hiw-mini-chat__bubble--foxy {
  background: rgba(196, 98, 63, 0.06);
  border-radius: 12px 12px 12px 4px;
  padding: 10px 12px;
}

.hiw-mini-chat__bubble--user {
  background: var(--surface-2);
  border-radius: 12px 12px 4px 12px;
  padding: 10px 12px;
  align-self: flex-end;
  margin-left: 32px;
}

.hiw-mini-chat__avatar {
  font-size: 18px;
  flex-shrink: 0;
}

/* ── Mini Progress Visual ───────────────────────────────────── */
.hiw-mini-progress {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.hiw-mini-progress__row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.hiw-mini-progress__subject {
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
  min-width: 50px;
}

.hiw-mini-progress__bar {
  flex: 1;
  height: 6px;
  border-radius: 4px;
  background: var(--surface-2);
  overflow: hidden;
}

.hiw-mini-progress__fill {
  height: 100%;
  border-radius: 4px;
  transition: width 1s ease 0.6s;
}

.hiw-mini-progress__pct {
  font-family: var(--font-display);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
  min-width: 32px;
  text-align: right;
}

.hiw-mini-progress__streak {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-body);
  font-size: 13px;
  color: #c4623f;
  padding-top: 4px;
}

/* ── CTA ────────────────────────────────────────────────────── */
.hiw-cta {
  text-align: center;
  margin-top: clamp(48px, 6vw, 72px);
  transition:
    opacity 0.6s ease,
    transform 0.6s ease;
}

.hiw-cta__button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-display);
  font-size: clamp(16px, 2vw, 18px);
  font-weight: 700;
  color: #fff;
  background: #c4623f;
  border: none;
  border-radius: 12px;
  padding: 16px 32px;
  text-decoration: none;
  cursor: pointer;
  transition:
    transform 0.25s ease,
    box-shadow 0.25s ease;
  box-shadow: 0 2px 12px rgba(196, 98, 63, 0.25);
}

.hiw-cta__button:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 20px rgba(196, 98, 63, 0.35);
}

.hiw-cta__button:focus-visible {
  outline: 3px solid #c4623f;
  outline-offset: 3px;
}

.hiw-cta__button:active {
  transform: translateY(0);
}

.hiw-cta__arrow {
  transition: transform 0.25s ease;
}

.hiw-cta__button:hover .hiw-cta__arrow {
  transform: translateX(4px);
}

.hiw-cta__note {
  font-family: var(--font-body);
  font-size: 14px;
  color: var(--text-3);
  margin-top: 12px;
}

/* ── Reduced motion ─────────────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  .hiw-step,
  .hiw-cta {
    transition: none !important;
    opacity: 1 !important;
    transform: none !important;
  }
  .hiw-connector__fill {
    transition: none !important;
    transform: scaleX(1) !important;
  }
  .hiw-connector__pulse {
    animation: none !important;
  }
  .hiw-step:hover .hiw-step__visual {
    transform: none;
  }
}
`;
