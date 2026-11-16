/**
 * Who took every bundled photograph, and under what license. Generated with
 * the photos in lib/photoLibrary.ts (one row per photo key, plus the eight world tile photos in WORLD_PHOTOS) and listed in the
 * app on Profile → Photo credits, and on the website at /legal/photo-credits.
 * Web copy of mobile/lib/photoCredits.ts: keep both in step.
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
  { key: "photo-citadelle", title: "Citadelle Laferrière Aerial View", author: "SPC Gibran Torres, U.S. Army", license: "Public domain", licenseUrl: "", source: "https://commons.wikimedia.org/wiki/File:Citadelle_Laferri%C3%A8re_Aerial_View.jpg" },
  { key: "photo-sanssouci", title: "Ruines du palais Sans-Souci, Milot, Haïti", author: "Laurent Quevilly", license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0", source: "https://commons.wikimedia.org/wiki/File:Ruines_du_palais_Sans-Souci,_Milot,_Ha%C3%AFti.jpg" },
  { key: "photo-cap-cathedral", title: "The cathedral dome of Cap-Haïtien seen down Rue 17", author: "Patrice S Dorsainville", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/HlseIzr_6fI" },
  { key: "photo-cap-haitien", title: "View of Cap-Haitien", author: "Rémi Kaupp", license: "CC BY-SA 3.0", licenseUrl: "http://creativecommons.org/licenses/by-sa/3.0/", source: "https://commons.wikimedia.org/wiki/File:View_of_Cap-Haitien.jpg" },
  { key: "photo-jacmel", title: "JacmelView", author: "User:Doron", license: "CC BY-SA 3.0", licenseUrl: "http://creativecommons.org/licenses/by-sa/3.0/", source: "https://commons.wikimedia.org/wiki/File:JacmelView.jpg" },
  { key: "photo-bassinbleu", title: "Bassin bleu (Jacmel)", author: "Intellect'Art", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", source: "https://commons.wikimedia.org/wiki/File:Bassin_bleu_(Jacmel).jpg" },
  { key: "photo-labadee", title: "Boats moored in the turquoise bay at Labadee", author: "Hannah Gibbs", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/wlwLQsXe3CI" },
  { key: "photo-labadee-coast", title: "Green hills over the sea at Labadee", author: "Patrice S Dorsainville", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/4_U53ln0174" },
  { key: "photo-negmawon", title: "Le Marron Inconnu, Haiti 2012", author: "Kristina Just", license: "CC BY 2.0", licenseUrl: "https://creativecommons.org/licenses/by/2.0", source: "https://commons.wikimedia.org/wiki/File:Le_Marron_Inconnu,_Haiti_2012.jpg" },
  { key: "photo-dessalines", title: "Equestrian statue of Jean-Jacques Dessalines in Port-au-Prince (close)", author: "Bdx", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", source: "https://commons.wikimedia.org/wiki/File:Equestrian_statue_of_Jean-Jacques_Dessalines_in_Port-au-Prince_(close).jpg" },
  { key: "photo-petionville", title: "Pétion-Ville rooftops below the mountains", author: "Reynaldo Mirault", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/U3Sdt2phkmA" },
  { key: "photo-kenscoff", title: "Vers Kenscoff - panoramio", author: "Alex Carroll", license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0", source: "https://commons.wikimedia.org/wiki/File:Vers_Kenscoff_-_panoramio.jpg" },
  { key: "photo-foretdespins", title: "Un forêt des pins - panoramio", author: "Alex Carroll", license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0", source: "https://commons.wikimedia.org/wiki/File:Un_for%C3%AAt_des_pins_-_panoramio.jpg" },
  { key: "photo-sautdeau", title: "Haiti Saut-d'Eau", author: "Jstplace", license: "Public domain", licenseUrl: "", source: "https://commons.wikimedia.org/wiki/File:Haiti_Saut-d%27Eau.JPG" },
  { key: "photo-ileavache", title: "A wooden boat on the white sand of Abaka Bay", author: "Claudia Altamimi", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/EICXhtGFDAs" },
  { key: "photo-arcadins", title: "Swimmers in the calm water of a beach on the Côte des Arcadins", author: "Claudia Altamimi", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/8mGBT8_23YM" },
  { key: "photo-wahoo", title: "A fishing boat crossing the clear water of Wahoo Bay", author: "Tim Wildsmith", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/lhDkQXfddvc" },
  { key: "photo-lescayes", title: "Cathédrale Notre-Dame de l'Assomption, Les Cayes, Haïti", author: "Rency Inson Michel", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", source: "https://commons.wikimedia.org/wiki/File:Cath%C3%A9drale_Notre-Dame_de_l%27Assomption,_Les_Cayes,_Ha%C3%AFti.jpg" },
  { key: "photo-haiti-coast", title: "A town at the foot of the mountains by the sea in Haiti", author: "TopSphere Media", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/5ouqB4k9Yjw" },
  { key: "photo-sud-beach", title: "A painted fishing boat pulled up on a beach", author: "Claudia Altamimi", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/_Y0IQ-9vicU" },
  { key: "photo-miami", title: "Little Haiti south", author: "Averette", license: "CC BY 3.0", licenseUrl: "https://creativecommons.org/licenses/by/3.0", source: "https://commons.wikimedia.org/wiki/File:Little_Haiti_south.jpg" },
  { key: "photo-flatbush", title: "Newkirk Avenue Little Haiti Sign", author: "Kidfly182", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", source: "https://commons.wikimedia.org/wiki/File:Newkirk_Avenue_Little_Haiti_Sign.jpg" },
  { key: "photo-boston", title: "The Boston skyline lit up at night across the harbor", author: "Gary Lee", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/sy2_qzR-a54" },
  { key: "photo-montreal", title: "Tabou Combo at the 2014 Festival International Nuits d'Afrique in Montréal (1-3)", author: "Didier Moïse", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", source: "https://commons.wikimedia.org/wiki/File:Tabou_Combo_at_the_2014_Festival_International_Nuits_d%27Afrique_in_Montr%C3%A9al_(1-3).jpg" },
  { key: "photo-saintdenis", title: "Basilique Saint-Denis - Façade - Octobre 2024", author: "ZeusUpsistos", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", source: "https://commons.wikimedia.org/wiki/File:Basilique_Saint-Denis_-_Fa%C3%A7ade_-_Octobre_2024.jpg" },
  { key: "photo-flag-crowd", title: "Haiti flag - Carifiesta July 2011", author: "abdallahh from Montréal, Canada", license: "CC BY 2.0", licenseUrl: "https://creativecommons.org/licenses/by/2.0", source: "https://commons.wikimedia.org/wiki/File:Haiti_flag_-_Carifiesta_July_2011.jpg" },
  { key: "photo-vertieres", title: "Batalla de Vertières Haiti", author: "Wilmeus Tamar", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", source: "https://commons.wikimedia.org/wiki/File:Batalla_de_Verti%C3%A8res_Haiti.jpg" },
  { key: "photo-soupjoumou", title: "Soup Joumou", author: "Aliceba", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", source: "https://commons.wikimedia.org/wiki/File:Soup_Joumou.jpg" },
  { key: "photo-kanaval-mask", title: "Kanaval in Jacmel Haiti 2014 21", author: "HOPE Art", license: "CC BY 2.0", licenseUrl: "https://creativecommons.org/licenses/by/2.0", source: "https://commons.wikimedia.org/wiki/File:Kanaval_in_Jacmel_Haiti_2014_21.jpg" },
  { key: "photo-kap", title: "A bright kite flying over a green hillside", author: "this life's illusions", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/NxMU0RuNCPg" },
  { key: "photo-toussaint", title: "Statue Toussaint Louverture à Allada", author: "Rachad sanoussi", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", source: "https://commons.wikimedia.org/wiki/File:Statue_Toussaint_Louverture_%C3%A0_Allada.jpg" },
  { key: "photo-diri", title: "Gardeners working in a rice plantation in Les Cayes Haiti", author: "Hudson-explore", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", source: "https://commons.wikimedia.org/wiki/File:Gardeners_working_in_a_rice_plantation_in_Les_Cayes_Haiti.jpg" },
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
  { key: "photo-gastronomi-griot", title: "Griot haïtien", author: "Lëa-Kim Châteauneuf", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", source: "https://commons.wikimedia.org/wiki/File:Griot_ha%C3%AFtien.jpg" },
  { key: "photo-gastronomi-poul", title: "Poul an Sòs", author: "Aliceba", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0", source: "https://commons.wikimedia.org/wiki/File:Poul_an_S%C3%B2s.jpg" },
  { key: "photo-gastronomi-night", title: "People eating at a lively Caribbean restaurant at night", author: "X F", license: "Unsplash License", licenseUrl: "https://unsplash.com/license", source: "https://unsplash.com/photos/8JPo6SBuZGw" },
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
