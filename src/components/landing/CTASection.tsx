'use client';

import { useEffect, useRef, useState } from 'react';

/* ══════════════════════════════════════════════════════════════
   FLOATING EMOJI BACKGROUND
   ══════════════════════════════════════════════════════════════ */

interface FloatingEmoji {
  emoji: string;
  x: number;
  y: number;
  size: number;
  delay: number;
  duration: number;
}

const EMOJIS: FloatingEmoji[] = [
  { emoji: '📚', x: 8, y: 15, size: 28, delay: 0, duration: 18 },
  { emoji: '🧠', x: 85, y: 20, size: 24, delay: 2, duration: 22 },
  { emoji: '🔬', x: 15, y: 70, size: 22, delay: 4, duration: 20 },
  { emoji: '📐', x: 78, y: 75, size: 26, delay: 1, duration: 16 },
  { emoji: '🦊', x: 50, y: 10, size: 30, delay: 3, duration: 24 },
  { emoji: '✨', x: 92, y: 50, size: 20, delay: 5, duration: 19 },
  { emoji: '🎯', x: 5, y: 45, size: 22, delay: 2.5, duration: 21 },
];

function FloatingEmojis() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);

  if (reduced) return null;

  return (
    <div className="floating-emojis" aria-hidden="true">
      {EMOJIS.map((e, i) => (
        <span
          key={i}
          className="floating-emoji"
          style={{
            left: `${e.x}%`,
            top: `${e.y}%`,
            fontSize: `${e.size}px`,
            animationDelay: `${e.delay}s`,
            animationDuration: `${e.duration}s`,
          }}
        >
          {e.emoji}
        </span>
      ))}

      <style jsx>{`
        .floating-emojis {
          position: absolute;
          inset: 0;
          overflow: hidden;
          pointer-events: none;
          z-index: 0;
        }
        .floating-emoji {
          position: absolute;
          opacity: 0.15;
          animation: emojiDrift linear infinite;
          will-change: transform;
        }
        @keyframes emojiDrift {
          0% {
            transform: translate(0, 0) rotate(0deg);
          }
          25% {
            transform: translate(12px, -18px) rotate(5deg);
          }
          50% {
            transform: translate(-8px, -30px) rotate(-3deg);
          }
          75% {
            transform: translate(15px, -12px) rotate(4deg);
          }
          100% {
            transform: translate(0, 0) rotate(0deg);
          }
        }
      `}</style>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   CTA SECTION
   ══════════════════════════════════════════════════════════════ */

interface CTASectionProps {
  onGetStarted?: () => void;
}

export default function CTASection({ onGetStarted }: CTASectionProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={sectionRef} className="cta-section" id="get-started">
      <FloatingEmojis />

      {/* Jade radial glow */}
      <div className="jade-glow" aria-hidden="true" />

      {/* Animated jade light beams */}
      <div className="light-beams" aria-hidden="true">
        <div className="beam beam-1" />
        <div className="beam beam-2" />
        <div className="beam beam-3" />
      </div>

      <div
        className="cta-content"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(32px)',
          transition: 'opacity 0.7s ease, transform 0.7s ease',
        }}
      >
        <h2 className="cta-headline">
          Ready to Transform Your Child&apos;s Learning?
        </h2>

        <p className="cta-subheading">
          Join 10,000+ students already learning smarter with Foxy.
          <br className="hide-mobile" />
          Free to start, no credit card needed.
        </p>

        <div className="cta-buttons">
          <button
            className="btn-primary"
            onClick={onGetStarted}
            type="button"
          >
            Start Learning Free
            <span className="btn-arrow" aria-hidden="true">&rarr;</span>
          </button>

          <a href="mailto:hello@alfanumrik.com" className="btn-secondary">
            Talk to Us
          </a>
        </div>

        <p className="cta-note">
          <span className="note-label">Free plan includes:</span>
          Unlimited Foxy chats · 3 subjects · Study plans · Progress tracking
        </p>
      </div>

      <style jsx>{`
        .cta-section {
          position: relative;
          background: linear-gradient(165deg, #0D1B2A 0%, #00B17A 120%);
          padding: 80px 20px 88px;
          overflow: hidden;
        }
        .jade-glow {
          position: absolute;
          inset: 0;
          background: radial-gradient(circle at 50% 60%, rgba(0, 177, 122, 0.15) 0%, transparent 60%);
          pointer-events: none;
          z-index: 0;
        }
        .light-beams {
          position: absolute;
          inset: 0;
          overflow: hidden;
          pointer-events: none;
          z-index: 0;
        }
        .beam {
          position: absolute;
          width: 1px;
          height: 200%;
          background: rgba(0, 177, 122, 0.03);
          top: -50%;
          transform-origin: center center;
          animation: beamRotate linear infinite;
        }
        .beam-1 {
          left: 30%;
          animation-duration: 20s;
          transform: rotate(25deg);
        }
        .beam-2 {
          left: 55%;
          animation-duration: 28s;
          transform: rotate(-15deg);
          animation-delay: -5s;
        }
        .beam-3 {
          left: 75%;
          animation-duration: 24s;
          transform: rotate(35deg);
          animation-delay: -10s;
        }
        @keyframes beamRotate {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .cta-content {
          position: relative;
          z-index: 1;
          max-width: 720px;
          margin: 0 auto;
          text-align: center;
          will-change: opacity, transform;
        }
        .cta-headline {
          font-family: var(--font-display);
          font-size: 2rem;
          font-weight: 800;
          color: #FFFFFF;
          line-height: 1.15;
          letter-spacing: -0.02em;
          margin-bottom: 20px;
        }
        .cta-subheading {
          font-size: 1.1rem;
          color: rgba(255, 255, 255, 0.7);
          line-height: 1.6;
          margin-bottom: 36px;
        }
        .hide-mobile {
          display: none;
        }
        .cta-buttons {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 14px;
          margin-bottom: 32px;
        }
        .btn-primary {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 16px 36px;
          font-family: var(--font-display);
          font-size: 1.05rem;
          font-weight: 700;
          color: #FFFFFF;
          background: linear-gradient(135deg, #00B17A, #00D68F);
          border: none;
          border-radius: 14px;
          cursor: pointer;
          transition: transform 0.2s ease, box-shadow 0.3s ease;
          box-shadow: 0 4px 24px rgba(0, 177, 122, 0.35);
          white-space: nowrap;
        }
        .btn-primary:hover {
          transform: translateY(-2px) scale(1.02);
          box-shadow: 0 8px 40px rgba(0, 177, 122, 0.5);
        }
        .btn-primary:active {
          transform: translateY(0) scale(0.99);
        }
        .btn-arrow {
          font-size: 1.2em;
          transition: transform 0.2s ease;
        }
        .btn-primary:hover .btn-arrow {
          transform: translateX(3px);
        }
        .btn-secondary {
          display: inline-flex;
          align-items: center;
          padding: 14px 32px;
          font-family: var(--font-display);
          font-size: 0.95rem;
          font-weight: 600;
          color: rgba(255, 255, 255, 0.9);
          background: transparent;
          border: 1.5px solid rgba(255, 255, 255, 0.25);
          border-radius: 14px;
          cursor: pointer;
          text-decoration: none;
          transition: border-color 0.2s ease, background 0.2s ease, color 0.2s ease;
          white-space: nowrap;
        }
        .btn-secondary:hover {
          border-color: rgba(255, 255, 255, 0.5);
          background: rgba(255, 255, 255, 0.06);
          color: #FFFFFF;
        }
        .cta-note {
          font-size: 0.85rem;
          color: rgba(255, 255, 255, 0.45);
          line-height: 1.5;
        }
        .note-label {
          font-weight: 600;
          color: rgba(255, 255, 255, 0.6);
          margin-right: 6px;
        }

        @media (min-width: 640px) {
          .cta-buttons {
            flex-direction: row;
            justify-content: center;
          }
          .hide-mobile {
            display: inline;
          }
        }
        @media (min-width: 768px) {
          .cta-section {
            padding: 100px 32px 108px;
          }
          .cta-headline {
            font-size: 2.75rem;
          }
          .cta-subheading {
            font-size: 1.2rem;
          }
        }
        @media (min-width: 1024px) {
          .cta-headline {
            font-size: 3rem;
          }
        }
      `}</style>
    </section>
  );
}
