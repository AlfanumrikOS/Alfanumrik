import { ImageResponse } from 'next/og';
import { PRICING } from '@alfanumrik/lib/plans';

export const runtime = 'nodejs';

const W = 1200;
const H = 630;

/**
 * Per-page OG image variants (SEO layer, 2026-07-16), selected via
 * `?v=default|product|pricing|parents|teachers|schools` and referenced by
 * buildMarketingMetadata (src/lib/marketing-metadata.ts). Only the TEXT
 * content varies — layout, Foxy mascot, colors and footer are shared.
 *
 * `default` MUST stay byte-identical to the pre-variant output (no `?v` or
 * an unknown value falls through to it): the strings below are the exact
 * renderings of the previously-inline JSX text nodes.
 *
 * Pricing numbers come from PRICING (@alfanumrik/lib/plans) — the single
 * source of truth. No price literals in this file.
 */
interface OgVariantContent {
  line1: string;
  line2: string;
  sub1: string;
  sub2: string;
  bullets: [string, string, string];
}

const VARIANTS: Record<string, OgVariantContent> = {
  default: {
    line1: "Tonight's homework",
    line2: 'can be different.',
    sub1: "Foxy — India's most patient tutor.",
    sub2: 'CBSE Grades 6–12 · Hindi & English',
    bullets: [
      "Adapts to your child's pace",
      'Every answer NCERT-grounded',
      'Free to start · no card needed',
    ],
  },
  product: {
    line1: 'One platform.',
    line2: 'Every learner covered.',
    sub1: 'AI tutoring, quizzes, dashboards & reports.',
    sub2: 'CBSE Grades 6–12 · Hindi & English',
    bullets: [
      'NCERT-grounded AI tutor',
      'Adaptive quizzes & spaced review',
      'Teacher & parent dashboards',
    ],
  },
  pricing: {
    line1: 'Start free.',
    line2: 'Upgrade any time.',
    sub1: `Plans from ₹0 to ₹${PRICING.unlimited.monthly}/month.`,
    sub2: 'CBSE Grades 6–12 · Hindi & English',
    bullets: [
      `Starter ₹${PRICING.starter.monthly}/mo`,
      `Pro ₹${PRICING.pro.monthly}/mo`,
      `Unlimited ₹${PRICING.unlimited.monthly}/mo`,
    ],
  },
  parents: {
    line1: 'Know what your child',
    line2: 'actually learned.',
    sub1: 'Weekly letters. Subject-wise mastery.',
    sub2: 'CBSE Grades 6–12 · Hindi & English',
    bullets: [
      'Progress letters every week',
      'Honest mastery tracking',
      'Free to start · no card needed',
    ],
  },
  teachers: {
    line1: 'Monday-ready',
    line2: 'class insights.',
    sub1: "90-second worksheets. Bloom's analytics.",
    sub2: 'CBSE Grades 6–12 · built for teachers',
    bullets: [
      'Worksheets in 90 seconds',
      "Bloom's-level class dashboards",
      'Automated parent reports',
    ],
  },
  schools: {
    line1: 'School intelligence,',
    line2: 'in real time.',
    sub1: 'NEP-aligned reporting · ISO 27001 certified.',
    sub2: 'CBSE Grades 6–12 · 30 to 3,000 seats',
    bullets: [
      'Principal-level dashboards',
      'NEP-aligned reporting',
      'India-hosted student data',
    ],
  },
};

export async function GET(request: Request) {
  const v = new URL(request.url).searchParams.get('v');
  const content = (v && VARIANTS[v]) || VARIANTS.default;

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          width: W,
          height: H,
          background: '#0D0A06',
          position: 'relative',
          overflow: 'hidden',
          fontFamily: 'Georgia, "Times New Roman", serif',
        }}
      >
        {/* Radial vignette */}
        <div
          style={{
            position: 'absolute', inset: 0, display: 'flex',
            background:
              'radial-gradient(ellipse 90% 80% at 38% 52%, transparent 0%, rgba(0,0,0,0.58) 100%)',
          }}
        />

        {/* Saffron bottom accent strip */}
        <div
          style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            height: 7, background: '#E8581C', display: 'flex',
          }}
        />

        {/* Foxy fox — right side, CSS shapes */}
        {/* Glow halo */}
        <div
          style={{
            position: 'absolute', right: 100, top: 80,
            width: 360, height: 360, borderRadius: 360,
            background:
              'radial-gradient(circle, rgba(232,88,28,0.22) 0%, transparent 70%)',
            display: 'flex',
          }}
        />
        {/* Left ear */}
        <div
          style={{
            position: 'absolute', right: 330, top: 80,
            width: 0, height: 0,
            borderLeft: '42px solid transparent',
            borderRight: '42px solid transparent',
            borderBottom: '110px solid #E8581C',
            display: 'flex',
          }}
        />
        {/* Right ear */}
        <div
          style={{
            position: 'absolute', right: 168, top: 80,
            width: 0, height: 0,
            borderLeft: '42px solid transparent',
            borderRight: '42px solid transparent',
            borderBottom: '110px solid #E8581C',
            display: 'flex',
          }}
        />
        {/* Inner left ear */}
        <div
          style={{
            position: 'absolute', right: 319, top: 110,
            width: 0, height: 0,
            borderLeft: '26px solid transparent',
            borderRight: '26px solid transparent',
            borderBottom: '64px solid #C84411',
            display: 'flex',
          }}
        />
        {/* Inner right ear */}
        <div
          style={{
            position: 'absolute', right: 184, top: 110,
            width: 0, height: 0,
            borderLeft: '26px solid transparent',
            borderRight: '26px solid transparent',
            borderBottom: '64px solid #C84411',
            display: 'flex',
          }}
        />
        {/* Fox head — large saffron circle */}
        <div
          style={{
            position: 'absolute', right: 130, top: 155,
            width: 280, height: 280, borderRadius: 280,
            background: '#E8581C', display: 'flex',
          }}
        />
        {/* Muzzle (cream oval) */}
        <div
          style={{
            position: 'absolute', right: 205, top: 340,
            width: 130, height: 100, borderRadius: 100,
            background: '#F4ECDB', display: 'flex',
          }}
        />
        {/* Left eye socket */}
        <div
          style={{
            position: 'absolute', right: 352, top: 270,
            width: 36, height: 36, borderRadius: 36,
            background: '#0E0B07', display: 'flex',
          }}
        />
        {/* Right eye socket */}
        <div
          style={{
            position: 'absolute', right: 220, top: 270,
            width: 36, height: 36, borderRadius: 36,
            background: '#0E0B07', display: 'flex',
          }}
        />
        {/* Left eye shine */}
        <div
          style={{
            position: 'absolute', right: 372, top: 276,
            width: 11, height: 11, borderRadius: 11,
            background: '#fff', opacity: 0.85, display: 'flex',
          }}
        />
        {/* Right eye shine */}
        <div
          style={{
            position: 'absolute', right: 240, top: 276,
            width: 11, height: 11, borderRadius: 11,
            background: '#fff', opacity: 0.85, display: 'flex',
          }}
        />
        {/* Nose */}
        <div
          style={{
            position: 'absolute', right: 287, top: 352,
            width: 0, height: 0,
            borderLeft: '10px solid transparent',
            borderRight: '10px solid transparent',
            borderTop: '8px solid #0E0B07',
            display: 'flex',
          }}
        />

        {/* Left content column */}
        <div
          style={{
            display: 'flex', flexDirection: 'column',
            padding: '52px 56px 60px',
            width: 720, flexShrink: 0,
            position: 'relative', zIndex: 1,
          }}
        >
          {/* Brand row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 52 }}>
            <div
              style={{
                width: 9, height: 9, borderRadius: 9,
                background: '#E8581C', display: 'flex', flexShrink: 0,
              }}
            />
            <div
              style={{
                color: '#F4ECDB', fontSize: 22, fontWeight: 700,
                letterSpacing: '-0.01em', display: 'flex',
              }}
            >
              Alfanumrik
            </div>
            <div
              style={{
                marginLeft: 8, display: 'flex',
                background: 'rgba(232,88,28,0.14)',
                border: '1px solid rgba(232,88,28,0.28)',
                padding: '4px 13px', borderRadius: 99,
                fontSize: 10, color: '#E8581C', letterSpacing: '0.14em',
              }}
            >
              FOXY · CBSE INDIA
            </div>
          </div>

          {/* Headline */}
          <div
            style={{
              display: 'flex', flexDirection: 'column',
              fontSize: 74, fontWeight: 700, lineHeight: 1.02,
              letterSpacing: '-0.035em', marginBottom: 24,
            }}
          >
            <span style={{ color: '#F4ECDB' }}>{content.line1}</span>
            <span style={{ color: '#E8581C', fontStyle: 'italic' }}>{content.line2}</span>
          </div>

          {/* Sub-copy */}
          <div
            style={{
              display: 'flex', flexDirection: 'column',
              fontSize: 20, lineHeight: 1.48,
              fontStyle: 'italic', marginBottom: 32,
            }}
          >
            <span style={{ color: 'rgba(244,236,219,0.72)' }}>
              {content.sub1}
            </span>
            <span style={{ color: 'rgba(244,236,219,0.48)', fontSize: 17 }}>
              {content.sub2}
            </span>
          </div>

          {/* Bullets */}
          {content.bullets.map((b, i) => (
            <div
              key={i}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                marginBottom: 9, color: 'rgba(244,236,219,0.52)', fontSize: 15,
              }}
            >
              <div
                style={{
                  width: 5, height: 5, borderRadius: 5,
                  background: '#E8581C', flexShrink: 0, display: 'flex',
                }}
              />
              {b}
            </div>
          ))}

          {/* Footer */}
          <div
            style={{
              marginTop: 'auto', paddingTop: 36,
              fontFamily: '"Courier New", Courier, monospace',
              fontSize: 11, letterSpacing: '0.18em',
              color: 'rgba(244,236,219,0.28)', textTransform: 'uppercase',
              display: 'flex',
            }}
          >
            alfanumrik.com · free to start · 7-day money back
          </div>
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
      // The image only changes on deploy — cache aggressively at the browser
      // (1 day) and CDN (7 days, serving stale while revalidating).
      headers: {
        'Cache-Control':
          'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
      },
    },
  );
}
