import { NextResponse } from 'next/server'
import { HOLIDAY_TEMPLATES, holidayTemplateJson } from '@/lib/holidayTemplates'
import { parseOccasion } from '@/lib/occasions'

/**
 * GET /api/posters/holidays[?occasion=kanaval] → the holiday poster templates
 * (lib/holidayTemplates): layout, colourway, photo treatment, photo URLs,
 * suggested titles in ht/fr/en and the photo credit. The app's poster sheet
 * and occasion screen read this, so the list lives only on the website and a
 * new template reaches phones without an app update.
 */
export function GET(req: Request) {
  const occasion = parseOccasion(new URL(req.url).searchParams.get('occasion'))
  const list = occasion ? HOLIDAY_TEMPLATES.filter((t) => t.occasion === occasion) : HOLIDAY_TEMPLATES
  return NextResponse.json(
    { templates: list.map(holidayTemplateJson) },
    { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=3600', 'Access-Control-Allow-Origin': '*' } }
  )
}
