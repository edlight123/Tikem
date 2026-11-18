#!/usr/bin/env node
/**
 * One-off codemod (2026-11-18): rewrite raw colours and one-off pixel text
 * sizes in Tailwind classes onto the tokens in lib/design/tokens.ts.
 *
 *   node scripts/codemods/unify-web-tokens.mjs [--dry]
 *
 * Nearby values snap to the nearest step (white/60, /65, /70 → fg-muted), so
 * the site settles onto the app's handful of greys instead of ~40 alphas.
 * Anything outside the ladder keeps its opacity on the token (`fg/20`).
 */
import fs from 'node:fs'
import path from 'node:path'

const DRY = process.argv.includes('--dry')
const ROOTS = ['app', 'components', 'lib']
const EXT = /\.(tsx|ts|css)$/
const SKIP = [/lib\/design\/tokens\.ts$/, /lib\/email/, /\/emails?\//, /opengraph-image|twitter-image|\/og\//, /\.test\./]

const files = []
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p) }
    else if (EXT.test(e.name) && !SKIP.some((r) => r.test(p))) files.push(p)
  }
}
ROOTS.forEach(walk)

// ---- alpha parsing: "/70" → 0.70, "/[0.055]" → 0.055
const alphaOf = (s) => (s.startsWith('[') ? parseFloat(s.slice(1, -1)) : parseInt(s, 10) / 100)

// Text / icon colour (text-, placeholder-, fill-, stroke-, decoration-, caret-)
function fgStep(a) {
  if (a >= 0.9) return 'fg'
  if (a >= 0.72) return 'fg-soft'
  if (a >= 0.53) return 'fg-muted'
  if (a >= 0.38) return 'fg-subtle'
  if (a >= 0.2) return 'fg-faint'
  return null
}
// Fills (bg-, from-, via-, to-)
function surfaceStep(a) {
  if (a <= 0.045) return 'surface-low'
  if (a <= 0.065) return 'surface'
  if (a <= 0.105) return 'surface-raised'
  if (a <= 0.16) return 'surface-high'
  if (a >= 0.85 && a <= 0.95) return 'inverse-hover'
  return null
}
// Lines (border-, ring-, divide-, outline-)
function lineStep(a) {
  if (a <= 0.07) return 'line-soft'
  if (a <= 0.14) return 'line'
  if (a <= 0.25) return 'line-strong'
  return null
}
function scrimStep(a) {
  if (a >= 0.3 && a <= 0.55) return 'scrim-light'
  if (a > 0.55 && a <= 0.72) return 'scrim'
  if (a > 0.72 && a <= 0.9) return 'scrim-strong'
  return null
}
const TEXTY = new Set(['text', 'placeholder', 'fill', 'stroke', 'decoration', 'caret'])
const FILLY = new Set(['bg', 'from', 'via', 'to'])
const LINEY = new Set(['border', 'ring', 'divide', 'outline', 'border-t', 'border-b', 'border-l', 'border-r', 'border-x', 'border-y', 'ring-offset'])

const pct = (a) => {
  const n = Math.round(a * 1000) / 10
  return Number.isInteger(n) ? String(n) : `[${a}]`
}

// ---- status palettes → semantic tokens
const STATUS = { red: 'danger', rose: 'danger', amber: 'warning', yellow: 'warning', emerald: 'success', green: 'success' }
const statusShade = (n) => (n <= 300 ? 'soft' : n === 400 ? '' : 'strong')
// The old config scales (success-500 / warning-500 / error-500)
const OLD = { success: 'success', warning: 'warning', error: 'danger' }

// ---- arbitrary hex
const HEX = {
  '#080808': 'canvas', '#0a0a0a': 'canvas', '#0f0f0f': 'canvas', '#101010': 'canvas',
  '#111': 'surface-solid', '#111111': 'surface-solid', '#141414': 'surface-solid', '#161616': 'surface-solid', '#171717': 'surface-solid',
  '#1a1a1a': 'surface-raised-solid', '#1c1c1c': 'surface-raised-solid', '#1e1e1e': 'surface-raised-solid', '#1f1f1f': 'surface-raised-solid',
  '#14b8a6': 'brand-500', '#000': 'black', '#000000': 'black', '#fff': 'white', '#ffffff': 'white',
}
// gray-9xx are the canvas / surface in disguise
const GRAY = { 950: 'canvas', 900: 'surface-solid', 800: 'surface-raised-solid' }

// ---- font sizes
const SIZE = {
  8: 'eyebrow', 9: 'eyebrow', 10: 'eyebrow', 11: 'eyebrow', 11.5: 'eyebrow',
  12: 'caption', 12.5: 'caption', 13: 'meta', 13.5: 'meta', 14: 'sm', 15: 'body', 16: 'base',
  17: 'lead', 18: 'lead', 19: 'lead', 20: 'title', 22: 'section', 24: 'section',
  26: 'headline', 28: 'headline', 30: 'display', 32: 'display', 34: 'display',
}

const B = '(?<![\\w-])' // class boundary (prefixes like md: / hover: / ! stay)
const stats = {}
const bump = (k) => (stats[k] = (stats[k] || 0) + 1)

function transform(src) {
  let s = src

  // white/black with an alpha
  s = s.replace(new RegExp(`${B}(text|placeholder|fill|stroke|decoration|caret|bg|from|via|to|border(?:-[tblrxy])?|ring(?:-offset)?|divide|outline)-(white|black)\\/(\\[[0-9.]+\\]|[0-9]+)(?![\\w\\]])`, 'g'), (m, util, base, al) => {
    const a = alphaOf(al)
    let tok = null
    if (base === 'white') {
      if (TEXTY.has(util)) tok = fgStep(a)
      else if (FILLY.has(util)) tok = surfaceStep(a)
      else tok = lineStep(a)
      if (!tok) { bump('white→fg/N'); return `${util}-fg/${pct(a)}` }
    } else {
      if (FILLY.has(util)) tok = scrimStep(a)
      if (!tok) return m
    }
    bump(`${base}/a→token`)
    return `${util}-${tok}`
  })

  // plain white / black
  s = s.replace(new RegExp(`${B}(text|placeholder|fill|stroke|decoration|caret)-white(?![\\w/-])`, 'g'), (m, u) => (bump('text-white'), `${u}-fg`))
  s = s.replace(new RegExp(`${B}bg-white(?![\\w/-])`, 'g'), () => (bump('bg-white'), 'bg-inverse'))
  s = s.replace(new RegExp(`${B}text-black(?![\\w/-])`, 'g'), () => (bump('text-black'), 'text-on-inverse'))

  // arbitrary hex colours
  s = s.replace(new RegExp(`${B}([a-z]+(?:-[a-z]+)?)-\\[(#[0-9a-fA-F]{3,8})\\]`, 'g'), (m, util, hex) => {
    const tok = HEX[hex.toLowerCase()]
    if (!tok) return m
    bump('hex')
    return `${util}-${tok}`
  })

  // status palettes
  s = s.replace(new RegExp(`${B}([a-z]+(?:-[a-z]+)?)-(red|rose|amber|yellow|emerald|green)-([0-9]{2,3})(?![0-9])`, 'g'), (m, util, pal, n) => {
    const shade = statusShade(parseInt(n, 10))
    bump('status')
    return `${util}-${STATUS[pal]}${shade ? '-' + shade : ''}`
  })
  s = s.replace(new RegExp(`${B}([a-z]+(?:-[a-z]+)?)-(success|warning|error)-(50|500|600|700)(?![0-9])`, 'g'), (m, util, pal, n) => {
    bump('old-status')
    if (n === '50') return `${util}-${OLD[pal]}/10`
    return `${util}-${OLD[pal]}-strong`
  })
  s = s.replace(new RegExp(`${B}([a-z]+(?:-[a-z]+)?)-gray-(950|900|800)(?![0-9])`, 'g'), (m, util, n) => (bump('gray'), `${util}-${GRAY[n]}`))

  // one-off pixel sizes
  s = s.replace(new RegExp(`${B}text-\\[([0-9.]+)px\\]`, 'g'), (m, px) => {
    const tok = SIZE[parseFloat(px)]
    if (!tok) return m
    bump('size')
    return `text-${tok}`
  })
  return s
}

let changed = 0
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8')
  const out = transform(src)
  if (out !== src) {
    changed++
    if (!DRY) fs.writeFileSync(f, out)
  }
}
console.log(`${DRY ? '[dry] ' : ''}${changed} files changed`)
console.log(stats)
