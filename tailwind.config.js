/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  // Theme strategy (Phase 1 — 2026-05-11):
  //   AuthContext writes data-theme="dark" to <html> when the user picks dark
  //   (or when their system preference is dark while pref === 'system'). The
  //   selector strategy below lets Tailwind's `dark:` variant follow that same
  //   attribute, so `dark:bg-gray-900` etc. activate in lock-step with the
  //   CSS-var dark theme in globals.css.
  //
  //   Note: this requires Tailwind 3.4.1+ for the 'selector' strategy with
  //   custom selector. Current package.json: tailwindcss ^3.4.4 (compatible).
  // Dark mode reversed 2026-05-11 — see src/lib/AuthContext.tsx::resolveTheme.
  // Point the dark-variant selector at an attribute value the app NEVER
  // writes, so every `dark:bg-*` / `dark:text-*` Tailwind utility becomes
  // dead CSS (still generated, never applied). A follow-up sweep can strip
  // the `dark:` classes from component files; this is defense in depth.
  darkMode: ['selector', '[data-theme="dark-disabled-pending-cleanup"]'],
  theme: {
    extend: {
      fontFamily: {
        // Devanagari fallbacks appended to every stack (P7). The self-hosted
        // next/font vars (--font-noto-*-deva, mounted on <html> by
        // momentum-fonts.ts) win first; the literal family names catch a
        // system-installed copy. Latin runs still resolve the primary face.
        sans: ['Plus Jakarta Sans', 'Sora', 'var(--font-noto-sans-deva)', 'Noto Sans Devanagari', 'system-ui', 'sans-serif'],
        heading: ['Sora', 'Plus Jakarta Sans', 'var(--font-noto-sans-deva)', 'Noto Sans Devanagari', 'sans-serif'],
        // Alfa Momentum triad (Wave 0). `display` = premium editorial
        // headlines (Fraunces); Fraunces lacks Devanagari glyphs, so the
        // Noto Devanagari fallbacks keep Hindi (isHi) headings legible. `data`
        // = the numeric/stat/XP/score voice (Sora). `heading` kept for back-compat.
        display: ['Fraunces', 'var(--font-noto-serif-deva)', 'Noto Serif Devanagari', 'Georgia', 'serif'],
        data: ['Sora', 'var(--font-noto-sans-deva)', 'Noto Sans Devanagari', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          // Repointed to the runtime token so `bg-brand-orange` follows the
          // active theme (burnt-orange on default/Atlas light, violet under
          // data-design="cosmic") instead of freezing at a literal. Resolves to
          // #E8581C on the shipping light theme — identical to the old literal.
          orange: 'var(--orange)',
          purple: '#7C3AED',
          cream: '#FBF8F4',
          warm: '#FEF3E2',
          // Dynamic school branding — overridden by SchoolThemeProvider CSS vars
          primary: 'var(--color-brand-primary, #7C3AED)',
          secondary: 'var(--color-brand-secondary, #F97316)',
        },
        // New semantic tokens — map to CSS custom properties
        primary: {
          DEFAULT: 'var(--primary)',
          light: 'var(--primary-light)',
          hover: 'var(--primary-hover)',
        },
        secondary: { DEFAULT: 'var(--secondary)' },
        success: { DEFAULT: 'var(--success)' },
        warning: { DEFAULT: 'var(--warning)' },
        danger: {
          DEFAULT: 'var(--danger)',
          light: 'var(--danger-light)',
        },
        info: { DEFAULT: 'var(--info)' },
        surface: {
          1: 'var(--surface-1)',
          2: 'var(--surface-2)',
          3: 'var(--surface-3)',
        },
        // Foreground tokens — used by admin-ui shared kit (Plan 0)
        foreground: 'var(--text-1)',
        'muted-foreground': 'var(--text-3)',
        // Gamification
        xp: 'var(--xp-color)',
        streak: 'var(--streak-color)',
        'mastery-low': 'var(--mastery-low)',
        'mastery-mid': 'var(--mastery-mid)',
        'mastery-high': 'var(--mastery-high)',
        'level-up': 'var(--level-up)',
      },
      boxShadow: {
        'sm': 'var(--shadow-sm)',
        'md': 'var(--shadow-md)',
        'lg': 'var(--shadow-lg)',
        'glow': 'var(--shadow-glow)',
      },
      borderRadius: {
        'sm': 'var(--radius-sm)',
        'md': 'var(--radius-md)',
        'lg': 'var(--radius-lg)',
        'xl': 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
      },
      spacing: {
        'sp-1': 'var(--space-1)',
        'sp-2': 'var(--space-2)',
        'sp-3': 'var(--space-3)',
        'sp-4': 'var(--space-4)',
        'sp-5': 'var(--space-5)',
        'sp-6': 'var(--space-6)',
        'sp-8': 'var(--space-8)',
        'sp-12': 'var(--space-12)',
        'sp-16': 'var(--space-16)',
      },
      keyframes: {
        // Keep existing keyframes from globals.css working via Tailwind
      },
      animation: {
        float: 'float 3s ease-in-out infinite',
        'scale-in': 'scale-in 0.3s cubic-bezier(0.34,1.56,0.64,1)',
        'slide-up': 'slide-up 0.4s ease-out',
        'fade-in': 'fade-in 0.3s ease-out',
        'bounce-in': 'bounce-in 0.5s cubic-bezier(0.34,1.56,0.64,1)',
        // New psychology-driven animations
        'level-up': 'levelUp 0.6s cubic-bezier(0.34,1.56,0.64,1) both',
        'xp-burst': 'xpBurst 0.5s cubic-bezier(0.34,1.56,0.64,1) both',
        'streak-pulse': 'streakPulse 1.5s ease-in-out infinite',
        'mastery-fill': 'masteryFill 1.2s cubic-bezier(0.4,0,0.2,1) both',
        'score-reveal': 'scoreReveal 0.8s cubic-bezier(0.34,1.56,0.64,1) both',
      },
    },
  },
  plugins: [],
};
