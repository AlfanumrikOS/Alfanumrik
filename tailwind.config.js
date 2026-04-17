/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Sora', 'system-ui', 'sans-serif'],
        heading: ['Sora', 'Plus Jakarta Sans', 'sans-serif'],
      },
      colors: {
        brand: {
          orange: '#F97316',
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
        // Spotlight beam entrance animation
        spotlight: {
          '0%':   { opacity: '0', transform: 'translate(-72%, -62%) scale(0.5)' },
          '100%': { opacity: '1', transform: 'translate(-50%, -40%) scale(1)' },
        },
        // Keep existing keyframes from globals.css working via Tailwind
      },
      animation: {
        // Spline / Spotlight (Aceternity) — beam sweep-in
        spotlight: 'spotlight 2s ease .75s 1 forwards',
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
