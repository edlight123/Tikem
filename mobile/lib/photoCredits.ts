/**
 * Who took every bundled photograph, and under what license. Generated with
 * the photos in lib/photoLibrary.ts (one row per photo key, plus the eight world tile photos in WORLD_PHOTOS) and listed in the
 * app on Profile → Photo credits.
 *
 * Unsplash License photos need no credit, but they are listed too so every
 * picture can be traced back to its source. Wikimedia Commons photos are
 * public domain or CC BY / CC BY-SA, which require the author, the license
 * and a link: that is what the Photo credits screen shows.
 *
 * Swapping a photo: replace the file, then update its row here (never reuse
 * a key for a different picture).
 */
export interface PhotoCredit {
  /** The photo key in lib/photoLibrary.ts. */
  key: string;
  /** The file title on its source page, or a short description. */
  title: string;
  author: string;
  /** e.g. "CC BY-SA 4.0", "Public domain", "Unsplash License". */
  license: string;
  licenseUrl: string;
  /** The page the photo was downloaded from. */
  source: string;
}

// prettier-ignore
export const PHOTO_CREDITS: PhotoCredit[] = [
  { key: "photo-montreal", title: "Tabou Combo at the 2014 Festival International Nuits d'Afrique in Montréal (1-3)", author: "Didier Moïse", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", source: "https://commons.wikimedia.org/wiki/File:Tabou_Combo_at_the_2014_Festival_International_Nuits_d%27Afrique_in_Montr%C3%A9al_(1-3).jpg" },
  { key: "photo-flag-crowd", title: "Haiti flag - Carifiesta July 2011", author: "abdallahh from Montréal, Canada", license: "CC BY 2.0", licenseUrl: "https://creativecommons.org/licenses/by/2.0", source: "https://commons.wikimedia.org/wiki/File:Haiti_flag_-_Carifiesta_July_2011.jpg" },
  { key: "photo-nwel", title: "A family laughing together in front of a Christmas tree", author: "Janay Peters", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/jp1b6envAIg" },
  { key: "photo-mizik-tabou", title: "Tabou Combo at the 2014 Festival International Nuits d'Afrique in Montréal (2-3)", author: "Didier Moïse", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", source: "https://commons.wikimedia.org/wiki/File:Tabou_Combo_at_the_2014_Festival_International_Nuits_d%27Afrique_in_Montr%C3%A9al_(2-3).jpg" },
  { key: "photo-mizik-flag", title: "A saxophonist playing among Haitian flags", author: "Bailey Torres", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/9-Mt_kNlj9Y" },
  { key: "photo-mizik-sax", title: "Kanaval in Jacmel Haiti 2014 29", author: "HOPE Art", license: "CC BY 2.0", licenseUrl: "https://creativecommons.org/licenses/by/2.0", source: "https://commons.wikimedia.org/wiki/File:Kanaval_in_Jacmel_Haiti_2014_29.jpg" },
  { key: "photo-lavi-crowd", title: "A crowd cheering at a packed concert", author: "Christian Agbede", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/524SzdT7pOo" },
  { key: "photo-lavi-confetti", title: "Friends celebrating under confetti at a party", author: "OurWhisky Foundation", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/4SKNDU85KOw" },
  { key: "photo-lavi-friends", title: "Four friends laughing together in front of a mural", author: "Christian Agbede", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/Oohrji8xGKI" },
  { key: "photo-kilti-parade", title: "La Parade", author: "Guerinault L", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", source: "https://commons.wikimedia.org/wiki/File:La_Parade.jpg" },
  { key: "photo-kilti-pap", title: "Carnaval de Port-au-Prince", author: "Dade70", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", source: "https://commons.wikimedia.org/wiki/File:Carnaval_de_Port-au-Prince.jpg" },
  { key: "photo-kilti-fire", title: "Souffle de feu", author: "Guerinault L", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", source: "https://commons.wikimedia.org/wiki/File:Souffle_de_feu.jpg" },
  { key: "photo-kilti-drum", title: "Le tambourineur", author: "Guerinault L", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", source: "https://commons.wikimedia.org/wiki/File:Le_tambourineur.jpg" },
  { key: "photo-kilti-dancers", title: "Local dancers in bright costumes performing in Labadee", author: "Katherine Bandin", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/QhDjA2KvoiQ" },
  { key: "photo-espo-sand", title: "Young men playing football on a sand pitch", author: "Yannaty Kouyate", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/unPrQUcWfI4" },
  { key: "photo-espo-night", title: "A pickup basketball game under the lights at night", author: "Christian Lue", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/fCyyLwjXm88" },
  { key: "photo-espo-beach", title: "People playing football on a tropical beach", author: "Random Institute", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/-PCY8gJD1Y8" },
  { key: "photo-espo-match", title: "Footballers competing for the ball in a stadium match", author: "proudlyswazi", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/ANTn7SL3XNA" },
  { key: "photo-gastronomi-grill", title: "A cook pouring sauce over shredded meat at a street-food stall", author: "Alex G", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/OdLC0GUzEvg" },
  { key: "photo-biznis-panel", title: "An audience watching a panel discussion on stage", author: "The Executive Group", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/_AN5hrsJbgE" },
  { key: "photo-biznis-applause", title: "People applauding at a business conference", author: "Carlos Gil", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/QOYXJN1_AJA" },
  { key: "photo-biznis-talk", title: "Two professionals talking at a reception", author: "Praise Judah", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/KHQJf0Gq3RA" },
  { key: "photo-biznis-stage", title: "A speaker on a dark stage", author: "De'von Wellesley", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/BvE2iUsyaXQ" },
  { key: "photo-fanmi-shoulders", title: "A family in a garden, a little girl up on a man's shoulders", author: "Osarugue Igbinoba", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/4ardiyvfhTM" },
  { key: "photo-fanmi-kids", title: "A smiling girl with her arms raised among other children", author: "TopSphere Media", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/rWEUBzbp2rc" },
  { key: "photo-fanmi-school", title: "Schoolgirls in uniform laughing together in Port-au-Prince", author: "Heather Suggitt", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/Jcg4Y4Zst0o" },
  { key: "photo-mizik", title: "A singer on stage with a trumpet player behind her", author: "Julius Drost", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/UFlO384euRI" },
  { key: "photo-lavi-lannwit", title: "Friends dancing at a crowded party", author: "Jared Pizarro", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/b7IkZFcCRDI" },
  { key: "photo-kilti", title: "A carnival drummer in costume and paint", author: "Audrey Gabon", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/iVTwE98CslM" },
  { key: "photo-espo", title: "A young footballer dribbling on a pitch", author: "Skiking Photos", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/d-f7hjdjNjw" },
  { key: "photo-gastronomi", title: "Friends laughing over dinner and drinks", author: "Jim Nyamao", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/iu5u3JrguHU" },
  { key: "photo-biznis", title: "People talking at a networking reception", author: "Olena Kholina", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/OsuDfn4vtLA" },
  { key: "photo-fanmi", title: "A family in white holding their children on a bridge", author: "Dylan Sauerwein", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/YFItC9nQK7o" },
  { key: "photo-eksperyans", title: "A group of friends cheering on a dune under a blue sky", author: "Inatimi Nathus", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/UygW_kIv2A4" },
];
