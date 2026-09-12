// Honeypot: well-known scanner/attacker probe paths that this app never serves.
// Requests to any of these are rewritten to the decoy responder
// (app/api/honeypot/[[...slug]]/route.ts), which logs the hit and returns
// believable fake content. These are deliberately chosen to NOT overlap with
// any real route (no /admin, no /api/*, no /.well-known, no /manifest).
const HONEYPOT_DECOY_PATHS = [
  '/.env',
  '/.env.local',
  '/.env.production',
  '/.env.backup',
  '/.git/config',
  '/.git/HEAD',
  '/wp-admin',
  '/wp-login.php',
  '/wp-config.php',
  '/wp-config.php.bak',
  '/xmlrpc.php',
  '/phpmyadmin',
  '/phpmyadmin/index.php',
  '/pma',
  '/adminer.php',
  '/.aws/credentials',
  '/server-status',
  '/.svn/entries',
  '/backup.sql',
  '/backup.zip',
  '/database.sql',
  '/dump.sql',
  '/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php',
  '/cgi-bin/luci',
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Force new build ID to invalidate Vercel cache
  generateBuildId: async () => {
    return `build-${Date.now()}`
  },
  
  // Compression and performance
  compress: true,
  poweredByHeader: false,

  // Strip console.* from production bundles, but keep error/warn for observability.
  compiler: {
    removeConsole: { exclude: ['error', 'warn'] },
  },

  // Performance optimizations
  experimental: {
    optimizePackageImports: ['lucide-react', 'date-fns'],
  },

  // The OG card route reads these TTFs off disk at request time (satori needs a
  // raw font buffer and cannot use the woff2 that next/font emits). Tracing
  // cannot infer a runtime fs.readFileSync, so name the files explicitly or the
  // serverless bundle ships without them and every share card 500s in prod.
  outputFileTracingIncludes: {
    '/events/[id]/opengraph-image': ['./assets/fonts/**'],
  },
  
  // Add headers for better caching, performance, and security
  async headers() {
    // Content-Security-Policy allowlist derived from the app's real external
    // origins: Stripe (checkout), Firebase/Google (auth, Firestore, storage,
    // FCM), self-hosted next/font fonts, and Unsplash/GCS images.
    //
    // ENFORCING (verified live: the response header is Content-Security-Policy,
    // not -Report-Only). It shipped as Report-Only first because a slightly-off
    // policy on a live payments app breaks Stripe checkout or Google sign-in;
    // it was flipped after a clean production sweep.
    //
    // So treat every entry below as load-bearing: removing a host here BLOCKS it
    // in browsers rather than logging it. Anything new that checkout depends on
    // (a Stripe domain, a wallet, an auth provider) has to be added here first.
    const contentSecurityPolicy = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      // maps.googleapis.com / api.mapbox.com serve the venue static-map TILE on
      // the event page (components/events/VenueMap.tsx). It is a plain <img>
      // from a third-party host, so without these two entries an enforcing CSP
      // blocks it with no visible error — the tile just never appears. Images
      // only: neither host is added to script-src, connect-src or frame-src,
      // because a static tile needs none of them.
      // i.scdn.co is Spotify's album-art CDN, used by the composer's song picker
      // (components/organizer/SpotifySongPicker.tsx). Searching itself goes
      // through our own /api/spotify/search, so no connect-src entry is needed.
      // i.ytimg.com is YouTube's thumbnail CDN — the still behind the promo
      // video's play button (components/events/PromoVideo.tsx). Image only:
      // the poster is shown before anyone presses play, so the player's own
      // hosts are in frame-src and nowhere else.
      "img-src 'self' data: blob: https://images.unsplash.com https://storage.googleapis.com https://firebasestorage.googleapis.com https://*.googleusercontent.com https://maps.googleapis.com https://api.mapbox.com https://i.scdn.co https://i.ytimg.com",
      "font-src 'self' data:",
      // Next.js injects inline styles; recharts sets inline SVG styles.
      "style-src 'self' 'unsafe-inline'",
      // 'unsafe-inline'/'unsafe-eval' are required by Next's runtime today;
      // tighten to a nonce/hash-based policy as a follow-up.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://apis.google.com https://www.gstatic.com",
      "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://api.stripe.com https://m.stripe.network https://*.stripe.com",
      // youtube-nocookie.com and player.vimeo.com host the promo video player
      // (components/events/PromoVideo.tsx). These two entries are the whole
      // reason lib/videoEmbed exists: the frame's src is BUILT from a template
      // against a validated id, never taken from the organizer's pasted
      // string, so admitting these hosts admits exactly two players and not
      // "whatever an organizer typed". youtube.com itself is listed because
      // the nocookie host redirects there for a small number of videos.
      // Adding a third provider means editing this line too — which is the
      // point of keeping the list short.
      "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://*.firebaseapp.com https://accounts.google.com https://open.spotify.com https://www.youtube-nocookie.com https://www.youtube.com https://player.vimeo.com",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      "media-src 'self' blob:",
    ].join('; ')

    return [
      {
        // Cache static assets aggressively
        source: '/(.*)\\.(jpg|jpeg|png|gif|svg|ico|webp|avif)$',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        // Cache fonts
        source: '/(.*)\\.(woff|woff2|eot|ttf|otf)$',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        // API routes must NEVER be cached by the browser or a shared CDN/proxy.
        // These responses are dynamic and often per-user (auth, payments). In particular
        // the MonCash/NatCash checkout + return endpoints set per-order correlation cookies
        // and issue one-time redirects; if a CDN caches them the fulfillment handler is
        // bypassed and buyers get stale/cross-cached responses (failed checkout, wrong order).
        source: '/api/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate, max-age=0',
          },
        ],
      },
      {
        // Security headers for every route.
        // NOTE: we intentionally do NOT set a blanket "public" Cache-Control here. Most pages
        // are dynamic and/or personalized (event details, dashboards, tickets), and publicly
        // caching them at the edge can leak one user's response to another. Next.js already
        // applies correct caching for genuinely static pages; the rules above handle assets.
        source: '/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            // Don't leak full URLs (which can contain ids/tokens) to third parties.
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            // Camera is allowed same-origin because ticket check-in scans QR
            // codes via getUserMedia (html5-qrcode / jsqr). Microphone and
            // geolocation are unused by the app, so both are denied.
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(), geolocation=(), browsing-topics=()',
          },
          {
            // ENFORCING as of 2026-09-02, after a production-build sweep of the
            // public pages, the composer, the guides and the auth screens found
            // zero violations. Report-Only shipped no report endpoint, so the
            // evidence is that sweep rather than field telemetry — if a rail
            // ever breaks, the console names the directive to widen.
            key: 'Content-Security-Policy',
            value: contentSecurityPolicy,
          },
        ],
      },
    ]
  },

  // Serve mobile deep-link association files from /.well-known (env-driven routes).
  // NOTE: guide docs are served by app/guides/[file]/route.ts (reads private
  // Storage objects via the Admin SDK), not by a rewrite.
  async rewrites() {
    return [
      {
        source: '/.well-known/apple-app-site-association',
        destination: '/api/well-known/aasa',
      },
      {
        source: '/.well-known/assetlinks.json',
        destination: '/api/well-known/assetlinks',
      },
      // Honeypot: route scanner probe paths to the decoy responder. The
      // original probed path is preserved as the destination slug so the
      // handler can pick an appropriate fake response.
      ...HONEYPOT_DECOY_PATHS.map((source) => ({
        source,
        destination: `/api/honeypot${source}`,
      })),
    ]
  },
  
  images: {
    // NOTE: maps.googleapis.com / api.mapbox.com are deliberately NOT listed
    // here. The venue static-map tile (components/events/VenueMap.tsx) is a
    // plain <img>, not next/image: the provider already returns it at the exact
    // size and compression we want, so routing it through the optimizer would
    // re-encode it on our server for no gain — and would replace the clean
    // onError the component relies on ("render nothing rather than a broken
    // tile") with an /_next/image failure. It needs the CSP img-src entry
    // above; it does not need a remotePattern.
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com',
      },
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
      },
    ],
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 60,
    dangerouslyAllowSVG: true,
    contentDispositionType: 'attachment',
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
}

module.exports = nextConfig
