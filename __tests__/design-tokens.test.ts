/**
 * The website's colours and text sizes live in ONE file, lib/design/tokens.ts,
 * mirroring the app's mobile/theme/tokens.ts (owner, 2026-11-18). These tests
 * keep the two in step and stop raw colours creeping back into the site.
 */
import fs from 'node:fs'
import path from 'node:path'
import { color, fontSize } from '@/lib/design/tokens'

const appTokens = fs.readFileSync(path.join(__dirname, '../mobile/theme/tokens.ts'), 'utf8')
const appValue = (key: string) => {
  const m = new RegExp(`\\n\\s+${key}: '([^']+)'`).exec(appTokens)
  if (!m) throw new Error(`app token ${key} not found`)
  return m[1].toUpperCase()
}

describe('web tokens mirror the app', () => {
  it.each([
    ['canvas', () => color.canvas, 'bg'],
    ['surface solid', () => color.surface.solid, 'surface'],
    ['raised solid', () => color.surface['raised-solid'], 'surfaceRaised'],
    ['line solid', () => color.line.solid, 'border'],
    ['accent', () => color.brand[500], 'teal'],
    ['muted text', () => color.fg['muted-solid'], 'textSecondary'],
    ['danger', () => color.danger.DEFAULT, 'red'],
    ['warning', () => color.warning.DEFAULT, 'amber'],
    ['success', () => color.success.DEFAULT, 'emerald'],
  ])('%s', (_name, web, appKey) => {
    expect(web().toUpperCase()).toBe(appValue(appKey))
  })

  it('shares the app text ladder', () => {
    for (const px of [11, 12, 13, 15, 20, 22]) {
      expect(Object.values(fontSize)).toContain(`${px}px`)
    }
  })
})

// --- no raw colours in the site's classes -----------------------------------
const ROOTS = ['app', 'components', 'lib']
const SKIP = [/lib\/design\/tokens\.ts$/, /lib\/email/, /\/emails?\//, /opengraph-image|twitter-image|\/og\//, /__tests__/, /\.test\./]
const files: string[] = []
const walk = (d: string) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') walk(p)
    } else if (/\.(tsx|ts|css)$/.test(e.name) && !SKIP.some((r) => r.test(p))) files.push(p)
  }
}
ROOTS.forEach((r) => walk(path.join(__dirname, '..', r)))

const B = '(?<![\\w-])'
const RULES: Array<[string, RegExp]> = [
  ['white/black at an alpha (use fg-*, surface-*, line-*, scrim-*)', new RegExp(`${B}(?:text|bg|border|ring|divide|placeholder|from|via|to)-(?:white|black)\\/`, 'g')],
  ['plain text-white / bg-white / text-black (use fg, inverse, on-inverse)', new RegExp(`${B}(?:text-white|bg-white|text-black)(?![\\w/-])`, 'g')],
  ['arbitrary hex class (add a token)', new RegExp(`${B}[a-z]+(?:-[a-z]+)?-\\[#[0-9a-fA-F]{3,8}\\]`, 'g')],
  ['stock palette colour (use danger / warning / success / brand)', new RegExp(`${B}(?:bg|text|border|ring|from|via|to|divide|fill|stroke|placeholder)-(?:gray|zinc|neutral|slate|stone|red|rose|amber|yellow|emerald|green|teal|blue|sky|cyan|indigo|violet|purple|pink|orange|lime)-[0-9]{2,3}`, 'g')],
  ['one-off pixel text size (use the ladder: eyebrow…hero)', new RegExp(`${B}text-\\[[0-9.]+px\\]`, 'g')],
]

describe('no raw colours or one-off text sizes on the website', () => {
  it.each(RULES)('%s', (_label, re) => {
    const hits: string[] = []
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8')
      // Comments may name the old classes when they explain a change.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
      const m = code.match(re)
      if (m) hits.push(`${path.relative(path.join(__dirname, '..'), f)}: ${[...new Set(m)].join(', ')}`)
    }
    expect(hits).toEqual([])
  })
})
