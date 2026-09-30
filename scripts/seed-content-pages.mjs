/**
 * Seed script: writes the legal/help content into Firestore at
 * content_pages/{slug} as a PER-LANGUAGE document so web + mobile render a
 * single source in the user's language (en fallback).
 *
 *   content_pages/{slug} = { slug, translations: { en, fr, ht } }
 *   LocalizedContent      = { title, updated, blocks, roleLabels?, draft? }
 *
 * - support (Help Center): built from public/locales/{lang}/support.json, which
 *   is already professionally translated in all three languages.
 * - terms / privacy / refunds: English is the reference; fr/ht are
 *   machine-translated drafts (draft: true) pending human review.
 *
 * Run with: node scripts/seed-content-pages.mjs            (all pages)
 *           node scripts/seed-content-pages.mjs --only=terms
 * Requires:  FIREBASE_SERVICE_ACCOUNT_KEY (service-account JSON, e.g. .env.local)
 * Idempotent: each doc is fully replaced via .set().
 */

import admin from 'firebase-admin'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// Best-effort: load .env.local so the script is runnable without exporting vars.
try {
  const dotenv = await import('dotenv')
  dotenv.config({ path: join(ROOT, '.env.local') })
} catch {
  // dotenv not installed — rely on the ambient environment instead.
}

// Initialize Firebase Admin. Parse the service-account JSON resiliently: when
// the key is loaded from .env.local its private_key contains real newlines,
// which break a naive JSON.parse — so on failure we escape the control chars,
// then restore \n in the private_key for the cert (mirrors upload-guides.mjs).
if (!admin.apps.length) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
  if (!raw) {
    console.error('Missing FIREBASE_SERVICE_ACCOUNT_KEY (set it in .env.local).')
    process.exit(1)
  }
  let serviceAccount
  try {
    serviceAccount = JSON.parse(raw)
  } catch {
    serviceAccount = JSON.parse(raw.replace(/\r/g, '').replace(/\n/g, '\\n').replace(/\t/g, '\\t'))
  }
  if (typeof serviceAccount.private_key === 'string') {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n')
  }
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
}

const db = admin.firestore()

// ─────────────────────────────────────────────────────────────────────────────
// SUPPORT / HELP CENTER — built from the localized support.json files.
// Category order + attendee/organizer split mirror app/support/faqData.ts.
// ─────────────────────────────────────────────────────────────────────────────

const ATTENDEE_CATEGORY_IDS = ['tickets-orders', 'event-access', 'payments-refunds', 'account-profile']
const ORGANIZER_CATEGORY_IDS = ['create-manage-events', 'payments-payouts', 'tickets-checkin', 'organizer-account']

function loadSupportJson(lang) {
  return JSON.parse(readFileSync(join(ROOT, 'public', 'locales', lang, 'support.json'), 'utf8'))
}

function buildSupport(lang) {
  const j = loadSupportJson(lang)
  const roleLabels = { attendee: j.role_toggle.attendee, organizer: j.role_toggle.organizer }
  const blocks = []

  // Hero subtitle as an intro paragraph (above the accordion).
  if (j.hero?.subtitle) blocks.push({ type: 'paragraph', text: j.hero.subtitle })

  const pushRole = (roleKey, ids, roleLabel) => {
    for (const id of ids) {
      const cat = j.faq?.[roleKey]?.categories?.[id]
      if (!cat) continue
      // Role-prefixed h2 so the Attendee/Organizer filter can detect it.
      blocks.push({ type: 'heading', level: 2, text: `${roleLabel} — ${cat.title}` })
      if (cat.description) blocks.push({ type: 'paragraph', text: cat.description })
      for (const f of cat.faqs || []) {
        blocks.push({ type: 'heading', level: 3, text: f.question })
        blocks.push({ type: 'paragraph', text: f.answer })
      }
    }
  }

  pushRole('attendee', ATTENDEE_CATEGORY_IDS, roleLabels.attendee)
  pushRole('organizer', ORGANIZER_CATEGORY_IDS, roleLabels.organizer)

  // Common "Still need help?" section (no role prefix).
  if (j.need_help) {
    blocks.push({ type: 'heading', level: 2, text: j.need_help.title })
    if (j.need_help.description) blocks.push({ type: 'paragraph', text: j.need_help.description })
    blocks.push({
      type: 'list',
      items: [
        `${j.need_help.contact_support}: support@tikem.co`,
        'WhatsApp: wa.me/50938675309',
        j.need_help.submit_request,
      ],
    })
  }

  return { title: j.hero?.title || 'Help Center', updated: '', blocks, roleLabels }
}

const support = {
  slug: 'support',
  translations: {
    en: buildSupport('en'),
    fr: buildSupport('fr'),
    ht: buildSupport('ht'),
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// LEGAL PAGES — English is the reference; fr/ht are machine-translated drafts.
// ─────────────────────────────────────────────────────────────────────────────

const terms = {
  slug: 'terms',
  translations: {
    en: {
      title: 'Terms of Service',
      updated: 'September 30, 2026',
      blocks: [
        { type: 'heading', level: 2, text: '1. Acceptance of Terms' },
        { type: 'paragraph', text: 'By accessing and using Tikèm ("the Platform"), you accept and agree to be bound by the terms and provision of this agreement.' },
        { type: 'heading', level: 2, text: '2. Use License' },
        { type: 'paragraph', text: 'Permission is granted to temporarily use the Platform for personal, non-commercial transitory viewing only. This is the grant of a license, not a transfer of title.' },
        { type: 'heading', level: 3, text: 'Under this license you may not:' },
        { type: 'list', items: [
          'Modify or copy the materials',
          'Use the materials for any commercial purpose or for any public display',
          'Attempt to decompile or reverse engineer any software contained on the Platform',
          'Remove any copyright or other proprietary notations from the materials',
          'Transfer the materials to another person or "mirror" the materials on any other server',
        ] },
        { type: 'heading', level: 2, text: '3. Event Organizers' },
        { type: 'paragraph', text: 'Event organizers using the Platform agree to:' },
        { type: 'list', items: [
          'Provide accurate and truthful information about their events',
          'Honor all ticket sales and refunds according to stated policies',
          'Comply with all applicable laws and regulations',
          'Not engage in fraudulent or deceptive practices',
          'Maintain appropriate insurance for their events',
        ] },
        { type: 'heading', level: 2, text: '4. Ticket Purchases' },
        { type: 'paragraph', text: 'When purchasing tickets through the Platform:' },
        { type: 'list', items: [
          'All sales are subject to availability',
          'Tickets are non-transferable unless otherwise stated',
          'Refund policies are set by individual event organizers',
          'You are responsible for checking event details before purchase',
          'Tikèm acts as an intermediary and is not liable for event cancellations or changes',
        ] },
        { type: 'heading', level: 2, text: '5. User Content' },
        { type: 'paragraph', text: 'Users may post reviews, comments, and other content. By posting content, you grant Tikèm a non-exclusive, royalty-free, perpetual license to use, reproduce, modify, and display such content.' },
        { type: 'heading', level: 2, text: '6. Prohibited Activities' },
        { type: 'paragraph', text: 'You agree not to:' },
        { type: 'list', items: [
          'Violate any laws or regulations',
          'Infringe on intellectual property rights',
          'Transmit viruses or malicious code',
          'Engage in fraudulent ticket sales or purchases',
          'Harass or harm other users',
          'Use automated systems to access the Platform',
        ] },
        { type: 'heading', level: 3, text: 'Zero tolerance for objectionable content and abusive users' },
        { type: 'paragraph', text: 'Tikèm has no tolerance for objectionable content or abusive users. You may not publish events, images, descriptions, profiles or messages that are hateful, harassing, threatening, sexually explicit, violent, fraudulent, misleading or illegal, or that target any person or group. This applies to everyone who uses the Platform, including event organizers.' },
        { type: 'list', items: [
          'Every event page and organizer profile has a Report option. Our team reviews reports within 24 hours and removes content that breaks these terms.',
          'You can block an organizer at any time; their events are then hidden from your feeds and you stop receiving notifications about them.',
          'Accounts that post objectionable content or abuse other users are removed from the Platform, and their events are taken down.',
          'To report something urgent, email support@tikem.co.',
        ] },
        { type: 'heading', level: 2, text: '7. Payment Processing' },
        { type: 'paragraph', text: 'Payments are processed securely through third-party payment processors. Tikèm does not store credit card information. A service fee may be applied to ticket purchases.' },
        { type: 'heading', level: 2, text: '8. Limitation of Liability' },
        { type: 'paragraph', text: 'Tikèm shall not be liable for any indirect, incidental, special, consequential, or punitive damages resulting from your use of the Platform or any events listed on it.' },
        { type: 'heading', level: 2, text: '9. Account Termination' },
        { type: 'paragraph', text: 'We reserve the right to terminate or suspend accounts that violate these terms or engage in prohibited activities, without prior notice.' },
        { type: 'heading', level: 2, text: '10. Modifications to Terms' },
        { type: 'paragraph', text: 'Tikèm reserves the right to revise these terms at any time. Continued use of the Platform after changes constitutes acceptance of modified terms.' },
        { type: 'heading', level: 2, text: '11. Governing Law' },
        { type: 'paragraph', text: 'These terms shall be governed by and construed in accordance with the laws of Haiti, without regard to its conflict of law provisions.' },
        { type: 'heading', level: 2, text: '12. Contact Information' },
        { type: 'paragraph', text: 'For questions about these Terms of Service, please contact us at:' },
        { type: 'paragraph', text: 'Email: legal@tikem.co' },
        { type: 'paragraph', text: 'Address: Port-au-Prince, Haiti' },
      ],
    },
    fr: {
      draft: true,
      title: "Conditions d'utilisation",
      updated: '30 septembre 2026',
      blocks: [
        { type: 'heading', level: 2, text: '1. Acceptation des conditions' },
        { type: 'paragraph', text: 'En accédant à Tikèm (« la Plateforme ») et en l\'utilisant, vous acceptez d\'être lié par les conditions et dispositions du présent accord.' },
        { type: 'heading', level: 2, text: "2. Licence d'utilisation" },
        { type: 'paragraph', text: 'Vous êtes autorisé à utiliser temporairement la Plateforme à des fins personnelles et non commerciales, pour une consultation transitoire uniquement. Il s\'agit de l\'octroi d\'une licence, et non d\'un transfert de propriété.' },
        { type: 'heading', level: 3, text: 'Dans le cadre de cette licence, vous ne pouvez pas :' },
        { type: 'list', items: [
          'Modifier ou copier les contenus',
          'Utiliser les contenus à des fins commerciales ou pour tout affichage public',
          'Tenter de décompiler ou de faire de l\'ingénierie inverse sur tout logiciel de la Plateforme',
          'Supprimer toute mention de droit d\'auteur ou de propriété des contenus',
          'Transférer les contenus à une autre personne ou les « refléter » sur un autre serveur',
        ] },
        { type: 'heading', level: 2, text: '3. Organisateurs d\'événements' },
        { type: 'paragraph', text: 'Les organisateurs d\'événements qui utilisent la Plateforme s\'engagent à :' },
        { type: 'list', items: [
          'Fournir des informations exactes et véridiques sur leurs événements',
          'Honorer toutes les ventes de billets et les remboursements conformément aux politiques annoncées',
          'Respecter toutes les lois et réglementations applicables',
          'Ne pas se livrer à des pratiques frauduleuses ou trompeuses',
          'Souscrire une assurance appropriée pour leurs événements',
        ] },
        { type: 'heading', level: 2, text: '4. Achats de billets' },
        { type: 'paragraph', text: 'Lors de l\'achat de billets sur la Plateforme :' },
        { type: 'list', items: [
          'Toutes les ventes sont soumises à disponibilité',
          'Les billets sont non transférables, sauf indication contraire',
          'Les politiques de remboursement sont définies par chaque organisateur',
          'Il vous incombe de vérifier les détails de l\'événement avant l\'achat',
          'Tikèm agit en tant qu\'intermédiaire et n\'est pas responsable des annulations ou modifications d\'événements',
        ] },
        { type: 'heading', level: 2, text: '5. Contenu des utilisateurs' },
        { type: 'paragraph', text: 'Les utilisateurs peuvent publier des avis, des commentaires et d\'autres contenus. En publiant du contenu, vous accordez à Tikèm une licence non exclusive, libre de redevance et perpétuelle pour utiliser, reproduire, modifier et afficher ce contenu.' },
        { type: 'heading', level: 2, text: '6. Activités interdites' },
        { type: 'paragraph', text: 'Vous vous engagez à ne pas :' },
        { type: 'list', items: [
          'Enfreindre toute loi ou réglementation',
          'Porter atteinte aux droits de propriété intellectuelle',
          'Transmettre des virus ou du code malveillant',
          'Vous livrer à des ventes ou achats de billets frauduleux',
          'Harceler ou nuire à d\'autres utilisateurs',
          'Utiliser des systèmes automatisés pour accéder à la Plateforme',
        ] },
        { type: 'heading', level: 3, text: 'Tolérance zéro pour les contenus répréhensibles et les utilisateurs abusifs' },
        { type: 'paragraph', text: "Tikèm ne tolère aucun contenu répréhensible ni aucun utilisateur abusif. Vous ne pouvez pas publier d'événements, d'images, de descriptions, de profils ou de messages haineux, harcelants, menaçants, sexuellement explicites, violents, frauduleux, trompeurs ou illégaux, ou visant une personne ou un groupe. Cela s'applique à tous les utilisateurs de la Plateforme, y compris les organisateurs d'événements." },
        { type: 'list', items: [
          "Chaque page d'événement et chaque profil d'organisateur propose une option Signaler. Notre équipe examine les signalements sous 24 heures et retire les contenus qui enfreignent ces conditions.",
          "Vous pouvez bloquer un organisateur à tout moment ; ses événements sont alors masqués de vos fils et vous ne recevez plus de notifications à leur sujet.",
          'Les comptes qui publient des contenus répréhensibles ou abusent des autres utilisateurs sont retirés de la Plateforme, et leurs événements sont supprimés.',
          'Pour un signalement urgent, écrivez à support@tikem.co.',
        ] },
        { type: 'heading', level: 2, text: '7. Traitement des paiements' },
        { type: 'paragraph', text: 'Les paiements sont traités de manière sécurisée par des prestataires de paiement tiers. Tikèm ne conserve pas les informations de carte bancaire. Des frais de service peuvent s\'appliquer aux achats de billets.' },
        { type: 'heading', level: 2, text: '8. Limitation de responsabilité' },
        { type: 'paragraph', text: 'Tikèm ne saurait être tenu responsable de tout dommage indirect, accessoire, spécial, consécutif ou punitif résultant de votre utilisation de la Plateforme ou de tout événement qui y est répertorié.' },
        { type: 'heading', level: 2, text: '9. Résiliation de compte' },
        { type: 'paragraph', text: 'Nous nous réservons le droit de résilier ou de suspendre les comptes qui enfreignent ces conditions ou se livrent à des activités interdites, sans préavis.' },
        { type: 'heading', level: 2, text: '10. Modifications des conditions' },
        { type: 'paragraph', text: 'Tikèm se réserve le droit de réviser ces conditions à tout moment. L\'utilisation continue de la Plateforme après des modifications vaut acceptation des conditions modifiées.' },
        { type: 'heading', level: 2, text: '11. Droit applicable' },
        { type: 'paragraph', text: 'Les présentes conditions sont régies et interprétées conformément aux lois d\'Haïti, sans égard aux règles de conflit de lois.' },
        { type: 'heading', level: 2, text: '12. Coordonnées' },
        { type: 'paragraph', text: 'Pour toute question concernant ces Conditions d\'utilisation, veuillez nous contacter à :' },
        { type: 'paragraph', text: 'E-mail : legal@tikem.co' },
        { type: 'paragraph', text: 'Adresse : Port-au-Prince, Haïti' },
      ],
    },
    ht: {
      draft: true,
      title: 'Kondisyon itilizasyon',
      updated: '30 septanm 2026',
      blocks: [
        { type: 'heading', level: 2, text: '1. Aksepte kondisyon yo' },
        { type: 'paragraph', text: 'Lè w aksede epi w itilize Tikèm (« Plafòm nan »), ou aksepte epi ou dakò pou respekte kondisyon ak dispozisyon akò sa a.' },
        { type: 'heading', level: 2, text: '2. Lisans itilizasyon' },
        { type: 'paragraph', text: 'Yo ba w pèmisyon pou itilize Plafòm nan tanporèman, pou zafè pèsonèl, pa komèsyal, pou senp konsiltasyon sèlman. Sa se yon lisans yo ba ou, se pa yon transfè pwopriyete.' },
        { type: 'heading', level: 3, text: 'Anba lisans sa a, ou pa gen dwa :' },
        { type: 'list', items: [
          'Modifye oswa kopye kontni yo',
          'Itilize kontni yo pou nenpòt rezon komèsyal oswa pou nenpòt afichaj piblik',
          'Eseye dekonpile oswa fè ranvèse-jeni sou nenpòt lojisyèl ki sou Plafòm nan',
          'Retire nenpòt nòt dwa otè oswa dwa pwopriyete sou kontni yo',
          'Transfere kontni yo bay yon lòt moun oswa « miwote » yo sou nenpòt lòt sèvè',
        ] },
        { type: 'heading', level: 2, text: '3. Òganizatè evènman' },
        { type: 'paragraph', text: 'Òganizatè evènman ki itilize Plafòm nan dakò pou :' },
        { type: 'list', items: [
          'Bay enfòmasyon egzat e verite sou evènman yo',
          'Onore tout vant tikè ak ranbousman selon règ yo anonse yo',
          'Respekte tout lwa ak règleman ki aplikab',
          'Pa angaje nan pratik fwod oswa twonpri',
          'Kenbe yon asirans ki apwopriye pou evènman yo',
        ] },
        { type: 'heading', level: 2, text: '4. Acha tikè' },
        { type: 'paragraph', text: 'Lè w ap achte tikè sou Plafòm nan :' },
        { type: 'list', items: [
          'Tout vant depann de disponibilite',
          'Tikè yo pa transfere sof si yo di otreman',
          'Chak òganizatè evènman fikse règ ranbousman yo',
          'Se responsablite w pou tcheke detay evènman an anvan w achte',
          'Tikèm aji kòm entèmedyè epi li pa responsab pou anilasyon oswa chanjman evènman',
        ] },
        { type: 'heading', level: 2, text: '5. Kontni itilizatè' },
        { type: 'paragraph', text: 'Itilizatè yo ka pibliye evalyasyon, kòmantè ak lòt kontni. Lè w pibliye kontni, ou bay Tikèm yon lisans ki pa eksklizif, san redevans e pèmanan pou itilize, repwodui, modifye ak montre kontni sa a.' },
        { type: 'heading', level: 2, text: '6. Aktivite entèdi' },
        { type: 'paragraph', text: 'Ou dakò pou w pa :' },
        { type: 'list', items: [
          'Vyole nenpòt lwa oswa règleman',
          'Vyole dwa pwopriyete entelektyèl',
          'Voye viris oswa kòd malveyan',
          'Angaje nan vant oswa acha tikè fwod',
          'Anmède oswa fè lòt itilizatè mal',
          'Itilize sistèm otomatik pou aksede Plafòm nan',
        ] },
        { type: 'heading', level: 3, text: 'Zewo tolerans pou kontni ki choke ak itilizatè ki abize lòt moun' },
        { type: 'paragraph', text: 'Tikèm pa tolere okenn kontni ki choke ni okenn itilizatè ki abize lòt moun. Ou pa gen dwa pibliye evènman, imaj, deskripsyon, pwofil oswa mesaj ki gen rayisman, asèlman, menas, kontni seksyèl eksplisit, vyolans, fwod, manti oswa bagay ilegal, oswa ki vize yon moun oswa yon gwoup. Sa aplike pou tout moun k ap itilize Plafòm nan, enkli òganizatè evènman yo.' },
        { type: 'list', items: [
          'Chak paj evènman ak chak pwofil òganizatè gen yon opsyon Siyale. Ekip nou an egzaminen siyalman yo nan 24 èdtan epi li retire kontni ki vyole kondisyon sa yo.',
          'Ou ka bloke yon òganizatè nenpòt ki lè; evènman li yo pa parèt nan fil ou ankò epi ou pa resevwa notifikasyon sou yo ankò.',
          'Kont ki pibliye kontni ki choke oswa ki abize lòt itilizatè yo retire sou Plafòm nan, epi evènman yo retire tou.',
          'Pou yon siyalman ijan, ekri support@tikem.co.',
        ] },
        { type: 'heading', level: 2, text: '7. Tretman peman' },
        { type: 'paragraph', text: 'Peman yo trete an sekirite atravè founisè peman tyès. Tikèm pa konsève enfòmasyon kat kredi. Yon frè sèvis ka aplike sou acha tikè.' },
        { type: 'heading', level: 2, text: '8. Limit responsablite' },
        { type: 'paragraph', text: 'Tikèm pa p responsab pou okenn domaj endirèk, aksidantèl, espesyal, konsekan oswa pinitif ki soti nan itilizasyon w fè de Plafòm nan oswa nenpòt evènman ki afiche sou li.' },
        { type: 'heading', level: 2, text: '9. Rezilyasyon kont' },
        { type: 'paragraph', text: 'Nou rezève dwa pou rezilye oswa sispann kont ki vyole kondisyon sa yo oswa ki angaje nan aktivite entèdi, san avètisman davans.' },
        { type: 'heading', level: 2, text: '10. Modifikasyon kondisyon yo' },
        { type: 'paragraph', text: 'Tikèm rezève dwa pou revize kondisyon sa yo nenpòt lè. Si w kontinye itilize Plafòm nan apre chanjman yo, sa vle di ou aksepte kondisyon modifye yo.' },
        { type: 'heading', level: 2, text: '11. Lwa ki aplikab' },
        { type: 'paragraph', text: 'Kondisyon sa yo gouvène e entèprete dapre lwa Ayiti, san konsidere règ konfli lwa yo.' },
        { type: 'heading', level: 2, text: '12. Kontak' },
        { type: 'paragraph', text: 'Pou nenpòt kesyon sou Kondisyon itilizasyon sa yo, tanpri kontakte nou nan :' },
        { type: 'paragraph', text: 'Imèl : legal@tikem.co' },
        { type: 'paragraph', text: 'Adrès : Pòtoprens, Ayiti' },
      ],
    },
  },
}

const privacy = {
  slug: 'privacy',
  translations: {
    en: {
      title: 'Privacy Policy',
      updated: 'November 23, 2025',
      blocks: [
        { type: 'heading', level: 2, text: '1. Information We Collect' },
        { type: 'heading', level: 3, text: 'Personal Information' },
        { type: 'paragraph', text: 'When you use Tikèm, we may collect:' },
        { type: 'list', items: [
          'Name and email address',
          'Phone number',
          'Payment information (processed securely by third parties)',
          'Profile information and preferences',
          'Identity verification documents (for event organizers)',
        ] },
        { type: 'heading', level: 3, text: 'Usage Information' },
        { type: 'list', items: [
          'IP address and device information',
          'Browser type and version',
          'Pages visited and time spent on pages',
          'Event searches and purchases',
          'Interaction with emails and notifications',
        ] },
        { type: 'heading', level: 2, text: '2. How We Use Your Information' },
        { type: 'paragraph', text: 'We use collected information to:' },
        { type: 'list', items: [
          'Process ticket purchases and manage your account',
          'Send event confirmations and reminders',
          'Provide customer support',
          'Personalize your experience and recommendations',
          'Prevent fraud and ensure platform security',
          'Analyze usage patterns to improve our service',
          'Send marketing communications (with your consent)',
        ] },
        { type: 'heading', level: 2, text: '3. Information Sharing' },
        { type: 'paragraph', text: 'We may share your information with:' },
        { type: 'heading', level: 3, text: 'Event Organizers' },
        { type: 'paragraph', text: 'When you purchase a ticket, we share your name, email, and phone number with the event organizer for event management purposes.' },
        { type: 'heading', level: 3, text: 'Service Providers' },
        { type: 'list', items: [
          'Payment processors (Stripe, MonCash)',
          'Email service providers (Resend)',
          'Cloud hosting providers (Firebase, Vercel)',
          'Analytics services',
        ] },
        { type: 'heading', level: 3, text: 'Legal Requirements' },
        { type: 'paragraph', text: 'We may disclose information when required by law or to protect our rights, property, or safety.' },
        { type: 'heading', level: 2, text: '4. Data Security' },
        { type: 'paragraph', text: 'We implement industry-standard security measures to protect your data:' },
        { type: 'list', items: [
          'Encryption of sensitive data in transit and at rest',
          'Secure payment processing (PCI DSS compliant)',
          'Regular security audits and updates',
          'Access controls and authentication',
          'Monitoring for suspicious activity',
        ] },
        { type: 'heading', level: 2, text: '5. Your Rights' },
        { type: 'paragraph', text: 'You have the right to:' },
        { type: 'list', items: [
          'Access your personal data',
          'Correct inaccurate information',
          'Request deletion of your data',
          'Opt-out of marketing communications',
          'Export your data',
          'Object to data processing',
        ] },
        { type: 'heading', level: 2, text: '6. Cookies and Tracking' },
        { type: 'paragraph', text: 'We use cookies and similar technologies to:' },
        { type: 'list', items: [
          'Remember your preferences and settings',
          'Maintain your login session',
          'Analyze site usage and performance',
          'Provide personalized content',
        ] },
        { type: 'paragraph', text: 'You can control cookie settings through your browser preferences.' },
        { type: 'heading', level: 2, text: '7. Data Retention' },
        { type: 'paragraph', text: 'We retain your personal data for as long as necessary to provide our services and comply with legal obligations. Ticket purchase records are retained for tax and accounting purposes.' },
        { type: 'heading', level: 2, text: "8. Children's Privacy" },
        { type: 'paragraph', text: 'Tikèm is not intended for children under 13. We do not knowingly collect personal information from children under 13.' },
        { type: 'heading', level: 2, text: '9. International Data Transfers' },
        { type: 'paragraph', text: 'Your information may be transferred to and processed in countries other than Haiti. We ensure appropriate safeguards are in place for such transfers.' },
        { type: 'heading', level: 2, text: '10. Changes to This Policy' },
        { type: 'paragraph', text: 'We may update this Privacy Policy periodically. We will notify you of significant changes via email or platform notification.' },
        { type: 'heading', level: 2, text: '11. Third-Party Links' },
        { type: 'paragraph', text: 'Our platform may contain links to third-party websites. We are not responsible for the privacy practices of these sites.' },
        { type: 'heading', level: 2, text: '12. Contact Us' },
        { type: 'paragraph', text: 'For privacy-related questions or to exercise your rights:' },
        { type: 'list', items: [
          'Email: privacy@tikem.co',
          'Data Protection Officer: dpo@tikem.co',
          'Address: Port-au-Prince, Haiti',
        ] },
        { type: 'heading', level: 2, text: '13. GDPR Compliance' },
        { type: 'paragraph', text: 'For users in the European Union, we comply with GDPR requirements:' },
        { type: 'list', items: [
          'Lawful basis for processing (consent, contract, legitimate interest)',
          'Right to data portability',
          'Right to be forgotten',
          'Data breach notification',
          'Privacy by design and default',
        ] },
      ],
    },
    fr: {
      draft: true,
      title: 'Politique de confidentialité',
      updated: '23 novembre 2025',
      blocks: [
        { type: 'heading', level: 2, text: '1. Informations que nous collectons' },
        { type: 'heading', level: 3, text: 'Informations personnelles' },
        { type: 'paragraph', text: 'Lorsque vous utilisez Tikèm, nous pouvons collecter :' },
        { type: 'list', items: [
          'Nom et adresse e-mail',
          'Numéro de téléphone',
          'Informations de paiement (traitées de manière sécurisée par des tiers)',
          'Informations de profil et préférences',
          'Documents de vérification d\'identité (pour les organisateurs)',
        ] },
        { type: 'heading', level: 3, text: 'Informations d\'utilisation' },
        { type: 'list', items: [
          'Adresse IP et informations sur l\'appareil',
          'Type et version du navigateur',
          'Pages visitées et temps passé sur les pages',
          'Recherches et achats d\'événements',
          'Interactions avec les e-mails et les notifications',
        ] },
        { type: 'heading', level: 2, text: '2. Comment nous utilisons vos informations' },
        { type: 'paragraph', text: 'Nous utilisons les informations collectées pour :' },
        { type: 'list', items: [
          'Traiter les achats de billets et gérer votre compte',
          'Envoyer des confirmations et rappels d\'événements',
          'Fournir un support client',
          'Personnaliser votre expérience et nos recommandations',
          'Prévenir la fraude et assurer la sécurité de la plateforme',
          'Analyser les habitudes d\'utilisation pour améliorer notre service',
          'Envoyer des communications marketing (avec votre consentement)',
        ] },
        { type: 'heading', level: 2, text: '3. Partage des informations' },
        { type: 'paragraph', text: 'Nous pouvons partager vos informations avec :' },
        { type: 'heading', level: 3, text: 'Organisateurs d\'événements' },
        { type: 'paragraph', text: 'Lorsque vous achetez un billet, nous partageons votre nom, votre e-mail et votre numéro de téléphone avec l\'organisateur à des fins de gestion de l\'événement.' },
        { type: 'heading', level: 3, text: 'Prestataires de services' },
        { type: 'list', items: [
          'Prestataires de paiement (Stripe, MonCash)',
          'Fournisseurs de services e-mail (Resend)',
          'Fournisseurs d\'hébergement cloud (Firebase, Vercel)',
          'Services d\'analyse',
        ] },
        { type: 'heading', level: 3, text: 'Obligations légales' },
        { type: 'paragraph', text: 'Nous pouvons divulguer des informations lorsque la loi l\'exige ou pour protéger nos droits, nos biens ou notre sécurité.' },
        { type: 'heading', level: 2, text: '4. Sécurité des données' },
        { type: 'paragraph', text: 'Nous mettons en œuvre des mesures de sécurité conformes aux normes du secteur pour protéger vos données :' },
        { type: 'list', items: [
          'Chiffrement des données sensibles en transit et au repos',
          'Traitement des paiements sécurisé (conforme à la norme PCI DSS)',
          'Audits et mises à jour de sécurité réguliers',
          'Contrôles d\'accès et authentification',
          'Surveillance des activités suspectes',
        ] },
        { type: 'heading', level: 2, text: '5. Vos droits' },
        { type: 'paragraph', text: 'Vous avez le droit de :' },
        { type: 'list', items: [
          'Accéder à vos données personnelles',
          'Corriger des informations inexactes',
          'Demander la suppression de vos données',
          'Vous désabonner des communications marketing',
          'Exporter vos données',
          'Vous opposer au traitement des données',
        ] },
        { type: 'heading', level: 2, text: '6. Cookies et suivi' },
        { type: 'paragraph', text: 'Nous utilisons des cookies et des technologies similaires pour :' },
        { type: 'list', items: [
          'Mémoriser vos préférences et paramètres',
          'Maintenir votre session de connexion',
          'Analyser l\'utilisation et les performances du site',
          'Fournir du contenu personnalisé',
        ] },
        { type: 'paragraph', text: 'Vous pouvez contrôler les paramètres des cookies via les préférences de votre navigateur.' },
        { type: 'heading', level: 2, text: '7. Conservation des données' },
        { type: 'paragraph', text: 'Nous conservons vos données personnelles aussi longtemps que nécessaire pour fournir nos services et respecter nos obligations légales. Les registres d\'achat de billets sont conservés à des fins fiscales et comptables.' },
        { type: 'heading', level: 2, text: '8. Confidentialité des enfants' },
        { type: 'paragraph', text: 'Tikèm n\'est pas destiné aux enfants de moins de 13 ans. Nous ne collectons pas sciemment d\'informations personnelles auprès d\'enfants de moins de 13 ans.' },
        { type: 'heading', level: 2, text: '9. Transferts internationaux de données' },
        { type: 'paragraph', text: 'Vos informations peuvent être transférées et traitées dans des pays autres qu\'Haïti. Nous veillons à ce que des garanties appropriées soient en place pour de tels transferts.' },
        { type: 'heading', level: 2, text: '10. Modifications de cette politique' },
        { type: 'paragraph', text: 'Nous pouvons mettre à jour cette Politique de confidentialité périodiquement. Nous vous informerons des changements importants par e-mail ou notification sur la plateforme.' },
        { type: 'heading', level: 2, text: '11. Liens vers des tiers' },
        { type: 'paragraph', text: 'Notre plateforme peut contenir des liens vers des sites web tiers. Nous ne sommes pas responsables des pratiques de confidentialité de ces sites.' },
        { type: 'heading', level: 2, text: '12. Nous contacter' },
        { type: 'paragraph', text: 'Pour des questions liées à la confidentialité ou pour exercer vos droits :' },
        { type: 'list', items: [
          'E-mail : privacy@tikem.co',
          'Délégué à la protection des données : dpo@tikem.co',
          'Adresse : Port-au-Prince, Haïti',
        ] },
        { type: 'heading', level: 2, text: '13. Conformité au RGPD' },
        { type: 'paragraph', text: 'Pour les utilisateurs de l\'Union européenne, nous respectons les exigences du RGPD :' },
        { type: 'list', items: [
          'Base légale du traitement (consentement, contrat, intérêt légitime)',
          'Droit à la portabilité des données',
          'Droit à l\'oubli',
          'Notification des violations de données',
          'Protection de la vie privée dès la conception et par défaut',
        ] },
      ],
    },
    ht: {
      draft: true,
      title: 'Règleman sou konfidansyalite',
      updated: '23 novanm 2025',
      blocks: [
        { type: 'heading', level: 2, text: '1. Enfòmasyon nou kolekte' },
        { type: 'heading', level: 3, text: 'Enfòmasyon pèsonèl' },
        { type: 'paragraph', text: 'Lè w itilize Tikèm, nou ka kolekte :' },
        { type: 'list', items: [
          'Non ak adrès imèl',
          'Nimewo telefòn',
          'Enfòmasyon peman (tyès pati trete yo an sekirite)',
          'Enfòmasyon pwofil ak preferans',
          'Dokiman verifikasyon idantite (pou òganizatè evènman)',
        ] },
        { type: 'heading', level: 3, text: 'Enfòmasyon itilizasyon' },
        { type: 'list', items: [
          'Adrès IP ak enfòmasyon sou aparèy la',
          'Tip ak vèsyon navigatè',
          'Paj ou vizite ak tan ou pase sou paj yo',
          'Rechèch ak acha evènman',
          'Entèraksyon ak imèl ak notifikasyon',
        ] },
        { type: 'heading', level: 2, text: '2. Kijan nou itilize enfòmasyon ou' },
        { type: 'paragraph', text: 'Nou itilize enfòmasyon nou kolekte pou :' },
        { type: 'list', items: [
          'Trete acha tikè epi jere kont ou',
          'Voye konfimasyon ak rapèl evènman',
          'Bay sipò kliyan',
          'Pèsonalize eksperyans ou ak rekòmandasyon nou yo',
          'Anpeche fwod epi asire sekirite plafòm nan',
          'Analize abitid itilizasyon pou amelyore sèvis nou',
          'Voye kominikasyon maketing (ak konsantman ou)',
        ] },
        { type: 'heading', level: 2, text: '3. Pataj enfòmasyon' },
        { type: 'paragraph', text: 'Nou ka pataje enfòmasyon ou ak :' },
        { type: 'heading', level: 3, text: 'Òganizatè evènman' },
        { type: 'paragraph', text: 'Lè w achte yon tikè, nou pataje non w, imèl ou ak nimewo telefòn ou ak òganizatè evènman an pou zafè jesyon evènman an.' },
        { type: 'heading', level: 3, text: 'Founisè sèvis' },
        { type: 'list', items: [
          'Founisè peman (Stripe, MonCash)',
          'Founisè sèvis imèl (Resend)',
          'Founisè ebèjman nan nwaj (Firebase, Vercel)',
          'Sèvis analiz',
        ] },
        { type: 'heading', level: 3, text: 'Egzijans legal' },
        { type: 'paragraph', text: 'Nou ka divilge enfòmasyon lè lalwa mande sa oswa pou pwoteje dwa, byen oswa sekirite nou.' },
        { type: 'heading', level: 2, text: '4. Sekirite done' },
        { type: 'paragraph', text: 'Nou aplike mezi sekirite ki respekte estanda endistri a pou pwoteje done ou :' },
        { type: 'list', items: [
          'Chifreman done sansib pandan transfè ak lè yo sere',
          'Tretman peman an sekirite (konfòm ak PCI DSS)',
          'Odit ak mizajou sekirite regilye',
          'Kontwòl aksè ak otantifikasyon',
          'Siveyans pou aktivite sispèk',
        ] },
        { type: 'heading', level: 2, text: '5. Dwa ou' },
        { type: 'paragraph', text: 'Ou gen dwa pou :' },
        { type: 'list', items: [
          'Aksede done pèsonèl ou',
          'Korije enfòmasyon ki pa egzat',
          'Mande efase done ou',
          'Dezenskri nan kominikasyon maketing',
          'Ekspòte done ou',
          'Opoze ak tretman done',
        ] },
        { type: 'heading', level: 2, text: '6. Cookies ak swivi' },
        { type: 'paragraph', text: 'Nou itilize cookies ak teknoloji similè pou :' },
        { type: 'list', items: [
          'Sonje preferans ak paramèt ou',
          'Kenbe sesyon koneksyon ou',
          'Analize itilizasyon ak pèfòmans sit la',
          'Bay kontni pèsonalize',
        ] },
        { type: 'paragraph', text: 'Ou ka kontwole paramèt cookies yo atravè preferans navigatè ou.' },
        { type: 'heading', level: 2, text: '7. Konsèvasyon done' },
        { type: 'paragraph', text: 'Nou konsève done pèsonèl ou pandan tout tan ki nesesè pou bay sèvis nou epi respekte obligasyon legal. Nou konsève dosye acha tikè pou rezon fiskal ak kontablite.' },
        { type: 'heading', level: 2, text: '8. Konfidansyalite timoun' },
        { type: 'paragraph', text: 'Tikèm pa fèt pou timoun ki poko gen 13 an. Nou pa kolekte enfòmasyon pèsonèl timoun ki poko gen 13 an fè espre.' },
        { type: 'heading', level: 2, text: '9. Transfè done entènasyonal' },
        { type: 'paragraph', text: 'Enfòmasyon ou ka transfere epi trete nan lòt peyi ki pa Ayiti. Nou asire gen garanti ki apwopriye pou transfè sa yo.' },
        { type: 'heading', level: 2, text: '10. Chanjman nan règleman sa a' },
        { type: 'paragraph', text: 'Nou ka mete Règleman sou konfidansyalite sa a ajou detanzantan. Nou ap enfòme w sou chanjman enpòtan pa imèl oswa notifikasyon sou plafòm nan.' },
        { type: 'heading', level: 2, text: '11. Lyen tyès pati' },
        { type: 'paragraph', text: 'Plafòm nou an ka gen lyen ki mennen sou sit entènèt tyès pati. Nou pa responsab pratik konfidansyalite sit sa yo.' },
        { type: 'heading', level: 2, text: '12. Kontakte nou' },
        { type: 'paragraph', text: 'Pou kesyon ki gen rapò ak konfidansyalite oswa pou egzèse dwa ou :' },
        { type: 'list', items: [
          'Imèl : privacy@tikem.co',
          'Reskonsab pwoteksyon done : dpo@tikem.co',
          'Adrès : Pòtoprens, Ayiti',
        ] },
        { type: 'heading', level: 2, text: '13. Konfòmite ak RGPD' },
        { type: 'paragraph', text: 'Pou itilizatè nan Inyon Ewopeyen an, nou respekte egzijans RGPD yo :' },
        { type: 'list', items: [
          'Baz legal pou tretman (konsantman, kontra, enterè lejitim)',
          'Dwa pou pòtabilite done',
          'Dwa pou yo bliye w',
          'Notifikasyon vyolasyon done',
          'Konfidansyalite depi nan konsepsyon epi pa defo',
        ] },
      ],
    },
  },
}

const refunds = {
  slug: 'refunds',
  translations: {
    en: {
      title: 'Refund Policy',
      updated: 'November 23, 2025',
      blocks: [
        { type: 'heading', level: 2, text: '1. General Refund Policy' },
        { type: 'paragraph', text: "Refund policies for events are set by individual event organizers. Tikèm acts as a ticketing platform and facilitates refunds according to the organizer's stated policy." },
        { type: 'heading', level: 2, text: '2. Event Cancellation by Organizer' },
        { type: 'paragraph', text: 'If an event is cancelled by the organizer:' },
        { type: 'list', items: [
          'Full refunds will be issued automatically within 5-7 business days',
          'Refunds include the ticket price but may exclude service fees',
          'You will receive an email confirmation of the refund',
          'Refunds are processed to the original payment method',
        ] },
        { type: 'heading', level: 2, text: '3. Event Postponement' },
        { type: 'paragraph', text: 'If an event is postponed to a new date:' },
        { type: 'list', items: [
          'Your ticket remains valid for the new date',
          'You may request a refund if you cannot attend the new date',
          'Refund requests must be made within 7 days of the postponement announcement',
          'The organizer may offer credit for future events instead of refunds',
        ] },
        { type: 'heading', level: 2, text: '4. Attendee-Requested Refunds' },
        { type: 'paragraph', text: 'If you wish to cancel your ticket:' },
        { type: 'list', items: [
          "Refund availability depends on the event organizer's policy",
          'Most events offer refunds up to 48-72 hours before the event',
          'A cancellation fee may apply (typically 10-20% of ticket price)',
          'Some events may be non-refundable - check before purchasing',
          'Refunds must be requested through your account dashboard',
        ] },
        { type: 'heading', level: 2, text: '5. Service Fees' },
        { type: 'paragraph', text: 'Tikèm service fees:' },
        { type: 'list', items: [
          'Are non-refundable in most cases',
          'May be refunded if the event is cancelled by the organizer',
          'Cover platform costs, payment processing, and customer support',
        ] },
        { type: 'heading', level: 2, text: '6. Refund Timeline' },
        { type: 'list', items: [
          'Approved refunds: Processed within 5-7 business days',
          'Credit card refunds: May take an additional 3-5 days to appear',
          'Mobile payment refunds: Typically processed within 24-48 hours',
          'Bank transfers: May take up to 10 business days',
        ] },
        { type: 'heading', level: 2, text: '7. Exceptions and Special Cases' },
        { type: 'heading', level: 3, text: 'No Refunds For:' },
        { type: 'list', items: [
          'Events attended or checked in to',
          'Tickets transferred to another person',
          'Last-minute cancellations (within 24 hours of event)',
          'Weather-related issues (unless event is cancelled)',
          'Personal emergencies or schedule conflicts',
        ] },
        { type: 'heading', level: 3, text: 'Eligible for Refunds:' },
        { type: 'list', items: [
          'Duplicate ticket purchases',
          'Technical errors in booking',
          'Venue changes that are unreasonable',
          'Significant changes to event lineup or program',
        ] },
        { type: 'heading', level: 2, text: '8. How to Request a Refund' },
        { type: 'list', ordered: true, items: [
          'Log in to your Tikèm account',
          'Go to "My Tickets"',
          'Select the ticket you wish to refund',
          'Click "Request Refund"',
          'Provide a reason for the refund request',
          'Submit the request for review',
        ] },
        { type: 'heading', level: 2, text: '9. Refund Review Process' },
        { type: 'paragraph', text: 'Refund requests are reviewed by:' },
        { type: 'list', items: [
          'Event organizers (for organizer policy-based refunds)',
          'Tikèm support team (for platform issues)',
          'Review typically completed within 2-3 business days',
          'You will receive an email with the decision',
        ] },
        { type: 'heading', level: 2, text: '10. Disputed Charges' },
        { type: 'paragraph', text: 'If you believe you were charged incorrectly:' },
        { type: 'list', items: [
          'Contact our support team before disputing with your bank',
          'Provide transaction details and evidence',
          'We will investigate and respond within 48 hours',
          'Chargebacks may result in account suspension',
        ] },
        { type: 'heading', level: 2, text: '11. Gift Tickets and Promotional Codes' },
        { type: 'list', items: [
          'Tickets purchased with promotional codes follow standard refund policies',
          'Gift tickets may not be eligible for cash refunds',
          'Credit may be issued instead for promotional purchases',
        ] },
        { type: 'heading', level: 2, text: '12. Contact Support' },
        { type: 'paragraph', text: 'For refund-related questions:' },
        { type: 'list', items: [
          'Email: refunds@tikem.co',
          'Support: support@tikem.co',
          'Response Time: Within 24-48 hours',
        ] },
        { type: 'callout', title: '💡 Refund Tips', items: [
          "Always check the event's refund policy before purchasing",
          'Consider event insurance for expensive tickets',
          'Request refunds as early as possible',
          'Keep all confirmation emails for your records',
          'Contact support if you have questions before purchasing',
        ] },
      ],
    },
    fr: {
      draft: true,
      title: 'Politique de remboursement',
      updated: '23 novembre 2025',
      blocks: [
        { type: 'heading', level: 2, text: '1. Politique générale de remboursement' },
        { type: 'paragraph', text: 'Les politiques de remboursement des événements sont définies par chaque organisateur. Tikèm agit comme plateforme de billetterie et facilite les remboursements conformément à la politique annoncée par l\'organisateur.' },
        { type: 'heading', level: 2, text: '2. Annulation de l\'événement par l\'organisateur' },
        { type: 'paragraph', text: 'Si un événement est annulé par l\'organisateur :' },
        { type: 'list', items: [
          'Des remboursements complets seront émis automatiquement sous 5 à 7 jours ouvrables',
          'Les remboursements incluent le prix du billet mais peuvent exclure les frais de service',
          'Vous recevrez une confirmation du remboursement par e-mail',
          'Les remboursements sont effectués sur le mode de paiement d\'origine',
        ] },
        { type: 'heading', level: 2, text: '3. Report de l\'événement' },
        { type: 'paragraph', text: 'Si un événement est reporté à une nouvelle date :' },
        { type: 'list', items: [
          'Votre billet reste valable pour la nouvelle date',
          'Vous pouvez demander un remboursement si vous ne pouvez pas assister à la nouvelle date',
          'Les demandes de remboursement doivent être faites dans les 7 jours suivant l\'annonce du report',
          'L\'organisateur peut offrir un crédit pour de futurs événements au lieu d\'un remboursement',
        ] },
        { type: 'heading', level: 2, text: '4. Remboursements demandés par le participant' },
        { type: 'paragraph', text: 'Si vous souhaitez annuler votre billet :' },
        { type: 'list', items: [
          'La disponibilité du remboursement dépend de la politique de l\'organisateur',
          'La plupart des événements offrent des remboursements jusqu\'à 48 à 72 heures avant l\'événement',
          'Des frais d\'annulation peuvent s\'appliquer (généralement 10 à 20 % du prix du billet)',
          'Certains événements peuvent être non remboursables — vérifiez avant d\'acheter',
          'Les remboursements doivent être demandés depuis le tableau de bord de votre compte',
        ] },
        { type: 'heading', level: 2, text: '5. Frais de service' },
        { type: 'paragraph', text: 'Les frais de service Tikèm :' },
        { type: 'list', items: [
          'Ne sont pas remboursables dans la plupart des cas',
          'Peuvent être remboursés si l\'événement est annulé par l\'organisateur',
          'Couvrent les coûts de la plateforme, le traitement des paiements et le support client',
        ] },
        { type: 'heading', level: 2, text: '6. Délais de remboursement' },
        { type: 'list', items: [
          'Remboursements approuvés : traités sous 5 à 7 jours ouvrables',
          'Remboursements par carte : peuvent prendre 3 à 5 jours supplémentaires pour apparaître',
          'Remboursements par paiement mobile : généralement traités sous 24 à 48 heures',
          'Virements bancaires : peuvent prendre jusqu\'à 10 jours ouvrables',
        ] },
        { type: 'heading', level: 2, text: '7. Exceptions et cas particuliers' },
        { type: 'heading', level: 3, text: 'Aucun remboursement pour :' },
        { type: 'list', items: [
          'Les événements auxquels vous avez assisté ou pour lesquels vous vous êtes enregistré',
          'Les billets transférés à une autre personne',
          'Les annulations de dernière minute (dans les 24 heures précédant l\'événement)',
          'Les problèmes liés à la météo (sauf si l\'événement est annulé)',
          'Les urgences personnelles ou conflits d\'horaire',
        ] },
        { type: 'heading', level: 3, text: 'Éligible à un remboursement :' },
        { type: 'list', items: [
          'Achats de billets en double',
          'Erreurs techniques lors de la réservation',
          'Changements de lieu déraisonnables',
          'Changements importants de la programmation de l\'événement',
        ] },
        { type: 'heading', level: 2, text: '8. Comment demander un remboursement' },
        { type: 'list', ordered: true, items: [
          'Connectez-vous à votre compte Tikèm',
          'Allez dans « Mes billets »',
          'Sélectionnez le billet que vous souhaitez faire rembourser',
          'Cliquez sur « Demander un remboursement »',
          'Indiquez un motif pour la demande de remboursement',
          'Soumettez la demande pour examen',
        ] },
        { type: 'heading', level: 2, text: '9. Processus d\'examen des remboursements' },
        { type: 'paragraph', text: 'Les demandes de remboursement sont examinées par :' },
        { type: 'list', items: [
          'Les organisateurs (pour les remboursements liés à la politique de l\'organisateur)',
          'L\'équipe de support Tikèm (pour les problèmes de plateforme)',
          'L\'examen est généralement effectué sous 2 à 3 jours ouvrables',
          'Vous recevrez un e-mail avec la décision',
        ] },
        { type: 'heading', level: 2, text: '10. Contestation de débits' },
        { type: 'paragraph', text: 'Si vous pensez avoir été facturé de manière incorrecte :' },
        { type: 'list', items: [
          'Contactez notre équipe de support avant de contester auprès de votre banque',
          'Fournissez les détails de la transaction et des preuves',
          'Nous enquêterons et répondrons sous 48 heures',
          'Les rétrofacturations peuvent entraîner la suspension du compte',
        ] },
        { type: 'heading', level: 2, text: '11. Billets cadeaux et codes promotionnels' },
        { type: 'list', items: [
          'Les billets achetés avec des codes promotionnels suivent les politiques de remboursement standard',
          'Les billets cadeaux peuvent ne pas être éligibles à un remboursement en espèces',
          'Un crédit peut être émis à la place pour les achats promotionnels',
        ] },
        { type: 'heading', level: 2, text: '12. Contacter le support' },
        { type: 'paragraph', text: 'Pour les questions liées aux remboursements :' },
        { type: 'list', items: [
          'E-mail : refunds@tikem.co',
          'Support : support@tikem.co',
          'Délai de réponse : sous 24 à 48 heures',
        ] },
        { type: 'callout', title: '💡 Conseils de remboursement', items: [
          'Vérifiez toujours la politique de remboursement de l\'événement avant d\'acheter',
          'Envisagez une assurance événement pour les billets coûteux',
          'Demandez les remboursements le plus tôt possible',
          'Conservez tous les e-mails de confirmation pour vos dossiers',
          'Contactez le support si vous avez des questions avant d\'acheter',
        ] },
      ],
    },
    ht: {
      draft: true,
      title: 'Règleman ranbousman',
      updated: '23 novanm 2025',
      blocks: [
        { type: 'heading', level: 2, text: '1. Règleman jeneral sou ranbousman' },
        { type: 'paragraph', text: 'Se chak òganizatè evènman ki fikse règleman ranbousman pou evènman yo. Tikèm aji kòm yon plafòm biyetri epi li fasilite ranbousman selon règleman òganizatè a anonse.' },
        { type: 'heading', level: 2, text: '2. Anilasyon evènman pa òganizatè a' },
        { type: 'paragraph', text: 'Si òganizatè a anile yon evènman :' },
        { type: 'list', items: [
          'Yo ap fè ranbousman konplè otomatikman nan 5 a 7 jou ouvrab',
          'Ranbousman yo gen ladan pri tikè a men yo ka pa gen frè sèvis yo',
          'Ou ap resevwa yon konfimasyon ranbousman pa imèl',
          'Yo trete ranbousman yo sou menm mwayen peman orijinal la',
        ] },
        { type: 'heading', level: 2, text: '3. Ranvwa evènman' },
        { type: 'paragraph', text: 'Si yo ranvwaye yon evènman pou yon nouvo dat :' },
        { type: 'list', items: [
          'Tikè ou rete valab pou nouvo dat la',
          'Ou ka mande yon ranbousman si w pa ka prezan nan nouvo dat la',
          'Ou dwe fè demann ranbousman nan 7 jou apre anons ranvwa a',
          'Òganizatè a ka ofri kredi pou evènman fiti olye de ranbousman',
        ] },
        { type: 'heading', level: 2, text: '4. Ranbousman patisipan mande' },
        { type: 'paragraph', text: 'Si w vle anile tikè ou :' },
        { type: 'list', items: [
          'Disponiblite ranbousman an depann de règleman òganizatè a',
          'Pifò evènman ofri ranbousman jiska 48 a 72 èdtan anvan evènman an',
          'Yon frè anilasyon ka aplike (an jeneral 10 a 20 % nan pri tikè a)',
          'Kèk evènman ka pa ranbousab — tcheke anvan w achte',
          'Ou dwe mande ranbousman atravè tablo bò kont ou',
        ] },
        { type: 'heading', level: 2, text: '5. Frè sèvis' },
        { type: 'paragraph', text: 'Frè sèvis Tikèm yo :' },
        { type: 'list', items: [
          'Pa ranbousab nan pifò ka',
          'Ka ranbouse si òganizatè a anile evènman an',
          'Kouvri depans plafòm nan, tretman peman ak sipò kliyan',
        ] },
        { type: 'heading', level: 2, text: '6. Delè ranbousman' },
        { type: 'list', items: [
          'Ranbousman apwouve : trete nan 5 a 7 jou ouvrab',
          'Ranbousman kat kredi : ka pran 3 a 5 jou anplis pou parèt',
          'Ranbousman peman mobil : an jeneral trete nan 24 a 48 èdtan',
          'Transfè labank : ka pran jiska 10 jou ouvrab',
        ] },
        { type: 'heading', level: 2, text: '7. Eksepsyon ak ka espesyal' },
        { type: 'heading', level: 3, text: 'Pa gen ranbousman pou :' },
        { type: 'list', items: [
          'Evènman ou te ale oswa ou te anrejistre',
          'Tikè ou te transfere bay yon lòt moun',
          'Anilasyon dènye minit (nan 24 èdtan anvan evènman an)',
          'Pwoblèm ki gen rapò ak tan (sof si yo anile evènman an)',
          'Ijans pèsonèl oswa konfli orè',
        ] },
        { type: 'heading', level: 3, text: 'Kalifye pou ranbousman :' },
        { type: 'list', items: [
          'Acha tikè an doub',
          'Erè teknik pandan rezèvasyon',
          'Chanjman kote ki pa rezonab',
          'Chanjman enpòtan nan pwogram evènman an',
        ] },
        { type: 'heading', level: 2, text: '8. Kijan pou mande yon ranbousman' },
        { type: 'list', ordered: true, items: [
          'Konekte sou kont Tikèm ou',
          'Ale nan « Tikè m yo »',
          'Chwazi tikè ou vle ranbouse a',
          'Klike sou « Mande ranbousman »',
          'Bay yon rezon pou demann ranbousman an',
          'Soumèt demann nan pou revizyon',
        ] },
        { type: 'heading', level: 2, text: '9. Pwosesis revizyon ranbousman' },
        { type: 'paragraph', text: 'Men kiyès ki revize demann ranbousman yo :' },
        { type: 'list', items: [
          'Òganizatè evènman (pou ranbousman ki baze sou règleman òganizatè a)',
          'Ekip sipò Tikèm (pou pwoblèm plafòm nan)',
          'An jeneral revizyon an fèt nan 2 a 3 jou ouvrab',
          'Ou ap resevwa yon imèl ak desizyon an',
        ] },
        { type: 'heading', level: 2, text: '10. Chaj ou konteste' },
        { type: 'paragraph', text: 'Si w kwè yo te fè w peye pa kòrèk :' },
        { type: 'list', items: [
          'Kontakte ekip sipò nou anvan w konteste ak labank ou',
          'Bay detay tranzaksyon an ak prèv',
          'Nou ap fè ankèt epi reponn nan 48 èdtan',
          'Retrofakti ka lakòz sispansyon kont',
        ] },
        { type: 'heading', level: 2, text: '11. Tikè kado ak kòd pwomosyonèl' },
        { type: 'list', items: [
          'Tikè yo achte ak kòd pwomosyonèl swiv règleman ranbousman estanda',
          'Tikè kado ka pa kalifye pou ranbousman an lajan kach',
          'Yo ka bay kredi olye de sa pou acha pwomosyonèl',
        ] },
        { type: 'heading', level: 2, text: '12. Kontakte sipò' },
        { type: 'paragraph', text: 'Pou kesyon ki gen rapò ak ranbousman :' },
        { type: 'list', items: [
          'Imèl : refunds@tikem.co',
          'Sipò : support@tikem.co',
          'Delè repons : nan 24 a 48 èdtan',
        ] },
        { type: 'callout', title: '💡 Konsèy sou ranbousman', items: [
          'Toujou tcheke règleman ranbousman evènman an anvan w achte',
          'Konsidere yon asirans evènman pou tikè ki chè',
          'Mande ranbousman pi bonè posib',
          'Kenbe tout imèl konfimasyon pou dosye w',
          'Kontakte sipò si w gen kesyon anvan w achte',
        ] },
      ],
    },
  },
}

// `--only=terms` (comma-separated slugs) re-seeds just those pages, so a terms
// update does not also overwrite privacy/refunds/support.
const onlyArg = process.argv.find((a) => a.startsWith('--only='))
const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',').map((s) => s.trim())) : null
const pages = [terms, privacy, refunds, support].filter((p) => !only || only.has(p.slug))

async function main() {
  console.log('🌱 Seeding content_pages (per-language)...\n')
  for (const page of pages) {
    await db.collection('content_pages').doc(page.slug).set(page)
    const counts = Object.entries(page.translations)
      .map(([lang, c]) => `${lang}:${c.blocks.length}`)
      .join('  ')
    console.log(`✅ ${page.slug} — ${counts}`)
  }
  console.log('\n✅ Seed complete')
  process.exit(0)
}

main().catch((err) => {
  console.error('❌ Seed failed:', err)
  process.exit(1)
})
