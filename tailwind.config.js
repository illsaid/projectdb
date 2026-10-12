/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
        display: ['"Instrument Serif"', 'Georgia', 'serif'],
      },
      colors: {
        ink: {
          950: '#090b0e',
          900: '#0d1014',
          850: '#12161c',
          800: '#171c23',
          700: '#232a33',
          600: '#2f3843',
          500: '#4b5563',
          400: '#6b7684',
          300: '#9ca3af',
          200: '#d4d9e0',
          100: '#f1f5f9',
        },
      },
    },
  },
  plugins: [],
};
