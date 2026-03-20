/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Sora', 'sans-serif'],
        body: ['Plus Jakarta Sans', 'sans-serif'],
      },
      colors: {
        orange: '#FF6B35', gold: '#FFB800', teal: '#00B4D8',
        green: '#2DC653', purple: '#9B4DAE', pink: '#E84393',
      },
      animation: {
        'float': 'float 3s ease-in-out infinite',
        'spin-slow': 'spin-slow 8s linear infinite',
        'slide-up': 'slideUp 0.4s cubic-bezier(0.4,0,0.2,1) both',
        'fade-in': 'fadeIn 0.35s ease both',
        'shimmer': 'shimmer 2s linear infinite',
      },
    },
  },
  plugins: [],
};
