import { NextResponse } from 'next/server'

/**
 * Apple App Site Association (AASA)
 *
 * Served at https://tikem.co/.well-known/apple-app-site-association via a rewrite
 * in next.config.js. Enables iOS Universal Links so https://tikem.co/... opens
 * the Tikèm app (bundle co.tikem.mobile) when installed.
 *
 * The Apple Team ID is read from APPLE_TEAM_ID so no secrets are committed.
 * Until APPLE_TEAM_ID is set the file is served with an empty details array
 * (valid JSON, simply inactive).
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const IOS_BUNDLE_ID = 'co.tikem.mobile'

// Paths the mobile app handles as deep links (see mobile/navigation/AppNavigator).
// /i/* is a friend's personal invite link: with the app installed it opens the
// app, which saves the code itself (the web route's cookie never reaches it).
const APP_PATHS = ['/events/*', '/tickets/*', '/invite', '/notifications', '/i/*']

export async function GET() {
  const teamId = process.env.APPLE_TEAM_ID?.trim()
  const appIDs = teamId ? [`${teamId}.${IOS_BUNDLE_ID}`] : []

  const body = {
    applinks: {
      apps: [],
      details: appIDs.length
        ? [
            {
              // Modern (iOS 13+) format
              appIDs,
              components: APP_PATHS.map((p) => ({ '/': p })),
              // Legacy format for older iOS versions
              appID: appIDs[0],
              paths: APP_PATHS,
            },
          ]
        : [],
    },
    // Enables Shared Web Credentials / password autofill for the app.
    ...(appIDs.length ? { webcredentials: { apps: appIDs } } : {}),
  }

  return new NextResponse(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
