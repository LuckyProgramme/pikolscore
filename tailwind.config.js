/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'deep-green': '#203F39',
        teal: '#0F5C62',
        'dark-teal': '#084B46',
        'forest-teal': '#085953',
        sage: '#8A9B82',
        'pale-sage': '#EAF0E5',
        'off-white': '#FAF9F5',
        ivory: '#FEFEFB',
        muted: '#748079',
        'muted-strong': '#384640',
        'receiving-digit': '#5A6660',
        line: '#E2E5DC',
        cream: '#FEECD6',
        error: '#BA1A1A',
        warn: '#8A3B08',
        danger: '#BA1A1A',
        // Semantic aliases
        canvas: '#FAF9F5',
        surface: '#FEFEFB',
        tint: '#EAF0E5',
        'surface-hover': '#EAF0E5',
        primary: '#0F5C62',
        'primary-hover': '#085953',
        serving: '#0F5C62',
        'on-serving': '#FEFEFB',
        'server-tile': '#FEECD6',
        'receiving-header': '#E2E5DC',
        hairline: '#E2E5DC',
        strong: '#203F39',
        ball: '#FEECD6',
        forest: '#203F39',
        'line-soft': '#E2E5DC',
        jade: '#8A9B82',
      },
      fontFamily: {
        outfit: ['var(--font-outfit)', 'Outfit', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        flip: {
          '0%': { transform: 'rotateX(-85deg)', opacity: '0.2' },
          '100%': { transform: 'none', opacity: '1' },
        },
      },
      animation: {
        flip: 'flip 0.38s ease-out',
      },
    },
  },
  plugins: [],
}
