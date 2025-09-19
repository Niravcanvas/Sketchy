import plugin from 'tailwindcss/plugin';

/**
 * Shared Tailwind v3 preset — "Party Pop" visual direction.
 * Palette + tokens verbatim from arch/design-party-pop.md §2–§4.
 * Consumers: apps/web/tailwind.config.ts (`presets: [popPreset]`).
 * @type {import('tailwindcss').Config}
 */
const popPreset = {
  theme: {
    extend: {
      colors: {
        paper: '#EFEAFF',
        'paper-2': '#FFFFFF',
        ink: '#14120B',
        graphite: '#5C5647',
        civilian: '#2F6FF2',
        undercover: '#FF4D3D',
        mrwhite: '#8B5CF6',
        highlight: '#FFD23F',
        success: '#2FA85F',
        'phase-discuss': '#D9F2E2',
        'phase-vote': '#FFEFB8',
        'phase-reveal': '#FFDCD6',
      },
      fontFamily: {
        ui: ['var(--font-ui)', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-ui)', 'sans-serif'],
      },
      borderWidth: {
        3: '3px',
      },
      boxShadow: {
        'hard-sm': '3px 3px 0 0 #14120B',
        hard: '5px 5px 0 0 #14120B',
        'hard-lg': '6px 6px 0 0 #14120B',
        'hard-pressed': '1px 1px 0 0 #14120B',
      },
      transitionTimingFunction: {
        snap: 'cubic-bezier(0.2, 1.6, 0.4, 1)',
      },
    },
  },
  plugins: [
    // Halftone dot ground for interstitials / kit panels (design-party-pop.md §9).
    plugin(({ addUtilities }) => {
      addUtilities({
        '.dots': {
          'background-image': 'radial-gradient(rgba(20, 18, 11, 0.14) 1.5px, transparent 1.5px)',
          'background-size': '13px 13px',
        },
      });
    }),
  ],
};

export default popPreset;
