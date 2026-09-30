#!/usr/bin/env node
/**
 * Push the Tikèm App Store listing (store/app-store/metadata.json) to App Store Connect.
 *
 *   node scripts/asc-apply-metadata.mjs                    dry run: GETs only, prints the diff
 *   node scripts/asc-apply-metadata.mjs --apply            PATCH/POST whatever differs
 *
 * Options (combine with or without --apply):
 *   --attach-build <number>        attach processed build <number> (CFBundleVersion) to the version
 *   --upload-screenshots [dir]     upload the iPhone 6.9" set (APP_IPHONE_67); default dir
 *                                  store/screenshots/ios-6.9. Files are sorted by name.
 *   --screenshot-locales a,b       localizations to upload to (default: en-US; other
 *                                  locales fall back to the primary-language screenshots)
 *   --replace-screenshots          also delete screenshots in the set that are not in <dir>
 *   --territories ALL|USA,CAN,...  availability when none is set yet (default: metadata.json)
 *   --only a,b                     run only some steps: version,localizations,appinfo,
 *                                  categories,agerating,contentrights,review,price,
 *                                  availability,build,screenshots
 *   --allow-todo                   send review notes even if they still contain TODO
 *
 * Credentials: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH (defaults below). Demo account
 * values come from the environment or store/app-store/demo.env (gitignored):
 * ASC_DEMO_EMAIL, ASC_DEMO_PASSWORD, ASC_DEMO_ORGANIZER_EMAIL,
 * ASC_DEMO_ORGANIZER_PASSWORD, ASC_DEMO_EVENT_URL.
 *
 * Idempotent: every step reads the live value first and only writes what differs, so a
 * second --apply run prints "unchanged" everywhere.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STORE = path.join(ROOT, 'store', 'app-store')
const API = 'https://api.appstoreconnect.apple.com'

// ---------- args ----------
const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const opt = (name, fallback) => {
  const i = argv.indexOf(name)
  if (i === -1) return undefined
  const next = argv[i + 1]
  return next && !next.startsWith('--') ? next : fallback
}
const APPLY = flag('--apply')
const ALLOW_TODO = flag('--allow-todo')
const ATTACH_BUILD = opt('--attach-build', null)
const SHOTS_DIR = flag('--upload-screenshots')
  ? path.resolve(ROOT, opt('--upload-screenshots', 'store/screenshots/ios-6.9'))
  : null
const SHOT_LOCALES = (opt('--screenshot-locales', 'en-US') || 'en-US').split(',')
const REPLACE_SHOTS = flag('--replace-screenshots')
const ONLY = opt('--only', null)?.split(',')
if (flag('--attach-build') && !ATTACH_BUILD) die('--attach-build needs a build number, e.g. --attach-build 43')

const meta = JSON.parse(fs.readFileSync(path.join(STORE, 'metadata.json'), 'utf8'))
const APP_ID = meta.app.appId
const TERRITORIES = opt('--territories', null) || meta.app.availability?.territories || 'ALL'

// ---------- secrets ----------
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return {}
  const out = {}
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return out
}
const ENV = { ...loadDotEnv(path.join(STORE, 'demo.env')), ...process.env }
const SECRET_KEYS = ['ASC_DEMO_PASSWORD', 'ASC_DEMO_ORGANIZER_PASSWORD']
const fill = (s) =>
  typeof s === 'string' ? s.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, k) => (ENV[k] ? ENV[k] : m)) : s
const unresolved = (s) => (typeof s === 'string' ? [...s.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)].map((m) => m[1]) : [])
const mask = (s) => {
  if (typeof s !== 'string') return s
  let out = s
  for (const k of SECRET_KEYS) if (ENV[k]) out = out.split(ENV[k]).join('••••••')
  return out
}

// ---------- auth ----------
const KEY_ID = ENV.ASC_KEY_ID || 'XA7DX3A8Z8'
const ISSUER = ENV.ASC_ISSUER_ID || '0eddb34e-a05b-4930-8418-7f60a80d0f04'
const KEY_PATH = ENV.ASC_KEY_PATH || path.join(os.homedir(), 'Downloads', `AuthKey_${KEY_ID}.p8`)
let jwt = null
let jwtExp = 0
function token() {
  const now = Math.floor(Date.now() / 1000)
  if (jwt && now < jwtExp - 60) return jwt
  if (!fs.existsSync(KEY_PATH)) die(`API key not found at ${KEY_PATH} (set ASC_KEY_PATH)`)
  const key = fs.readFileSync(KEY_PATH, 'utf8')
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  jwtExp = now + 1200
  const unsigned = `${b64({ alg: 'ES256', kid: KEY_ID, typ: 'JWT' })}.${b64({ iss: ISSUER, iat: now, exp: jwtExp, aud: 'appstoreconnect-v1' })}`
  const sig = crypto.sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')
  jwt = `${unsigned}.${sig}`
  return jwt
}

// ---------- http ----------
const planned = []
async function api(method, p, body) {
  if (method !== 'GET' && !APPLY) {
    planned.push(`${method} ${p}`)
    return { dryRun: true, data: null }
  }
  const res = await fetch(API + p, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 204) return {}
  const text = await res.text()
  const json = text ? JSON.parse(text) : {}
  if (!res.ok) {
    const e = new Error(
      `${method} ${p} -> ${res.status}: ${(json.errors || []).map((x) => `${x.title}: ${x.detail}`).join(' | ') || text}`,
    )
    e.status = res.status
    throw e
  }
  return json
}
const get = (p) => api('GET', p)
async function getAll(p) {
  const out = []
  let next = p
  while (next) {
    const j = await get(next)
    out.push(...(j.data || []))
    next = j.links?.next ? j.links.next.replace(API, '') : null
  }
  return out
}

// ---------- output ----------
let changes = 0
const warnings = []
function die(msg) {
  console.error(`\n✗ ${msg}`)
  process.exit(1)
}
function section(t) {
  console.log(`\n== ${t}`)
}
const show = (v) => {
  if (v === null || v === undefined) return '∅'
  const s = mask(typeof v === 'string' ? v : JSON.stringify(v)).replace(/\n/g, '⏎')
  return s.length > 70 ? `${s.slice(0, 67)}… (${[...String(v)].length} chars)` : s
}
/** Compare desired vs current, print the diff, return only the attributes that differ. */
function diff(current, desired, label = '') {
  const out = {}
  for (const [k, want] of Object.entries(desired)) {
    if (want === undefined) continue
    const have = current?.[k] ?? null
    if (JSON.stringify(have) === JSON.stringify(want)) {
      console.log(`  = ${label}${k}`)
    } else {
      console.log(`  ~ ${label}${k}: ${show(have)}  →  ${show(want)}`)
      out[k] = want
    }
  }
  if (Object.keys(out).length) changes++
  return out
}
const step = (name) => !ONLY || ONLY.includes(name)
const verb = APPLY ? '' : '(dry run) would '

// ---------- steps ----------
const EDITABLE = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY']

async function findVersion() {
  const versions = await getAll(`/v1/apps/${APP_ID}/appStoreVersions?filter[platform]=IOS&limit=50`)
  const v = versions.find((x) => EDITABLE.includes(x.attributes.appStoreState))
  if (!v) die(`No editable iOS version (states: ${versions.map((x) => x.attributes.appStoreState).join(', ')})`)
  return { version: v, isFirstVersion: versions.length === 1 }
}

async function stepVersion(version) {
  section(`Version ${version.attributes.versionString} (${version.id})`)
  const want = diff(version.attributes, { versionString: meta.app.versionString, copyright: meta.app.copyright })
  if (Object.keys(want).length) {
    await api('PATCH', `/v1/appStoreVersions/${version.id}`, {
      data: { type: 'appStoreVersions', id: version.id, attributes: want },
    })
    console.log(`  ${verb}PATCH appStoreVersions`)
  }
}

async function stepVersionLocalizations(version, isFirstVersion) {
  section('Version localizations (description, keywords, promo text, URLs, what\'s new)')
  const existing = await getAll(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`)
  for (const [locale, l] of Object.entries(meta.localizations)) {
    const cur = existing.find((x) => x.attributes.locale === locale)
    const desired = {
      description: l.description,
      keywords: l.keywords,
      promotionalText: l.promotionalText,
      supportUrl: l.supportUrl,
      marketingUrl: l.marketingUrl,
      // Apple refuses "What's New" on an app's first version; it is kept for 1.0.1+.
      whatsNew: isFirstVersion ? undefined : l.whatsNew,
    }
    if (isFirstVersion) console.log(`  · ${locale} whatsNew skipped (first version)`)
    const want = diff(cur?.attributes, desired, `${locale} `)
    if (!Object.keys(want).length) continue
    if (cur) {
      await api('PATCH', `/v1/appStoreVersionLocalizations/${cur.id}`, {
        data: { type: 'appStoreVersionLocalizations', id: cur.id, attributes: want },
      })
      console.log(`  ${verb}PATCH ${locale}`)
    } else {
      await api('POST', '/v1/appStoreVersionLocalizations', {
        data: {
          type: 'appStoreVersionLocalizations',
          attributes: { locale, ...want },
          relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } } },
        },
      })
      console.log(`  ${verb}POST new localization ${locale}`)
    }
  }
}

async function findAppInfo() {
  const infos = await getAll(`/v1/apps/${APP_ID}/appInfos`)
  // The editable appInfo is the one not yet live.
  return infos.find((i) => !['READY_FOR_DISTRIBUTION', 'READY_FOR_SALE'].includes(i.attributes.state)) || infos[0]
}

async function stepAppInfoLocalizations(appInfo) {
  section('App info localizations (name, subtitle, privacy URL)')
  const existing = await getAll(`/v1/appInfos/${appInfo.id}/appInfoLocalizations`)
  for (const [locale, l] of Object.entries(meta.localizations)) {
    const cur = existing.find((x) => x.attributes.locale === locale)
    const want = diff(cur?.attributes, { name: l.name, subtitle: l.subtitle, privacyPolicyUrl: l.privacyPolicyUrl }, `${locale} `)
    if (!Object.keys(want).length) continue
    if (cur) {
      await api('PATCH', `/v1/appInfoLocalizations/${cur.id}`, {
        data: { type: 'appInfoLocalizations', id: cur.id, attributes: want },
      })
      console.log(`  ${verb}PATCH ${locale}`)
    } else {
      await api('POST', '/v1/appInfoLocalizations', {
        data: {
          type: 'appInfoLocalizations',
          attributes: { locale, ...want },
          relationships: { appInfo: { data: { type: 'appInfos', id: appInfo.id } } },
        },
      })
      console.log(`  ${verb}POST new localization ${locale}`)
    }
  }
}

async function stepCategories(appInfo) {
  section('Categories')
  const j = await get(`/v1/appInfos/${appInfo.id}?include=primaryCategory,secondaryCategory`)
  const cur = {
    primary: j.data.relationships?.primaryCategory?.data?.id ?? null,
    secondary: j.data.relationships?.secondaryCategory?.data?.id ?? null,
  }
  const want = diff(cur, { primary: meta.app.categories.primary, secondary: meta.app.categories.secondary })
  if (!Object.keys(want).length) return
  const rel = {}
  if (want.primary) rel.primaryCategory = { data: { type: 'appCategories', id: want.primary } }
  if (want.secondary) rel.secondaryCategory = { data: { type: 'appCategories', id: want.secondary } }
  await api('PATCH', `/v1/appInfos/${appInfo.id}`, { data: { type: 'appInfos', id: appInfo.id, relationships: rel } })
  console.log(`  ${verb}PATCH appInfos categories`)
}

async function stepAgeRating(appInfo) {
  section('Age rating declaration')
  const j = await get(`/v1/appInfos/${appInfo.id}/ageRatingDeclaration`)
  const desired = Object.fromEntries(Object.entries(meta.ageRating).filter(([k]) => !k.startsWith('$')))
  const want = diff(j.data.attributes, desired)
  if (!Object.keys(want).length) return
  await api('PATCH', `/v1/ageRatingDeclarations/${j.data.id}`, {
    data: { type: 'ageRatingDeclarations', id: j.data.id, attributes: want },
  })
  console.log(`  ${verb}PATCH ageRatingDeclarations`)
}

async function stepContentRights() {
  section('Content rights declaration')
  const j = await get(`/v1/apps/${APP_ID}?fields[apps]=contentRightsDeclaration`)
  const want = diff(j.data.attributes, { contentRightsDeclaration: meta.app.contentRightsDeclaration })
  if (!Object.keys(want).length) return
  await api('PATCH', `/v1/apps/${APP_ID}`, { data: { type: 'apps', id: APP_ID, attributes: want } })
  console.log(`  ${verb}PATCH apps.contentRightsDeclaration`)
}

function reviewNotes() {
  const md = fs.readFileSync(path.join(STORE, meta.reviewDetail.notesFile), 'utf8')
  const m = md.match(/<!-- NOTES-BEGIN -->\r?\n([\s\S]*?)\r?\n<!-- NOTES-END -->/)
  if (!m) die(`No NOTES-BEGIN/NOTES-END block in ${meta.reviewDetail.notesFile}`)
  return fill(m[1].trim())
}

async function stepReviewDetail(version) {
  section('App Review information')
  const r = meta.reviewDetail
  const notes = reviewNotes()
  const desired = {
    contactFirstName: r.contactFirstName,
    contactLastName: r.contactLastName,
    contactPhone: r.contactPhone,
    contactEmail: r.contactEmail,
    demoAccountRequired: r.demoAccountRequired,
    demoAccountName: fill(r.demoAccountName),
    demoAccountPassword: fill(r.demoAccountPassword),
    notes,
  }
  const missing = [...new Set(Object.values(desired).flatMap(unresolved))]
  const todo = /\bTODO\b/.test(notes)
  if (missing.length) warnings.push(`Review detail: unresolved placeholders ${missing.join(', ')} (set them in store/app-store/demo.env)`)
  if (todo) warnings.push('Review notes still contain TODO (account deletion / report-block). Fix review-notes.md, or pass --allow-todo.')
  if ([...notes].length > 4000) warnings.push(`Review notes are ${[...notes].length} chars; Apple's limit is 4000.`)
  const blocked = missing.length > 0 || (todo && !ALLOW_TODO) || [...notes].length > 4000

  let cur = null
  try {
    cur = (await get(`/v1/appStoreVersions/${version.id}/appStoreReviewDetail`)).data
  } catch (e) {
    if (e.status !== 404) throw e
  }
  const want = diff(cur?.attributes, desired)
  if (!Object.keys(want).length) return
  if (blocked) {
    console.log('  ! review detail NOT sent: resolve the warnings below first')
    return
  }
  if (cur) {
    await api('PATCH', `/v1/appStoreReviewDetails/${cur.id}`, {
      data: { type: 'appStoreReviewDetails', id: cur.id, attributes: want },
    })
    console.log(`  ${verb}PATCH appStoreReviewDetails`)
  } else {
    await api('POST', '/v1/appStoreReviewDetails', {
      data: {
        type: 'appStoreReviewDetails',
        attributes: desired,
        relationships: { appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } } },
      },
    })
    console.log(`  ${verb}POST appStoreReviewDetails`)
  }
}

async function stepPrice() {
  section('Price (free, base territory USA)')
  const base = meta.app.price.baseTerritory
  let manual = []
  let curBase = null
  try {
    const j = await get(`/v1/appPriceSchedules/${APP_ID}/manualPrices?include=appPricePoint,territory&limit=50`)
    manual = j.data || []
    const pts = Object.fromEntries((j.included || []).filter((x) => x.type === 'appPricePoints').map((x) => [x.id, x]))
    manual = manual.map((m) => ({
      territory: m.relationships?.territory?.data?.id,
      price: pts[m.relationships?.appPricePoint?.data?.id]?.attributes?.customerPrice,
    }))
    curBase = (await get(`/v1/appPriceSchedules/${APP_ID}/baseTerritory`)).data?.id ?? null
  } catch (e) {
    if (e.status !== 404) throw e
  }
  const curPrice = manual.find((m) => m.territory === base)?.price ?? null
  const isFree = curBase === base && curPrice !== null && Number(curPrice) === 0
  const want = diff({ baseTerritory: curBase, customerPrice: curPrice }, { baseTerritory: base, customerPrice: isFree ? curPrice : '0.0' })
  if (isFree) return
  // Find the $0 price point for the base territory.
  let point = null
  let next = `/v1/apps/${APP_ID}/appPricePoints?filter[territory]=${base}&limit=200`
  while (next && !point) {
    const j = await get(next)
    point = (j.data || []).find((p) => Number(p.attributes.customerPrice) === 0)
    next = j.links?.next ? j.links.next.replace(API, '') : null
  }
  if (!point) die(`No free price point found for ${base}`)
  await api('POST', '/v1/appPriceSchedules', {
    data: {
      type: 'appPriceSchedules',
      relationships: {
        app: { data: { type: 'apps', id: APP_ID } },
        baseTerritory: { data: { type: 'territories', id: base } },
        manualPrices: { data: [{ type: 'appPrices', id: '${price0}' }] },
      },
    },
    included: [
      {
        type: 'appPrices',
        id: '${price0}',
        attributes: { startDate: null },
        relationships: { appPricePoint: { data: { type: 'appPricePoints', id: point.id } } },
      },
    ],
  })
  console.log(`  ${verb}POST appPriceSchedules (price point ${point.id})`)
  void want
}

async function stepAvailability() {
  section('Availability (territories)')
  let cur = null
  try {
    cur = (await get(`/v1/apps/${APP_ID}/appAvailabilityV2`)).data
  } catch (e) {
    if (e.status !== 404) throw e
  }
  if (cur) {
    const t = await getAll(`/v2/appAvailabilities/${cur.id}/territoryAvailabilities?limit=200&fields[territoryAvailabilities]=available`)
    const on = t.filter((x) => x.attributes.available).length
    console.log(`  = availability exists (${on}/${t.length} territories available, availableInNewTerritories=${cur.attributes.availableInNewTerritories}). Edit territories in the ASC web UI if needed.`)
    return
  }
  const all = (await getAll('/v1/territories?limit=200')).map((t) => t.id)
  const ids = TERRITORIES === 'ALL' ? all : TERRITORIES.split(',').map((s) => s.trim().toUpperCase())
  const bad = ids.filter((id) => !all.includes(id))
  if (bad.length) die(`Unknown territory codes: ${bad.join(', ')}`)
  console.log(`  ~ availability: ∅  →  ${TERRITORIES === 'ALL' ? `all ${ids.length} territories` : ids.join(', ')} (availableInNewTerritories=${TERRITORIES === 'ALL'})`)
  changes++
  await api('POST', '/v2/appAvailabilities', {
    data: {
      type: 'appAvailabilities',
      attributes: { availableInNewTerritories: TERRITORIES === 'ALL' },
      relationships: {
        app: { data: { type: 'apps', id: APP_ID } },
        territoryAvailabilities: { data: ids.map((id) => ({ type: 'territoryAvailabilities', id: `\${ta-${id}}` })) },
      },
    },
    included: ids.map((id) => ({
      type: 'territoryAvailabilities',
      id: `\${ta-${id}}`,
      attributes: { available: true },
      relationships: { territory: { data: { type: 'territories', id } } },
    })),
  })
  console.log(`  ${verb}POST /v2/appAvailabilities`)
}

async function stepBuild(version) {
  section(`Build ${ATTACH_BUILD}`)
  const builds = await getAll(
    `/v1/builds?filter[app]=${APP_ID}&filter[version]=${ATTACH_BUILD}&filter[preReleaseVersion.platform]=IOS&include=preReleaseVersion&limit=10`,
  )
  const b = builds[0]
  if (!b) {
    warnings.push(`Build ${ATTACH_BUILD} not found in App Store Connect yet (still uploading?).`)
    console.log('  ! not found')
    return
  }
  const pre = await get(`/v1/builds/${b.id}/preReleaseVersion`)
  const short = pre.data?.attributes?.version
  console.log(`  build ${b.attributes.version} (${short}) state=${b.attributes.processingState} expired=${b.attributes.expired}`)
  if (b.attributes.processingState !== 'VALID') {
    warnings.push(`Build ${ATTACH_BUILD} is ${b.attributes.processingState}; wait for VALID and rerun.`)
    return
  }
  if (short !== meta.app.versionString) {
    warnings.push(`Build ${ATTACH_BUILD} is ${short} but the App Store version is ${meta.app.versionString}; they must match.`)
  }
  const cur = (await get(`/v1/appStoreVersions/${version.id}/build`)).data
  const want = diff({ build: cur?.attributes?.version ?? null }, { build: b.attributes.version })
  if (!Object.keys(want).length) return
  await api('PATCH', `/v1/appStoreVersions/${version.id}/relationships/build`, { data: { type: 'builds', id: b.id } })
  console.log(`  ${verb}attach build ${b.attributes.version}`)
}

// --- screenshots ---
function imageSize(buf) {
  if (buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), alpha: [4, 6].includes(buf[25]) }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i < buf.length) {
      if (buf[i] !== 0xff) return null
      const marker = buf[i + 1]
      const len = buf.readUInt16BE(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) }
      }
      i += 2 + len
    }
  }
  return null
}

async function stepScreenshots(version) {
  const displayType = meta.screenshots.displayType
  section(`Screenshots ${displayType} from ${path.relative(ROOT, SHOTS_DIR)}`)
  if (!fs.existsSync(SHOTS_DIR)) {
    warnings.push(`Screenshot dir ${SHOTS_DIR} does not exist.`)
    return
  }
  const files = fs
    .readdirSync(SHOTS_DIR)
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .sort()
  if (!files.length) {
    warnings.push(`No .png/.jpg files in ${SHOTS_DIR}.`)
    return
  }
  if (files.length > 10) die(`Apple allows at most 10 screenshots per set (found ${files.length}).`)
  const local = files.map((f) => {
    const buf = fs.readFileSync(path.join(SHOTS_DIR, f))
    const size = imageSize(buf)
    const dims = size ? `${size.w}x${size.h}` : '?'
    if (!meta.screenshots.acceptedSizes.includes(dims)) die(`${f} is ${dims}; ${displayType} accepts ${meta.screenshots.acceptedSizes.join(' or ')} (portrait).`)
    if (size?.alpha) die(`${f} has an alpha channel; Apple needs flattened RGB screenshots (e.g. sips -s format jpeg, or re-export without transparency).`)
    return { name: f, buf, dims, md5: crypto.createHash('md5').update(buf).digest('hex') }
  })
  console.log(`  ${local.length} local files: ${local.map((l) => `${l.name} (${l.dims})`).join(', ')}`)

  const locs = await getAll(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`)
  for (const locale of SHOT_LOCALES) {
    const loc = locs.find((l) => l.attributes.locale === locale)
    if (!loc) {
      warnings.push(`Localization ${locale} does not exist yet; run the localizations step with --apply first.`)
      continue
    }
    const sets = await getAll(`/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets?filter[screenshotDisplayType]=${displayType}`)
    let set = sets[0]
    let remote = []
    if (set) {
      remote = await getAll(`/v1/appScreenshotSets/${set.id}/appScreenshots?limit=50`)
    }
    const remoteByMd5 = new Map(remote.map((r) => [r.attributes.sourceFileChecksum, r]))
    const toUpload = local.filter((l) => !remoteByMd5.has(l.md5))
    const stale = remote.filter((r) => !local.some((l) => l.md5 === r.attributes.sourceFileChecksum))
    console.log(`  ${locale}: ${remote.length} on ASC, ${toUpload.length} to upload, ${stale.length} not in dir${stale.length && !REPLACE_SHOTS ? ' (kept; pass --replace-screenshots to delete)' : ''}`)
    if (!toUpload.length && (!stale.length || !REPLACE_SHOTS)) {
      console.log(`  = ${locale} screenshots`)
      continue
    }
    changes++
    if (!APPLY) {
      for (const l of toUpload) planned.push(`UPLOAD ${locale} ${l.name}`)
      for (const r of REPLACE_SHOTS ? stale : []) planned.push(`DELETE ${locale} ${r.attributes.fileName}`)
      continue
    }
    if (!set) {
      set = (
        await api('POST', '/v1/appScreenshotSets', {
          data: {
            type: 'appScreenshotSets',
            attributes: { screenshotDisplayType: displayType },
            relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: loc.id } } },
          },
        })
      ).data
    }
    if (REPLACE_SHOTS) {
      for (const r of stale) {
        await api('DELETE', `/v1/appScreenshots/${r.id}`)
        console.log(`  - deleted ${r.attributes.fileName}`)
      }
    }
    for (const l of toUpload) {
      // 1. reserve
      const res = (
        await api('POST', '/v1/appScreenshots', {
          data: {
            type: 'appScreenshots',
            attributes: { fileName: l.name, fileSize: l.buf.length },
            relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: set.id } } },
          },
        })
      ).data
      // 2. upload each part exactly as Apple describes it
      for (const op of res.attributes.uploadOperations) {
        const headers = Object.fromEntries((op.requestHeaders || []).map((h) => [h.name, h.value]))
        const part = l.buf.subarray(op.offset, op.offset + op.length)
        const r = await fetch(op.url, { method: op.method, headers, body: part })
        if (!r.ok) die(`Upload of ${l.name} part @${op.offset} failed: ${r.status} ${await r.text()}`)
      }
      // 3. commit with the MD5 checksum
      await api('PATCH', `/v1/appScreenshots/${res.id}`, {
        data: { type: 'appScreenshots', id: res.id, attributes: { uploaded: true, sourceFileChecksum: l.md5 } },
      })
      // 4. wait for processing
      let state = 'UPLOAD_COMPLETE'
      for (let i = 0; i < 30 && !['COMPLETE', 'FAILED'].includes(state); i++) {
        await new Promise((r) => setTimeout(r, 2000))
        const s = await get(`/v1/appScreenshots/${res.id}?fields[appScreenshots]=assetDeliveryState`)
        state = s.data.attributes.assetDeliveryState?.state
        if (state === 'FAILED') die(`${l.name} failed processing: ${JSON.stringify(s.data.attributes.assetDeliveryState.errors)}`)
      }
      console.log(`  + ${locale} ${l.name} ${state}`)
    }
    // 5. order the set to match the file order
    const after = await getAll(`/v1/appScreenshotSets/${set.id}/appScreenshots?limit=50`)
    const order = local
      .map((l) => after.find((a) => a.attributes.sourceFileChecksum === l.md5))
      .filter(Boolean)
      .concat(after.filter((a) => !local.some((l) => l.md5 === a.attributes.sourceFileChecksum)))
    await api('PATCH', `/v1/appScreenshotSets/${set.id}/relationships/appScreenshots`, {
      data: order.map((a) => ({ type: 'appScreenshots', id: a.id })),
    })
    console.log(`  ✓ ${locale} set ordered (${order.length})`)
  }
}

// ---------- local sanity checks ----------
function localChecks() {
  section('Local checks')
  for (const [locale, l] of Object.entries(meta.localizations)) {
    const limits = { name: 30, subtitle: 30, promotionalText: 170, description: 4000, keywords: 100, whatsNew: 4000 }
    for (const [k, n] of Object.entries(limits)) {
      const len = [...(l[k] || '')].length
      if (len > n) die(`${locale} ${k} is ${len} chars (limit ${n})`)
    }
    if (/,\s/.test(l.keywords)) die(`${locale} keywords must not have spaces after commas`)
  }
  console.log('  = copy lengths and keyword format OK')
}

// ---------- main ----------
console.log(`Tikèm → App Store Connect (app ${APP_ID}) ${APPLY ? 'APPLY' : 'DRY RUN (GET only)'}`)
localChecks()
const { version, isFirstVersion } = await findVersion()
const appInfo = await findAppInfo()
console.log(`  version ${version.id} [${version.attributes.appStoreState}], appInfo ${appInfo.id} [${appInfo.attributes.state}]`)

if (step('version')) await stepVersion(version)
if (step('localizations')) await stepVersionLocalizations(version, isFirstVersion)
if (step('appinfo')) await stepAppInfoLocalizations(appInfo)
if (step('categories')) await stepCategories(appInfo)
if (step('agerating')) await stepAgeRating(appInfo)
if (step('contentrights')) await stepContentRights()
if (step('review')) await stepReviewDetail(version)
if (step('price')) await stepPrice()
if (step('availability')) await stepAvailability()
if (ATTACH_BUILD && step('build')) await stepBuild(version)
if (SHOTS_DIR && step('screenshots')) await stepScreenshots(version)

section('Summary')
console.log(`  ${changes} step(s) with differences${APPLY ? ' applied' : ''}`)
if (!APPLY && planned.length) {
  console.log('  Writes that --apply would send:')
  for (const p of planned) console.log(`    ${p}`)
}
if (warnings.length) {
  console.log('  Warnings:')
  for (const w of warnings) console.log(`    ! ${w}`)
}
console.log(
  '\n  Still owner-only in the ASC web UI: App Privacy answers (store/app-store/app-privacy.md), and the final Add for Review / Submit.',
)
