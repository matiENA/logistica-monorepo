/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './taller.html', './coordinacion.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        plate: ['"FE-Font"', '"FE-FONT"', 'monospace'],
        mono: ['"Share Tech Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        numeric: ['"Roboto Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        notes: ['"Zilla Slab"', 'Georgia', 'serif'],
        helvetica: ['Helvetica', 'Arial', 'sans-serif'],
        roboto: ['Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
