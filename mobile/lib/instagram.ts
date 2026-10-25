import { Linking } from 'react-native';

/**
 * Open Tikèm's Instagram in the Instagram app when it is installed, the
 * browser otherwise. Mirror of the web lib/instagram.ts.
 *
 * openURL (unlike canOpenURL) needs no LSApplicationQueriesSchemes entry, so
 * this works on the shipped binary: it rejects when no app handles the
 * instagram:// scheme, and the catch falls back to the web profile.
 */
export const INSTAGRAM_URL = 'https://www.instagram.com/tikem.co/';
export const INSTAGRAM_HANDLE = '@tikem.co';

export function openTikemInstagram(): void {
  Linking.openURL('instagram://user?username=tikem.co').catch(() => {
    Linking.openURL(INSTAGRAM_URL).catch(() => {});
  });
}
