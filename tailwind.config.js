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
        },
      },
      animation: {
        float: 'float 3s ease-in-out infinite',
        'scale-in': 'scale-in 0.3s cubic-bezier(0.34,1.56,0.64,1)',
        'slide-up': 'slide-up 0.4s ease-out',
        'fade-in': 'fade-in 0.3s ease-out',
        'bounce-in': 'bounce-in 0.5s cubic-bezier(0.34,1.56,0.64,1)',
      },
    },
  },
  plugins: [],
};
