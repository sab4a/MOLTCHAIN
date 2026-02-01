/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        molt: {
          50: '#fef3f2',
          100: '#fee4e2',
          200: '#ffcdc9',
          300: '#fda9a3',
          400: '#f97970',
          500: '#f04d42',
          600: '#dd3028',
          700: '#b9231d',
          800: '#99211c',
          900: '#7f221e',
          950: '#450d0a',
        },
        dark: {
          50: '#f6f6f7',
          100: '#e2e3e5',
          200: '#c5c6ca',
          300: '#a0a2a8',
          400: '#7b7e85',
          500: '#60636a',
          600: '#4c4e54',
          700: '#3f4146',
          800: '#36373b',
          900: '#1a1b1e',
          950: '#0d0d0f',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px rgb(249 121 112 / 0.4), 0 0 20px rgb(249 121 112 / 0.2)' },
          '100%': { boxShadow: '0 0 20px rgb(249 121 112 / 0.6), 0 0 40px rgb(249 121 112 / 0.3)' },
        }
      }
    },
  },
  plugins: [],
}
