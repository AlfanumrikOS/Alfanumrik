'use client';

import { useEffect, useRef } from 'react';

/* ══════════════════════════════════════════════════════════════
   PRODUCT SHOWCASE — Phone mockups showing Alfanumrik in action
   ══════════════════════════════════════════════════════════════ */

interface PhoneScreen {
  id: string;
  title: string;
  description: string;
  theme: string;
  accent: string;
  render: () => React.ReactNode;
}

/* ── Individual screen renderers ─────────────────────────────── */

function FoxyChatScreen() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 12px', height: '100%' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#c4623f', marginBottom: 4 }}>
        🦊 Foxy AI Chat
      </div>
      {/* Student bubble */}
      <div style={{ alignSelf: 'flex-end', maxWidth: '78%' }}>
        <div
          style={{
            background: '#F5F5F0',
            border: '1px solid #e8e6dc',
            borderRadius: '16px 16px 4px 16px',
            padding: '10px 14px',
            fontSize: 12,
            color: '#141413',
            lineHeight: 1.5,
          }}
        >
          Explain quadratic equations 🤔
        </div>
        <div style={{ fontSize: 10, color: '#8a8880', textAlign: 'right', marginTop: 2 }}>
          You
        </div>
      </div>
      {/* Foxy bubble */}
      <div style={{ alignSelf: 'flex-start', maxWidth: '82%' }}>
        <div
          style={{
            background: '#c4623f',
            borderRadius: '16px 16px 16px 4px',
            padding: '10px 14px',
            fontSize: 12,
            color: '#fff',
            lineHeight: 1.5,
          }}
        >
          Great question! Let&apos;s break it down! 🎯
          <br />
          <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 600 }}>
            ax&sup2; + bx + c = 0
          </span>
          <br />
          Here, <b>a</b>, <b>b</b>, and <b>c</b> are constants...
        </div>
        <div style={{ fontSize: 10, color: '#8a8880', marginTop: 2 }}>🦊 Foxy</div>
      </div>
      {/* Input hint */}
      <div
        style={{
          marginTop: 'auto',
          border: '1px solid #e8e6dc',
          borderRadius: 20,
          padding: '8px 14px',
          fontSize: 11,
          color: '#8a8880',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        Ask Foxy anything...
        <span style={{ color: '#c4623f', fontSize: 14 }}>&#8593;</span>
      </div>
    </div>
  );
}

function StudyPlanScreen() {
  const tasks = [
    { label: 'Quadratic Formula', bloom: 'Apply', xp: 40, done: true },
    { label: 'Completing the Square', bloom: 'Understand', xp: 30, done: true },
    { label: 'Word Problems', bloom: 'Analyze', xp: 50, done: false },
  ];
  const bloomColors: Record<string, string> = {
    Apply: '#c4623f',
    Understand: '#5589b8',
    Analyze: '#6b7f50',
  };

  return (
    <div style={{ padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#5589b8' }}>
        📋 Today&apos;s Plan
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tasks.map((t) => (
          <div
            key={t.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 10px',
              background: t.done ? '#F5F5F0' : '#fff',
              borderRadius: 10,
              border: '1px solid #e8e6dc',
            }}
          >
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                border: `2px solid ${t.done ? '#c4623f' : '#c4c2b8'}`,
                background: t.done ? '#c4623f' : 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                color: '#fff',
                flexShrink: 0,
              }}
            >
              {t.done && '\u2713'}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#141413',
                  textDecoration: t.done ? 'line-through' : 'none',
                  opacity: t.done ? 0.7 : 1,
                }}
              >
                {t.label}
              </div>
            </div>
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: bloomColors[t.bloom],
                background: `${bloomColors[t.bloom]}18`,
                padding: '2px 6px',
                borderRadius: 6,
                whiteSpace: 'nowrap',
              }}
            >
              {t.bloom}
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#c4623f', whiteSpace: 'nowrap' }}>
              +{t.xp} XP
            </span>
          </div>
        ))}
      </div>
      {/* Progress bar */}
      <div style={{ marginTop: 8 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 11,
            fontWeight: 600,
            marginBottom: 4,
          }}
        >
          <span style={{ color: '#4a4843' }}>Progress</span>
          <span style={{ color: '#c4623f' }}>60%</span>
        </div>
        <div style={{ height: 8, background: '#e8e6dc', borderRadius: 999 }}>
          <div
            style={{
              width: '60%',
              height: '100%',
              background: '#c4623f',
              borderRadius: 999,
            }}
          />
        </div>
      </div>
    </div>
  );
}

function InteractiveLabScreen() {
  return (
    <div
      style={{
        padding: '16px 12px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: '#5589b8', alignSelf: 'flex-start' }}>
        🔬 Pendulum Simulation
      </div>
      {/* Pendulum visual */}
      <div
        style={{
          position: 'relative',
          width: 160,
          height: 140,
          marginTop: 8,
        }}
      >
        {/* Pivot */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: '#c4623f',
          }}
        />
        {/* Arc path */}
        <svg
          width="160"
          height="100"
          viewBox="0 0 160 100"
          style={{ position: 'absolute', top: 8, left: 0 }}
        >
          <path
            d="M 40 90 A 80 80 0 0 1 120 90"
            fill="none"
            stroke="#e8e6dc"
            strokeWidth="1.5"
            strokeDasharray="4 3"
          />
        </svg>
        {/* String + bob */}
        <div
          style={{
            position: 'absolute',
            top: 5,
            left: '50%',
            width: 2,
            height: 90,
            background: '#c4623f',
            transformOrigin: 'top center',
            transform: 'rotate(25deg)',
          }}
        >
          <div
            style={{
              position: 'absolute',
              bottom: -12,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 24,
              height: 24,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #c4623f, #d67a52)',
              boxShadow: '0 4px 12px rgba(196, 98, 63, 0.30)',
            }}
          />
        </div>
      </div>
      {/* Hint */}
      <div
        style={{
          fontSize: 11,
          color: '#c4623f',
          background: '#F5F5F0',
          padding: '6px 12px',
          borderRadius: 8,
          fontWeight: 500,
        }}
      >
        Drag to change angle
      </div>
      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        {['Play', 'Reset'].map((btn) => (
          <div
            key={btn}
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: '5px 12px',
              borderRadius: 6,
              background: '#c4623f',
              color: '#fff',
            }}
          >
            {btn}
          </div>
        ))}
      </div>
    </div>
  );
}

function ProgressDashboardScreen() {
  const subjects = [
    { name: 'Maths', xp: 1240, max: 2000, pct: 62, color: '#c4623f' },
    { name: 'Science', xp: 880, max: 2000, pct: 44, color: '#5589b8' },
    { name: 'English', xp: 1560, max: 2000, pct: 78, color: '#6b7f50' },
  ];

  return (
    <div style={{ padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#c4623f' }}>My Progress</div>
      {/* Streak */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: '#F5F5F0',
          borderRadius: 10,
          padding: '8px 12px',
          border: '1px solid #e8e6dc',
        }}
      >
        <span style={{ fontSize: 18 }}>&#x1F525;</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#c4623f' }}>5-day streak!</div>
          <div style={{ fontSize: 10, color: '#8a8880' }}>Keep it going!</div>
        </div>
      </div>
      {/* Subject cards */}
      {subjects.map((s) => (
        <div
          key={s.name}
          style={{
            padding: '10px 12px',
            borderRadius: 10,
            border: `1px solid ${s.color}22`,
            background: `${s.color}08`,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 6,
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600, color: '#141413' }}>{s.name}</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: s.color }}>
              {s.xp} / {s.max} XP
            </span>
          </div>
          <div style={{ height: 6, background: '#e8e6dc', borderRadius: 999 }}>
            <div
              style={{
                width: `${s.pct}%`,
                height: '100%',
                background: s.color,
                borderRadius: 999,
                transition: 'width 1s ease',
              }}
            />
          </div>
          <div style={{ fontSize: 10, color: '#4a4843', marginTop: 4, textAlign: 'right' }}>
            Mastery: {s.pct}%
          </div>
        </div>
      ))}
    </div>
  );
}

function ParentViewScreen() {
  return (
    <div style={{ padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#6b7f50' }}>Child Progress</div>
      {/* Child avatar row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 12px',
          background: '#F5F5F0',
          borderRadius: 12,
          border: '1px solid #e8e6dc',
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #6b7f50, #8a9e69)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 16,
            color: '#fff',
            fontWeight: 700,
          }}
        >
          A
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#141413' }}>Ananya</div>
          <div style={{ fontSize: 10, color: '#4a4843' }}>Class 8 &middot; CBSE</div>
        </div>
      </div>
      {/* Progress meter */}
      <div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 11,
            fontWeight: 600,
            color: '#141413',
            marginBottom: 6,
          }}
        >
          <span>Overall Progress</span>
          <span style={{ color: '#6b7f50' }}>72%</span>
        </div>
        <div style={{ height: 10, background: '#e8e6dc', borderRadius: 999 }}>
          <div
            style={{
              width: '72%',
              height: '100%',
              background: '#6b7f50',
              borderRadius: 999,
            }}
          />
        </div>
      </div>
      {/* Stats row */}
      <div style={{ display: 'flex', gap: 8 }}>
        {[
          { label: 'Sessions', value: '12' },
          { label: 'Hours', value: '8.5' },
          { label: 'Streak', value: '5' },
        ].map((s) => (
          <div
            key={s.label}
            style={{
              flex: 1,
              textAlign: 'center',
              padding: '8px 4px',
              background: '#F5F5F0',
              borderRadius: 8,
              border: '1px solid #e8e6dc',
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: '#6b7f50' }}>{s.value}</div>
            <div style={{ fontSize: 9, color: '#4a4843' }}>{s.label}</div>
          </div>
        ))}
      </div>
      {/* Weekly report button */}
      <div
        style={{
          width: '100%',
          padding: '10px 0',
          borderRadius: 10,
          background: '#6b7f50',
          color: '#fff',
          fontSize: 12,
          fontWeight: 700,
          textAlign: 'center',
          marginTop: 4,
        }}
      >
        Weekly Report
      </div>
    </div>
  );
}

/* ── Screen data ─────────────────────────────────────────────── */

const SCREENS: PhoneScreen[] = [
  {
    id: 'foxy-chat',
    title: 'Foxy AI Chat',
    description: 'Your 24/7 AI tutor that explains concepts with patience and clarity.',
    theme: 'teal',
    accent: '#c4623f',
    render: FoxyChatScreen,
  },
  {
    id: 'study-plan',
    title: 'Smart Study Plan',
    description: 'Personalized daily plans with Bloom-level tasks and XP rewards.',
    theme: 'purple',
    accent: '#5589b8',
    render: StudyPlanScreen,
  },
  {
    id: 'interactive-lab',
    title: 'Interactive Lab',
    description: 'Hands-on simulations that make abstract concepts tangible.',
    theme: 'indigo',
    accent: '#7b6db8',
    render: InteractiveLabScreen,
  },
  {
    id: 'progress-dashboard',
    title: 'Progress Dashboard',
    description: 'Track XP, streaks, and mastery across every subject.',
    theme: 'teal',
    accent: '#c4623f',
    render: ProgressDashboardScreen,
  },
  {
    id: 'parent-view',
    title: 'Parent View',
    description: 'Stay informed with real-time insights into your child\u2019s learning.',
    theme: 'green',
    accent: '#6b7f50',
    render: ParentViewScreen,
  },
];

/* ── Main component ──────────────────────────────────────────── */

export default function ProductShowcase() {
  const cardsRef = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
    );

    cardsRef.current.forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  return (
    <section
      id="product-showcase"
      className="landing-section"
      style={{
        background: '#faf9f5',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div className="landing-container" style={{ position: 'relative', zIndex: 1 }}>
        {/* ── Heading ────────────────────────────────────────── */}
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <h2 className="landing-heading" style={{ marginBottom: 12 }}>
            See Alfanumrik in Action
          </h2>
          {/* Gradient underline */}
          <div
            style={{
              width: 80,
              height: 4,
              borderRadius: 999,
              background: 'linear-gradient(90deg, #c4623f, #b8922e, #5589b8)',
              margin: '0 auto 16px',
            }}
          />
          <p className="landing-subheading">
            Five powerful features &mdash; designed for how Indian students actually learn.
          </p>
        </div>

        {/* ── Phone grid — horizontal scroll on mobile, perspective grid on desktop ── */}
        <div
          style={{
            display: 'flex',
            gap: 28,
            overflowX: 'auto',
            scrollSnapType: 'x mandatory',
            WebkitOverflowScrolling: 'touch',
            paddingBottom: 24,
            scrollbarWidth: 'none',
          }}
          className="product-showcase-scroll"
        >
          {SCREENS.map((screen, i) => (
            <div
              key={screen.id}
              ref={(el) => { cardsRef.current[i] = el; }}
              className="stagger-card"
              style={{
                transitionDelay: `${i * 120}ms`,
                scrollSnapAlign: 'center',
                flexShrink: 0,
              }}
            >
              {/* Phone frame */}
              <div
                className="phone-frame showcase-phone-frame"
                style={{
                  width: 220,
                  height: 420,
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }}
              >
                {/* Status bar */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '28px 16px 6px',
                    fontSize: 10,
                    fontWeight: 600,
                    color: '#4a4843',
                  }}
                >
                  <span>9:41</span>
                  <span style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 9 }}>
                    <span>&#9679;&#9679;&#9679;</span>
                  </span>
                </div>
                {/* Screen content */}
                <div style={{ flex: 1, overflow: 'hidden' }}>{screen.render()}</div>
              </div>

              {/* Label below phone */}
              <div style={{ textAlign: 'center', marginTop: 14, maxWidth: 220 }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: screen.accent,
                    fontFamily: 'var(--font-display)',
                    marginBottom: 2,
                  }}
                >
                  {screen.title}
                </div>
                <div style={{ fontSize: 12, color: '#4a4843', lineHeight: 1.4 }}>
                  {screen.description}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Scoped styles ──────────────────────────────────── */}
      <style>{`
        .product-showcase-scroll::-webkit-scrollbar { display: none; }

        .showcase-phone-frame {
          transition: box-shadow 0.3s ease;
        }
        .showcase-phone-frame:hover {
          box-shadow: 0 12px 40px rgba(20, 20, 19, 0.14) !important;
        }

        @media (max-width: 1023px) {
          .product-showcase-scroll {
            -webkit-mask-image: linear-gradient(
              to right,
              transparent 0%,
              black 8%,
              black 92%,
              transparent 100%
            );
            mask-image: linear-gradient(
              to right,
              transparent 0%,
              black 8%,
              black 92%,
              transparent 100%
            );
          }
        }

        @media (min-width: 1024px) {
          .product-showcase-scroll {
            overflow-x: visible !important;
            justify-content: center;
            flex-wrap: nowrap;
            perspective: 1200px;
          }
        }
      `}</style>
    </section>
  );
}
