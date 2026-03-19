/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Nunito', 'sans-serif'],
        body: ['Nunito', 'sans-serif'],
      },
      colors: {
        brand: {
          orange: '#FF6B35',
          'orange-light': '#FF8F5E',
          'orange-dark': '#E55A25',
          purple: '#7B2D8E',
          'purple-light': '#9B4DAE',
          'purple-dark': '#5A1A6E',
          gold: '#FFB800',
          teal: '#00B4D8',
          green: '#2DC653',
          red: '#FF4757',
        },
        surface: {
          50: '#FAFAFA',
          100: '#F5F3FF',
          200: '#EDE9FE',
          700: '#1E1B2E',
          800: '#141220',
          900: '#0D0B15',
        },
      },
      keyframes: {
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-10px)' } },
        slideUp: { '0%': { transform: 'translateY(20px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
        bounceIn: { '0%': { transform: 'scale(0.3)', opacity: '0' }, '50%': { transform: 'scale(1.05)' }, '100%': { transform: 'scale(1)', opacity: '1' } },
        pulseGlow: { '0%,100%': { boxShadow: '0 0 20px rgba(255,107,53,0.3)' }, '50%': { boxShadow: '0 0 40px rgba(255,107,53,0.6)' } },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
      },
      animation: {
        float: 'float 3s ease-in-out infinite',
        'slide-up': 'slideUp 0.5s ease-out',
        'bounce-in': 'bounceIn 0.6s ease-out',
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        shimmer: 'shimmer 2s linear infinite',
      },
    },
  },
  plugins: [],
};
