/**
 * Holiday poster templates: a real photograph paired with a poster layout,
 * a colourway and a suggested title, for each occasion (lib/occasions).
 *
 * An organizer making a Kanaval bal or a Revèyon Nwèl gets a finished poster
 * in one tap: the composer's poster picker shows the occasion's templates
 * first ("For Nwèl"), drawn with the event's own title and date; the occasion
 * page shows them as a strip and its ideas open Create Event with one
 * applied; the flyer library leads with the season's photos.
 *
 * Served to the app through GET /api/posters/holidays (never copied into
 * mobile/), and drawn by the same pipeline as every poster template
 * (lib/posters/render, GET /api/posters/preview).
 *
 * PHOTOS. Real photographs only, never AI art. Every id below is an
 * images.unsplash.com photo (Unsplash License: free to use, credit not
 * required but kept so each picture traces back to its page). Each one was
 * fetched and looked at before it went in: it resolves, it shows what the
 * occasion is about, and it holds up behind type. plus.unsplash.com premium
 * ids look the same in search results but are blocked by our hosts, so none
 * are here. Fèt Gede and Vertières use candles, cemeteries at dusk, drums and
 * fortress cannons: nothing that reads as Halloween or caricature.
 *
 * Counts follow how much each occasion is celebrated with events (Kanaval and
 * Nwèl most, Vertières least); __tests__/holidayTemplates.test.ts pins them.
 */
import { ideaDate, type IsoDay, type OccasionIdea, type OccasionKey, type OccasionText } from './occasions'
import type { PhotoTreatment } from './posters/templates'

export interface HolidayTemplate {
  /** Stable id, saved on an event's poster_template as `holiday`. */
  id: string
  occasion: OccasionKey
  /** Unsplash photo id: the `photo-…` path segment on images.unsplash.com. */
  photo: string
  /** Who took it, and the Unsplash page it came from. */
  credit: { author: string; source: string }
  /** A layout id from lib/posters/templates TEMPLATES (always one that uses a photo). */
  layout: string
  /** Colourway 0–2 of that layout. */
  palette: 0 | 1 | 2
  /** How the photo is treated before the layout draws over it. */
  treatment: PhotoTreatment
  /** Suggested event title, natural in each language. */
  title: OccasionText
  /** One short line: the event's summary when the template starts an event. */
  subtitle: OccasionText
  /** The web composer's category (lib/filters/config CATEGORIES). */
  category: string
  /** The app composer's category (its CATEGORIES list). */
  appCategory: string
  /** Suggested start time, 24h. */
  time: string
}

type Row = [
  id: string,
  photo: string,
  author: string,
  slug: string,
  layout: string,
  palette: 0 | 1 | 2,
  treatment: PhotoTreatment,
  title: [ht: string, fr: string, en: string],
  subtitle: [ht: string, fr: string, en: string],
  category: string,
  appCategory: string,
  time: string,
]

const build = (occasion: OccasionKey, rows: Row[]): HolidayTemplate[] =>
  rows.map(([id, photo, author, slug, layout, palette, treatment, t, s, category, appCategory, time]) => ({
    id,
    occasion,
    photo,
    credit: { author, source: `https://unsplash.com/photos/${slug}` },
    layout,
    palette,
    treatment,
    title: { ht: t[0], fr: t[1], en: t[2] },
    subtitle: { ht: s[0], fr: s[1], en: s[2] },
    category,
    appCategory,
    time,
  }))

const FD = 'Food & Drink'

// prettier-ignore
const NWEL = build('nwel', [
  ['nwel-piano', '1732763327028-1babe08a88e4', 'Aaron Burden', 'zcNXGjcXLbs', 'serif-photo', 1, 'none', ['Nwèl nan Pyano', 'Noël au piano', 'Christmas at the Piano'], ['Yon swa kantik ak chandèl', 'Une soirée de chants à la bougie', 'An evening of carols by candlelight'], 'Concert', 'Music', '19:00'],
  ['nwel-reveyon', '1763463608728-6eeb317023d2', 'Dragon White Munthe', '9b1Jum6uw2g', 'magazine', 1, 'none', ['Revèyon Nwèl', 'Réveillon de Noël', 'Christmas Eve Réveillon'], ['Dine, mizik ak fanmi 24 desanm', 'Dîner, musique et famille le 24 décembre', 'Dinner, music and family on the 24th'], FD, FD, '20:00'],
  ['nwel-dine', '1768464706032-25121adbb459', 'Sobolev Maksim', 'Xg04RQGEhl0', 'giant-date', 1, 'darken', ['Dine Nwèl', 'Dîner de Noël', 'Christmas Dinner'], ['Yon tab pou tout fanmi an', 'Une table pour toute la famille', 'A table for the whole family'], FD, FD, '19:00'],
  ['nwel-bal', '1513297887119-d46091b24bfa', 'Kieran White', 'SBdmQcW8qag', 'stack-bar', 0, 'darken', ['Bal Nwèl', 'Bal de Noël', 'Christmas Bal'], ['Konpa jiska minwi', 'Konpa jusqu’à minuit', 'Konpa until midnight'], 'Party', 'Music', '21:00'],
  ['nwel-gala', '1514214460829-5f081763862a', 'Benjamin Wong', 'WoViiJWKLik', 'bill-center', 1, 'darken', ['Gala Nwèl', 'Gala de Noël', 'Christmas Gala'], ['Tenyen, dine ak dans', 'Tenue de soirée, dîner et danse', 'Black tie, dinner and dancing'], FD, FD, '19:30'],
  ['nwel-limye', '1482315845100-0b8e97fa27e0', 'Brigitte Tohm', 'sm5aAzR7FhI', 'outline-block', 2, 'mono', ['Limyè Nwèl', 'Lumières de Noël', 'Christmas Lights'], ['Yon swa deyò pou tout moun', 'Une soirée en plein air pour tous', 'An open-air night for everyone'], 'Festival', 'Community', '18:00'],
  ['nwel-timoun', '1701443936964-6afadbd4c2a9', 'Rae Galatas', '4iP5FGPchlM', 'tilt-pop', 0, 'darken', ['Fèt Nwèl Timoun', 'Fête de Noël des enfants', 'Kids’ Christmas Party'], ['Kado, jwèt ak Papa Nwèl', 'Cadeaux, jeux et Père Noël', 'Gifts, games and Santa'], 'Family', 'Community', '14:00'],
  ['nwel-kantik', '1543978571-a065f649f95c', 'Aaron Burden', '3PYAcPLceO4', 'serif-photo', 1, 'none', ['Kantik Nwèl', 'Chants de Noël', 'Christmas Carols'], ['Koral ak gospel an kreyòl ak fransè', 'Chorale et gospel en créole et en français', 'Choir and gospel in Kreyòl and French'], 'Concert', 'Music', '18:00'],
  ['nwel-konse', '1767216344243-3558c4028753', 'Alexa M', 'v-3VcsLY9cw', 'date-rail', 0, 'darken', ['Konsè Nwèl', 'Concert de Noël', 'Christmas Concert'], ['Kòd, pyano ak vwa', 'Cordes, piano et voix', 'Strings, piano and voices'], 'Concert', 'Music', '19:00'],
  ['nwel-mes', '1765723822010-8521fb35ead5', 'Jon Tyson', 'Hv7lwIWLaMM', 'serif-photo', 0, 'none', ['Mès Minwi', 'Messe de minuit', 'Midnight Mass'], ['Vèy Nwèl an kominote', 'La veillée de Noël en communauté', 'Christmas Eve together'], 'Other', 'Community', '23:00'],
  ['nwel-fanmi', '1712668055078-0dea0d2bfa11', 'Janay Peters', 'jp1b6envAIg', 'split-half', 0, 'none', ['Nwèl an Fanmi', 'Noël en famille', 'Family Christmas'], ['Manje, jwèt ak foto pou tout laj', 'Repas, jeux et photos pour tous les âges', 'Food, games and photos for all ages'], 'Family', 'Community', '15:00'],
  ['nwel-lakay', '1516013474378-d6498f0d1434', 'Gift Habeshaw', '44XRowmXF24', 'framed', 2, 'none', ['Nwèl Lakay', 'Noël au pays', 'Christmas Back Home'], ['Yon apremidi an fanmi', 'Un après-midi en famille', 'An afternoon with family'], 'Family', 'Community', '14:00'],
  ['nwel-biwo', '1699730164892-d7c433524ff3', 'OurWhisky Foundation', 'SdTKkcdz9mY', 'ticket-stub', 0, 'darken', ['Fèt Nwèl Biwo', 'Noël au bureau', 'Office Christmas Party'], ['Kokteyl, DJ ak bon moman', 'Cocktails, DJ et bons moments', 'Cocktails, a DJ and good times'], 'Party', 'Music', '19:00'],
  ['nwel-vey', '1640939521971-80c664159cce', 'Elliott B', '6e_Sf1c8qnY', 'serif-duotone', 1, 'duotone', ['Vèy Nwèl', 'Veillée de Noël', 'Christmas Eve Vigil'], ['Chandèl, lapriyè ak chante', 'Bougies, prière et chants', 'Candles, prayer and song'], 'Other', 'Community', '21:00'],
  ['nwel-mache', '1608132055071-aea9bf8e121e', 'Nick Fewings', 'Uz9w7XZnEkA', 'giant-date', 2, 'darken', ['Mache Nwèl', 'Marché de Noël', 'Christmas Market'], ['Atizan, kado ak manje lakay', 'Artisans, cadeaux et cuisine d’ici', 'Makers, gifts and home cooking'], 'Festival', 'Community', '10:00'],
  ['nwel-vil', '1641627498987-e0d1e1af3fc8', 'Klim Musalimov', 'KS6IYAwbZHM', 'magazine', 0, 'none', ['Nwèl nan Vil la', 'Noël en ville', 'Christmas in the City'], ['Limyè, mizik ak manje nan lari', 'Lumières, musique et cuisine de rue', 'Lights, music and street food'], 'Festival', 'Community', '18:00'],
  ['nwel-nwit', '1595424377378-a253ca4a7486', 'Bao Menglong', 'CfE4Rs3GDwk', 'serif-duotone', 0, 'duotone', ['Nwit Nwèl', 'Nuit de Noël', 'Christmas Night'], ['Yon sware elegant', 'Une soirée élégante', 'An elegant evening'], 'Party', 'Music', '21:00'],
  ['nwel-brunch', '1601118964938-228a89955311', 'krakenimages', '7BpuzmcxlHU', 'stack-bar', 2, 'darken', ['Brunch Nwèl', 'Brunch de Noël', 'Christmas Brunch'], ['25 desanm, an fanmi', 'Le 25 décembre, en famille', 'The 25th, with family'], FD, FD, '11:00'],
])

// prettier-ignore
const FEN_ANE = build('fen-ane', [
  ['fen-bal', '1784151100421-df2f1e19ee48', 'Alexander Gluschenko', 'ASo75459MbQ', 'serif-photo', 0, 'none', ['Bal Fen Ane', 'Bal du Nouvel An', 'New Year’s Eve Bal'], ['Danse jiska premye janvye', 'Danser jusqu’au 1er janvier', 'Dance into the first of January'], 'Party', 'Music', '21:00'],
  ['fen-minwi-konpa', '1608416026650-66b4e0c0c301', 'Myriam Zilles', 'L3FwT4qMeT0', 'giant-date', 1, 'darken', ['Minwi Konpa', 'Minuit Konpa', 'Midnight Konpa'], ['Konpa live jiska minwi', 'Konpa live jusqu’à minuit', 'Live konpa until midnight'], 'Party', 'Music', '22:00'],
  ['fen-konfeti', '1778208041283-0d9961ccb296', 'olaniyan oluwapelumi', '398LI1PKkck', 'tilt-pop', 1, 'darken', ['Fèt Konfeti', 'Soirée confettis', 'Confetti Night'], ['DJ, konfeti ak chanpay', 'DJ, confettis et champagne', 'DJ, confetti and champagne'], 'Party', 'Music', '22:00'],
  ['fen-gala', '1770135005669-0094609c733e', 'Desiray Green', '4OjvrEGyf6A', 'ticket-stub', 0, 'darken', ['Gala Fen Ane', 'Gala de fin d’année', 'Year-End Gala'], ['Dine, mizik live ak dans', 'Dîner, musique live et danse', 'Dinner, live music and dancing'], FD, FD, '20:00'],
  ['fen-reveyon', '1549194400-06e6874c2fd1', 'Kristian Løvstad', 'xplrF8WMitE', 'stack-bar', 1, 'darken', ['Revèyon 31', 'Réveillon du 31', 'New Year’s Eve'], ['Dife atifis a minwi', 'Feux d’artifice à minuit', 'Fireworks at midnight'], 'Party', 'Music', '22:00'],
  ['fen-chanpay', '1580657274234-7339717f4541', 'Alexander Naglestad', 'xzKtOI1Cnxo', 'bill-center', 1, 'darken', ['Chanpay a Minwi', 'Champagne à minuit', 'Champagne at Midnight'], ['Yon sware chik pou fèmen ane a', 'Une soirée chic pour finir l’année', 'A chic night to close the year'], 'Party', 'Music', '21:00'],
  ['fen-disko', '1763584926319-df13fed1238d', 'Sam Farallon', 'p4Gpvqa7xNQ', 'outline-block', 2, 'mono', ['Nwit Disko', 'Nuit disco', 'Disco Night'], ['Fini ane a sou pis la', 'Finir l’année sur la piste', 'End the year on the dance floor'], 'Party', 'Music', '22:00'],
  ['fen-bon-ane', '1767464949351-0fc591e59b78', 'T', '7zr0SeS2-Ws', 'serif-photo', 1, 'none', ['Bòn Ane', 'Bonne année', 'Happy New Year'], ['Yon dènye swa ansanm', 'Une dernière soirée ensemble', 'One last night together'], 'Party', 'Music', '21:00'],
  ['fen-twa', '1533219057257-4bb9ed5d2cc6', 'zuzanka galczynska', 'c5_eQi4rrjA', 'date-rail', 0, 'darken', ['Fen Ane sou Twa', 'Réveillon sur le toit', 'Rooftop New Year’s Eve'], ['Gade dife atifis yo ansanm', 'Regarder les feux d’artifice ensemble', 'Watch the fireworks together'], 'Party', 'Music', '22:00'],
  ['fen-dine', '1786367242321-756c9de33cd2', 'Nataliya Melnychuk', 'CL3KfV9S3QY', 'split-half', 0, 'none', ['Dine Revèyon', 'Dîner du réveillon', 'New Year’s Eve Dinner'], ['Senk plat ak yon tos a minwi', 'Cinq services et un toast à minuit', 'Five courses and a midnight toast'], FD, FD, '20:00'],
  ['fen-kontaj', '1500212802521-de7d7426f496', 'Paul Morley', '0ALhqKA4XTc', 'framed', 2, 'none', ['Kontaj Minwi', 'Compte à rebours', 'Countdown'], ['Kat DJ jiska maten', 'Quatre DJ jusqu’au matin', 'Four DJs until morning'], 'Party', 'Music', '22:00'],
  ['fen-fet', '1699730185428-d11054059c7f', 'OurWhisky Foundation', '4SKNDU85KOw', 'magazine', 1, 'none', ['Fèt Fen Ane', 'Fête du Nouvel An', 'New Year’s Party'], ['Zanmi, mizik ak konfeti', 'Amis, musique et confettis', 'Friends, music and confetti'], 'Party', 'Music', '21:00'],
  ['fen-denye-swa', '1514845505178-849cebf1a91d', 'Wout Vanacker', 'l4HBYkURqvE', 'serif-duotone', 2, 'duotone', ['Dènye Swa Ane a', 'Dernière nuit de l’année', 'Last Night of the Year'], ['Yon swa twoubadou ak zanmi', 'Une soirée twoubadou entre amis', 'A twoubadou night with friends'], 'Concert', 'Music', '20:00'],
  ['fen-lakay', '1492684223066-81342ee5ff30', 'Pablo Heimplatz', 'ZODcBkEohk8', 'giant-date', 2, 'darken', ['Fen Ane Lakay', 'Réveillon au pays', 'New Year’s Eve Back Home'], ['Ak soup joumou granmaten', 'Avec la soupe joumou à l’aube', 'With soup joumou at dawn'], 'Party', 'Music', '21:00'],
  ['fen-tos', '1776530899794-aaaa3b9dd1a1', 'Michel Stockman', 'IG1VKwKUY7E', 'serif-photo', 2, 'none', ['Yon Tos pou Ane a', 'Un toast à l’année', 'A Toast to the Year'], ['Lounge, jazz ak chanpay', 'Lounge, jazz et champagne', 'Lounge, jazz and champagne'], FD, FD, '20:00'],
  ['fen-konse', '1503803508152-7790ae3cb125', 'Sebastien Gabriel', 'tN7phR1HIzM', 'stack-bar', 0, 'darken', ['Konsè Fen Ane', 'Concert du Nouvel An', 'New Year’s Concert'], ['Gwoup live sou sèn', 'Des groupes live sur scène', 'Live bands on stage'], 'Concert', 'Music', '20:00'],
])

// prettier-ignore
const KANAVAL = build('kanaval', [
  ['kan-bal', '1639002549231-a895a33c4888', 'VENUS MAJOR', 'ysIIH0lApgs', 'serif-photo', 0, 'none', ['Bal Kanaval', 'Bal de Carnaval', 'Kanaval Bal'], ['Mereng kanaval ak konpa', 'Méringues de carnaval et konpa', 'Kanaval meringues and konpa'], 'Party', 'Music', '21:00'],
  ['kan-pre', '1742541922679-95cc82ba6c7d', 'Markus Kammermann', '7y3--tvFi0k', 'tilt-pop', 0, 'darken', ['Pre-Kanaval', 'Pré-carnaval', 'Pre-Kanaval'], ['Chofe kò w anvan jou gra yo', 'S’échauffer avant les jours gras', 'Warm up before the fat days'], 'Party', 'Music', '21:00'],
  ['kan-defile', '1785011197291-8bb73bb8a02e', 'Pierre Goiffon', 'd975a5zwCMs', 'stack-bar', 2, 'darken', ['Defile Kanaval', 'Défilé du Carnaval', 'Kanaval Parade'], ['Cha, bann ak mizik nan lari', 'Chars, bandes et musique dans la rue', 'Floats, bands and music in the street'], 'Festival', 'Music', '13:00'],
  ['kan-maske', '1778088167513-1daa051c8b30', 'Iryna Limborska', 'jDJMOwTCrtY', 'magazine', 1, 'none', ['Bal Maske', 'Bal masqué', 'Masked Ball'], ['Mask obligatwa', 'Masque obligatoire', 'Masks required'], 'Party', 'Music', '21:00'],
  ['kan-lendi-gra', '1785060219469-caeb999665b5', 'Pierre Goiffon', 'kt91mUMxkzc', 'giant-date', 1, 'darken', ['Lendi Gra', 'Lundi gras', 'Lendi Gra'], ['Cha, DJ ak tout foul la', 'Chars, DJ et toute la foule', 'Floats, DJs and the whole crowd'], 'Festival', 'Music', '14:00'],
  ['kan-madi-gra', '1785060599263-1de2f4168d2d', 'Pierre Goiffon', 'gATFjKcw60M', 'serif-duotone', 1, 'duotone', ['Madi Gra', 'Mardi gras', 'Madi Gra'], ['Dènye jou kanaval la', 'Le dernier jour du carnaval', 'The last day of Kanaval'], 'Festival', 'Music', '14:00'],
  ['kan-dimanch-gra', '1785011197323-89014318e748', 'Pierre Goiffon', 'F-8HSQ8EYyU', 'date-rail', 2, 'darken', ['Dimanch Gra', 'Dimanche gras', 'Dimanch Gra'], ['Premye jou gra a nan lari', 'Le premier jour gras dans la rue', 'The first fat day in the street'], 'Festival', 'Music', '14:00'],
  ['kan-atelye-mask', '1563183365-b4428efb958a', 'Nacho Díaz Latorre', 'Qm_2LZRwBSs', 'outline-block', 2, 'mono', ['Atelye Mask Kanaval', 'Atelier de masques', 'Kanaval Mask Workshop'], ['Papye mache tankou Jakmèl', 'Papier mâché façon Jacmel', 'Jacmel-style papier-mâché'], 'Workshop', 'Arts', '10:00'],
  ['kan-lakay', '1680442302920-6b5703538aa0', 'VENUS MAJOR', 'Nwjc2v9s2wk', 'split-half', 0, 'none', ['Kanaval Lakay', 'Carnaval au pays', 'Kanaval Back Home'], ['Kilti, koulè ak mizik rasin', 'Culture, couleurs et musique racine', 'Culture, colour and roots music'], 'Festival', 'Music', '15:00'],
  ['kan-ren', '1574724713425-fee7e2eacf84', 'Ugur Arpaci', 'U18V0ToioFU', 'bill-center', 0, 'darken', ['Rèn Kanaval', 'Reine du Carnaval', 'Kanaval Queen'], ['Konkou kostim ak defile', 'Concours de costumes et défilé', 'Costume contest and parade'], 'Festival', 'Arts', '18:00'],
  ['kan-nwit', '1785060219449-e457875413d1', 'Pierre Goiffon', 'aPJvLDiVZtc', 'serif-photo', 1, 'none', ['Nwit Kanaval', 'Nuit du Carnaval', 'Kanaval Night'], ['Cha limyè ak foul la', 'Chars lumineux et la foule', 'Lit floats and the crowd'], 'Festival', 'Music', '19:00'],
  ['kan-apre-defile', '1785060599218-a5fb06bfb9ec', 'Pierre Goiffon', 'Z2JQwncZGWQ', 'magazine', 2, 'none', ['Apre Defile a', 'Après le défilé', 'After the Parade'], ['DJ jiska maten', 'DJ jusqu’au matin', 'DJs until morning'], 'Party', 'Music', '23:00'],
  ['kan-dyaspora', '1642076195906-2804dead9a7e', 'Holger Woizick', '78z3qaiYN8I', 'ticket-stub', 0, 'darken', ['Kanaval Dyaspora', 'Carnaval de la diaspora', 'Diaspora Kanaval'], ['Miami, Nouyòk, Monreyal', 'Miami, New York, Montréal', 'Miami, New York, Montréal'], 'Festival', 'Community', '15:00'],
  ['kan-plaj', '1759807966328-7379fadd1fd6', 'Johnathan Kaufman', 'Nz0RsPla1ps', 'giant-date', 0, 'darken', ['Kanaval sou Plaj', 'Carnaval à la plage', 'Beach Kanaval'], ['Mizik, solèy ak kostim', 'Musique, soleil et costumes', 'Music, sun and costumes'], 'Festival', 'Music', '13:00'],
  ['kan-swa-mask', '1598868116817-febbd119e53a', 'Hush Naidoo Jade Photography', 'w4sdEk6P44c', 'split-half', 0, 'none', ['Swa Mask', 'Soirée masquée', 'Masquerade Night'], ['Kokteyl ak konpa', 'Cocktails et konpa', 'Cocktails and konpa'], 'Party', 'Music', '21:00'],
  ['kan-bann', '1659700556679-6cb287a5c883', 'VENUS MAJOR', 'mEbZQxkV80Y', 'stack-bar', 1, 'darken', ['Mereng Kanaval', 'Méringues du Carnaval', 'Kanaval Meringues'], ['Gwoup yo prezante mereng yo', 'Les groupes présentent leurs méringues', 'The bands debut their meringues'], 'Concert', 'Music', '20:00'],
  ['kan-gwo-sen', '1785060598584-c042c13b3385', 'Pierre Goiffon', 'jIZZSkW3Kdo', 'date-rail', 1, 'darken', ['Gwo Sèn Kanaval', 'Grande scène du Carnaval', 'Kanaval Main Stage'], ['Mizik live tout lannwit', 'Musique live toute la nuit', 'Live music all night'], 'Concert', 'Music', '19:00'],
  ['kan-kostim', '1646385759526-e3ca6a5380a7', 'Holger Woizick', 'PIquPw1YDQk', 'tilt-pop', 1, 'darken', ['Fèt Kostim', 'Soirée costumée', 'Costume Party'], ['Vin abiye pou kanaval', 'Venez costumés pour le carnaval', 'Come dressed for Kanaval'], 'Party', 'Music', '21:00'],
])

// prettier-ignore
const ENDEPANDANS = build('fet-endepandans', [
  ['end-soup-brunch', '1613844237701-8f3664fc2eff', 'Max Griss', 'cToNEm70cvE', 'serif-photo', 1, 'none', ['Soup Joumou Brunch', 'Brunch soupe joumou', 'Soup Joumou Brunch'], ['Premye janvye, an fanmi', 'Le 1er janvier, en famille', 'The first of January, with family'], FD, FD, '10:00'],
  ['end-soup-maten', '1695459003933-4a1b59009355', 'Monika Borys', '81B2H64Ff54', 'magazine', 0, 'none', ['Maten Soup Joumou', 'Matinée soupe joumou', 'Soup Joumou Morning'], ['Yon bòl pou chak moun', 'Un bol pour chacun', 'A bowl for everyone'], FD, FD, '09:00'],
  ['end-jou-de-lan', '1603208785984-cdf985beca7a', 'Hanna Balan', '5HjFnUaCjho', 'giant-date', 1, 'darken', ['Jou de Lan', 'Jour de l’An', 'New Year’s Day'], ['Soup joumou ak lajwa', 'Soupe joumou et joie', 'Soup joumou and joy'], FD, FD, '11:00'],
  ['end-fet', '1529641484336-ef35148bab06', 'Ruvim Noga', 'pazM9TQJ2Ck', 'serif-duotone', 2, 'duotone', ['Fèt Endepandans', 'Fête de l’Indépendance', 'Independence Day'], ['Premye janvye 1804, nou sonje', '1er janvier 1804, on se souvient', '1 January 1804, remembered'], 'Festival', 'Community', '16:00'],
  ['end-konse', '1527091736853-64ca6a9b64d9', 'Bailey Torres', '9-Mt_kNlj9Y', 'bill-center', 0, 'darken', ['Konsè Endepandans', 'Concert de l’Indépendance', 'Independence Concert'], ['Mizik rasin ak konpa', 'Musique racine et konpa', 'Roots music and konpa'], 'Concert', 'Music', '19:00'],
  ['end-bal', '1498931299472-f7a63a5a1cfa', 'Ray Hennessy', 'gdTxVSAE5sk', 'stack-bar', 2, 'darken', ['Bal Endepandans', 'Bal de l’Indépendance', 'Independence Bal'], ['Antre nan ane a kòm pèp lib', 'Entrer dans l’année en peuple libre', 'Into the year as a free people'], 'Party', 'Music', '21:00'],
  ['end-istwa', '1786286672773-c1da4ca6ec0b', 'Meg von Haartman', 'Dl0Ksz2DA3w', 'magazine', 1, 'none', ['Istwa 1804', 'L’histoire de 1804', 'The Story of 1804'], ['Yon swa istwa ak powèm', 'Une soirée d’histoire et de poésie', 'An evening of history and poetry'], 'Conference', 'Education', '18:00'],
  ['end-okap', '1603839957368-33fc4df9943e', 'Patrice S Dorsainville', 'HlseIzr_6fI', 'date-rail', 1, 'darken', ['Endepandans Okap', 'L’Indépendance au Cap', 'Independence in Okap'], ['Yon jounen nan vil istorik la', 'Une journée dans la ville historique', 'A day in the historic city'], 'Festival', 'Community', '10:00'],
  ['end-tos', '1527529482837-4698179dc6ce', 'Al Elmes', 'ULHxWq8reao', 'ticket-stub', 0, 'darken', ['Tos Premye Janvye', 'Toast du 1er janvier', 'New Year’s Day Toast'], ['Brunch, chanpay ak soup joumou', 'Brunch, champagne et soupe joumou', 'Brunch, champagne and soup joumou'], FD, FD, '11:00'],
  ['end-soup-kominote', '1613844237701-8f3664fc2eff', 'Max Griss', 'cToNEm70cvE', 'split-half', 0, 'none', ['Soup Joumou pou Tout Moun', 'Soupe joumou pour tous', 'Soup Joumou for All'], ['Yon kizin kominotè premye janvye', 'Une soupe populaire le 1er janvier', 'A community soup kitchen on 1 January'], 'Family', 'Community', '08:00'],
])

// prettier-ignore
const MANMAN = build('fet-manman', [
  ['man-brunch', '1664192578366-523c01b7ce43', 'Alice Pasqual', 'sDYqMYg8h60', 'serif-photo', 1, 'none', ['Fèt Manman Brunch', 'Brunch de la Fête des Mères', 'Mother’s Day Brunch'], ['Yon tab pou manman yo', 'Une table pour les mamans', 'A table for the mothers'], FD, FD, '11:00'],
  ['man-woz', '1654369512556-7bdaf5f3a2b4', 'Pedro Vit', 'TbPkS5xgMTg', 'magazine', 2, 'none', ['Fèt Manman', 'Fête des Mères', 'Mother’s Day'], ['Flè, mizik ak lanmou', 'Fleurs, musique et amour', 'Flowers, music and love'], 'Party', 'Music', '19:00'],
  ['man-pitit-fi', '1508205065970-cad01cebebb4', 'Eye for Ebony', 'zQQ6Y5_RtHE', 'split-half', 0, 'none', ['Manman ak Pitit Fi', 'Mères et filles', 'Mothers and Daughters'], ['Yon apremidi pou nou de', 'Un après-midi rien qu’à nous', 'An afternoon just for us'], 'Family', 'Community', '14:00'],
  ['man-konse', '1504888060547-83cbe78ccfe0', 'Andrae Ricketts', 'Q9_zv0LN4jU', 'outline-block', 0, 'mono', ['Pou Manman', 'Pour Maman', 'For Mom'], ['Yon konsè pou tout manman', 'Un concert pour toutes les mamans', 'A concert for every mother'], 'Concert', 'Music', '18:00'],
  ['man-gala', '1516565349308-c76fe36a115c', 'Alessio Soggetti', 'KQBsTXCvGwM', 'giant-date', 2, 'darken', ['Gala Fèt Manman', 'Gala de la Fête des Mères', 'Mother’s Day Gala'], ['Dine ak mizik live', 'Dîner et musique live', 'Dinner and live music'], FD, FD, '19:00'],
  ['man-te', '1621522641347-61650f394fda', 'Lynette Giesbrecht', 'J18xuRgl_Ic', 'serif-photo', 0, 'none', ['Te Fèt Manman', 'Thé de la Fête des Mères', 'Mother’s Day Tea'], ['Te, gato ak pawòl dous', 'Thé, gâteaux et mots doux', 'Tea, cakes and kind words'], FD, FD, '15:00'],
  ['man-lanmou', '1741940365437-e55b919a89d3', 'Lisa Marie Theck', '-nLMCrCZS_Q', 'serif-duotone', 1, 'duotone', ['Lanmou Manman', 'L’amour d’une mère', 'A Mother’s Love'], ['Powèm ak chante pou manman', 'Poèmes et chansons pour maman', 'Poems and songs for mom'], 'Theater', 'Arts', '17:00'],
  ['man-dine', '1688437310009-ed23b2188d38', 'Zac Cain', '0qF0AYIwrn4', 'stack-bar', 1, 'darken', ['Dine Fèt Manman', 'Dîner de la Fête des Mères', 'Mother’s Day Dinner'], ['Rezève tab fanmi an', 'Réservez la table de famille', 'Book the family table'], FD, FD, '19:00'],
  ['man-foto', '1647616906873-ba5d9b8a7b7d', 'Trust “Tru” Katsande', 'jv8SELgSKAs', 'date-rail', 0, 'darken', ['Foto Fèt Manman', 'Photos de la Fête des Mères', 'Mother’s Day Portraits'], ['Yon souvni pou fanmi an', 'Un souvenir pour la famille', 'A keepsake for the family'], 'Family', 'Community', '10:00'],
  ['man-lakay', '1693890260182-9644977f5e6e', 'Sharvina Aathymoolam', 'jrlRvVT176Y', 'ticket-stub', 0, 'darken', ['Fèt Manman Lakay', 'Fête des Mères au pays', 'Mother’s Day Back Home'], ['Dènye dimanch me', 'Le dernier dimanche de mai', 'The last Sunday of May'], 'Family', 'Community', '13:00'],
])

// prettier-ignore
const PAPA = build('fet-papa', [
  ['pap-babekyou', '1627947063935-55577ec3c2e1', 'Rafael Hoyos Weht', 'Aqot8S_Keb8', 'stack-bar', 2, 'darken', ['Babekyou Fèt Papa', 'Grillades de la Fête des Pères', 'Father’s Day Cookout'], ['Babekyou, domino ak konpa', 'Grillades, dominos et konpa', 'Grill, dominoes and konpa'], FD, FD, '14:00'],
  ['pap-domino', '1566694271453-390536dd1f0d', 'Ryan Quintal', 'Ecp0vf3f_aw', 'outline-block', 1, 'mono', ['Tounwa Domino', 'Tournoi de dominos', 'Dominoes Tournament'], ['Fèt Papa, san pitye', 'Fête des Pères, sans pitié', 'Father’s Day, no mercy'], 'Other', 'Community', '15:00'],
  ['pap-siga', '1637248990333-e66e027538f4', 'Mitja Bergoč', 'v8XNrqRlMlA', 'serif-photo', 1, 'none', ['Swa Ronm ak Siga', 'Soirée rhum et cigares', 'Rum and Cigar Night'], ['Pou papa yo, ak jazz', 'Pour les papas, avec du jazz', 'For the fathers, with jazz'], FD, FD, '19:00'],
  ['pap-fet', '1745425715042-24a69791bcf7', 'kofa boyah', 'piT8jPf7Mvk', 'split-half', 0, 'none', ['Fèt Papa', 'Fête des Pères', 'Father’s Day'], ['Dènye dimanch jen', 'Le dernier dimanche de juin', 'The last Sunday of June'], 'Family', 'Community', '13:00'],
  ['pap-pitit', '1549231634-8633391d04b8', 'Mulberry Digital', 'Y83f26VFCcg', 'serif-duotone', 2, 'duotone', ['Papa ak Pitit', 'Papas et enfants', 'Dads and Kids'], ['Jwèt, manje ak foto', 'Jeux, repas et photos', 'Games, food and photos'], 'Family', 'Community', '11:00'],
  ['pap-gala', '1577818582646-65d170ebfe1a', 'Kaysha', '52bLA0c8nJA', 'magazine', 0, 'none', ['Gala Papa', 'Gala des Pères', 'Fathers’ Gala'], ['Kostim, dine ak konpa', 'Costume, dîner et konpa', 'Suits, dinner and konpa'], FD, FD, '20:00'],
  ['pap-griyo', '1558540319-35836c870b28', 'sarah richer', 'NTKZrDk-ENM', 'giant-date', 1, 'darken', ['Griyo pou Papa', 'Griot pour Papa', 'Griyo for Dad'], ['Manje lakay ak mizik', 'Cuisine d’ici et musique', 'Home cooking and music'], FD, FD, '13:00'],
  ['pap-lounge', '1749841730816-fabf3a4c2e06', 'Considerate Agency', '0ACFLMsILIs', 'bill-center', 1, 'darken', ['Lounge Fèt Papa', 'Lounge de la Fête des Pères', 'Father’s Day Lounge'], ['Twoubadou ak bon ronm', 'Twoubadou et bon rhum', 'Twoubadou and good rum'], 'Concert', 'Music', '18:00'],
])

// prettier-ignore
const DRAPO = build('fet-drapo', [
  ['drp-fet', '1786639949689-3dd3fe8c1f89', 'Ayush Design', 'PZ0UUDUPUnE', 'serif-photo', 0, 'none', ['Fèt Drapo', 'Fête du Drapeau', 'Flag Day'], ['18 me, ble ak wouj', '18 mai, bleu et rouge', '18 May, blue and red'], 'Festival', 'Community', '10:00'],
  ['drp-ble-wouj', '1541701571234-ffe036ddf1d2', 'Lucas K', 'wq1BodC0TS8', 'magazine', 0, 'none', ['Ble ak Wouj', 'Bleu et rouge', 'Blue and Red'], ['Yon swa pou drapo a', 'Une soirée pour le drapeau', 'A night for the flag'], 'Party', 'Music', '21:00'],
  ['drp-ekspo', '1588097211669-71cefc744956', 'Pawel Czerwinski', 'F1uRqwXNkTs', 'tilt-pop', 2, 'darken', ['Ekspo Fèt Drapo', 'Expo de la Fête du Drapeau', 'Flag Day Exhibition'], ['Atis ayisyen an ble ak wouj', 'Des artistes haïtiens en bleu et rouge', 'Haitian artists in blue and red'], 'Festival', 'Arts', '17:00'],
  ['drp-defile', '1609054831013-5fda2cd79ccf', 'Beth Macdonald', 'Zb6tNHQkoqA', 'stack-bar', 2, 'darken', ['Defile 18 Me', 'Défilé du 18 mai', '18 May Parade'], ['Fanfa, lekòl ak drapo', 'Fanfares, écoles et drapeaux', 'Brass bands, schools and flags'], 'Festival', 'Community', '09:00'],
  ['drp-konse', '1616382519098-57806dfc551a', 'Adrian Hartanto', 'YPnu0_V5Ttk', 'serif-photo', 2, 'none', ['Konsè Fèt Drapo', 'Concert de la Fête du Drapeau', 'Flag Day Concert'], ['Ble ak wouj sou sèn', 'Le bleu et rouge sur scène', 'Blue and red on stage'], 'Concert', 'Music', '19:00'],
  ['drp-bal', '1506157999258-a35364384ce9', 'Hanny Naibaho', 'XH2JH5U3fe0', 'giant-date', 2, 'darken', ['Bal Fèt Drapo', 'Bal du Drapeau', 'Flag Day Bal'], ['Konpa jiska minwi', 'Konpa jusqu’à minuit', 'Konpa until midnight'], 'Party', 'Music', '21:00'],
  ['drp-fanfa', '1527091736853-64ca6a9b64d9', 'Bailey Torres', '9-Mt_kNlj9Y', 'framed', 2, 'none', ['Fanfa Fèt Drapo', 'Fanfare du Drapeau', 'Flag Day Brass'], ['Mizik ak drapo nan lari', 'Musique et drapeaux dans la rue', 'Music and flags in the street'], 'Festival', 'Music', '15:00'],
  ['drp-fyete', '1573055592760-a1427683e07e', 'A J.', 'wvl8aKUtVsU', 'serif-duotone', 2, 'duotone', ['Fyète Ayisyen', 'Fierté haïtienne', 'Haitian Pride'], ['Yon fèt pou drapo a', 'Une fête pour le drapeau', 'A party for the flag'], 'Party', 'Music', '21:00'],
])

// prettier-ignore
const ERITAJ = build('heritage-month', [
  ['her-mwa', '1786639949689-3dd3fe8c1f89', 'Ayush Design', 'PZ0UUDUPUnE', 'split-half', 0, 'none', ['Mwa Eritaj Ayisyen', 'Mois du patrimoine haïtien', 'Haitian Heritage Month'], ['Me nan dyaspora a', 'Mai dans la diaspora', 'May in the diaspora'], 'Festival', 'Community', '13:00'],
  ['her-danse', '1742095228943-1b0ceb0fd82e', 'Katherine Bandin', 'QhDjA2KvoiQ', 'serif-photo', 1, 'none', ['Danse Folklorik', 'Danse folklorique', 'Folkloric Dance'], ['Rasin nou sou sèn', 'Nos racines sur scène', 'Our roots on stage'], 'Theater', 'Arts', '19:00'],
  ['her-katye', '1645730826845-cd2ddec9984f', 'Jack', '-eqm30LNAlE', 'stack-bar', 2, 'darken', ['Fèt Katye Eritaj', 'Fête de quartier du patrimoine', 'Heritage Block Party'], ['Manje, drapo ak konpa', 'Cuisine, drapeaux et konpa', 'Food, flags and konpa'], 'Festival', 'Community', '13:00'],
  ['her-konpa', '1785835394980-8c395e26ebdb', 'Kyle Hinkson', '8H4Ws3MeUv8', 'giant-date', 0, 'darken', ['Konpa nan Lari', 'Konpa dans la rue', 'Konpa in the Street'], ['Yon gwo bal anplen lè', 'Un grand bal en plein air', 'A big open-air bal'], 'Party', 'Music', '17:00'],
  ['her-sware', '1517457373958-b7bdd4587205', 'Samantha Gades', 'fIHozNWfcvs', 'magazine', 1, 'none', ['Sware Eritaj', 'Soirée du patrimoine', 'Heritage Night'], ['Mizik, manje ak istwa', 'Musique, cuisine et histoire', 'Music, food and history'], 'Party', 'Music', '20:00'],
  ['her-ayiti', '1602027333786-373a1b858831', 'Reynaldo Mirault', 'U3Sdt2phkmA', 'serif-duotone', 0, 'duotone', ['Ayiti nan Kè Nou', 'Haïti dans nos cœurs', 'Haiti in Our Hearts'], ['Yon swa pou dyaspora a', 'Une soirée pour la diaspora', 'An evening for the diaspora'], 'Conference', 'Community', '18:00'],
  ['her-mache', '1640251314219-be6eb294446b', 'Karl Callwood', 'vKVUTS0msYw', 'date-rail', 0, 'darken', ['Mache Eritaj', 'Marché du patrimoine', 'Heritage Market'], ['Atizan ak manje ayisyen', 'Artisans et cuisine haïtienne', 'Haitian makers and food'], 'Festival', 'Community', '12:00'],
  ['her-defile', '1638752097222-ab93e6b15c67', 'Colin Lloyd', 'j4TaOS1rD2s', 'ticket-stub', 0, 'darken', ['Defile Eritaj', 'Défilé du patrimoine', 'Heritage Parade'], ['Drapo, fanfa ak fyète', 'Drapeaux, fanfares et fierté', 'Flags, bands and pride'], 'Festival', 'Community', '12:00'],
])

// prettier-ignore
const CHANPET = build('fet-chanpet', [
  ['cha-fet', '1694271643834-4aaaef614add', 'benjamin lehman', 'mfb_evGFm78', 'serif-photo', 0, 'none', ['Fèt Chanpèt', 'Fête champêtre', 'Fèt Chanpèt'], ['Manje, mizik ak jwèt nan lakou a', 'Cuisine, musique et jeux au lakou', 'Food, music and games in the lakou'], 'Festival', 'Community', '15:00'],
  ['cha-patwonal', '1756823940002-b9f239d96788', 'ayumi kubo', 'xnx-EyPQHJ8', 'magazine', 1, 'none', ['Fèt Patwonal', 'Fête patronale', 'Patron Saint Festival'], ['Yon nwit nan lari bouk la', 'Une nuit dans les rues du bourg', 'A night in the village streets'], 'Festival', 'Community', '18:00'],
  ['cha-bal', '1464047736614-af63643285bf', 'Andrew Knechel', 'gG6yehL64fo', 'giant-date', 1, 'darken', ['Bal Chanpèt', 'Bal champêtre', 'Open-Air Bal'], ['Konpa anba zetwal yo', 'Konpa sous les étoiles', 'Konpa under the stars'], 'Party', 'Music', '20:00'],
  ['cha-ete', '1758599669452-0cf5fba4eb97', 'Vitaly Gariev', 'G2XHJnAl5-g', 'outline-block', 2, 'mono', ['Fèt Ete', 'Fête d’été', 'Summer Party'], ['Solèy kouche ak DJ', 'Coucher de soleil et DJ', 'Sunset and a DJ'], 'Party', 'Music', '17:00'],
  ['cha-plaj', '1552272492-3053fbacbf4b', 'Felipe Palacio', '3GigycWLG0c', 'stack-bar', 0, 'darken', ['Fèt sou Plaj', 'Fête à la plage', 'Beach Party'], ['Ete a lakay', 'L’été au pays', 'Summer back home'], 'Party', 'Music', '16:00'],
  ['cha-fwa', '1687575635638-f651830393e7', 'Jackie Alexander', 'dRw3MHEk5WI', 'date-rail', 0, 'darken', ['Fwa Chanpèt', 'Foire champêtre', 'Country Fair'], ['Machann, jwèt ak manje', 'Stands, jeux et cuisine', 'Stalls, games and food'], 'Festival', 'Community', '14:00'],
  ['cha-plas', '1785835394980-8c395e26ebdb', 'Kyle Hinkson', '8H4Ws3MeUv8', 'bill-center', 0, 'darken', ['Danse nan Plas la', 'Danse sur la place', 'Dancing in the Square'], ['Twoubadou ak konpa', 'Twoubadou et konpa', 'Twoubadou and konpa'], 'Party', 'Music', '18:00'],
  ['cha-jounen-plaj', '1580741186862-c5d0bf2aff33', 'Claudia Altamimi', 'EICXhtGFDAs', 'split-half', 0, 'none', ['Jounen Plaj', 'Journée à la plage', 'Beach Day'], ['Yon jounen bò lanmè', 'Une journée au bord de la mer', 'A day by the sea'], 'Family', 'Community', '10:00'],
  ['cha-nwit', '1649730439524-11f8a92dd493', 'Jodie Walton', '21MNz4_ZBSo', 'ticket-stub', 0, 'darken', ['Nwit Fèt', 'Nuit de fête', 'Festival Night'], ['Manèj, limyè ak mizik', 'Manèges, lumières et musique', 'Rides, lights and music'], 'Festival', 'Community', '19:00'],
  ['cha-sezon', '1629064639601-c7f83a07a756', 'Ariel Blanco', '4ZlKJetA5mg', 'serif-photo', 1, 'none', ['Sezon Fèt Chanpèt', 'Saison des fêtes champêtres', 'Fèt Chanpèt Season'], ['Jiyè ak out, nan tout peyi a', 'Juillet et août, partout au pays', 'July and August, all over the country'], 'Festival', 'Community', '16:00'],
])

// prettier-ignore
const RARA = build('rara', [
  ['rar-lari', '1660675134062-7d3bbb340608', 'Emmanuel Yeboah Okine', 'pq66fmckyGE', 'stack-bar', 2, 'darken', ['Rara nan Lari', 'Rara dans la rue', 'Rara on the Road'], ['Vaksen, tanbou ak yon bann pou suiv', 'Vaksens, tambours et une bande à suivre', 'Vaksen, drums and a band to follow'], 'Festival', 'Music', '17:00'],
  ['rar-tanbou', '1530917203633-106d4a1a0967', 'Paul Zoetemeijer', 'ekBOf6sJYYo', 'serif-photo', 1, 'none', ['Atelye Tanbou', 'Atelier de tambour', 'Drum Workshop'], ['Ritm rara pou tout laj', 'Les rythmes du rara pour tous les âges', 'Rara rhythms for all ages'], 'Workshop', 'Arts', '10:00'],
  ['rar-pak', '1537930385926-b88db6f104a1', 'Luz Mendoza', 'Dq0ml-Xrf4U', 'outline-block', 2, 'mono', ['Rara Wikenn Pak', 'Rara du week-end de Pâques', 'Easter Weekend Rara'], ['Bann yo soti ansanm', 'Les bandes sortent ensemble', 'The bands come out together'], 'Festival', 'Music', '16:00'],
  ['rar-bann', '1750110734661-7095ebe2bf79', 'Michael Umoh', 'C41MAbxiTeM', 'giant-date', 2, 'darken', ['Bann Rara', 'Bande rara', 'Rara Band'], ['Mizik rasin pandan Karèm', 'Musique racine pendant le Carême', 'Roots music through Lent'], 'Concert', 'Music', '18:00'],
  ['rar-rasin', '1751708692623-44fe44b6bcff', 'Michael Umoh', 's32L5adnJ24', 'magazine', 0, 'none', ['Konsè Rasin', 'Concert racine', 'Roots Concert'], ['Rara ak mizik rasin live', 'Rara et musique racine en live', 'Rara and live roots music'], 'Concert', 'Music', '19:00'],
  ['rar-dyaspora', '1667248311264-102ce7a94a64', 'Philippe Murray-Pietsch', 'BmZrKKsuYoY', 'tilt-pop', 0, 'darken', ['Rara Dyaspora', 'Rara de la diaspora', 'Diaspora Rara'], ['Yon bann a pye nan dyaspora a', 'Une bande à pied dans la diaspora', 'A walking band in the diaspora'], 'Festival', 'Music', '15:00'],
])

// prettier-ignore
const GEDE = build('fet-gede', [
  ['ged-fet', '1495667496513-9068843d7679', 'Nicola Fioravanti', 'UrAKbpKnak8', 'serif-photo', 1, 'none', ['Fèt Gede', 'Fête des Guédés', 'Fèt Gede'], ['Nou onore zansèt nou yo', 'Nous honorons nos ancêtres', 'Honouring our ancestors'], 'Festival', 'Community', '18:00'],
  ['ged-jou-mo', '1476900164809-ff19b8ae5968', 'Mike Labrum', 'fvl4b1gjpbk', 'magazine', 0, 'none', ['Jou Mò', 'Jour des Morts', 'All Souls’ Day'], ['Yon swa chandèl ak souvni', 'Une soirée de bougies et de souvenirs', 'An evening of candles and memory'], 'Other', 'Community', '18:00'],
  ['ged-latousen', '1763629615369-502781fab8ad', 'Philippe BONTEMPS', 'qxabjYKd5Do', 'date-rail', 0, 'darken', ['Latousen', 'La Toussaint', 'All Saints’ Day'], ['1 novanm, an kominote', 'Le 1er novembre, ensemble', '1 November, together'], 'Other', 'Community', '17:00'],
  ['ged-kont', '1505009608774-cfa484f461b3', 'Scott Rodgerson', 'ZLHBjxbCCEc', 'outline-block', 1, 'mono', ['Kont ak Memwa', 'Contes et mémoire', 'Stories and Memory'], ['Yon swa kont pou Fèt Gede', 'Une soirée de contes pour les Guédés', 'A storytelling night for Fèt Gede'], 'Theater', 'Arts', '19:00'],
  ['ged-tanbou', '1476873282730-9018f17bdf4e', 'Pascal Müller', 'rhYdgo-rpvg', 'giant-date', 1, 'darken', ['Tanbou ak Chandèl', 'Tambours et bougies', 'Drums and Candles'], ['Mizik rasin pou Fèt Gede', 'Musique racine pour les Guédés', 'Roots music for Fèt Gede'], 'Concert', 'Music', '19:00'],
])

// prettier-ignore
const VERTIERES = build('vertieres', [
  ['ver-1803', '1793110432730-346edaef776d', 'Dimitry Anikin', '7SF5v0i1l6g', 'serif-photo', 1, 'none', ['Vètyè 1803', 'Vertières 1803', 'Vertières 1803'], ['Batay ki mennen nou nan 1804', 'La bataille qui a mené à 1804', 'The battle that led to 1804'], 'Conference', 'Education', '18:00'],
  ['ver-istwa', '1773807091778-7699242ada8c', 'Meg von Haartman', 'NFr8XOjOxKg', 'outline-block', 2, 'mono', ['Swa Istwa Vètyè', 'Soirée d’histoire Vertières', 'Vertières History Night'], ['Yon istoryen ap rakonte', 'Racontée par un historien', 'Told by a historian'], 'Conference', 'Education', '18:00'],
  ['ver-18-novanm', '1786286672773-c1da4ca6ec0b', 'Meg von Haartman', 'Dl0Ksz2DA3w', 'magazine', 0, 'none', ['18 Novanm', '18 novembre', '18 November'], ['Onè pou Kapwa Lamò', 'Honneur à Capois-la-Mort', 'Honouring Capois-la-Mort'], 'Festival', 'Community', '10:00'],
  ['ver-konse', '1694644872482-129592ba5baa', 'Ben Mathis Seibel', 'CUT8qtfXtsw', 'giant-date', 0, 'darken', ['Konsè Vètyè', 'Concert de Vertières', 'Vertières Concert'], ['Mizik rasin pou jou batay la', 'Musique racine pour le jour de la bataille', 'Roots music for the day of the battle'], 'Concert', 'Music', '19:00'],
])

export const HOLIDAY_TEMPLATES: readonly HolidayTemplate[] = [
  ...KANAVAL,
  ...NWEL,
  ...FEN_ANE,
  ...ENDEPANDANS,
  ...MANMAN,
  ...CHANPET,
  ...PAPA,
  ...DRAPO,
  ...ERITAJ,
  ...RARA,
  ...GEDE,
  ...VERTIERES,
]

const BY_ID = new Map(HOLIDAY_TEMPLATES.map((t) => [t.id, t]))

export function holidayTemplateById(id: string | null | undefined): HolidayTemplate | null {
  return (id && BY_ID.get(id)) || null
}

export function holidayTemplatesFor(occasion: OccasionKey | null | undefined): HolidayTemplate[] {
  return occasion ? HOLIDAY_TEMPLATES.filter((t) => t.occasion === occasion) : []
}

/** Occasions that have at least one template. */
export function occasionsWithTemplates(): OccasionKey[] {
  return [...new Set(HOLIDAY_TEMPLATES.map((t) => t.occasion))]
}

const unsplash = (photo: string, w: number, h: number) =>
  `https://images.unsplash.com/photo-${photo}?w=${w}&h=${h}&fit=crop&q=80`

/** The photo the poster is drawn on (what goes in the poster spec). */
export const holidayPhotoUrl = (t: Pick<HolidayTemplate, 'photo'>) => unsplash(t.photo, 1200, 1500)
/** A small 4:5 thumbnail of the bare photo. */
export const holidayThumbUrl = (t: Pick<HolidayTemplate, 'photo'>) => unsplash(t.photo, 320, 400)

type Lang = 'en' | 'fr' | 'ht'
const langOf = (lang?: string | null): Lang => {
  const l = String(lang || '').slice(0, 2)
  return l === 'fr' || l === 'ht' ? l : 'en'
}

export function holidayText(t: HolidayTemplate, lang?: string | null): { title: string; subtitle: string } {
  const l = langOf(lang)
  return { title: t.title[l], subtitle: t.subtitle[l] }
}

/**
 * The start day a template suggests when it opens Create Event on its own
 * (an occasion page's poster strip): the upcoming occurrence's main first
 * day, moved a year on when that has passed. YYYY-MM-DD.
 */
export function holidayDate(t: Pick<HolidayTemplate, 'occasion'>, now: Date | number | IsoDay = Date.now()): IsoDay {
  return ideaDate({ occasion: t.occasion, day: 0 } as OccasionIdea, now)
}

/**
 * The template drawn with its own suggested title on its next date: the
 * occasion page's poster strip. A path on the website (GET /api/posters/preview).
 */
export function holidaySamplePath(t: HolidayTemplate, lang?: string | null, now: Date | number = Date.now()): string {
  const l = langOf(lang)
  const q = new URLSearchParams({
    template: t.layout,
    palette: String(t.palette),
    treatment: t.treatment,
    title: t.title[l],
    start: `${holidayDate(t, now)}T${t.time}`,
    locale: l,
    photo: holidayPhotoUrl(t),
  })
  return `/api/posters/preview?${q}`
}

/** The poster spec a composer saves (poster_template) when this template is applied. */
export function holidayPosterSpec(t: HolidayTemplate): {
  template: string
  palette: number
  photo: string
  treatment: PhotoTreatment
  holiday: string
} {
  return { template: t.layout, palette: t.palette, photo: holidayPhotoUrl(t), treatment: t.treatment, holiday: t.id }
}

/** What GET /api/posters/holidays hands the app for one template. */
export function holidayTemplateJson(t: HolidayTemplate) {
  return {
    id: t.id,
    occasion: t.occasion,
    layout: t.layout,
    palette: t.palette,
    treatment: t.treatment,
    photoUrl: holidayPhotoUrl(t),
    thumbUrl: holidayThumbUrl(t),
    title: t.title,
    subtitle: t.subtitle,
    category: t.category,
    appCategory: t.appCategory,
    time: t.time,
    credit: t.credit,
  }
}
