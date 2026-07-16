'use client';

import s from '../welcome-v3.module.css';

/**
 * MarketingIcons — inline lucide-style stroke icons for the v3 marketing
 * pages (1.9px stroke via s.icon, no icon-library dependency — same
 * convention as FeaturesV3.tsx). All decorative: aria-hidden, meaning is
 * always carried by the adjacent heading/body text.
 *
 * The v3 style contract bans emoji glyphs on these surfaces; every legacy
 * emoji tile maps to one of these.
 */

function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg className={s.icon} viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  );
}

/** Bar chart — reports / analytics. */
export const IconChart = () => (
  <Svg>
    <path d="M3 3v16a2 2 0 0 0 2 2h16" />
    <path d="M7 15v-3" />
    <path d="M12 15V8" />
    <path d="M17 15v-5" />
  </Svg>
);

/** Open book — subjects / NCERT. */
export const IconBook = () => (
  <Svg>
    <path d="M12 7v14" />
    <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
  </Svg>
);

/** Clock — study time. */
export const IconClock = () => (
  <Svg>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </Svg>
);

/** Target — readiness / adaptivity. */
export const IconTarget = () => (
  <Svg>
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="2" />
  </Svg>
);

/** Bell — alerts. */
export const IconBell = () => (
  <Svg>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </Svg>
);

/** Shield with check — safety / consent. */
export const IconShieldCheck = () => (
  <Svg>
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    <path d="m9 12 2 2 4-4" />
  </Svg>
);

/** Padlock — privacy / no data selling. */
export const IconLock = () => (
  <Svg>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </Svg>
);

/** Document — worksheets / reports / policy. */
export const IconFileText = () => (
  <Svg>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <path d="M8 13h8" />
    <path d="M8 17h5" />
  </Svg>
);

/** People — classes / parent portal. */
export const IconUsers = () => (
  <Svg>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </Svg>
);

/** Building — institution. */
export const IconBuilding = () => (
  <Svg>
    <rect x="4" y="2" width="16" height="20" rx="2" />
    <path d="M9 22v-4h6v4" />
    <path d="M8 6h.01" />
    <path d="M16 6h.01" />
    <path d="M12 6h.01" />
    <path d="M8 10h.01" />
    <path d="M16 10h.01" />
    <path d="M12 10h.01" />
    <path d="M8 14h.01" />
    <path d="M16 14h.01" />
    <path d="M12 14h.01" />
  </Svg>
);

/** Envelope — parent letters. */
export const IconMail = () => (
  <Svg>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m22 7-10 6L2 7" />
  </Svg>
);

/** Trending up — outcomes / growth. */
export const IconTrendingUp = () => (
  <Svg>
    <path d="M22 7 13.5 15.5 8.5 10.5 2 17" />
    <path d="M16 7h6v6" />
  </Svg>
);

/** Clipboard with check — assignments / assessment. */
export const IconClipboardCheck = () => (
  <Svg>
    <rect x="8" y="2" width="8" height="4" rx="1" />
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <path d="m9 14 2 2 4-4" />
  </Svg>
);

/** Magnifier — tracking / drill-down. */
export const IconSearch = () => (
  <Svg>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </Svg>
);

/** Chat bubble — Foxy tutoring. */
export const IconMessageCircle = () => (
  <Svg>
    <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z" />
  </Svg>
);

/** Repeat — spaced repetition. */
export const IconRepeat = () => (
  <Svg>
    <path d="m17 2 4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="m7 22-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
  </Svg>
);

/** Flask — simulations / research. */
export const IconFlask = () => (
  <Svg>
    <path d="M10 2v7.31L4.34 19.2A2 2 0 0 0 6.1 22h11.8a2 2 0 0 0 1.76-2.8L14 9.31V2" />
    <path d="M8.5 2h7" />
    <path d="M7 16h10" />
  </Svg>
);

/** Trophy — gamified learning. */
export const IconTrophy = () => (
  <Svg>
    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
    <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
    <path d="M4 22h16" />
    <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
    <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
    <path d="M18 2H6v7a6 6 0 0 0 12 0z" />
  </Svg>
);

/** Graduation cap — student-first. */
export const IconGraduationCap = () => (
  <Svg>
    <path d="M22 10v6" />
    <path d="M2 10 12 5l10 5-10 5z" />
    <path d="M6 12v5c3 3 9 3 12 0v-5" />
  </Svg>
);

/** Circle-slash — ad-free. */
export const IconCircleSlash = () => (
  <Svg>
    <circle cx="12" cy="12" r="10" />
    <path d="m4.9 4.9 14.2 14.2" />
  </Svg>
);

/** Map pin — Made in India. */
export const IconMapPin = () => (
  <Svg>
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0" />
    <circle cx="12" cy="10" r="3" />
  </Svg>
);

/** Dashboard panels — teacher/school dashboards. */
export const IconLayoutDashboard = () => (
  <Svg>
    <rect x="3" y="3" width="7" height="9" rx="1" />
    <rect x="14" y="3" width="7" height="5" rx="1" />
    <rect x="14" y="12" width="7" height="9" rx="1" />
    <rect x="3" y="16" width="7" height="5" rx="1" />
  </Svg>
);

/** Layers — multi-class / mastery map. */
export const IconLayers = () => (
  <Svg>
    <path d="M12 2 2 7l10 5 10-5z" />
    <path d="m2 17 10 5 10-5" />
    <path d="m2 12 10 5 10-5" />
  </Svg>
);
