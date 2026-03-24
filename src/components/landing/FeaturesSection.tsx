'use client';

import { useEffect, useRef, useState } from 'react';

/* ══════════════════════════════════════════════════════════════
   FEATURES SECTION — Premium feature grid (Linear/Notion style)
   ══════════════════════════════════════════════════════════════ */

interface Feature {
  emoji: string;
  title: string;
  description: string;
  accentColor: string;
  bgColor: string;
}

const FEATURES: Feature[] = [
  {
    emoji: '🦊',
    title: 'Foxy AI Tutor',
    description:
      'A patient, brilliant tutor available 24/7. Teaches in Hindi, English, or Hinglish — adapting to your child\u2019s exact level.',
    accentColor: '#0EA5E9',
    bgColor: 'rgba(14, 165, 233, 0.10)',
  },
  {
    emoji: '🧠',
    title: 'Adaptive Learning',
    description:
      'Powered by Bayesian Knowledge Tracing. Every question, every answer shapes a personalized learning path.',
    accentColor: '#6366F1',
    bgColor: 'rgba(99, 102, 241, 0.10)',
  },
  {
    emoji: '📅',
    title: 'Smart Study Plans',
    description:
      'AI generates daily plans with the perfect mix: Learn \u2192 Practice \u2192 Quiz \u2192 Review. Science-backed spaced repetition.',
    accentColor: '#0EA5E9',
    bgColor: 'rgba(14, 165, 233, 0.10)',
  },
  {
    emoji: '🔬',
    title: 'Interactive Simulations',
    description:
      'Touch, drag, and experiment. Physics, Chemistry, Biology \u2014 concepts come alive with interactive labs.',
    accentColor: '#10B981',
    bgColor: 'rgba(16, 185, 129, 0.10)',
  },
  {
    emoji: '📋',
    title: 'Board Exam Ready',
    description:
      'CBSE-aligned content. Previous year patterns. Chapter-wise practice. Your child walks into exams confident.',
    accentColor: '#1B2B5B',
    bgColor: 'rgba(27, 43, 91, 0.10)',
  },
  {
    emoji: '👨\u200D👩\u200D👧',
    title: 'Parent Dashboard',
    description:
      'Know exactly where your child stands. Weekly reports, weak areas, study alerts \u2014 without being intrusive.',
    accentColor: '#6366F1',
    bgColor: 'rgba(99, 102, 241, 0.10)',
  },
];

function FeatureCard({
  feature,
  index,
  isVisible,
}: {
  feature: Feature;
  index: number;
  isVisible: boolean;
}) {
  return (
    <div
      className="feature-card"
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible
          ? 'translateY(0)'
          : 'translateY(24px)',
        transitionDelay: `${index * 100}ms`,
      }}
    >
      {/* Left accent border */}
      <div
        className="feature-card__accent"
        style={{ backgroundColor: feature.accentColor }}
      />

      {/* Emoji icon */}
      <div
        className="feature-card__icon"
        style={{ backgroundColor: feature.bgColor }}
      >
        <span>{feature.emoji}</span>
      </div>

      {/* Content */}
      <h3 className="feature-card__title">{feature.title}</h3>
      <p className="feature-card__desc">{feature.description}</p>
    </div>
  );
}

/* ── Bilingual highlight card (full-width) ────────────────── */
function BilingualCard({ isVisible }: { isVisible: boolean }) {
  return (
    <div
      className="bilingual-card"
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(24px)',
        transitionDelay: '650ms',
      }}
    >
      <div className="bilingual-card__inner">
        <div className="bilingual-card__text">
          <div className="bilingual-card__badges">
            <span className="bilingual-badge bilingual-badge--en">English</span>
            <span className="bilingual-badge bilingual-badge--hi">हिन्दी</span>
            <span className="bilingual-badge bilingual-badge--hing">Hinglish</span>
          </div>
          <h3 className="bilingual-card__title">
            Learns in Your Child&apos;s Language
          </h3>
          <p className="bilingual-card__desc">
            Foxy seamlessly switches between English, Hindi, and Hinglish mid-conversation.
            Whether your child thinks in &ldquo;velocity&rdquo; or &ldquo;वेग&rdquo;, Foxy
            meets them where they are.
          </p>
        </div>
        <div className="bilingual-card__visual">
          <div className="bilingual-bubble bilingual-bubble--user">
            Bhaiya ye formula samajh nahi aaya
          </div>
          <div className="bilingual-bubble bilingual-bubble--foxy">
            Koi baat nahi! 😊 Chalo step-by-step dekhte hain&hellip;
            <br />
            <span style={{ color: 'var(--teal)', fontWeight: 600 }}>
              v = u + at
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Main Section ─────────────────────────────────────────── */
export default function FeaturesSection() {
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
      { threshold: 0.1, rootMargin: '0px 0px -60px 0px' }
    );

    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={sectionRef}
      id="features"
      className="features-section"
    >
      <style>{featuresCSS}</style>

      <div className="features-section__container">
        {/* Header */}
        <div className="features-section__header">
          <span className="features-section__badge">Features</span>
          <h2 className="features-section__title">
            Everything Your Child Needs to Excel
          </h2>
          <p className="features-section__subtitle">
            From personalized AI tutoring to board exam prep &mdash; one platform
            that adapts, motivates, and delivers real results.
          </p>
        </div>

        {/* Grid */}
        <div className="features-grid">
          {FEATURES.map((feature, i) => (
            <FeatureCard
              key={feature.title}
              feature={feature}
              index={i}
              isVisible={isVisible}
            />
          ))}
        </div>

        {/* Full-width bilingual card */}
        <BilingualCard isVisible={isVisible} />
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════
   STYLES
   ══════════════════════════════════════════════════════════════ */
const featuresCSS = `
/* ── Section ────────────────────────────────────────────────── */
.features-section {
  position: relative;
  padding: clamp(64px, 10vw, 120px) 0;
  background: var(--bg);
  overflow: hidden;
}

.features-section__container {
  max-width: 1120px;
  margin: 0 auto;
  padding: 0 20px;
}

/* ── Header ─────────────────────────────────────────────────── */
.features-section__header {
  text-align: center;
  max-width: 640px;
  margin: 0 auto clamp(40px, 6vw, 64px);
}

.features-section__badge {
  display: inline-block;
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #1B2B5B;
  background: rgba(27, 43, 91, 0.08);
  border: 1px solid rgba(27, 43, 91, 0.18);
  border-radius: 100px;
  padding: 6px 16px;
  margin-bottom: 20px;
}

.features-section__title {
  font-family: var(--font-display);
  font-size: clamp(28px, 4.5vw, 44px);
  font-weight: 700;
  line-height: 1.15;
  color: var(--text-1);
  margin-bottom: 16px;
  letter-spacing: -0.02em;
}

.features-section__subtitle {
  font-family: var(--font-body);
  font-size: clamp(16px, 2vw, 18px);
  line-height: 1.6;
  color: var(--text-3);
}

/* ── Grid ───────────────────────────────────────────────────── */
.features-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}

@media (min-width: 640px) {
  .features-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 20px;
  }
}

@media (min-width: 1024px) {
  .features-grid {
    grid-template-columns: repeat(3, 1fr);
    gap: 24px;
  }
}

/* ── Feature Card ───────────────────────────────────────────── */
.feature-card {
  position: relative;
  background: var(--surface-1);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 28px 24px 24px 24px;
  overflow: hidden;
  transition:
    transform 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    box-shadow 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94),
    opacity 0.5s ease,
    border-color 0.35s ease;
  cursor: default;
}

.feature-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.06), 0 2px 8px rgba(0, 0, 0, 0.04);
  border-color: var(--border-mid);
}

.feature-card:focus-within {
  outline: 2px solid #1B2B5B;
  outline-offset: 2px;
}

/* Accent left border */
.feature-card__accent {
  position: absolute;
  top: 16px;
  left: 0;
  width: 3px;
  height: 40px;
  border-radius: 0 4px 4px 0;
  transition: height 0.3s ease;
}

.feature-card:hover .feature-card__accent {
  height: 56px;
}

/* Icon circle */
.feature-card__icon {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  margin-bottom: 16px;
  transition: transform 0.3s ease;
}

.feature-card:hover .feature-card__icon {
  transform: scale(1.08);
}

/* Title */
.feature-card__title {
  font-family: var(--font-display);
  font-size: 17px;
  font-weight: 700;
  color: var(--text-1);
  margin-bottom: 8px;
  letter-spacing: -0.01em;
}

/* Description */
.feature-card__desc {
  font-family: var(--font-body);
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-3);
}

/* ── Bilingual Card ─────────────────────────────────────────── */
.bilingual-card {
  margin-top: 24px;
  transition:
    opacity 0.5s ease,
    transform 0.5s ease;
}

.bilingual-card__inner {
  background: linear-gradient(135deg, var(--surface-1) 0%, var(--surface-2) 100%);
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: clamp(24px, 4vw, 40px);
  display: flex;
  flex-direction: column;
  gap: 24px;
  overflow: hidden;
  transition: box-shadow 0.35s ease;
}

.bilingual-card__inner:hover {
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.06);
}

@media (min-width: 768px) {
  .bilingual-card__inner {
    flex-direction: row;
    align-items: center;
    gap: 40px;
  }
}

.bilingual-card__text {
  flex: 1;
}

.bilingual-card__badges {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

.bilingual-badge {
  font-family: var(--font-display);
  font-size: 12px;
  font-weight: 600;
  padding: 4px 12px;
  border-radius: 100px;
}

.bilingual-badge--en {
  background: rgba(14, 165, 233, 0.10);
  color: #0EA5E9;
}

.bilingual-badge--hi {
  background: rgba(27, 43, 91, 0.10);
  color: #1B2B5B;
}

.bilingual-badge--hing {
  background: rgba(99, 102, 241, 0.10);
  color: #6366F1;
}

.bilingual-card__title {
  font-family: var(--font-display);
  font-size: clamp(20px, 3vw, 26px);
  font-weight: 700;
  color: var(--text-1);
  margin-bottom: 10px;
  letter-spacing: -0.02em;
}

.bilingual-card__desc {
  font-family: var(--font-body);
  font-size: 15px;
  line-height: 1.6;
  color: var(--text-3);
}

/* Chat bubbles */
.bilingual-card__visual {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 300px;
  width: 100%;
}

.bilingual-bubble {
  font-family: var(--font-body);
  font-size: 14px;
  line-height: 1.5;
  padding: 12px 16px;
  border-radius: 16px;
  max-width: 260px;
}

.bilingual-bubble--user {
  background: var(--surface-2);
  color: var(--text-2);
  border-bottom-right-radius: 4px;
  align-self: flex-end;
}

.bilingual-bubble--foxy {
  background: rgba(14, 165, 233, 0.08);
  color: var(--text-1);
  border-bottom-left-radius: 4px;
  align-self: flex-start;
  border: 1px solid rgba(14, 165, 233, 0.12);
}

/* ── Reduced motion ─────────────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  .feature-card,
  .bilingual-card {
    transition: none !important;
    opacity: 1 !important;
    transform: none !important;
  }
  .feature-card:hover {
    transform: none;
  }
}
`;
