import { NextResponse } from 'next/server'
import { TEMPLATES } from '@/lib/posters/templates'

/**
 * GET /api/posters/catalog → the poster templates the app's picker shows:
 * id, family, whether it uses a photo, and each colourway's swatch. The
 * templates themselves live only here (lib/posters/templates), so the app
 * never carries a second copy that could drift.
 */
export function GET() {
  return NextResponse.json(
    {
      templates: TEMPLATES.map((t) => ({
        id: t.id,
        family: t.family,
        usesPhoto: t.usesPhoto,
        palettes: t.palettes.map((p) => ({ bg: p.bg, accent: p.accent })),
      })),
    },
    { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=3600', 'Access-Control-Allow-Origin': '*' } }
  )
}
