/**
 * schema.org Organization + WebSite for the homepage, so search engines can tie
 * the brand name to this site. "Tikem" (no accent) is how people type it, and
 * without this a brand-new name that looks like "TikTok" gets corrected away.
 */

import { CANONICAL_SITE_URL } from '@/lib/site-url'

const INSTAGRAM_URL = 'https://www.instagram.com/tikem.co/'
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=co.tikem.mobile'

export const BRAND_ALTERNATE_NAMES = ['Tikem', 'Tikem.co', 'tikem.co']

export function buildSiteJsonLd(siteUrl: string = CANONICAL_SITE_URL): Record<string, unknown> {
  const url = siteUrl.replace(/\/$/, '')
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${url}/#organization`,
        name: 'Tikèm',
        alternateName: BRAND_ALTERNATE_NAMES,
        url: `${url}/`,
        logo: `${url}/app-icon.png`,
        description: 'Event ticketing for Haiti and the Haitian diaspora: MonCash, QR tickets and door scanning.',
        email: 'support@tikem.co',
        sameAs: [INSTAGRAM_URL, PLAY_STORE_URL],
      },
      {
        '@type': 'WebSite',
        '@id': `${url}/#website`,
        name: 'Tikèm',
        alternateName: BRAND_ALTERNATE_NAMES,
        url: `${url}/`,
        inLanguage: ['ht', 'fr', 'en'],
        publisher: { '@id': `${url}/#organization` },
        potentialAction: {
          '@type': 'SearchAction',
          target: { '@type': 'EntryPoint', urlTemplate: `${url}/discover?search={search_term_string}` },
          'query-input': 'required name=search_term_string',
        },
      },
    ],
  }
}
