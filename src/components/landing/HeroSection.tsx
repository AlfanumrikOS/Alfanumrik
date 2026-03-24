'use client';

import React, { useEffect, useRef, useState } from 'react';

interface HeroSectionProps {
  onGetStarted?: () => void;
}

/* ─── Simulated chat messages for the phone mockup ─── */
const CHAT_MESSAGES = [
  {
    role: 'student' as const,
    text: 'Explain photosynthesis simply',
  },
  {
    role: 'foxy' as const,
    text: 'Think of leaves as tiny solar-powered food factories! \u{1F33F} They capture sunlight, mix it with water & CO\u2082, and cook up glucose \u2014 their food!',
  },
  {
    role: 'student' as const,
    text: 'So they eat sunlight? \u{1F60E}',
  },
  {
    role: 'foxy' as const,
    text: 'Exactly! And the best part? They release oxygen as a byproduct. Plants are literally feeding the planet while breathing life into it \u{1F30D}\u2728',
  },
];

export default function HeroSection({ onGetStarted }: HeroSectionProps) {
  const [visibleMessages, setVisibleMessages] = useState(0);
  const heroRef = useRef<HTMLElement>(null);

  // Animate chat messages appearing one by one
  useEffect(() => {
    if (visibleMessages >= CHAT_MESSAGES.length) return;
    const timer = setTimeout(() => {
      setVisibleMessages((v) => v + 1);
    }, 800 + visibleMessages * 600);
    return () => clearTimeout(timer);
  }, [visibleMessages]);

  return (
    <section
      ref={heroRef}
      id="hero"
      style={{
        position: 'relative',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        padding: '80px 24px 60px',
      }}
    >
      {/* ─── SVG grain filter ─── */}
      <svg style={{ position: 'absolute', width: 0, height: 0 }}>
        <filter id="grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
      </svg>

      {/* ─── Warm background with grain overlay ─── */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
          overflow: 'hidden',
          background: '#faf9f5',
        }}
      >
        {/* Grain texture overlay */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            opacity: 0.03,
            filter: 'url(#grain)',
            zIndex: 0,
          }}
        />

        {/* Warm amber/terra cotta glow - top right */}
        <div
          className="hero-gradient-orb hero-orb-1"
          style={{
            position: 'absolute',
            top: '-10%',
            right: '-5%',
            width: '60vw',
            height: '60vw',
            maxWidth: 700,
            maxHeight: 700,
            borderRadius: '50%',
            background:
              'radial-gradient(circle, rgba(217,119,87,0.08) 0%, transparent 70%)',
            filter: 'blur(40px)',
          }}
        />
        {/* Subtle blue glow - bottom left */}
        <div
          className="hero-gradient-orb hero-orb-2"
          style={{
            position: 'absolute',
            bottom: '-15%',
            left: '-10%',
            width: '50vw',
            height: '50vw',
            maxWidth: 600,
            maxHeight: 600,
            borderRadius: '50%',
            background:
              'radial-gradient(circle, rgba(106,155,204,0.06) 0%, transparent 70%)',
            filter: 'blur(50px)',
          }}
        />
        {/* Subtle green glow - center */}
        <div
          className="hero-gradient-orb hero-orb-3"
          style={{
            position: 'absolute',
            top: '30%',
            left: '30%',
            width: '40vw',
            height: '40vw',
            maxWidth: 500,
            maxHeight: 500,
            borderRadius: '50%',
            background:
              'radial-gradient(circle, rgba(120,140,93,0.05) 0%, transparent 60%)',
            filter: 'blur(60px)',
          }}
        />
      </div>

      {/* ─── Main content ─── */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          maxWidth: 1200,
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        {/* Two-column layout on desktop */}
        <div
          className="hero-layout"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '3rem',
            width: '100%',
          }}
        >
          {/* Left: Text content */}
          <div
            className="hero-text-col"
            style={{
              flex: '1 1 540px',
              maxWidth: 600,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
            }}
          >
            {/* Pill badge */}
            <div
              className="hero-fade-in"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 16px',
                borderRadius: 100,
                background: 'rgba(217, 119, 87, 0.08)',
                border: '1px solid rgba(217, 119, 87, 0.15)',
                fontSize: '0.85rem',
                fontWeight: 600,
                color: '#c4623f',
                marginBottom: 24,
                animationDelay: '0.1s',
              }}
            >
              <span>{'\u{1F1EE}\u{1F1F3}'}</span>
              <span>India&apos;s #1 AI Learning Platform</span>
            </div>

            {/* Main headline */}
            <h1
              className="hero-fade-in font-heading"
              style={{
                fontSize: 'clamp(2.2rem, 5vw, 3.75rem)',
                fontWeight: 800,
                lineHeight: 1.1,
                letterSpacing: '-0.025em',
                color: 'var(--text-1)',
                marginBottom: 20,
                animationDelay: '0.25s',
                fontFamily: 'var(--font-heading)',
              }}
            >
              Your Child&apos;s Personal{' '}
              <span
                className="hero-gradient-text"
                style={{
                  background:
                    'linear-gradient(135deg, #c4623f 0%, #b8922e 33%, #5589b8 66%, #c4623f 100%)',
                  backgroundSize: '200% 200%',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                AI Tutor
              </span>{' '}
              That Actually Works
            </h1>

            {/* Subheading */}
            <p
              className="hero-fade-in"
              style={{
                fontSize: 'clamp(1rem, 2vw, 1.2rem)',
                lineHeight: 1.75,
                color: 'var(--text-2)',
                maxWidth: 520,
                marginBottom: 36,
                animationDelay: '0.4s',
                fontFamily: 'var(--font-body)',
              }}
            >
              Foxy adapts to every student&apos;s level. Hindi &amp; English.
              CBSE Grades 6-12. Powered by cognitive science, not just AI.
            </p>

            {/* CTA row */}
            <div
              className="hero-fade-in"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 14,
                alignItems: 'center',
                animationDelay: '0.55s',
              }}
            >
              {/* Primary CTA */}
              <button
                onClick={onGetStarted}
                className="hero-cta-primary"
                style={{
                  background: '#c4623f',
                  border: 'none',
                  padding: '14px 32px',
                  minHeight: 52,
                  fontSize: '1.05rem',
                  fontWeight: 700,
                  color: '#fff',
                  cursor: 'pointer',
                  borderRadius: 12,
                  fontFamily: 'var(--font-body)',
                  boxShadow: '0 2px 8px rgba(196, 98, 63, 0.25)',
                  transition: 'box-shadow 0.3s ease, transform 0.3s ease',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  willChange: 'transform',
                }}
              >
                Start Learning Free
                <span
                  className="hero-cta-arrow"
                  style={{
                    fontSize: '1.1rem',
                    display: 'inline-block',
                    transition: 'transform 0.3s ease',
                  }}
                >
                  &rarr;
                </span>
              </button>

              {/* Secondary CTA */}
              <button
                className="hero-cta-secondary"
                style={{
                  background: 'none',
                  border: '1.5px solid #e8e6dc',
                  padding: '14px 28px',
                  minHeight: 52,
                  fontSize: '1.05rem',
                  fontWeight: 600,
                  color: 'var(--text-2)',
                  cursor: 'pointer',
                  borderRadius: 12,
                  fontFamily: 'var(--font-body)',
                  transition:
                    'border-color 0.3s ease, color 0.3s ease, background 0.3s ease',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                {/* Play icon */}
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <polygon
                    points="10,8 16,12 10,16"
                    fill="currentColor"
                    stroke="none"
                  />
                </svg>
                Watch Demo
              </button>
            </div>
          </div>

          {/* Right: Phone mockup */}
          <div
            className="hero-phone-col hero-fade-in"
            style={{
              flex: '0 1 380px',
              display: 'flex',
              justifyContent: 'center',
              animationDelay: '0.5s',
            }}
          >
            <div
              className="hero-phone-float"
              style={{
                width: 300,
                maxWidth: '100%',
                perspective: 1200,
                position: 'relative',
              }}
            >
              {/* Warm orange glow behind phone */}
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: 340,
                  height: 340,
                  borderRadius: '50%',
                  background:
                    'radial-gradient(circle, rgba(217,119,87,0.12) 0%, transparent 70%)',
                  filter: 'blur(30px)',
                }}
              />
              <div
                style={{
                  background: '#141413',
                  borderRadius: 28,
                  padding: 3,
                  boxShadow:
                    '0 24px 60px rgba(20,20,19,0.12), 0 8px 24px rgba(20,20,19,0.08)',
                  transform: 'rotateY(-6deg) rotateX(2deg)',
                  transformStyle: 'preserve-3d',
                }}
              >
                <div
                  style={{
                    background: 'var(--surface-1)',
                    borderRadius: 25,
                    overflow: 'hidden',
                    /* Enforce realistic 9:19.5 phone aspect ratio */
                    aspectRatio: '9 / 19.5',
                    minHeight: 540,
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  {/* Dynamic Island / Camera notch */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'center',
                      paddingTop: 8,
                    }}
                  >
                    <div
                      style={{
                        width: 72,
                        height: 20,
                        borderRadius: 12,
                        background: '#141413',
                      }}
                    />
                  </div>

                  {/* Phone status bar */}
                  <div
                    style={{
                      padding: '6px 16px 6px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      color: 'var(--text-3)',
                    }}
                  >
                    <span>9:41</span>
                    <div
                      style={{
                        display: 'flex',
                        gap: 4,
                        alignItems: 'center',
                      }}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3c-1.65-1.66-4.34-1.66-6 0zm-4-4l2 2c2.76-2.76 7.24-2.76 10 0l2-2C15.14 9.14 8.87 9.14 5 13z" />
                      </svg>
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <rect x="2" y="6" width="3" height="12" rx="1" />
                        <rect x="7" y="4" width="3" height="14" rx="1" />
                        <rect x="12" y="2" width="3" height="16" rx="1" />
                        <rect x="17" y="0" width="3" height="18" rx="1" />
                      </svg>
                      {/* Battery icon */}
                      <svg
                        width="18"
                        height="14"
                        viewBox="0 0 28 14"
                        fill="currentColor"
                      >
                        <rect
                          x="0"
                          y="1"
                          width="22"
                          height="12"
                          rx="2"
                          ry="2"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                        />
                        <rect
                          x="2"
                          y="3"
                          width="16"
                          height="8"
                          rx="1"
                          ry="1"
                        />
                        <rect
                          x="23"
                          y="4"
                          width="3"
                          height="6"
                          rx="1"
                          ry="1"
                        />
                      </svg>
                    </div>
                  </div>

                  {/* App header */}
                  <div
                    style={{
                      padding: '8px 12px 10px',
                      borderBottom: '1px solid var(--border)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    {/* Back button */}
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="var(--text-3)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="15,18 9,12 15,6" />
                    </svg>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: '50%',
                        background:
                          'linear-gradient(135deg, #d97757, #e8956f)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '1rem',
                      }}
                    >
                      {'\u{1F98A}'}
                    </div>
                    <div>
                      <div
                        style={{
                          fontSize: '0.85rem',
                          fontWeight: 700,
                          color: 'var(--text-1)',
                          fontFamily: 'var(--font-display)',
                        }}
                      >
                        Foxy AI Tutor
                      </div>
                      <div
                        style={{
                          fontSize: '0.65rem',
                          color: 'var(--green)',
                          fontWeight: 500,
                        }}
                      >
                        &#x25CF; Online
                      </div>
                    </div>
                  </div>

                  {/* Chat messages */}
                  <div
                    style={{
                      flex: 1,
                      padding: '12px 12px 16px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                      overflowY: 'auto',
                    }}
                  >
                    {CHAT_MESSAGES.slice(0, visibleMessages).map((msg, i) => (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          justifyContent:
                            msg.role === 'student'
                              ? 'flex-end'
                              : 'flex-start',
                          animation:
                            'heroMsgSlideIn 0.4s ease-out forwards',
                        }}
                      >
                        <div
                          style={{
                            maxWidth: '82%',
                            padding: '10px 14px',
                            borderRadius:
                              msg.role === 'student'
                                ? '16px 16px 4px 16px'
                                : '16px 16px 16px 4px',
                            background:
                              msg.role === 'student'
                                ? '#d97757'
                                : 'var(--surface-2)',
                            color:
                              msg.role === 'student'
                                ? '#fff'
                                : 'var(--text-1)',
                            fontSize: '0.78rem',
                            lineHeight: 1.5,
                            fontWeight: 500,
                          }}
                        >
                          {msg.text}
                        </div>
                      </div>
                    ))}
                    {/* Typing indicator — only show before Foxy replies */}
                    {visibleMessages < CHAT_MESSAGES.length &&
                      visibleMessages > 0 &&
                      CHAT_MESSAGES[visibleMessages]?.role === 'foxy' && (
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'flex-start',
                            animation:
                              'heroMsgSlideIn 0.3s ease-out forwards',
                          }}
                        >
                          <div
                            style={{
                              padding: '10px 18px',
                              borderRadius: '16px 16px 16px 4px',
                              background: 'var(--surface-2)',
                              display: 'flex',
                              gap: 4,
                              alignItems: 'center',
                            }}
                          >
                            <span
                              className="hero-typing-dot"
                              style={{ animationDelay: '0s' }}
                            />
                            <span
                              className="hero-typing-dot"
                              style={{ animationDelay: '0.15s' }}
                            />
                            <span
                              className="hero-typing-dot"
                              style={{ animationDelay: '0.3s' }}
                            />
                          </div>
                        </div>
                      )}
                  </div>

                  {/* Input bar */}
                  <div
                    style={{
                      padding: '8px 12px 12px',
                      borderTop: '1px solid var(--border)',
                    }}
                  >
                    <div
                      style={{
                        background: 'var(--surface-2)',
                        borderRadius: 20,
                        padding: '10px 16px',
                        fontSize: '0.75rem',
                        color: 'var(--text-3)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span>Ask Foxy anything...</span>
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#d97757"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <line x1="22" y1="2" x2="11" y2="13" />
                        <polygon points="22,2 15,22 11,13 2,9" />
                      </svg>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ─── Trust bar ─── */}
        <div
          className="hero-fade-in"
          style={{
            marginTop: 56,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 16,
            animationDelay: '0.8s',
          }}
        >
          <p
            style={{
              fontSize: '0.9rem',
              fontWeight: 500,
              color: 'var(--text-3)',
              letterSpacing: '0.02em',
            }}
          >
            Trusted by 10,000+ students across India
          </p>
          <div
            className="hero-trust-metrics"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: '24px',
            }}
          >
            {[
              { label: '96% accuracy', icon: '\u{2705}' },
              { label: '4.8\u2605 rating', icon: '\u{2B50}' },
              { label: 'Made in India', icon: '\u{1F1EE}\u{1F1F3}' },
            ].map((item) => (
              <div
                key={item.label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  color: 'var(--text-2)',
                  padding: '6px 14px',
                  borderRadius: 100,
                  background: 'rgba(217, 119, 87, 0.06)',
                  border: '1px solid rgba(217, 119, 87, 0.10)',
                }}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ─── Scroll indicator ─── */}
        <div
          className="hero-scroll-indicator"
          style={{
            marginTop: 48,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
            opacity: 0.5,
          }}
        >
          <span
            style={{
              fontSize: '0.7rem',
              color: 'var(--text-3)',
              fontWeight: 500,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            Scroll
          </span>
          <svg
            className="hero-bounce-chevron"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--text-3)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6,9 12,15 18,9" />
          </svg>
        </div>
      </div>

      {/* ─── CSS for animations ─── */}
      <style jsx>{`
        /* Fade-in entrance animation */
        .hero-fade-in {
          opacity: 0;
          transform: translateY(20px);
          animation: heroFadeIn 0.7s ease-out forwards;
        }

        @keyframes heroFadeIn {
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        /* Chat message slide-in */
        @keyframes heroMsgSlideIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        /* Phone float animation */
        .hero-phone-float {
          animation: heroFloat 4s ease-in-out infinite;
          will-change: transform;
        }

        @keyframes heroFloat {
          0%,
          100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-12px);
          }
        }

        /* Gradient orb drift — slow 18s cycle so it feels ambient, not distracting */
        .hero-gradient-orb {
          animation: heroOrbDrift 18s ease-in-out infinite alternate;
          will-change: transform;
        }
        .hero-orb-1 {
          animation-delay: 0s;
        }
        .hero-orb-2 {
          animation-delay: -6s;
        }
        .hero-orb-3 {
          animation-delay: -12s;
        }

        @keyframes heroOrbDrift {
          0% {
            transform: translate(0, 0) scale(1);
          }
          100% {
            transform: translate(30px, 20px) scale(1.05);
          }
        }

        /* Typing indicator dots */
        .hero-typing-dot {
          display: inline-block;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--text-3);
          animation: heroTypingBounce 1s ease-in-out infinite;
        }

        @keyframes heroTypingBounce {
          0%,
          80%,
          100% {
            transform: translateY(0);
            opacity: 0.4;
          }
          40% {
            transform: translateY(-5px);
            opacity: 1;
          }
        }

        /* Scroll indicator bounce */
        .hero-bounce-chevron {
          animation: heroBounce 2s ease-in-out infinite;
        }

        @keyframes heroBounce {
          0%,
          100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(6px);
          }
        }

        /* Animated gradient text */
        .hero-gradient-text {
          animation: heroGradientShift 6s ease-in-out infinite;
          will-change: background-position;
        }

        @keyframes heroGradientShift {
          0% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
          100% {
            background-position: 0% 50%;
          }
        }

        /* Primary CTA hover, active, and arrow animation */
        .hero-cta-primary:hover {
          box-shadow: 0 4px 20px rgba(196, 98, 63, 0.35) !important;
          transform: translateY(-1px);
        }
        .hero-cta-primary:hover .hero-cta-arrow {
          transform: translateX(4px);
        }
        .hero-cta-primary:active {
          transform: scale(0.97) !important;
          box-shadow: 0 2px 12px rgba(196, 98, 63, 0.3) !important;
        }

        /* Secondary CTA hover */
        .hero-cta-secondary:hover {
          border-color: var(--border-strong) !important;
          color: var(--text-1) !important;
          background: rgba(0, 0, 0, 0.02) !important;
        }
        .hero-cta-secondary:active {
          transform: scale(0.97);
        }

        /* Responsive: stack on mobile */
        @media (max-width: 860px) {
          .hero-layout {
            flex-direction: column !important;
            text-align: center !important;
          }
          .hero-text-col {
            align-items: center !important;
            max-width: 100% !important;
          }
          .hero-phone-col {
            flex: 0 0 auto !important;
            margin-top: 2rem;
          }
        }

        /* Respect reduced motion */
        @media (prefers-reduced-motion: reduce) {
          .hero-fade-in {
            animation: none !important;
            opacity: 1 !important;
            transform: none !important;
          }
          .hero-phone-float {
            animation: none !important;
          }
          .hero-gradient-orb {
            animation: none !important;
          }
          .hero-bounce-chevron {
            animation: none !important;
          }
          .hero-typing-dot {
            animation: none !important;
            opacity: 0.6 !important;
          }
          .hero-gradient-text {
            animation: none !important;
          }
          .hero-cta-primary,
          .hero-cta-secondary {
            transition: none !important;
          }
        }
      `}</style>
    </section>
  );
}
