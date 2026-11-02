/**
 * The app's store listings. Env-overridable (e.g. to point at a beta page),
 * defaulting to the live listings. next.config.js's /download redirect uses
 * the same two URLs; keep them in step.
 */
export const APP_STORE_URL =
  process.env.NEXT_PUBLIC_APP_STORE_URL || 'https://apps.apple.com/app/id6794334427'
export const PLAY_STORE_URL =
  process.env.NEXT_PUBLIC_PLAY_STORE_URL || 'https://play.google.com/store/apps/details?id=co.tikem.mobile'
