/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
    },
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          DEFAULT: 'var(--brand-primary, #2563eb)',
          50: 'var(--brand-primary-50, #eff6ff)',
          100: 'var(--brand-primary-100, #dbeafe)',
          500: 'var(--brand-primary, #2563eb)',
          600: 'var(--brand-primary-600, #1d4ed8)',
          700: 'var(--brand-primary-700, #1e40af)',
        },
        // Remapeia as cores slate mais usadas para CSS variables
        // Assim dark: prefix funciona em todos os elementos JSX automaticamente
        surface: {
          0: 'var(--surface-0)',
          1: 'var(--surface-1)',
          2: 'var(--surface-2)',
          3: 'var(--surface-3)',
        },
        border: {
          DEFAULT: 'var(--border)',
          strong: 'var(--border-strong)',
        },
        ink: {
          primary:   'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted:     'var(--text-muted)',
        },
      },
      borderRadius: {
        card: '12px',
        btn: '8px',
      },
      boxShadow: {
        soft: '0 30px 80px rgba(15, 23, 42, 0.12)',
        card: '0 18px 40px rgba(15, 23, 42, 0.08)',
        subtle: '0 14px 30px rgba(15, 23, 42, 0.04)',
      },
      animation: {
        'fade-in': 'fade-in 0.25s ease-out both',
        'fade-in-up': 'fade-in-up 0.35s ease-out both',
        'fade-in-scale': 'fade-in-scale 0.25s ease-out both',
        'slide-in-right': 'slide-in-right 0.3s ease-out both',
      },
    },
  },
  plugins: [],
};
