'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

/* ══════════════════════════════════════════════════════════════
   ANIMATED COUNTER — requestAnimationFrame, no libraries
   ══════════════════════════════════════════════════════════════ */

function useCountUp(end: number, duration = 2000, start = 0) {
  const [value, setValue] = useState(start);
  const [hasStarted, setHasStarted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const startCounting = useCallback(() => {
    if (hasStarted) return;
    setHasStarted(true);

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      setValue(end);
      return;
    }

    let startTime: number | null = null;
    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.floor(start + (end - start) * eased));
      if (progress < 1) {
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  }, [end, duration, start, hasStarted]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          startCounting();
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [startCounting]);

  return { value, ref };
}

/* ══════════════════════════════════════════════════════════════
   METRICS BANNER
   ══════════════════════════════════════════════════════════════ */

interface MetricProps {
  end: number;
  suffix?: string;
  prefix?: string;
  label: string;
  icon: string;
  decimals?: number;
}

function MetricCounter({ end, suffix = '', prefix = '', label, icon, decimals = 0 }: MetricProps) {
  const scaledEnd = decimals > 0 ? Math.round(end * Math.pow(10, decimals)) : end;
  const { value, ref } = useCountUp(scaledEnd);
  const displayValue = decimals > 0
    ? (value / Math.pow(10, decimals)).toFixed(decimals)
    : value.toLocaleString('en-IN');

  return (
    <div ref={ref} className="metric-counter">
      <span className="metric-icon">{icon}</span>
      <span className="metric-value">
        {prefix}{displayValue}{suffix}
      </span>
      <span className="metric-label">{label}</span>

      <style jsx>{`
        .metric-counter {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding: 24px 16px;
          flex: 1;
          min-width: 140px;
        }
        .metric-icon {
          font-size: 28px;
          margin-bottom: 4px;
        }
        .metric-value {
          font-family: var(--font-display);
          font-size: 2rem;
          font-weight: 800;
          color: #d97757;
          line-height: 1.1;
          letter-spacing: -0.02em;
        }
        .metric-label {
          font-family: var(--font-body);
          font-size: 0.85rem;
          color: var(--text-3);
          text-align: center;
          font-weight: 500;
        }
        @media (min-width: 768px) {
          .metric-value {
            font-size: 2.5rem;
          }
          .metric-counter {
            padding: 32px 24px;
          }
        }
      `}</style>
    </div>
  );
}

function MetricsBanner() {
  return (
    <div className="metrics-banner">
      <div className="metrics-grid">
        <MetricCounter end={10000} suffix="+" label="Students Learning" icon="🎓" />
        <MetricCounter end={96} suffix="%" label="Accuracy Rate" icon="🎯" />
        <MetricCounter end={4.8} decimals={1} suffix="★" label="Average Rating" icon="⭐" />
        <MetricCounter end={50000} suffix="+" label="Questions Solved" icon="✅" />
      </div>

      <style jsx>{`
        .metrics-banner {
          background: var(--surface-1);
          border: 1px solid var(--border);
          border-radius: 20px;
          margin-bottom: 64px;
          box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);
          overflow: hidden;
        }
        .metrics-grid {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
        }
        .metrics-grid > :global(.metric-counter:not(:last-child)) {
          border-right: 1px solid var(--border);
        }
        @media (max-width: 639px) {
          .metrics-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
          }
          .metrics-grid > :global(.metric-counter:not(:last-child)) {
            border-right: none;
          }
          .metrics-grid > :global(.metric-counter:nth-child(odd)) {
            border-right: 1px solid var(--border);
          }
          .metrics-grid > :global(.metric-counter:nth-child(-n+2)) {
            border-bottom: 1px solid var(--border);
          }
        }
      `}</style>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   TESTIMONIAL CARD
   ══════════════════════════════════════════════════════════════ */

interface Testimonial {
  name: string;
  role: string;
  location: string;
  quote: string;
  rating: number;
  initials: string;
  gradient: string;
}

const TESTIMONIALS: Testimonial[] = [
  {
    name: 'Priya S.',
    role: 'Class 10 Student',
    location: 'Delhi',
    quote: 'Foxy explains things better than my tuition teacher. I went from 65% to 89% in maths in just 2 months! The Hindi mode is amazing.',
    rating: 5,
    initials: 'PS',
    gradient: 'linear-gradient(135deg, #d97757, #e8956f)',
  },
  {
    name: 'Rajesh K.',
    role: 'Parent',
    location: 'Bengaluru',
    quote: "Finally, I can see exactly what my son is learning. The weekly reports give me peace of mind. Best investment we've made in his education.",
    rating: 5,
    initials: 'RK',
    gradient: 'linear-gradient(135deg, #6a9bcc, #8bb5d8)',
  },
  {
    name: 'Mrs. Sunita Sharma',
    role: 'Science Teacher',
    location: 'Jaipur',
    quote: 'I use the teacher dashboard to identify which students are struggling. The mastery heatmap is incredibly useful for targeted teaching.',
    rating: 5,
    initials: 'SS',
    gradient: 'linear-gradient(135deg, #788c5d, #96a876)',
  },
  {
    name: 'Arjun M.',
    role: 'Class 12 Student',
    location: 'Mumbai',
    quote: 'The study plans and spaced repetition actually work. I\'m retaining concepts weeks after learning them. Board exam prep feels manageable now.',
    rating: 5,
    initials: 'AM',
    gradient: 'linear-gradient(135deg, #8b7ec8, #a99bdb)',
  },
];

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="star-rating" aria-label={`${rating} out of 5 stars`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={i < rating ? 'star filled' : 'star'}>★</span>
      ))}
      <style jsx>{`
        .star-rating {
          display: flex;
          gap: 2px;
          font-size: 1rem;
        }
        .star {
          color: var(--border-mid);
        }
        .star.filled {
          color: #c4a35a;
        }
      `}</style>
    </div>
  );
}

function TestimonialCard({ testimonial, index }: { testimonial: Testimonial; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
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
      { threshold: 0.15 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="testimonial-card"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(24px)',
        transition: `opacity 0.6s ease ${index * 0.12}s, transform 0.6s ease ${index * 0.12}s`,
      }}
    >
      <div className="card-header">
        <div className="avatar" style={{ background: testimonial.gradient }}>
          {testimonial.initials}
        </div>
        <div className="author-info">
          <span className="author-name">{testimonial.name}</span>
          <span className="author-role">{testimonial.role}, {testimonial.location}</span>
        </div>
      </div>

      <StarRating rating={testimonial.rating} />

      <blockquote className="quote">
        &ldquo;{testimonial.quote}&rdquo;
      </blockquote>

      <style jsx>{`
        .testimonial-card {
          background: var(--surface-1);
          border: 1px solid var(--border);
          border-radius: 16px;
          padding: 28px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          box-shadow: 0 2px 12px rgba(0, 0, 0, 0.03);
          transition: box-shadow 0.3s ease, transform 0.3s ease;
          will-change: opacity, transform;
        }
        .testimonial-card:hover {
          box-shadow: 0 8px 32px rgba(20, 20, 19, 0.08);
          transform: translateY(-2px);
        }
        .card-header {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .avatar {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 0.9rem;
          color: #fff;
          flex-shrink: 0;
          letter-spacing: 0.02em;
        }
        .author-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .author-name {
          font-family: var(--font-display);
          font-weight: 700;
          font-size: 0.95rem;
          color: var(--text-1);
        }
        .author-role {
          font-size: 0.82rem;
          color: var(--text-3);
          font-weight: 500;
        }
        .quote {
          font-size: 0.95rem;
          line-height: 1.65;
          color: var(--text-2);
          font-style: normal;
          margin: 0;
        }
      `}</style>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   TRUST LOGOS ROW
   ══════════════════════════════════════════════════════════════ */

function TrustBadges() {
  return (
    <div className="trust-section">
      <div className="aligned-row">
        <span className="aligned-label">Aligned With</span>
        <div className="badge-group">
          <span className="badge badge-cbse">CBSE</span>
          <span className="badge badge-ncert">NCERT</span>
          <span className="badge badge-nep">NEP 2020</span>
        </div>
      </div>

      <div className="trust-features">
        <span className="trust-item">🛡️ Safe &amp; Secure</span>
        <span className="trust-sep" aria-hidden="true">·</span>
        <span className="trust-item">🔒 No Ads</span>
        <span className="trust-sep" aria-hidden="true">·</span>
        <span className="trust-item">🇮🇳 Made in India</span>
      </div>

      <style jsx>{`
        .trust-section {
          margin-top: 56px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 20px;
        }
        .aligned-row {
          display: flex;
          align-items: center;
          gap: 16px;
          flex-wrap: wrap;
          justify-content: center;
        }
        .aligned-label {
          font-family: var(--font-display);
          font-size: 0.85rem;
          font-weight: 600;
          color: var(--text-3);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .badge-group {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          justify-content: center;
        }
        .badge {
          display: inline-flex;
          align-items: center;
          padding: 6px 16px;
          border-radius: 100px;
          font-family: var(--font-display);
          font-size: 0.8rem;
          font-weight: 700;
          letter-spacing: 0.03em;
          border: 1.5px solid;
        }
        .badge-cbse {
          color: #d97757;
          background: rgba(217, 119, 87, 0.08);
          border-color: rgba(217, 119, 87, 0.2);
        }
        .badge-ncert {
          color: #788c5d;
          background: rgba(120, 140, 93, 0.08);
          border-color: rgba(120, 140, 93, 0.2);
        }
        .badge-nep {
          color: #6a9bcc;
          background: rgba(106, 155, 204, 0.08);
          border-color: rgba(106, 155, 204, 0.2);
        }
        .trust-features {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          justify-content: center;
        }
        .trust-item {
          font-size: 0.88rem;
          color: var(--text-2);
          font-weight: 500;
          white-space: nowrap;
        }
        .trust-sep {
          color: var(--text-3);
          font-size: 1.2rem;
          line-height: 1;
        }
      `}</style>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   SOCIAL PROOF — MAIN SECTION
   ══════════════════════════════════════════════════════════════ */

export default function SocialProof() {
  return (
    <section className="social-proof" id="social-proof">
      <div className="social-proof-inner">
        {/* ── Metrics ── */}
        <MetricsBanner />

        {/* ── Section heading ── */}
        <div className="section-heading">
          <span className="section-tag">What People Say</span>
          <h2 className="section-title">
            Loved by Students, Parents &amp; Teachers
          </h2>
          <p className="section-desc">
            Real stories from real learners across India
          </p>
        </div>

        {/* ── Testimonials grid ── */}
        <div className="testimonials-grid">
          {TESTIMONIALS.map((t, i) => (
            <TestimonialCard key={t.name} testimonial={t} index={i} />
          ))}
        </div>

        {/* ── Trust badges ── */}
        <TrustBadges />
      </div>

      <style jsx>{`
        .social-proof {
          padding: 80px 0 96px;
          background: var(--bg);
          position: relative;
        }
        .social-proof-inner {
          max-width: 1120px;
          margin: 0 auto;
          padding: 0 20px;
        }
        .section-heading {
          text-align: center;
          margin-bottom: 48px;
        }
        .section-tag {
          display: inline-block;
          font-family: var(--font-display);
          font-size: 0.8rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: #d97757;
          background: rgba(217, 119, 87, 0.08);
          padding: 6px 16px;
          border-radius: 100px;
          margin-bottom: 16px;
        }
        .section-title {
          font-family: var(--font-display);
          font-size: 2rem;
          font-weight: 800;
          color: var(--text-1);
          line-height: 1.2;
          margin-bottom: 12px;
          letter-spacing: -0.02em;
        }
        .section-desc {
          font-size: 1.05rem;
          color: var(--text-3);
          max-width: 480px;
          margin: 0 auto;
        }
        .testimonials-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 20px;
        }
        @media (min-width: 640px) {
          .testimonials-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }
        @media (min-width: 1024px) {
          .testimonials-grid {
            grid-template-columns: repeat(2, 1fr);
            gap: 24px;
          }
          .section-title {
            font-size: 2.5rem;
          }
        }
        @media (min-width: 768px) {
          .social-proof {
            padding: 100px 0 120px;
          }
          .social-proof-inner {
            padding: 0 32px;
          }
        }
      `}</style>
    </section>
  );
}
