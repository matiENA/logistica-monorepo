/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        panol: {
          bg: '#0D1117',
          'header-bg': '#121518',
          'panel-bg': '#11161D',
          'card-bg': '#161B22',
          'card-active': '#131B26',
          border: '#2A323D',
          'border-dark': '#30363D',
          'border-card': '#262C36',
          'border-light': '#3D4856',
          text: '#F3F4F6',
          'text-muted': '#9CA3AF',
          'text-dim': '#6B7280',
          blue: '#3B82F6',
          'blue-primary': '#2563EB',
          'blue-dark': '#365BA5',
          green: '#10B981',
          'green-dark': '#065F46',
          amber: '#F59E0B',
          red: '#DC2626',
          'red-dark': '#DA3633',
        },
        sector: {
          gomeria: '#f59e0b',
          mecanica: '#3b82f6',
          electricidad: '#8b5cf6',
          lavadero: '#06b6d4',
          engrase: '#10b981',
          lubricentro: '#14b8a6',
          motores: '#f97316',
          carroceria: '#f43f5e',
          vtv: '#6366f1',
        },
        brand: {
          iveco: '#1d4ed8',
          volvo: '#0369a1',
          scania: '#b91c1c',
          mercedes: '#374151',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Roboto Mono"', 'monospace'],
        plate: ['"FE-Font"', '"FE-FONT"', 'sans-serif'],
        tech: ['"Share Tech Mono"', 'monospace'],
      }
    },
  },
  plugins: [],
};
