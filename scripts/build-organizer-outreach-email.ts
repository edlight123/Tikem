/**
 * The organizer outreach email (Kreyòl), in the Tikèm email look
 * (lib/email-kit/layout). Writes the HTML so it can be previewed and pasted
 * into Gmail drafts. {NON} and {EVENMAN} are filled per organizer.
 *
 *   npx tsx scripts/build-organizer-outreach-email.ts [outFile] [name] [event]
 */
import { writeFileSync } from 'node:fs'
import {
  C,
  FONT,
  appUrl,
  button,
  gap,
  paragraphHtml,
  serifHeading,
  title,
} from '../lib/email-kit/layout'
import { escapeHtml } from '../lib/html'

const esc = (v: string) => escapeHtml(v)
const base = appUrl()
const WHATSAPP = 'https://wa.me/17542768676'

/** Recent = their last event was within the last few months ("dènyèman"). */
export function organizerOutreachHtml(name: string, event: string, recent = true): string {
  const fill = (rows: string, pad = '22px 22px') =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.surface}" style="background:${C.surface};border-radius:4px;border-collapse:separate;"><tr><td style="padding:${pad};">${rows}</td></tr></table>`

  const question = (n: string, text: string, last = false) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 ${last ? 0 : 14}px;"><tr>
<td width="34" valign="top" style="font-family:${FONT.serif};font-style:italic;font-size:22px;line-height:1.1;color:${C.teal};">${n}</td>
<td valign="top" style="font-family:${FONT.sans};font-size:15px;line-height:1.5;color:${C.text};">${esc(text)}</td></tr></table>`

  const tile = (head: string, body: string) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.surface}" style="background:${C.surface};border-radius:4px;border-collapse:separate;"><tr><td style="padding:18px 18px 20px;" valign="top">
<div style="font-family:${FONT.sans};font-size:15px;font-weight:800;line-height:1.3;color:${C.text};">${esc(head)}</div>
<div style="margin-top:6px;font-family:${FONT.sans};font-size:13px;line-height:1.5;color:${C.text2};">${esc(body)}</div>
</td></tr></table>`

  const grid = (cells: string[]) => {
    const rows: string[] = []
    for (let i = 0; i < cells.length; i += 2) {
      rows.push(`<tr>
<td class="tk-cell" width="50%" valign="top" style="padding:0 5px 10px 0;">${cells[i]}</td>
<td class="tk-cell" width="50%" valign="top" style="padding:0 0 10px 5px;">${cells[i + 1] || ''}</td></tr>`)
    }
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join('')}</table>`
  }

  const hero = `<a href="${base}" target="_blank" style="text-decoration:none;"><img src="${base}/email/organizer-hero.jpg" width="536" alt="Tikèm" style="display:block;width:536px;max-width:100%;height:auto;border-radius:4px;border:0;"></a>`

  const price = fill(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle" width="44%">
<div style="font-family:${FONT.sans};font-size:64px;line-height:1;font-weight:800;letter-spacing:-2px;color:${C.text};">10<span style="font-size:34px;color:${C.teal};">%</span></div>
</td>
<td valign="middle" style="font-family:${FONT.sans};font-size:15px;line-height:1.55;color:${C.text2};">
<span style="color:${C.text};font-weight:700;">MonCash ladan l.</span> Anyen pa ajoute sou sa.<br>Tikè 1 000 goud: <span style="color:${C.text};font-weight:700;">100 goud</span> an tou.<br>Tikè gratis: <span style="color:${C.text};font-weight:700;">0</span>.
</td></tr></table>`,
    '26px 24px'
  )

  const signature = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="top">
<div style="font-family:${FONT.serif};font-style:italic;font-size:26px;line-height:1.1;color:${C.text};">Fredler Pierre-Louis</div>
<div style="margin-top:6px;font-family:${FONT.sans};font-size:14px;line-height:1.6;color:${C.text2};">Tikèm · <a href="${base}" target="_blank" style="color:${C.text2};text-decoration:none;">tikem.co</a><br>
WhatsApp: <a href="${WHATSAPP}" target="_blank" style="color:${C.text};font-weight:700;text-decoration:none;">+1 754 276 8676</a></div>
</td></tr></table>`

  const blocks = [
    hero,
    gap(30),
    title('Tikè ou yo, san tèt chaje.', 36),
    gap(16),
    paragraphHtml(
      recent
        ? `Bonjou ${esc(name)}, mwen wè ou te òganize <span style="color:${C.text};font-weight:700;">${esc(event)}</span> dènyèman. Bravo pou bèl travay la.`
        : `Bonjou ${esc(name)}, nou te wè <span style="color:${C.text};font-weight:700;">${esc(event)}</span> ak lòt evènman ou yo. Bravo pou bèl travay la.`
    ),
    gap(18),
    serifHeading('ou janm viv sa?'),
    fill(
      question('1', 'Nimewo telefòn oswa imèl kliyan ou yo parèt kote yo pa t dwe parèt.') +
        question('2', 'Kòd QR yo refize mache nan pòt la, moun kanpe nan liy ap tann.') +
        question('3', 'Frè sou chak tikè, epi frè peman an ki vin sou sa ankò.', true)
    ),
    gap(34),
    serifHeading('sa tikèm chanje'),
    price,
    gap(10),
    grid([
      tile('Done kliyan an sekirite', 'Se ou menm sèl ki wè lis envite ou.'),
      tile('Pòt la mache', 'QR pwoteje, eskane menm san entènèt. Yon tikè pa pase de fwa.'),
      tile('MonCash ak kat', 'Dyaspora a achte tou. Tikè a antre nan Apple ak Google Wallet.'),
      tile('Zouti pou vann', 'Early bird, VIP, kòd pwomo, lyen pou pwomotè.'),
      tile('Ekip ou avè ou', 'Admin, manadjè ak moun pou pòt la, chak ak aksè pa yo.'),
      tile('Kreyòl, Fransè, Anglè', 'Sou sit la ak sou aplikasyon an.'),
    ]),
    gap(30),
    fill(
      `<div style="font-family:${FONT.sans};font-size:20px;font-weight:800;line-height:1.3;color:${C.text};">Nou mete pwochen evènman ou an liy pou ou, gratis.</div>
<div style="margin:8px 0 20px;font-family:${FONT.sans};font-size:15px;line-height:1.6;color:${C.text2};">Ou pa peye anyen davans. Reponn imèl sa a ak afich la, dat la, kote a ak pri yo, epi n ap okipe rès la.</div>
${button('Vizite tikem.co', base)}
<div style="height:10px;line-height:10px;font-size:1px;">&nbsp;</div>
${button('Telechaje aplikasyon an', `${base}/download`, 'secondary')}`,
      '26px 24px'
    ),
    gap(34),
    paragraphHtml(
      `<a href="${base}/decks/Tikem-oganizate-Ayiti.pdf" target="_blank" style="color:${C.text};font-weight:700;text-decoration:underline;text-underline-offset:3px;">Gade prezantasyon an</a>. Si ou pito pale, ekri m sou WhatsApp.`
    ),
    gap(6),
    signature,
  ]

  const body = blocks.map((b) => `<tr><td class="tk-pad" style="padding:0 32px;">${b}</td></tr>`).join('')
  const head = `<tr><td class="tk-pad" style="padding:36px 32px 24px;"><a href="${base}" target="_blank" style="text-decoration:none;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle" style="padding-right:10px;"><img src="${base}/email/icon-144.png" width="34" height="34" alt="Tikèm" style="display:block;width:34px;height:34px;border-radius:8px;border:0;"></td>
<td valign="middle" style="font-family:${FONT.serif};font-style:italic;font-size:26px;line-height:1;color:${C.text};">tikèm</td>
</tr></table></a></td></tr>`
  const foot = `<tr><td class="tk-pad" align="center" style="padding:40px 32px 44px;font-family:${FONT.sans};font-size:12px;line-height:1.8;color:${C.text3};">
Tikèm · tikè pou evènman an Ayiti ak nan dyaspora a<br>
<a href="${base}" target="_blank" style="color:${C.text3};">tikem.co</a> · <a href="https://www.instagram.com/tikem.co/" target="_blank" style="color:${C.text3};">@tikem.co</a><br>
Si ou pa vle resevwa lòt mesaj, jis reponn "non mèsi".
</td></tr>`

  return `<!DOCTYPE html><html lang="ht"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
<title>Tikèm</title>
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=Instrument+Serif:ital@1&display=swap" rel="stylesheet">
<style>body{margin:0;padding:0;background:${C.canvas}}@media (max-width:620px){.tk-col{width:100%!important}.tk-pad{padding-left:18px!important;padding-right:18px!important}.tk-cell{display:block!important;width:100%!important;padding:0 0 10px 0!important}}</style></head>
<body style="margin:0;padding:0;background:${C.canvas};">
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${C.canvas};">10%, MonCash ladan l. Done kliyan ou an sekirite, pòt la mache, epi nou mete evènman ou an liy gratis.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.canvas}" style="background:${C.canvas};"><tr><td align="center">
<table role="presentation" class="tk-col" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.canvas}" style="width:600px;max-width:600px;background:${C.canvas};">
${head}${body}${foot}
</table></td></tr></table></body></html>`
}

/**
 * Phase-2 "discovery" variant, for the ~940 PAM Event accounts that never ran an
 * event: most are attendees or aspiring organizers, so this leads with the app
 * (find and buy tickets) and only softly mentions hosting. No specific event is
 * named, so it fits anyone. Same look as organizerOutreachHtml.
 */
export function discoveryOutreachHtml(name: string): string {
  const fill = (rows: string, pad = '22px 22px') =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.surface}" style="background:${C.surface};border-radius:4px;border-collapse:separate;"><tr><td style="padding:${pad};">${rows}</td></tr></table>`

  const tile = (head: string, body: string) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.surface}" style="background:${C.surface};border-radius:4px;border-collapse:separate;"><tr><td style="padding:18px 18px 20px;" valign="top">
<div style="font-family:${FONT.sans};font-size:15px;font-weight:800;line-height:1.3;color:${C.text};">${esc(head)}</div>
<div style="margin-top:6px;font-family:${FONT.sans};font-size:13px;line-height:1.5;color:${C.text2};">${esc(body)}</div>
</td></tr></table>`

  const grid = (cells: string[]) => {
    const rows: string[] = []
    for (let i = 0; i < cells.length; i += 2) {
      rows.push(`<tr>
<td class="tk-cell" width="50%" valign="top" style="padding:0 5px 10px 0;">${cells[i]}</td>
<td class="tk-cell" width="50%" valign="top" style="padding:0 0 10px 5px;">${cells[i + 1] || ''}</td></tr>`)
    }
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.join('')}</table>`
  }

  const hero = `<a href="${base}" target="_blank" style="text-decoration:none;"><img src="${base}/email/organizer-hero.jpg" width="536" alt="Tikèm" style="display:block;width:536px;max-width:100%;height:auto;border-radius:4px;border:0;"></a>`

  const signature = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="top">
<div style="font-family:${FONT.serif};font-style:italic;font-size:26px;line-height:1.1;color:${C.text};">Fredler Pierre-Louis</div>
<div style="margin-top:6px;font-family:${FONT.sans};font-size:14px;line-height:1.6;color:${C.text2};">Tikèm · <a href="${base}" target="_blank" style="color:${C.text2};text-decoration:none;">tikem.co</a><br>
WhatsApp: <a href="${WHATSAPP}" target="_blank" style="color:${C.text};font-weight:700;text-decoration:none;">+1 754 276 8676</a></div>
</td></tr></table>`

  const blocks = [
    hero,
    gap(30),
    title(`Bonjou ${name},`, 36),
    gap(16),
    paragraphHtml(
      `Tikèm se kote pou <span style="color:${C.text};font-weight:700;">jwenn, achte ak viv</span> evènman an Ayiti ak nan dyaspora a. Konsè, fèt, konferans, fòmasyon, tout bagay yon sèl kote.`
    ),
    gap(18),
    serifHeading('poukisa Tikèm'),
    grid([
      tile('Jwenn sa k ap pase', 'Tout evènman yo, pa vil ak pa dat, nan men w.'),
      tile('Achte fasil', 'MonCash oswa kat. Tikè a antre nan Apple ak Google Wallet.'),
      tile('Tikè ki pa pèdi', 'QR pwoteje, nan telefòn ou, menm san entènèt.'),
      tile('Kreyòl, Fransè, Anglè', 'Sou sit la ak sou aplikasyon an.'),
    ]),
    gap(30),
    fill(
      `<div style="font-family:${FONT.sans};font-size:20px;font-weight:800;line-height:1.3;color:${C.text};">Telechaje Tikèm, jwenn pwochen sòti w.</div>
<div style="margin:8px 0 20px;font-family:${FONT.sans};font-size:15px;line-height:1.6;color:${C.text2};">Gratis. Kreye kont ou an de minit epi kòmanse dekouvri.</div>
${button('Telechaje aplikasyon an', `${base}/download`)}
<div style="height:10px;line-height:10px;font-size:1px;">&nbsp;</div>
${button('Dekouvri evènman yo', base, 'secondary')}`,
      '26px 24px'
    ),
    gap(30),
    serifHeading('ou menm, ou fè evènman?'),
    fill(
      `<div style="font-family:${FONT.sans};font-size:15px;line-height:1.65;color:${C.text2};">Si w vle vann tikè pou pwòp evènman w, li fasil sou Tikèm: <span style="color:${C.text};font-weight:700;">10% tou konpri, MonCash ladan l</span>, done kliyan w an sekirite, epi pòt la mache menm san entènèt. Reponn imèl sa a, n ap mete w kanpe.</div>`
    ),
    gap(34),
    paragraphHtml(
      `<a href="${base}/decks/Tikem-oganizate-Ayiti.pdf" target="_blank" style="color:${C.text};font-weight:700;text-decoration:underline;text-underline-offset:3px;">Gade prezantasyon an</a>. Si ou pito pale, ekri m sou WhatsApp.`
    ),
    gap(6),
    signature,
  ]

  const body = blocks.map((b) => `<tr><td class="tk-pad" style="padding:0 32px;">${b}</td></tr>`).join('')
  const head = `<tr><td class="tk-pad" style="padding:36px 32px 24px;"><a href="${base}" target="_blank" style="text-decoration:none;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle" style="padding-right:10px;"><img src="${base}/email/icon-144.png" width="34" height="34" alt="Tikèm" style="display:block;width:34px;height:34px;border-radius:8px;border:0;"></td>
<td valign="middle" style="font-family:${FONT.serif};font-style:italic;font-size:26px;line-height:1;color:${C.text};">tikèm</td>
</tr></table></a></td></tr>`
  const foot = `<tr><td class="tk-pad" align="center" style="padding:40px 32px 44px;font-family:${FONT.sans};font-size:12px;line-height:1.8;color:${C.text3};">
Tikèm · tikè pou evènman an Ayiti ak nan dyaspora a<br>
<a href="${base}" target="_blank" style="color:${C.text3};">tikem.co</a> · <a href="https://www.instagram.com/tikem.co/" target="_blank" style="color:${C.text3};">@tikem.co</a><br>
Si ou pa vle resevwa lòt mesaj, jis reponn "non mèsi".
</td></tr>`

  return `<!DOCTYPE html><html lang="ht"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark">
<title>Tikèm</title>
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=Instrument+Serif:ital@1&display=swap" rel="stylesheet">
<style>body{margin:0;padding:0;background:${C.canvas}}@media (max-width:620px){.tk-col{width:100%!important}.tk-pad{padding-left:18px!important;padding-right:18px!important}.tk-cell{display:block!important;width:100%!important;padding:0 0 10px 0!important}}</style></head>
<body style="margin:0;padding:0;background:${C.canvas};">
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${C.canvas};">Jwenn, achte ak viv evènman an Ayiti. Telechaje Tikèm, gratis.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.canvas}" style="background:${C.canvas};"><tr><td align="center">
<table role="presentation" class="tk-col" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.canvas}" style="width:600px;max-width:600px;background:${C.canvas};">
${head}${body}${foot}
</table></td></tr></table></body></html>`
}

if (require.main === module) {
  const args = process.argv.slice(2)
  if (args[0] === '--discovery') {
    const [, out = 'discovery-outreach.html', name = '{NON}'] = args
    writeFileSync(out, discoveryOutreachHtml(name))
    console.log(out)
  } else {
    const [out = 'organizer-outreach.html', name = '{NON}', event = '{EVENMAN}', recent = 'yes'] = args
    writeFileSync(out, organizerOutreachHtml(name, event, recent !== 'no'))
    console.log(out)
  }
}
