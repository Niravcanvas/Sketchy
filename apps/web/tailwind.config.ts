import type { Config } from 'tailwindcss';
import popPreset from '@sketchy/config/tailwind-preset';

const config: Config = {
  presets: [popPreset],
  content: ['./src/**/*.{ts,tsx}'],
};

export default config;
