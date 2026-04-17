'use client';

/**
 * Custom CSS-only icons for the landing page.
 * Every icon is built with gradients, borders, clip-path, and positioned elements.
 * No emoji. No icon libraries. No images.
 */

const ICON_SIZE = 48;

/* ─── Problem Icons ──────────────────────────────────────── */

/** Brain outline with dotted fade-out — concepts dissolving */
export function IconBrainFade() {
  return (
    <div className="relative shrink-0" style={{ width: ICON_SIZE, height: ICON_SIZE }} aria-hidden="true">
      <div className="absolute" style={{
        width: 32, height: 28, top: 10, left: 8,
        borderRadius: '50% 50% 45% 45%',
        border: '2.5px solid var(--text-3)',
        opacity: 0.8,
      }} />
      <div className="absolute" style={{
        width: 2, height: 16, top: 14, left: 23,
        background: 'var(--text-3)',
        opacity: 0.5,
      }} />
      {[
        { x: 34, y: 8, opacity: 0.5, size: 3 },
        { x: 38, y: 14, opacity: 0.35, size: 2.5 },
        { x: 40, y: 22, opacity: 0.2, size: 2 },
        { x: 36, y: 28, opacity: 0.12, size: 2 },
        { x: 30, y: 34, opacity: 0.08, size: 1.5 },
      ].map((dot, i) => (
        <div key={i} className="absolute rounded-full" style={{
          width: dot.size, height: dot.size,
          left: dot.x, top: dot.y,
          background: 'var(--text-3)',
          opacity: dot.opacity,
        }} />
      ))}
    </div>
  );
}

/** Scattered dots converging nowhere — random practice */
export function IconScatteredDots() {
  return (
    <div className="relative shrink-0" style={{ width: ICON_SIZE, height: ICON_SIZE }} aria-hidden="true">
      {[
        { x: 6, y: 12, size: 5, color: 'var(--text-3)', opacity: 0.7 },
        { x: 22, y: 4, size: 4, color: '#E8581C', opacity: 0.5 },
        { x: 38, y: 18, size: 6, color: 'var(--text-3)', opacity: 0.4 },
        { x: 14, y: 32, size: 4.5, color: '#E8581C', opacity: 0.6 },
        { x: 30, y: 36, size: 3, color: 'var(--text-3)', opacity: 0.3 },
        { x: 8, y: 24, size: 3.5, color: '#E8581C', opacity: 0.35 },
        { x: 36, y: 8, size: 3, color: 'var(--text-3)', opacity: 0.5 },
        { x: 24, y: 22, size: 5, color: 'var(--text-3)', opacity: 0.25 },
      ].map((dot, i) => (
        <div key={i} className="absolute rounded-full" style={{
          width: dot.size, height: dot.size,
          left: dot.x, top: dot.y,
          background: dot.color,
          opacity: dot.opacity,
        }} />
      ))}
    </div>
  );
}

/** Eye with strike-through — no visibility for parent */
export function IconEyeStrike() {
  return (
    <div className="relative shrink-0" style={{ width: ICON_SIZE, height: ICON_SIZE }} aria-hidden="true">
      <div className="absolute" style={{
        width: 34, height: 18, top: 15, left: 7,
        borderRadius: '50%',
        border: '2.5px solid var(--text-3)',
        opacity: 0.7,
      }} />
      <div className="absolute rounded-full" style={{
        width: 10, height: 10, top: 19, left: 19,
        background: 'var(--text-3)',
        opacity: 0.6,
      }} />
      <div className="absolute" style={{
        width: 42, height: 2.5, top: 23, left: 3,
        background: '#E8581C',
        transform: 'rotate(-35deg)',
        transformOrigin: 'center',
        borderRadius: 2,
        opacity: 0.85,
      }} />
    </div>
  );
}

/* ─── Solution Icons ─────────────────────────────────────── */

/** Brain with glowing connected nodes — clarity achieved */
export function IconBrainConnected() {
  return (
    <div className="relative shrink-0" style={{ width: ICON_SIZE, height: ICON_SIZE }} aria-hidden="true">
      <div className="absolute" style={{
        width: 32, height: 28, top: 10, left: 8,
        borderRadius: '50% 50% 45% 45%',
        border: '2.5px solid #E8581C',
        opacity: 0.8,
      }} />
      <div className="absolute" style={{
        width: 2, height: 16, top: 14, left: 23,
        background: '#E8581C',
        opacity: 0.4,
      }} />
      {[
        { x: 14, y: 16, size: 5 },
        { x: 28, y: 14, size: 5 },
        { x: 18, y: 28, size: 4 },
        { x: 30, y: 26, size: 4 },
      ].map((node, i) => (
        <div key={i} className="absolute rounded-full" style={{
          width: node.size, height: node.size,
          left: node.x, top: node.y,
          background: '#E8581C',
          boxShadow: '0 0 6px rgba(232,88,28,0.5)',
        }} />
      ))}
      <svg className="absolute inset-0" width={ICON_SIZE} height={ICON_SIZE} style={{ opacity: 0.35 }}>
        <line x1="16" y1="18" x2="30" y2="16" stroke="#E8581C" strokeWidth="1.5" />
        <line x1="16" y1="18" x2="20" y2="30" stroke="#E8581C" strokeWidth="1.5" />
        <line x1="30" y1="16" x2="32" y2="28" stroke="#E8581C" strokeWidth="1.5" />
        <line x1="20" y1="30" x2="32" y2="28" stroke="#E8581C" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

/** Arrow hitting bullseye — targeted practice */
export function IconBullseye() {
  return (
    <div className="relative shrink-0 flex items-center justify-center" style={{ width: ICON_SIZE, height: ICON_SIZE }} aria-hidden="true">
      <div className="absolute rounded-full" style={{
        width: 36, height: 36,
        border: '2px solid var(--text-3)',
        opacity: 0.3,
      }} />
      <div className="absolute rounded-full" style={{
        width: 24, height: 24,
        border: '2px solid var(--text-3)',
        opacity: 0.5,
      }} />
      <div className="absolute rounded-full" style={{
        width: 10, height: 10,
        background: '#E8581C',
        boxShadow: '0 0 8px rgba(232,88,28,0.4)',
      }} />
      <div className="absolute" style={{
        width: 18, height: 2,
        background: '#E8581C',
        top: 14, right: 2,
        transform: 'rotate(40deg)',
        transformOrigin: 'right center',
        borderRadius: 1,
      }} />
      <div className="absolute" style={{
        width: 0, height: 0,
        borderTop: '4px solid transparent',
        borderBottom: '4px solid transparent',
        borderRight: '7px solid #E8581C',
        top: 20, right: 14,
        transform: 'rotate(40deg)',
      }} />
    </div>
  );
}

/** Open eye with dashboard bars — daily visibility */
export function IconEyeDashboard() {
  return (
    <div className="relative shrink-0" style={{ width: ICON_SIZE, height: ICON_SIZE }} aria-hidden="true">
      <div className="absolute" style={{
        width: 36, height: 20, top: 14, left: 6,
        borderRadius: '50%',
        border: '2.5px solid #16A34A',
        opacity: 0.8,
      }} />
      <div className="absolute rounded-full flex items-end justify-center gap-px" style={{
        width: 14, height: 14, top: 17, left: 17,
        background: 'rgba(22,163,74,0.15)',
        padding: 2,
        overflow: 'hidden',
      }}>
        <div style={{ width: 2.5, height: 4, background: '#16A34A', borderRadius: 1, opacity: 0.7 }} />
        <div style={{ width: 2.5, height: 7, background: '#16A34A', borderRadius: 1, opacity: 0.85 }} />
        <div style={{ width: 2.5, height: 10, background: '#16A34A', borderRadius: 1 }} />
      </div>
    </div>
  );
}

/* ─── Trust Badge Icons ──────────────────────────────────── */

/** Ashoka Chakra-inspired motif — DPIIT */
export function IconAshoka() {
  return (
    <div className="relative shrink-0" style={{ width: 18, height: 18 }} aria-hidden="true">
      <div className="absolute inset-0 rounded-full" style={{
        border: '1.5px solid #1a237e',
        background: `conic-gradient(
          from 0deg,
          #E8581C 0deg, transparent 8deg, transparent 37deg,
          #E8581C 37deg, transparent 45deg, transparent 82deg,
          #E8581C 82deg, transparent 90deg, transparent 127deg,
          #E8581C 127deg, transparent 135deg, transparent 172deg,
          #E8581C 172deg, transparent 180deg, transparent 217deg,
          #E8581C 217deg, transparent 225deg, transparent 262deg,
          #E8581C 262deg, transparent 270deg, transparent 307deg,
          #E8581C 307deg, transparent 315deg, transparent 352deg,
          #E8581C 352deg, transparent 360deg
        )`,
      }} />
      <div className="absolute rounded-full" style={{
        width: 6, height: 6, top: 5, left: 5,
        background: '#1a237e',
      }} />
    </div>
  );
}

/** Shield — DPDPA */
export function IconShield() {
  return (
    <div className="relative shrink-0" style={{ width: 18, height: 18 }} aria-hidden="true">
      <div style={{
        width: 16, height: 18,
        clipPath: 'polygon(50% 0%, 100% 20%, 100% 65%, 50% 100%, 0% 65%, 0% 20%)',
        background: 'linear-gradient(135deg, #16A34A, #0891B2)',
        margin: '0 auto',
      }} />
      <div className="absolute" style={{
        width: 6, height: 6,
        top: 5, left: 7,
        borderLeft: '2px solid white',
        borderBottom: '2px solid white',
        transform: 'rotate(-45deg)',
        opacity: 0.9,
      }} />
    </div>
  );
}

/** Padlock — Encryption */
export function IconPadlock() {
  return (
    <div className="relative shrink-0" style={{ width: 18, height: 18 }} aria-hidden="true">
      <div className="absolute" style={{
        width: 10, height: 8, top: 1, left: 4,
        borderRadius: '5px 5px 0 0',
        border: '2px solid #92400E',
        borderBottom: 'none',
      }} />
      <div className="absolute" style={{
        width: 14, height: 10, top: 8, left: 2,
        borderRadius: 2,
        background: 'linear-gradient(135deg, #D97706, #F5A623)',
      }} />
      <div className="absolute rounded-full" style={{
        width: 3, height: 3, top: 11, left: 7.5,
        background: '#92400E',
      }} />
    </div>
  );
}

/** Open book — NCERT */
export function IconBook() {
  return (
    <div className="relative shrink-0 flex items-center justify-center" style={{ width: 18, height: 18 }} aria-hidden="true">
      <div style={{
        width: 8, height: 12,
        background: '#16A34A',
        borderRadius: '2px 0 0 2px',
        transform: 'skewY(-3deg)',
        opacity: 0.85,
      }} />
      <div style={{ width: 1.5, height: 13, background: '#15803D' }} />
      <div style={{
        width: 8, height: 12,
        background: '#16A34A',
        borderRadius: '0 2px 2px 0',
        transform: 'skewY(3deg)',
        opacity: 0.7,
      }} />
    </div>
  );
}

/** Prohibition circle — No Ads */
export function IconNoAds() {
  return (
    <div className="relative shrink-0" style={{ width: 18, height: 18 }} aria-hidden="true">
      <div className="absolute inset-0 rounded-full" style={{
        border: '2px solid #DC2626',
        opacity: 0.7,
      }} />
      <div className="absolute" style={{
        width: 14, height: 2,
        top: 8, left: 2,
        background: '#DC2626',
        transform: 'rotate(-45deg)',
        transformOrigin: 'center',
        borderRadius: 1,
        opacity: 0.7,
      }} />
    </div>
  );
}

/* ─── Product Card Icons ─────────────────────────────────── */

/** Bloom's taxonomy level indicator — 3 stacked triangles */
export function IconBloomLevel({ activeLevel = 2 }: { activeLevel?: 0 | 1 | 2 }) {
  const levels = [
    { y: 28, size: 10 },
    { y: 17, size: 8 },
    { y: 8, size: 6 },
  ];
  return (
    <div className="relative shrink-0" style={{ width: 18, height: 18 }} aria-hidden="true">
      {levels.map((lvl, i) => (
        <div key={i} className="absolute" style={{
          left: '50%',
          top: lvl.y - 8,
          transform: 'translateX(-50%)',
          width: 0, height: 0,
          borderLeft: `${lvl.size / 2}px solid transparent`,
          borderRight: `${lvl.size / 2}px solid transparent`,
          borderBottom: `${lvl.size * 0.7}px solid ${i === activeLevel ? '#2563EB' : 'var(--text-3)'}`,
          opacity: i === activeLevel ? 1 : 0.35,
        }} />
      ))}
    </div>
  );
}

/** Star-burst XP icon */
export function IconXPStar() {
  return (
    <div className="shrink-0" style={{
      width: 16, height: 16,
      clipPath: 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
      background: 'linear-gradient(135deg, #E8581C, #F5A623)',
    }} aria-hidden="true" />
  );
}