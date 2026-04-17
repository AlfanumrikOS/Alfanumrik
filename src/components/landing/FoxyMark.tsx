'use client';

/**
 * Branded CSS-only geometric fox avatar.
 * Replaces all 🦊 emoji on landing pages.
 * Three sizes: sm (w-7), md (w-12), lg (w-16).
 */
export function FoxyMark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
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