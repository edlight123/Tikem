// Builds one organizer sales deck per market (1080x1350 pages), rendered to PDF by Chrome.
import { readFileSync, writeFileSync } from 'node:fs'

const baseStyle = readFileSync('base.css.html', 'utf8').replace('</style>', `
.bleed:after{background:linear-gradient(180deg,rgba(0,0,0,.6) 0%,rgba(0,0,0,.05) 18%,rgba(0,0,0,.3) 40%,rgba(0,0,0,.88) 58%,#000 78%)}
.price{margin-top:44px;background:var(--surface);border-radius:32px;padding:48px 52px}
.price .big{font-size:132px;line-height:.95;font-weight:800;letter-spacing:-4px}
.price .big em{font-style:normal;color:var(--teal)}
.price p{font-size:28px;line-height:1.45;color:var(--text2);margin:18px 0 0}
.example{margin-top:18px;display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.example div{background:var(--surface);border-radius:24px;padding:26px 28px}
.example small{display:block;font-size:16px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:var(--text3)}
.example b{display:block;font-size:40px;font-weight:800;margin-top:8px;letter-spacing:-1px}
.example span{display:block;font-size:20px;color:var(--text2);margin-top:4px}
table.cmp{table-layout:fixed;width:100%;border-collapse:separate;border-spacing:0 12px;margin-top:34px}
table.cmp th{font-size:16px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:var(--text3);text-align:right;padding:0 20px}
table.cmp th:first-child{text-align:left;width:40%}
table.cmp td{background:var(--surface);font-size:28px;font-weight:700;text-align:right;padding:24px 20px;white-space:nowrap}
table.cmp td:first-child{width:40%;text-align:left;border-radius:22px 0 0 22px;white-space:normal}
table.cmp td:last-child{border-radius:0 22px 22px 0}
table.cmp td small{display:block;font-size:18px;font-weight:500;color:var(--text3);margin-top:6px;line-height:1.35}
table.cmp td.na{font-size:22px;font-weight:600;color:var(--text3)}
table.cmp tr.us td{background:#0F2E2A}
table.cmp tr.us td:first-child{box-shadow:inset 6px 0 0 var(--teal)}
table.cmp tr.us td small{color:#7EE3D3}
.notes{font-size:18px;line-height:1.5;color:var(--text3);margin-top:22px}
.points{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:22px}
.points div{background:var(--surface);border-radius:24px;padding:26px 30px;font-size:22px;line-height:1.45;color:var(--text2)}
.points b{display:block;color:var(--text);font-size:26px;margin-bottom:4px}
</style>`)

const top = (pg, label) => `<div class="top"><div class="brand"><img src="icon.png" alt=""><span>tik<em>è</em>m</span></div>${label ? `<div class="status">${label}</div>` : `<div class="pg">${pg}</div>`}</div>`

const tiles = (list) => `<div class="grid">${list.map(([s, t, p]) => `<div class="tile"><small>${s}</small><strong>${t}</strong><p>${p}</p></div>`).join('')}</div>`
const items = (list) => `<div class="list">${list.map(([t, s]) => `<div class="item"><b>${t}</b><span>${s}</span></div>`).join('')}</div>`

function table(cols, rows) {
  const head = `<tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>`
  const body = rows.map((r) => `<tr class="${r.us ? 'us' : ''}"><td>${r.name}${r.sub ? `<small>${r.sub}</small>` : ''}</td>${r.cells.map((c) => (c.startsWith('~') || /[a-zà-ÿ]{4,}/i.test(c) && !/\d/.test(c) ? `<td class="na">${c.replace(/^~/, '')}</td>` : `<td>${c}</td>`)).join('')}</tr>`).join('')
  return `<table class="cmp">${head}${body}</table>`
}

function deck(m) {
  return `<!doctype html><html lang="${m.lang}"><head><meta charset="utf-8"><title>${m.title}</title>
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700;800&family=Instrument+Serif:ital@1&family=JetBrains+Mono:wght@500&display=block" rel="stylesheet">
${baseStyle}</head><body>

<section class="page">
  <div class="bleed"><img src="${m.cover.img}" alt=""></div>
  ${top(null, m.cover.label)}
  <div class="bottom" style="padding-bottom:48px">
    <p class="eyebrow">${m.cover.eyebrow}</p>
    <h1 style="font-size:${m.cover.size || 96}px">${m.cover.h1}</h1>
    <p class="lede">${m.cover.lede}</p>
  </div>
  <div class="foot" style="margin-top:0;position:relative;z-index:2;padding-bottom:64px;color:rgba(255,255,255,.55)"><span class="mono">tikem.co</span><span>${m.langs}</span></div>
</section>

<section class="page">
  ${top('01')}
  <div class="pad" style="margin-top:200px">
    <p class="eyebrow" style="color:var(--text2)">${m.why.eyebrow}</p>
    <h2>${m.why.h2}</h2>
    ${tiles(m.why.tiles)}
  </div>
</section>

${m.feature.map((f, i) => `
<section class="page">
  <div class="band"><img src="${f.img}" alt="">
    <div class="head"><p class="eyebrow">${f.eyebrow}</p><h2>${f.h2}</h2></div>
  </div>
  ${top(String(i + 2).padStart(2, '0'))}
  <div class="pad"><div class="split">${items(f.items)}<div class="shot"><img src="${f.shot}" alt=""></div></div></div>
</section>`).join('')}

<section class="page">
  ${top(String(m.feature.length + 2).padStart(2, '0'))}
  <div class="pad" style="margin-top:190px">
    <p class="eyebrow" style="color:var(--text2)">${m.price.eyebrow}</p>
    <h2>${m.price.h2}</h2>
    <div class="price"><div class="big">${m.price.big}</div><p>${m.price.sub}</p></div>
    <div class="example">${m.price.examples.map(([s, b, t]) => `<div><small>${s}</small><b>${b}</b><span>${t}</span></div>`).join('')}</div>
    <div class="points">${m.price.points.map(([b, t]) => `<div><b>${b}</b>${t}</div>`).join('')}</div>
  </div>
</section>

<section class="page">
  ${top(String(m.feature.length + 3).padStart(2, '0'))}
  <div class="pad" style="margin-top:190px">
    <p class="eyebrow" style="color:var(--text2)">${m.cmp.eyebrow}</p>
    <h2>${m.cmp.h2}</h2>
    ${table(m.cmp.cols, m.cmp.rows)}
    <p class="notes">${m.cmp.notes}</p>
  </div>
</section>

<section class="page">
  <div class="bleed"><img src="${m.cta.img}" alt=""></div>
  ${top(String(m.feature.length + 4).padStart(2, '0'))}
  <div class="bottom" style="padding-bottom:48px">
    <p class="eyebrow">${m.cta.eyebrow}</p>
    <h2>${m.cta.h2}</h2>
    <p class="lede">${m.cta.lede}</p>
    <div class="cta">${m.cta.button}</div>
    <div class="contact"><b>${m.cta.team}</b> · support@tikem.co<br><span class="mono" style="font-size:24px">tikem.co</span> · ${m.cta.extra}</div>
  </div>
</section>
</body></html>`
}

// ---------- markets ----------
const markets = {}

markets['fr'] = {
  file: 'Tikem-organisateurs-France', lang: 'fr', title: 'Tikèm — organisateurs en France', langs: 'Français · Kreyòl · English',
  cover: { img: 'konpa.jpg', label: 'Organisateurs · France', eyebrow: 'la billetterie de la diaspora',
    h1: 'Kompa, zouk, afro&nbsp;: vendez vos billets au juste prix.',
    lede: 'Billets QR, équipe, promoteurs, contrôle à l’entrée et versements, au même endroit. 2,5&nbsp;% + 0,50&nbsp;€ par billet, paiement par carte inclus.' },
  why: { eyebrow: 'pourquoi Tikèm', h2: 'Tout ce qu’il faut pour remplir la salle.', tiles: [
    ['Prix', 'Un tarif publié, sans devis', '2,5&nbsp;% + 0,50&nbsp;€ par billet. Pas de grille cachée, pas d’abonnement.'],
    ['Versement', 'Votre argent 72&nbsp;h après', 'Disponible 72&nbsp;h après la fin de l’événement, puis 24&nbsp;h quand vous êtes établi.'],
    ['Acheteurs', 'Payer en 30 secondes', 'Carte bancaire, sans créer de compte. Billet QR par e-mail.'],
    ['Langues', 'Français, kreyòl, anglais', 'Votre public reçoit son billet dans sa langue.'],
    ['Promoteurs', 'Vous savez qui vend', 'Un lien par promoteur, avec ses ventes en direct.'],
    ['Équipe', 'Chacun son rôle', 'Associés, managers, staff de porte : chacun voit ce qu’il doit voir.'],
  ] },
  feature: [
    { img: 'kanaval.jpg', eyebrow: 'créer et vendre', h2: 'Votre événement, comme vous l’imaginez.', shot: '02-event-detail.jpg', items: [
      ['Autant de tarifs que vous voulez', 'Prévente, normal, VIP : prix, quantité et dates de vente pour chacun.'],
      ['Codes promo et invitations', 'Réductions pour vos partenaires, billets offerts en deux clics.'],
      ['Liens de suivi', 'Instagram ou WhatsApp ? Vous savez d’où viennent vos ventes.'],
      ['Liste d’attente', 'Un tarif épuisé ? Vos fans s’inscrivent pour la suite.'],
    ] },
    { img: 'labadeenight.jpg', eyebrow: 'le jour J', h2: 'Une entrée qui avance vite.', shot: '08-organizer-event-tools.jpg', items: [
      ['Scan au téléphone', 'La caméra lit le QR. Un billet n’entre qu’une seule fois.'],
      ['Votre staff de porte', 'Invitez votre équipe : chacun scanne avec son propre téléphone.'],
      ['Liste d’invités', 'Cherchez un nom et faites entrer à la main.'],
      ['Les chiffres en direct', 'Entrées, billets vendus, recettes : tout, en temps réel.'],
    ] },
  ],
  price: { eyebrow: 'tarifs', h2: 'Simple et transparent.', big: '2,5&nbsp;% <em>+</em> 0,50&nbsp;€',
    sub: 'par billet vendu. Le paiement par carte est inclus : rien ne s’ajoute.',
    examples: [['Billet à 10 €', '0,75 €', 'de frais'], ['Billet à 20 €', '1,00 €', 'de frais'], ['Billet à 35 €', '1,38 €', 'de frais']],
    points: [
      ['Vous choisissez qui paie', 'Frais ajoutés pour l’acheteur, ou inclus dans votre prix. Événement par événement.'],
      ['Gratuit = gratuit', 'Aucun frais sur les billets gratuits et les RSVP. Aucun frais de création.'],
    ] },
  cmp: { eyebrow: 'comparatif', h2: 'Ce que coûte un billet, chez chacun.',
    cols: ['Plateforme', 'Billet 15 €', 'Billet 25 €', 'Versement'],
    rows: [
      { us: true, name: 'Tikèm', sub: '2,5 % + 0,50 €, paiement inclus', cells: ['0,88 €', '1,13 €', '72 h après'] },
      { name: 'Bizouk', sub: 'Grille tarifaire non publiée', cells: ['~sur devis', '~sur devis', '15 jours après¹'] },
      { name: 'Shotgun', sub: 'Frais acheteur 2,75 % (min. 0,30 €)² + commission organisateur non publiée', cells: ['0,41 € + comm.', '0,69 € + comm.', '~non publié'] },
    ],
    notes: '¹ Centre d’aide Bizouk : « dans les 15 jours suivant l’évènement ». ² Centre d’aide Shotgun, frais de service acheteur. Tarifs publics relevés en octobre 2026 ; ils peuvent changer, vérifiez auprès de chaque plateforme. Tikèm : versement 72 h après la fin de l’événement, 24 h pour les organisateurs établis.' },
  cta: { img: 'jacmel.jpg', eyebrow: 'sans risque', h2: 'Essayez Tikèm sur votre prochaine soirée.',
    lede: 'Envoyez-nous votre affiche, la date, le lieu et vos tarifs. On met votre page en ligne avec vous, gratuitement. Rien à payer d’avance, rien à fermer ailleurs.',
    button: 'Répondez à ce message pour commencer', team: 'Équipe Tikèm', extra: '@tikem.co' },
}

markets['us'] = {
  file: 'Tikem-organizers-USA', lang: 'en', title: 'Tikèm — organizers in the US', langs: 'English · Kreyòl · Français',
  cover: { img: 'kanavalchar.jpg', label: 'For organizers · Miami · New York', eyebrow: 'ticketing for the culture',
    h1: 'Sell out your next fete. Keep more of every ticket.',
    lede: 'Tickets, promoters, door and payouts in one place. 6% + $0.99 per ticket, card processing included.' },
  why: { eyebrow: 'why Tikèm', h2: 'Everything it takes to pack the room.', tiles: [
    ['Fees', 'Lower than Posh at every price', '6% + $0.99 per ticket, processing included. No subscription, no setup fee.'],
    ['Payouts', 'Paid 72 hours after the event', 'Then 24 hours once you’re established.'],
    ['Buyers', 'Checkout in 30 seconds', 'Card payment, no account needed. QR ticket by email.'],
    ['Languages', 'English, Kreyòl, French', 'Your crowd gets their ticket in their language.'],
    ['Promoters', 'Know who’s selling', 'One link per promoter, with live sales for each.'],
    ['Team', 'Everyone in their lane', 'Partners, managers, door staff: each sees only what they need.'],
  ] },
  feature: [
    { img: 'konpa.jpg', eyebrow: 'create and sell', h2: 'Your event, the way you picture it.', shot: '02-event-detail.jpg', items: [
      ['As many ticket tiers as you want', 'Early bird, GA, VIP: price, quantity and sale dates for each.'],
      ['Promo codes and comps', 'Discounts for partners, free tickets in two taps.'],
      ['Tracking links', 'Instagram or WhatsApp? See exactly where sales come from.'],
      ['Waitlist', 'Tier sold out? Fans sign up for the next drop.'],
    ] },
    { img: 'labadeenight.jpg', eyebrow: 'day of', h2: 'A door that keeps moving.', shot: '08-organizer-event-tools.jpg', items: [
      ['Scan with your phone', 'The camera reads the QR. A ticket only gets in once.'],
      ['Your door team', 'Invite staff: each scans on their own phone.'],
      ['Guest list', 'Search a name and check them in by hand.'],
      ['Live numbers', 'Check-ins, tickets sold, revenue, in real time.'],
    ] },
  ],
  price: { eyebrow: 'pricing', h2: 'Simple and upfront.', big: '6% <em>+</em> $0.99',
    sub: 'per ticket sold. Card processing is included: nothing gets added on top.',
    examples: [['$20 ticket', '$2.19', 'in fees'], ['$40 ticket', '$3.39', 'in fees'], ['$75 ticket', '$5.49', 'in fees']],
    points: [
      ['You choose who pays', 'Pass the fee to buyers or absorb it into your price, event by event.'],
      ['Free means free', 'No fees on free tickets and RSVPs. No fee to create an event.'],
    ] },
  cmp: { eyebrow: 'compare', h2: 'What one ticket costs, platform by platform.',
    cols: ['Platform', '$20 ticket', '$40 ticket', '$75 ticket'],
    rows: [
      { us: true, name: 'Tikèm', sub: '6% + $0.99, processing included', cells: ['$2.19', '$3.39', '$5.49'] },
      { name: 'Posh', sub: '10% + $0.99 per ticket¹', cells: ['$2.99', '$4.99', '$8.49'] },
      { name: 'Eventbrite', sub: '3.7% + $1.79 service + 2.9% processing²', cells: ['$3.18', '$4.52', '$6.87'] },
      { name: 'DICE', sub: 'About 10–13%, negotiated, no public rate card³', cells: ['$2.00–2.60', '$4.00–5.20', '$7.50–9.75'] },
    ],
    notes: '¹ Posh product page. ² Eventbrite US paid-ticket rates as widely published in 2026; processing applied to the order total. ³ DICE does not publish a US rate card; range from third-party 2026 estimates. Public rates checked October 2026 and subject to change. Confirm with each platform.' },
  cta: { img: 'jacmel.jpg', eyebrow: 'no risk', h2: 'Try Tikèm on your next event.',
    lede: 'Send us your flyer, date, venue and ticket prices. We’ll set up your page with you, free. Nothing to pay upfront, nothing to shut down elsewhere.',
    button: 'Reply to this message to get started', team: 'Team Tikèm', extra: '@tikem.co' },
}

markets['ca'] = {
  file: 'Tikem-organisateurs-Canada', lang: 'fr-CA', title: 'Tikèm — organisateurs au Canada', langs: 'Français · English · Kreyòl',
  cover: { img: 'lakou.jpg', label: 'Organisateurs · Montréal · Canada', eyebrow: 'la billetterie de la diaspora',
    h1: 'Vos soirées méritent une billetterie à votre image.',
    lede: 'Billets QR, équipe, promoteurs, contrôle à l’entrée et versements, au même endroit. 6&nbsp;% + 0,99&nbsp;$ par billet, paiement par carte inclus.' },
  why: { eyebrow: 'pourquoi Tikèm', h2: 'Tout ce qu’il faut pour remplir la salle.', tiles: [
    ['Frais', 'Moins cher qu’Eventbrite', '6&nbsp;% + 0,99&nbsp;$ par billet, paiement inclus. Pas d’abonnement.'],
    ['Versement', 'Votre argent 72&nbsp;h après', 'Disponible 72&nbsp;h après la fin de l’événement, puis 24&nbsp;h quand vous êtes établi.'],
    ['Acheteurs', 'Payer en 30 secondes', 'Carte de crédit ou de débit, sans créer de compte. Billet QR par courriel.'],
    ['Langues', 'Français, anglais, kreyòl', 'Votre public reçoit son billet dans sa langue.'],
    ['Promoteurs', 'Vous savez qui vend', 'Un lien par promoteur, avec ses ventes en direct.'],
    ['Équipe', 'Chacun son rôle', 'Associés, gestionnaires, personnel à la porte : chacun voit ce qu’il doit voir.'],
  ] },
  feature: [
    { img: 'kanaval.jpg', eyebrow: 'créer et vendre', h2: 'Votre événement, comme vous l’imaginez.', shot: '02-event-detail.jpg', items: [
      ['Autant de tarifs que vous voulez', 'Prévente, régulier, VIP : prix, quantité et dates de vente pour chacun.'],
      ['Codes promo et billets de faveur', 'Rabais pour vos partenaires, billets gratuits en deux clics.'],
      ['Liens de suivi', 'Instagram ou WhatsApp ? Vous savez d’où viennent vos ventes.'],
      ['Liste d’attente', 'Un tarif épuisé ? Vos fans s’inscrivent pour la suite.'],
    ] },
    { img: 'tontonnwel.jpg', eyebrow: 'le jour J', h2: 'Une entrée qui avance vite.', shot: '08-organizer-event-tools.jpg', items: [
      ['Scan au téléphone', 'La caméra lit le QR. Un billet n’entre qu’une seule fois.'],
      ['Votre équipe à la porte', 'Invitez votre personnel : chacun scanne avec son propre téléphone.'],
      ['Liste d’invités', 'Cherchez un nom et faites entrer à la main.'],
      ['Les chiffres en direct', 'Entrées, billets vendus, revenus : tout, en temps réel.'],
    ] },
  ],
  price: { eyebrow: 'tarifs', h2: 'Simple et transparent.', big: '6&nbsp;% <em>+</em> 0,99&nbsp;$',
    sub: 'par billet vendu. Le paiement par carte est inclus : rien ne s’ajoute.',
    examples: [['Billet à 20 $', '2,19 $', 'de frais'], ['Billet à 40 $', '3,39 $', 'de frais'], ['Billet à 75 $', '5,49 $', 'de frais']],
    points: [
      ['Vous choisissez qui paie', 'Frais payés par l’acheteur ou inclus dans votre prix, événement par événement.'],
      ['Gratuit = gratuit', 'Aucuns frais sur les billets gratuits et les RSVP. Aucuns frais de création.'],
    ] },
  cmp: { eyebrow: 'comparatif', h2: 'Ce que coûte un billet, chez chacun.',
    cols: ['Plateforme', 'Billet 20 $', 'Billet 40 $', 'Billet 75 $'],
    rows: [
      { us: true, name: 'Tikèm', sub: '6 % + 0,99 $, paiement inclus', cells: ['2,19 $', '3,39 $', '5,49 $'] },
      { name: 'Eventbrite', sub: '3,5 % + 1,29 $ de service + 2,9 % de traitement¹', cells: ['2,63 $', '3,93 $', '6,20 $'] },
      { name: 'DICE', sub: 'Environ 10 à 13 %, négocié, pas de grille publique²', cells: ['2,00–2,60 $', '4,00–5,20 $', '7,50–9,75 $'] },
    ],
    notes: 'Montants en dollars canadiens. ¹ Tarif canadien publié dans le centre d’aide Eventbrite ; traitement appliqué au total de la commande. ² DICE ne publie pas de grille ; fourchette tirée d’estimations tierces de 2026. Tarifs relevés en octobre 2026 ; ils peuvent changer, vérifiez auprès de chaque plateforme.' },
  cta: { img: 'jacmel.jpg', eyebrow: 'sans risque', h2: 'Essayez Tikèm pour votre prochain événement.',
    lede: 'Envoyez-nous votre affiche, la date, la salle et vos tarifs. On met votre page en ligne avec vous, gratuitement. Rien à payer d’avance, rien à fermer ailleurs.',
    button: 'Répondez à ce message pour commencer', team: 'Équipe Tikèm', extra: '@tikem.co' },
}

markets['ht'] = {
  file: 'Tikem-oganizate-Ayiti-pri', lang: 'ht', title: 'Tikèm — pri pou òganizatè an Ayiti', langs: 'Kreyòl · Français · English',
  cover: { img: 'kanaval.jpg', label: 'Pou òganizatè · Ayiti', eyebrow: 'platfòm tikè ayisyen an',
    h1: 'MonCash ladan&nbsp;l. Pa gen sipriz.',
    lede: '10% sou chak tikè ou vann, frè MonCash yo deja ladan l. Moun peye an goud, ak telefòn yo, an kèk segonn.' },
  why: { eyebrow: 'poukisa Tikèm', h2: 'Fèt pou Ayiti, pa adapte apre.', tiles: [
    ['MonCash', 'Achtè peye an goud', 'Ak telefòn yo, san kat, san kont labank.'],
    ['Pri', 'Yon sèl chif : 10%', 'Frè MonCash yo ladan l. Pa gen frè fiks sou chak tikè.'],
    ['Tikè', 'QR kòd pa imèl', 'Nan lang achtè a : Kreyòl, Fransè oswa Anglè.'],
    ['Pòtay', 'Eskane ak telefòn ou', 'Yon tikè pa ka antre de fwa. Ekip ou eskane ak pwòp telefòn pa yo.'],
    ['Pwomotè', 'Ou konnen kiyès ki vann', 'Chak pwomotè gen pwòp lyen pa l.'],
    ['Kòb ou', 'Retire sou MonCash', 'Oswa sou kont labank ou. Verifikasyon yon sèl fwa.'],
  ] },
  feature: [
    { img: 'rara.jpg', eyebrow: 'vann plis', h2: 'Zouti pou fè moun vini.', shot: '08-organizer-event-tools.jpg', items: [
      ['Plizyè kalite tikè', 'Early bird, jeneral, VIP : pri ak kantite pou chak.'],
      ['Kòd pwomo ak tikè gratis', 'Rabè pou patnè ou yo, envitasyon an de klik.'],
      ['Lyen pou pwomotè', 'Ou wè konbyen tikè chak moun vann.'],
      ['Voye nouvèl', 'Yon mesaj rive bay tout moun ki gen tikè.'],
    ] },
  ],
  price: { eyebrow: 'pri', h2: 'Senp e klè.', big: '10<em>%</em>',
    sub: 'sou chak tikè ou vann. Frè MonCash yo deja ladan l : anyen pa ajoute sou li.',
    examples: [['Tikè 500 goud', '50 G', 'frè'], ['Tikè 1 000 goud', '100 G', 'frè'], ['Tikè 2 500 goud', '250 G', 'frè']],
    points: [
      ['Ou chwazi kiyès ki peye', 'Achtè a peye frè a, oswa li soti nan pri a. Pou chak evènman.'],
      ['Gratis se gratis', 'Pa gen frè sou tikè gratis ak RSVP. Pa gen frè pou kreye evènman.'],
    ] },
  cmp: { eyebrow: 'konparezon', h2: 'Konbyen yon tikè koute, sou chak platfòm.',
    cols: ['Platfòm', '500 G', '1 000 G', '2 500 G'],
    rows: [
      { us: true, name: 'Tikèm', sub: '10%, MonCash ladan l', cells: ['50 G', '100 G', '250 G'] },
      { name: 'PAM Event', sub: '2,5% + $1,49 pa tikè, + frè peman. MonCash ak kat¹', cells: ['208 G', '220 G', '258 G'] },
      { name: 'Posh', sub: '10% + $0,99 pa tikè. Kat sèlman, an dola²', cells: ['180 G', '230 G', '380 G'] },
      { name: 'Eventbrite', sub: '3,7% + $1,79 + 2,9%. Kat sèlman, an dola³', cells: ['267 G', '300 G', '399 G'] },
    ],
    notes: 'Kalkile ak $1 = 131 goud. ¹ pamevent.com/pricing : frè yo « pa enkli frè peman elektwonik », kidonk frè peman an (MonCash oswa kat) ajoute sou chif sa a. ² Paj pwodwi Posh. ³ Pri Eventbrite pou Etazini. Pri piblik yo tcheke an oktòb 2026 ; yo ka chanje.' },
  cta: { img: 'citadelle.jpg', eyebrow: 'san risk', h2: 'Eseye Tikèm pou pwochen evènman ou.',
    lede: 'Voye afich ou, dat la, kote a ak pri tikè yo ba nou. N ap mete paj ou an liy avè ou, gratis. Ou pa peye anyen davans.',
    button: 'Reponn mesaj sa a pou kòmanse', team: 'Ekip Tikèm', extra: 'Android sou Google Play · @tikem.co' },
}

for (const [k, m] of Object.entries(markets)) {
  writeFileSync(`${m.file}.html`, deck(m))
  console.log(m.file)
}
