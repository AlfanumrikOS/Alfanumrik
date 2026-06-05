'use client';

/**
 * Branded fox avatar for Foxy, the Alfanumrik mascot.
 *
 * Two variants:
 *   - 'classic' (DEFAULT): the original CSS-only geometric fox. Untouched, so
 *     every existing call site (flag OFF) renders exactly as before.
 *   - 'cosmic': an SVG fox that ADAPTS the approved cosmic treatment — a soft
 *     breathing aura, a white→light→accent gradient body, twinkling orbital
 *     stars, a forehead "learning spark", blinking eyes, and a gentle idle
 *     float — onto Foxy's existing FOX identity. The mascot stays a fox named
 *     "Foxy"; only the cosmic styling is borrowed from the prototype's
 *     elephant. Used by the cosmic redesign (ff_cosmic_redesign_v1) surfaces.
 *
 * Three sizes: sm (w-7), md (w-12), lg (w-16). The cosmic variant also accepts
 * an explicit pixel `px` size and accent colors so it can ride the role-scoped
 * palette (violet / parent peach / teacher lavender / school gold).
 */
import { usePrefersReducedMotion } from '@/components/cosmic/usePrefersReducedMotion';

type FoxySize = 'sm' | 'md' | 'lg';

export interface FoxyMarkProps {
  size?: FoxySize;
  /** 'classic' (default) keeps the legacy geometric fox. 'cosmic' = restyled. */
  variant?: 'classic' | 'cosmic';
  /** Cosmic only: explicit diameter in px (overrides `size`). */
  px?: number;
  /** Cosmic only: primary/body color. Defaults to the live --violet token. */
  primary?: string;
  /** Cosmic only: secondary/aura color. Defaults to the live --cyan token. */
  secondary?: string;
}

export function FoxyMark({
  size = 'md',
  variant = 'classic',
  px,
  primary,
  secondary,
}: FoxyMarkProps) {
  if (variant === 'cosmic') {
    return <CosmicFoxy size={size} px={px} primary={primary} secondary={secondary} />;
  }
  return <ClassicFoxy size={size} />;
}

/* ─────────────────────────── CLASSIC (unchanged) ─────────────────────────── */

function ClassicFoxy({ size = 'md' }: { size?: FoxySize }) {
  const dims = { sm: 28, md: 48, lg: 64 }[size];
  const earSize = { sm: 8, md: 14, lg: 18 }[size];
  const eyeSize = { sm: 2, md: 4, lg: 5 }[size];
  const noseSize = { sm: 3, md: 5, lg: 7 }[size];

  return (
    <div
      className="relative shrink-0"
      style={{ width: dims, height: dims }}
      aria-hidden="true"
    >
      {/* Circular base */}
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: 'linear-gradient(135deg, #E8581C, #F5A623)',
          boxShadow: '0 2px 8px rgba(232,88,28,0.25)',
        }}
      />
      {/* Left ear */}
      <div
        className="absolute"
        style={{
          width: 0,
          height: 0,
          borderLeft: `${earSize * 0.6}px solid transparent`,
          borderRight: `${earSize * 0.6}px solid transparent`,
          borderBottom: `${earSize}px solid #D4520F`,
          top: -earSize * 0.35,
          left: dims * 0.12,
          transform: 'rotate(-8deg)',
        }}
      />
      {/* Right ear */}
      <div
        className="absolute"
        style={{
          width: 0,
          height: 0,
          borderLeft: `${earSize * 0.6}px solid transparent`,
          borderRight: `${earSize * 0.6}px solid transparent`,
          borderBottom: `${earSize}px solid #D4520F`,
          top: -earSize * 0.35,
          right: dims * 0.12,
          transform: 'rotate(8deg)',
        }}
      />
      {/* Left eye */}
      <div
        className="absolute rounded-full bg-white"
        style={{
          width: eyeSize,
          height: eyeSize,
          top: '42%',
          left: '30%',
        }}
      />
      {/* Right eye */}
      <div
        className="absolute rounded-full bg-white"
        style={{
          width: eyeSize,
          height: eyeSize,
          top: '42%',
          right: '30%',
        }}
      />
      {/* Nose */}
      <div
        className="absolute"
        style={{
          width: 0,
          height: 0,
          borderLeft: `${noseSize * 0.5}px solid transparent`,
          borderRight: `${noseSize * 0.5}px solid transparent`,
          borderTop: `${noseSize * 0.6}px solid white`,
          bottom: '28%',
          left: '50%',
          transform: 'translateX(-50%)',
        }}
      />
    </div>
  );
}

/* ─────────────────────────── COSMIC (new) ────────────────────────────────── */

/**
 * Cosmic Foxy — an SVG fox wearing the prototype's cosmic treatment. The fox
 * silhouette (triangular ears, pointed snout, white face mask, bushy cheeks)
 * is original; the aura / star / spark / float language is adapted from the
 * approved design (05_98d62c90.js Riku), applied to the fox so Foxy keeps its
 * species and name.
 *
 * Reduced motion: every SMIL <animate>/<animateTransform> is conditionally
 * OMITTED when the user prefers reduced motion, and the wrapping .cosmic-float
 * is disabled by CSS — the mascot is then a still, fully-legible portrait.
 */
function CosmicFoxy({
  size = 'md',
  px,
  primary = 'var(--violet)',
  secondary = 'var(--cyan)',
}: {
  size?: FoxySize;
  px?: number;
  primary?: string;
  secondary?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const A = !reduced; // animate flag
  const dim = px ?? { sm: 36, md: 96, lg: 140 }[size];
  // Stable-ish id so two mascots on a page don't share gradient defs.
  const id = `foxy-cosmic-${size}-${px ?? 'x'}`;

  return (
    <div className="cosmic-float shrink-0" style={{ width: dim, height: dim }} aria-hidden="true">
      <svg width={dim} height={dim} viewBox="0 0 200 200" style={{ overflow: 'visible' }}>
        <defs>
          <radialGradient id={`${id}-body`} cx="50%" cy="36%" r="65%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="32%" stopColor="#E8E2FF" stopOpacity="1" />
            <stop offset="100%" stopColor={primary} stopOpacity="1" />
          </radialGradient>
          <radialGradient id={`${id}-aura`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={secondary} stopOpacity="0.45" />
            <stop offset="100%" stopColor={secondary} stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${id}-spark`} x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="100%" stopColor={secondary} />
          </linearGradient>
        </defs>

        {/* soft cosmic aura — breathing */}
        <circle cx="100" cy="104" r="90" fill={`url(#${id}-aura)`}>
          {A && <animate attributeName="r" values="86;94;86" dur="4.4s" repeatCount="indefinite" />}
          {A && <animate attributeName="opacity" values="0.7;1;0.7" dur="4.4s" repeatCount="indefinite" />}
        </circle>

        {/* twinkling orbital stars (on different beats) */}
        <circle cx="24" cy="62" r="2" fill={secondary} opacity="0.8">
          {A && <animate attributeName="opacity" values="0.3;1;0.3" dur="2.6s" repeatCount="indefinite" />}
        </circle>
        <circle cx="176" cy="50" r="2.5" fill={primary} opacity="0.7">
          {A && <animate attributeName="opacity" values="0.4;1;0.4" dur="3.1s" begin="0.7s" repeatCount="indefinite" />}
        </circle>
        <circle cx="168" cy="158" r="1.7" fill={secondary} opacity="0.6">
          {A && <animate attributeName="opacity" values="0.2;0.9;0.2" dur="2.2s" begin="1.4s" repeatCount="indefinite" />}
        </circle>
        <circle cx="34" cy="154" r="1.5" fill="#FCD34D" opacity="0.7">
          {A && <animate attributeName="opacity" values="0.3;1;0.3" dur="3.4s" begin="0.3s" repeatCount="indefinite" />}
        </circle>

        {/* ── FOX ── gentle head bob */}
        <g>
          {A && (
            <animateTransform
              attributeName="transform"
              type="translate"
              values="0 0; 0 -2; 0 0"
              dur="3.2s"
              repeatCount="indefinite"
            />
          )}

          {/* tail — bushy, swaying, behind the body */}
          <g style={{ transformOrigin: '150px 150px' }}>
            {A && (
              <animateTransform
                attributeName="transform"
                type="rotate"
                values="-8 150 150; 10 150 150; -8 150 150"
                dur="3.6s"
                repeatCount="indefinite"
              />
            )}
            <path
              d="M 138 150 Q 176 140 178 168 Q 168 184 146 174 Q 138 164 138 150 Z"
              fill={`url(#${id}-body)`}
              opacity="0.95"
            />
            {/* white tail tip — fox signature */}
            <path d="M 168 170 Q 178 166 178 176 Q 172 182 162 178 Z" fill="#FFFFFF" opacity="0.9" />
          </g>

          {/* triangular ears — fox */}
          <path d="M 56 56 L 44 14 L 84 44 Z" fill={primary} opacity="0.95" />
          <path d="M 60 50 L 52 26 L 76 44 Z" fill="#0B1130" opacity="0.18" />
          <path d="M 144 56 L 156 14 L 116 44 Z" fill={primary} opacity="0.95" />
          <path d="M 140 50 L 148 26 L 124 44 Z" fill="#0B1130" opacity="0.18" />

          {/* head — rounded fox face */}
          <path
            d="M 100 44 Q 150 44 152 98 Q 152 132 124 146 L 116 168 Q 100 178 84 168 L 76 146 Q 48 132 48 98 Q 50 44 100 44 Z"
            fill={`url(#${id}-body)`}
          />

          {/* white face mask / muzzle */}
          <path
            d="M 100 92 Q 122 92 122 120 Q 116 150 100 162 Q 84 150 78 120 Q 78 92 100 92 Z"
            fill="#FFFFFF"
            opacity="0.92"
          />

          {/* forehead learning spark — cosmic glow */}
          <g transform="translate(100 60)">
            <circle r="5.5" fill={`url(#${id}-spark)`} style={{ filter: 'drop-shadow(0 0 6px white)' }}>
              {A && <animate attributeName="r" values="4.5;6.5;4.5" dur="2.2s" repeatCount="indefinite" />}
            </circle>
            <path d="M -9 0 L 9 0 M 0 -9 L 0 9" stroke="white" strokeWidth="1.1" opacity="0.6" strokeLinecap="round" />
          </g>

          {/* eyes — blinking */}
          <ellipse cx="80" cy="98" rx="8" ry="9" fill="#0B1130">
            {A && (
              <animate
                attributeName="ry"
                values="9;9;9;9;1;9"
                keyTimes="0;0.2;0.5;0.78;0.82;0.86"
                dur="5.4s"
                repeatCount="indefinite"
              />
            )}
          </ellipse>
          <ellipse cx="120" cy="98" rx="8" ry="9" fill="#0B1130">
            {A && (
              <animate
                attributeName="ry"
                values="9;9;9;9;1;9"
                keyTimes="0;0.2;0.5;0.78;0.82;0.86"
                dur="5.4s"
                repeatCount="indefinite"
              />
            )}
          </ellipse>
          {/* eye sparkles */}
          <circle cx="83" cy="95" r="1.6" fill="#FFFFFF" />
          <circle cx="123" cy="95" r="1.6" fill="#FFFFFF" />

          {/* cheeks — gentle glow pulse */}
          <ellipse cx="68" cy="120" rx="7" ry="5" fill="#F8A4C4" opacity="0.5">
            {A && <animate attributeName="opacity" values="0.35;0.65;0.35" dur="3.6s" repeatCount="indefinite" />}
          </ellipse>
          <ellipse cx="132" cy="120" rx="7" ry="5" fill="#F8A4C4" opacity="0.5">
            {A && <animate attributeName="opacity" values="0.35;0.65;0.35" dur="3.6s" begin="0.4s" repeatCount="indefinite" />}
          </ellipse>

          {/* nose */}
          <path d="M 94 128 L 106 128 L 100 137 Z" fill="#0B1130" />
          {/* friendly smile */}
          <path d="M 90 144 Q 100 152 110 144" stroke="#0B1130" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.55" />
        </g>
      </svg>
    </div>
  );
}
