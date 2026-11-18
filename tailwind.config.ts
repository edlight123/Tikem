import type { Config } from 'tailwindcss'
import { color as tokenColor, fontSize as tokenFontSize } from './lib/design/tokens'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // The whole palette — canvas, surfaces, text, brand, status, console —
        // is lib/design/tokens.ts (mirrors the app's mobile/theme/tokens.ts).
        ...tokenColor,
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        display: ['var(--font-serif-display)', 'Instrument Serif', 'Georgia', 'serif'],
        serif: ['var(--font-serif-display)', 'Instrument Serif', 'Georgia', 'serif'],
        grotesk: ['var(--font-grotesk)', 'Space Grotesk', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        // The app's text ladder (lib/design/tokens.ts).
        ...tokenFontSize,
        'xs': ['0.75rem', { lineHeight: '1rem' }],
        'sm': ['0.875rem', { lineHeight: '1.25rem' }],
        'base': ['1rem', { lineHeight: '1.5rem' }],
        'lg': ['1.125rem', { lineHeight: '1.75rem' }],
        'xl': ['1.25rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.5rem', { lineHeight: '2rem' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
        '4xl': ['2.25rem', { lineHeight: '2.5rem' }],
        '5xl': ['3rem', { lineHeight: '1' }],
        '6xl': ['3.75rem', { lineHeight: '1' }],
        '7xl': ['4.5rem', { lineHeight: '1' }],
      },
      spacing: {
        '128': '32rem',
        '144': '36rem',
      },
      // BRAND RULE: 4px is the single corner radius on the website, the same
      // radius as the event poster. Every named step resolves to 4px so a
      // stray rounded-2xl can never drift the site back to soft corners; write
      // plain `rounded`. `rounded-full` is left alone and is ONLY for true
      // circles: avatars, status dots, radios, spinners, toggle thumbs and
      // small count badges. Pills, buttons, inputs, chips and search bars get
      // `rounded`. See docs/POSH_DESIGN_BRIEF.md.
      borderRadius: {
        'sm': '0.25rem',
        'DEFAULT': '0.25rem',
        'md': '0.25rem',
        'lg': '0.25rem',
        'xl': '0.25rem',
        '2xl': '0.25rem',
        '3xl': '0.25rem',
        '4xl': '0.25rem',
        '5xl': '0.25rem',
      },
      boxShadow: {
        'soft': '0 2px 15px rgba(0, 0, 0, 0.08)',
        'medium': '0 4px 20px rgba(0, 0, 0, 0.12)',
        'hard': '0 8px 30px rgba(0, 0, 0, 0.16)',
        'glow': '0 0 20px rgba(15, 118, 110, 0.3)',
        'glow-orange': '0 0 20px rgba(15, 118, 110, 0.3)',  // teal (legacy alias → brand)
        // Editorial / poster depth used across the public experience
        'poster': '0 24px 50px -24px rgba(12, 35, 33, 0.55)',
        'poster-sm': '0 12px 28px -16px rgba(12, 35, 33, 0.45)',
        'card-hover': '0 30px 60px -28px rgba(15, 118, 110, 0.45)',
      },
      letterSpacing: {
        eyebrow: '0.18em',
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-in-out',
        'slide-up': 'slideUp 0.5s ease-out',
        'slide-down': 'slideDown 0.5s ease-out',
        'scale-in': 'scaleIn 0.3s ease-out',
        'shimmer': 'shimmer 2s infinite',
        'bounce-slow': 'bounce 3s infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        scaleIn: {
          '0%': { transform: 'scale(0.9)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-1000px 0' },
          '100%': { backgroundPosition: '1000px 0' },
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'shimmer': 'linear-gradient(to right, transparent 0%, rgba(255,255,255,0.6) 50%, transparent 100%)',
      },
    },
  },
  plugins: [],
}
export default config
