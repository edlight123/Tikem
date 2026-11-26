import fs from 'node:fs/promises'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { FONT_FILES } from '@/lib/physical/design/painter'

export const runtime = 'nodejs'

const ALLOWED = new Set(Object.values(FONT_FILES))

/**
 * GET /api/physical/fonts/:file — the ticket typefaces (all SIL OFL) for the
 * printed-ticket proofs, so the SVG proof sets type with the very files the
 * print PDF embeds. Only the five ticket fonts; anything else is a 404.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const name = String((await params)?.name || '')
  if (!ALLOWED.has(name)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    const data = await fs.readFile(path.join(process.cwd(), 'assets', 'fonts', name))
    return new NextResponse(new Uint8Array(data), {
      headers: {
        'Content-Type': 'font/ttf',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}
