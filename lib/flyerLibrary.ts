/**
 * The flyer library — ready-made artwork for organizers with no poster.
 *
 * The uploader alone assumes the organizer already has a designed flyer. Most
 * first-time organizers on /create do not, and an event with no image is the
 * single worst-performing card on Discover. So the flyer slot offers a second
 * door: pick a piece of artwork, one click, no file, no designer.
 *
 * These are Unsplash CDN URLs, which the app already relies on: the host is in
 * `next.config.js` remotePatterns AND in the enforcing CSP's `img-src`, so a
 * picked flyer renders everywhere a real upload does. Every id here was
 * verified to resolve before being added — an id that 404s is an event with a
 * broken poster, which is worse than no library at all. Note that only
 * `images.unsplash.com` is allowed: `plus.unsplash.com/premium_photo-…` ids
 * look identical in search results and are silently blocked, so they are out.
 *
 * `label` is a plain English fallback; the picker translates
 * `composer.flyerLib.<id>` when a locale has it. Only the original fifteen
 * carry locale keys — everything added since falls back to `label` in all
 * three languages on purpose. Fifty-odd hand-translated one-word captions is a
 * lot of churn on en/fr/ht for a caption that sits under a thumbnail, and the
 * `tags` below (which carry the search) already speak Kreyòl and French.
 */

import { HOLIDAY_TEMPLATES, occasionsWithTemplates } from './holidayTemplates'
import { OCCASIONS, occasionsInSeason, type OccasionKey, type OccasionText } from './occasions'

export interface FlyerLibraryItem {
  /** Stable key, also the i18n suffix. */
  id: string
  /** Unsplash photo id (the `photo-…` path segment). */
  photo: string
  label: string
  /**
   * What an organizer would type looking for this. Searching only the label
   * fails the moment someone types "konpa" or "dj" instead of "stage lights",
   * so each piece carries the words for the kind of night it suits — the music
   * genre, the Kreyòl or French word, and the plain English, because the same
   * night gets typed three different ways. "konpa" and "kompa" both appear:
   * one word, two spellings, and organizers use both. Tags stay unaccented —
   * an ASCII tag is found by an accented query and a bare one alike.
   */
  tags: string[]
  /** A seasonal piece's caption in each language (holiday templates carry their own). */
  labels?: OccasionText
  /** The occasion a seasonal piece belongs to. */
  occasion?: OccasionKey
}

const unsplash = (photo: string, w: number, h: number) =>
  `https://images.unsplash.com/photo-${photo}?w=${w}&h=${h}&fit=crop&q=80`

/** Full-size 4:5 poster, what gets saved as banner_image_url. */
export const flyerLibraryFullUrl = (item: FlyerLibraryItem) => unsplash(item.photo, 1200, 1500)

/**
 * Grid thumbnail — small on purpose, the picker shows the whole library at
 * once. Exactly 4:5, matching the poster-shaped tiles, so the tile never has
 * to crop it.
 *
 * Left at 320x400 deliberately. A tile resolves to ~166 CSS px wide, so on a
 * 3x phone these are a little soft, and 400x500 does fix that — but at ~30KB a
 * thumb the whole library is already ~1.6MB, and 400x500 would push it past
 * 2MB. `q` barely moves the number (Unsplash serves much the same bytes at 70
 * as at 80). Marginal sharpness at this size is not worth it on the
 * connections this picker exists to serve: it is aimed at first-time
 * organizers with no artwork.
 */
export const flyerLibraryThumbUrl = (item: FlyerLibraryItem) => unsplash(item.photo, 320, 400)

/**
 * Roughly fifty pieces, not fifteen. Fifteen items spread over eight-odd tags
 * meant a specific search ("maryaj", "legliz", "kanaval") returned two or
 * three tiles and read as an empty shelf. The breadth below tracks what
 * Haitian and diaspora organizers actually put on: konpa and rara and
 * twoubadou nights, club and rooftop and boat parties, weddings and showers
 * and graduations, church services and gospel, comedy and theatre and film,
 * street food and rum and brunch, markets and craft fairs, fashion, football
 * and run clubs, panels and galas, family days, and the fireworks that carry
 * both new year and independence day.
 *
 * Every photo below was checked twice: that it resolves with a real body, and
 * that the 4:5 crop actually depicts what the label claims. Anything with
 * legible baked-in text, a brand mark, or one person's face filling the frame
 * was dropped — these are backgrounds for a poster, not portraits.
 */
export const FLYER_LIBRARY: readonly FlyerLibraryItem[] = [
  // The original fifteen. 'kompa' joins 'konpa' on the three that carry it.
  { id: 'stageLights', photo: '1516450360452-9312f5e86fc7', label: 'Stage lights', tags: ['concert','konpa','kompa','music','live','stage','band','dj','night'] },
  { id: 'crowdGold', photo: '1470229722913-7c0e2dbbafd3', label: 'Crowd in gold', tags: ['concert','festival','crowd','music','konpa','kompa','party','warm'] },
  { id: 'confetti', photo: '1492684223066-81342ee5ff30', label: 'Confetti', tags: ['party','fèt','celebration','new year','confetti','birthday'] },
  { id: 'fromTheStage', photo: '1533174072545-7a4b6ad7a6c3', label: 'From the stage', tags: ['concert','festival','crowd','stage','live','music'] },
  { id: 'handsUp', photo: '1429962714451-bb934ecdc4ec', label: 'Hands up', tags: ['party','fèt','club','dj','dance','crowd','night'] },
  { id: 'smokeAndLight', photo: '1493225457124-a3eb161ffa5f', label: 'Smoke and light', tags: ['party','club','dj','rap','smoke','night','performance'] },
  { id: 'brass', photo: '1511192336575-5a79af67a629', label: 'Brass', tags: ['jazz','konpa','kompa','twoubadou','brass','band','live','music'] },
  { id: 'festival', photo: '1514525253161-7a46d19cd819', label: 'Festival night', tags: ['festival','carnival','kanaval','concert','lights','music'] },
  { id: 'paint', photo: '1460661419201-fd4cecdf8a8b', label: 'Paint', tags: ['art','kilti','culture','exhibition','workshop','paint'] },
  { id: 'table', photo: '1555939594-58d7cb561ad1', label: 'The table', tags: ['food','manje','dinner','restaurant','tasting','gala'] },
  { id: 'worship', photo: '1438232992991-995b7058bbb3', label: 'Worship', tags: ['church','worship','gospel','religious','service','praise'] },
  { id: 'startLine', photo: '1461896836934-ffe607ba8211', label: 'Start line', tags: ['sports','espò','race','running','marathon','athletics'] },
  { id: 'darkRoom', photo: '1540575467063-178a50c2df87', label: 'Full room', tags: ['conference','business','talk','panel','summit','audience'] },
  { id: 'workshop', photo: '1557426272-fc759fdf7a8d', label: 'Workshop', tags: ['workshop','training','class','business','team','meeting'] },
  { id: 'classroom', photo: '1503676260728-1c00da094a0b', label: 'Classroom', tags: ['education','school','class','students','learning','training'] },

  // Haitian music, in the specific flavours organizers bill by name. The
  // parade saxophonist and the folkloric dancers are the two most on-brand
  // frames in the whole library — actual Haiti, flags and all — so they carry
  // the widest net of genre words.
  { id: 'konpaBand', photo: '1527091736853-64ca6a9b64d9', label: 'Parade brass', tags: ['konpa','kompa','rara','kanaval','defile','parade','mizik','live','band','dyaspora'] },
  { id: 'danseFolklorik', photo: '1742095228943-1b0ceb0fd82e', label: 'Folk dancers', tags: ['danse','dance','folklore','kilti','culture','rasin','kanaval','haiti','dyaspora','festival'] },
  { id: 'raraDrum', photo: '1778338943581-a43e09f48d02', label: 'Big drum', tags: ['rara','tanbou','drum','percussion','rasin','roots','kilti','vodou','festival'] },
  { id: 'twoubadouGuitar', photo: '1785539139081-a511edaf0f6a', label: 'Acoustic set', tags: ['twoubadou','acoustic','guitar','gita','mizik','live','unplugged','cafe','intimate'] },
  { id: 'kanaval', photo: '1639002549231-a895a33c4888', label: 'Carnival feathers', tags: ['kanaval','carnival','costume','feathers','defile','parade','danse','fet','colorful'] },
  { id: 'rapNight', photo: '1547661198-888c249734e7', label: 'On the mic', tags: ['rap','hip hop','afrobeats','dancehall','concert','stage','mic','live','night'] },

  // Nightlife. A DJ set gets searched for as "dj", as "sware", as "bal" and as
  // whatever genre is on the flyer, so both DJ frames carry all four.
  { id: 'djDecks', photo: '1470225620780-dba8ba36b745', label: 'Decks', tags: ['dj','set','club','party','fet','sware','afrobeats','dancehall','night','mizik'] },
  { id: 'djCrowd', photo: '1763630054130-0129c32d3f7f', label: 'Booth and crowd', tags: ['dj','club','bal','party','fet','sware','crowd','dance','night','zouk'] },
  { id: 'rooftop', photo: '1692261920240-a3c88f29e25f', label: 'Rooftop', tags: ['rooftop','terrace','party','fet','sware','sunset','drinks','summer','outdoor'] },
  { id: 'stringLights', photo: '1517457373958-b7bdd4587205', label: 'String lights', tags: ['party','fet','backyard','block party','lights','crowd','summer','outdoor','anniversary'] },
  { id: 'sunsetCruise', photo: '1628029338883-61644ec68475', label: 'Sunset cruise', tags: ['boat','yacht','cruise','party','fet','sunset','summer','sware','water'] },
  { id: 'beachPalms', photo: '1580741186862-c5d0bf2aff33', label: 'Beach and palms', tags: ['beach','plaj','palms','caribbean','party','fet','summer','day party','outdoor','haiti'] },

  // Life events — the quiet majority of what gets created. Weddings need two:
  // the room, and the toast.
  { id: 'weddingFlowers', photo: '1519225421980-715cb0215aed', label: 'Reception table', tags: ['wedding','maryaj','reception','flowers','dinner','engagement','shower','elegant'] },
  { id: 'weddingToast', photo: '1523521803700-b3bcaeab0150', label: 'The toast', tags: ['wedding','maryaj','toast','champagne','anniversary','anivese','reception','celebration'] },
  { id: 'birthdayCake', photo: '1610670444950-0b29430891b4', label: 'Candles', tags: ['birthday','anivese','cake','gato','candles','celebration','fet','surprise'] },
  { id: 'balloonGarland', photo: '1780586382191-bef9c740798e', label: 'Balloon garland', tags: ['baby shower','shower','gender reveal','bridal','balloons','anivese','brunch','elegant','celebration'] },
  { id: 'kidsBalloons', photo: '1530103862676-de8c9debad1d', label: 'Balloons', tags: ['kids','timoun','birthday','anivese','family','fanmi','balloons','party','fet'] },
  { id: 'graduationCaps', photo: '1533854775446-95c4609da544', label: 'Caps in the air', tags: ['graduation','gradyasyon','school','lekol','university','ceremony','students','celebration'] },
  { id: 'champagne', photo: '1580657274234-7339717f4541', label: 'Champagne', tags: ['champagne','toast','celebration','new year','ane nouvo','anniversary','anivese','gala','sware'] },
  { id: 'familyDay', photo: '1761662827034-13225b496e66', label: 'Family day', tags: ['family','fanmi','kids','timoun','picnic','piknik','park','outdoor','community','day'] },
  { id: 'fireworks', photo: '1533219057257-4bb9ed5d2cc6', label: 'Fireworks', tags: ['fireworks','new year','ane nouvo','independence','endepandans','celebration','fet','crowd','night'] },

  // Church. The white steeple reads as legliz at a glance in a way a European
  // nave does not, and the choir frame is the one people search "gospel" for.
  { id: 'whiteChurch', photo: '1716130838495-3679bb2289c4', label: 'White church', tags: ['church','legliz','service','sevis','worship','mass','revival','sunday','religious'] },
  { id: 'choir', photo: '1720186576697-24c1496a07e1', label: 'Choir', tags: ['choir','koral','gospel','church','legliz','worship','concert','praise','revival'] },

  // Stage arts. The bare mic in a spotlight is deliberately unspecific — it is
  // the tile for comedy, for open mic and for spoken word alike.
  { id: 'comedyMic', photo: '1507676385008-e7fb562d11f8', label: 'One mic', tags: ['comedy','komedi','stand up','open mic','poetry','spoken word','mic','stage','night'] },
  { id: 'theatreCurtain', photo: '1514306191717-452ec28c7814', label: 'Red curtain', tags: ['theatre','teyat','play','drama','stage','curtain','performance','dance','show'] },
  { id: 'driveIn', photo: '1594808985790-98a065b97476', label: 'Outdoor screen', tags: ['film','fim','cinema','sinema','screening','movie','outdoor','projection','night'] },

  // Food and drink. The grill is the griyo tile; the rum glass covers the
  // tasting and the ti punch both.
  { id: 'grill', photo: '1603088549155-6ae9395b928f', label: 'On the grill', tags: ['food','manje','griyo','grill','bbq','barbecue','street food','cookout','fundraiser'] },
  { id: 'brunch', photo: '1664192578366-523c01b7ce43', label: 'Brunch', tags: ['brunch','breakfast','manje','food','cafe','coffee','day party','sunday','tasting'] },
  { id: 'winePour', photo: '1553361371-9b22f78e8b1d', label: 'Wine pour', tags: ['wine','diven','tasting','degustation','dinner','manje','pairing','sware','elegant'] },
  { id: 'rumGlass', photo: '1615887625746-f3d2aa27e048', label: 'On the rocks', tags: ['rum','ronm','cocktails','bar','tasting','sware','drinks','night','lounge'] },

  // Markets and makers.
  { id: 'streetMarket', photo: '1783343982687-4c169ab0cf23', label: 'Market stalls', tags: ['market','mache','vendors','stalls','food','manje','popup','fair','outdoor','community'] },
  { id: 'craftMarket', photo: '1769425158985-8452c0e54194', label: 'Craft fair', tags: ['craft','atizana','handmade','fair','market','mache','artisan','popup','vendors','art'] },

  // Fashion. One frame, tagged for both a runway show and a pageant.
  { id: 'runway', photo: '1543728069-a3f97c5a2f32', label: 'Runway', tags: ['fashion','mode','runway','catwalk','show','pageant','model','style','night'] },

  // Fitness and sport. Football gets the empty floodlit pitch rather than a
  // match photo — it survives the portrait crop and reads at thumbnail size.
  { id: 'yoga', photo: '1683056255281-e52a141924f0', label: 'Yoga class', tags: ['yoga','wellness','fitness','stretch','class','meditation','health','retreat','studio'] },
  { id: 'runClub', photo: '1739368732843-800f36a9b7d0', label: 'Run club', tags: ['running','kouri','run club','fitness','marathon','5k','espo','sports','morning','group'] },
  { id: 'footballField', photo: '1487466365202-1afdb86c764e', label: 'Night pitch', tags: ['football','soccer','foutbol','espo','sports','match','tournament','pitch','night'] },
  { id: 'basketball', photo: '1562552052-4e9f2d8e8a4e', label: 'Pickup game', tags: ['basketball','basket','espo','sports','tournament','court','game','outdoor','youth'] },

  // Business and giving.
  { id: 'panel', photo: '1735679356705-7c06b780c7a4', label: 'Panel', tags: ['panel','conference','konferans','talk','speakers','forum','business','summit','audience'] },
  { id: 'networking', photo: '1515169067868-5387ec356754', label: 'Networking', tags: ['networking','mixer','business','biznis','reception','sware','drinks','meetup','professional'] },
  { id: 'galaBallroom', photo: '1780542900375-0cf459e38fbb', label: 'Ballroom', tags: ['gala','ballroom','fundraiser','benefit','banquet','dinner','manje','awards','elegant','sware'] },
]

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/**
 * The library as it should read on `now`: for the 30 days before an occasion
 * that has holiday templates (lib/holidayTemplates), and while it is on, that
 * season's photos come first (soonest occasion first), then the everyday
 * library. A photo appears once. Pure: pass `now` to test it.
 */
export function seasonalFlyerLibrary(now: Date | number = Date.now()): FlyerLibraryItem[] {
  const season = occasionsInSeason(now, occasionsWithTemplates())
  const seen = new Set<string>()
  const lead: FlyerLibraryItem[] = []
  for (const occasion of season) {
    const o = OCCASIONS.find((x) => x.key === occasion)!
    const words = [...new Set(Object.values(o.name).map(fold))]
    for (const t of HOLIDAY_TEMPLATES) {
      if (t.occasion !== occasion || seen.has(t.photo)) continue
      seen.add(t.photo)
      lead.push({
        id: `holiday-${t.id}`,
        photo: t.photo,
        label: t.title.en,
        labels: t.title,
        occasion,
        tags: [...words, occasion, fold(t.title.ht), fold(t.title.fr), fold(t.category)],
      })
    }
  }
  return [...lead, ...FLYER_LIBRARY.filter((f) => !seen.has(f.photo))]
}
