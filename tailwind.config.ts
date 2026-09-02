import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    // Mobile-first breakpoints (min-width). Base styles target phones.
    screens: {
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
    },
    extend: {
      colors: {
        brand: {
          DEFAULT: '#1d4ed8',
          fg: '#ffffff',
        },
      },
      // Minimum comfortable touch target size for field capture.
      spacing: {
        touch: '44px',
      },
    },
  },
  plugins: [],
};

export default config;
