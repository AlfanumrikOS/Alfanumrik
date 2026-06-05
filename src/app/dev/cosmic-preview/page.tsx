'use client';

/**
 * Dev-only visual QA surface for the cosmic redesign (Phase 0).
 *
 * Renders every cosmic primitive + cosmic Foxy in one place so the look can be
 * verified end-to-end. It is GATED on ff_cosmic_redesign_v1:
 *   - Flag OFF → shows a plain "flag is off" notice (no cosmic chrome leaks).
 *   - Flag ON  → shows the gallery, with controls to flip theme
 *     (dark / light / hc) and to preview role palettes via <html data-role>.
 *
 * Bilingual (P7): all visible copy goes through the local `t()` helper keyed on
 * AuthContext.isHi. Technical terms (XP, AAA) are not translated.
 *
 * This route is intentionally minimal and not linked from any nav. It exists
 * for design sign-off; Phase 1 will reskin real surfaces.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useCosmicTheme, type CosmicThemePreference } from '@/lib/cosmic-theme';
import { FoxyMark } from '@/components/landing/FoxyMark';
import {
  GlowCard,
  CardElev,
  Chip,
  CosmicButton,
  PillButton,
  IconButton,
  MasteryRing,
  ProgressBar,
  HeatCell,
  MascotBubble,
  Starfield,
  HDisplay,
} from '@/components/cosmic';

type CosmicRole = 'student' | 'parent' | 'teacher' | 'school';

const STRINGS = {
  title: { en: 'Cosmic Preview', hi: 'कॉस्मिक पूर्वावलोकन' },
  flagOff: {
    en: 'The cosmic redesign flag (ff_cosmic_redesign_v1) is OFF. Enable it to preview.',
    hi: 'कॉस्मिक रीडिज़ाइन फ़्लैग (ff_cosmic_redesign_v1) बंद है। पूर्वावलोकन हेतु इसे चालू करें।',
  },
  theme: { en: 'Theme', hi: 'थीम' },
  role: { en: 'Role palette', hi: 'भूमिका रंग' },
  dark: { en: 'Dark', hi: 'गहरा' },
  light: { en: 'Light', hi: 'हल्का' },
  hc: { en: 'High contrast', hi: 'उच्च कंट्रास्ट' },
  buttons: { en: 'Buttons', hi: 'बटन' },
  primary: { en: 'Primary', hi: 'मुख्य' },
  ghost: { en: 'Ghost', hi: 'घोस्ट' },
  chips: { en: 'Chips', hi: 'चिप्स' },
  rings: { en: 'Mastery rings', hi: 'महारत रिंग' },
  bars: { en: 'Progress bars', hi: 'प्रगति बार' },
  heat: { en: 'Heatmap cells', hi: 'हीटमैप सेल' },
  mascot: { en: 'Cosmic Foxy', hi: 'कॉस्मिक फॉक्सी' },
  bubble: {
    en: 'Hi! Ready for today’s practice? You’re close to a new streak.',
    hi: 'नमस्ते! आज के अभ्यास के लिए तैयार? आप नई लय के करीब हैं।',
  },
  daily: { en: 'Daily goal', hi: 'दैनिक लक्ष्य' },
} as const;

const ROLES: CosmicRole[] = ['student', 'parent', 'teacher', 'school'];

export default function CosmicPreviewPage() {
  const { isHi } = useAuth();
  const { cosmicEnabled, cosmicTheme, setCosmicTheme } = useCosmicTheme();
  const [role, setRole] = useState<CosmicRole>('student');

  const t = (k: keyof typeof STRINGS) => STRINGS[k][isHi ? 'hi' : 'en'];

  // Preview-only: drive the <html data-role> so role palettes can be inspected
  // here without changing the user's actual active role. Restored on unmount.
  useEffect(() => {
    if (!cosmicEnabled || typeof document === 'undefined') return;
    const html = document.documentElement;
    const prev = html.getAttribute('data-role');
    html.setAttribute('data-role', role);
    return () => {
      if (prev) html.setAttribute('data-role', prev);
    };
  }, [role, cosmicEnabled]);

  if (!cosmicEnabled) {
    return (
      <div style={{ padding: 24, maxWidth: 640, margin: '0 auto' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>{t('title')}</h1>
        <p style={{ marginTop: 12, opacity: 0.8 }}>{t('flagOff')}</p>
      </div>
    );
  }

  const themes: { key: CosmicThemePreference; label: string }[] = [
    { key: 'dark', label: t('dark') },
    { key: 'light', label: t('light') },
    { key: 'hc', label: t('hc') },
  ];

  return (
    <div style={{ position: 'relative', minHeight: '100dvh', padding: '20px 18px 80px' }}>
      <Starfield />
      <div style={{ position: 'relative', maxWidth: 760, margin: '0 auto', display: 'grid', gap: 18 }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <FoxyMark variant="cosmic" px={48} />
          <HDisplay as="h1" style={{ fontSize: 26 }}>
            {t('title')}
          </HDisplay>
        </header>

        {/* Theme + role controls */}
        <CardElev style={{ padding: 16, display: 'grid', gap: 14 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', marginBottom: 8 }}>
              {t('theme')}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {themes.map((th) => (
                <PillButton key={th.key} active={cosmicTheme === th.key} onClick={() => setCosmicTheme(th.key)}>
                  {th.label}
                </PillButton>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', marginBottom: 8 }}>
              {t('role')}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {ROLES.map((r) => (
                <PillButton key={r} active={role === r} onClick={() => setRole(r)}>
                  {r}
                </PillButton>
              ))}
            </div>
          </div>
        </CardElev>

        {/* Mascot + bubble */}
        <GlowCard style={{ padding: 18, display: 'flex', gap: 14, alignItems: 'center' }}>
          <FoxyMark variant="cosmic" px={88} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', marginBottom: 6 }}>
              {t('mascot')}
            </div>
            <MascotBubble>{t('bubble')}</MascotBubble>
          </div>
        </GlowCard>

        {/* Buttons */}
        <CardElev style={{ padding: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', marginBottom: 10 }}>
            {t('buttons')}
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <CosmicButton>{t('primary')}</CosmicButton>
            <CosmicButton variant="ghost">{t('ghost')}</CosmicButton>
            <IconButton aria-label="settings">⚙</IconButton>
          </div>
        </CardElev>

        {/* Chips */}
        <CardElev style={{ padding: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', marginBottom: 10 }}>
            {t('chips')}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Chip tone="violet">XP +120</Chip>
            <Chip tone="cyan">Bloom: Apply</Chip>
            <Chip tone="mint">CBSE</Chip>
            <Chip tone="saffron">Streak 6</Chip>
            <Chip tone="pink">New</Chip>
            <Chip>Neutral</Chip>
          </div>
        </CardElev>

        {/* Rings */}
        <CardElev style={{ padding: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', marginBottom: 12 }}>
            {t('rings')}
          </div>
          <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
            <MasteryRing percent={42} size={64} label="Algebra">
              <span style={{ fontSize: 13, fontWeight: 700 }}>42%</span>
            </MasteryRing>
            <MasteryRing percent={78} size={64} label="Geometry">
              <span style={{ fontSize: 13, fontWeight: 700 }}>78%</span>
            </MasteryRing>
            <MasteryRing percent={100} size={64} label="Fractions">
              <span style={{ fontSize: 13, fontWeight: 700 }}>100%</span>
            </MasteryRing>
          </div>
        </CardElev>

        {/* Bars */}
        <CardElev style={{ padding: 16, display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)' }}>
            {t('bars')}
          </div>
          <ProgressBar percent={28} label={t('daily')} />
          <ProgressBar percent={64} label={t('daily')} />
          <ProgressBar percent={92} label={t('daily')} />
        </CardElev>

        {/* Heatmap */}
        <CardElev style={{ padding: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', marginBottom: 12 }}>
            {t('heat')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 6, maxWidth: 320 }}>
            {Array.from({ length: 30 }).map((_, i) => (
              <HeatCell key={i} intensity={(i % 10) / 9} />
            ))}
          </div>
        </CardElev>
      </div>
    </div>
  );
}
