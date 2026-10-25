import { renderEmail, title, eyebrow, p, gap, button, C } from '@/lib/email-kit/layout'
import type { EmailLang } from '@/lib/email-kit/i18n'
import type { TeamRole } from '@/lib/organizer/teamRoles'

/** "Join {org} on Tikèm as {role}": the organization team invite (lib/organizer/context). */

const COPY = {
  en: {
    subject: (o: string) => `You're invited to join ${o} on Tikèm`,
    preheader: (o: string, r: string) => `Join ${o} as ${r}.`,
    status: 'Invite',
    eyebrow: 'Team invitation',
    headline: (o: string) => `Join ${o}`,
    body: (o: string, r: string, by: string) =>
      `${by} invited you to help run ${o} on Tikèm as ${r}. Accept with the account you want to use; you can switch between your own account and ${o} anytime.`,
    roles: {
      admin: 'an admin (events, orders, guests, team and settings)',
      manager: 'a manager (events, orders, guests and check-in)',
      staff: 'staff (door check-in for the events you are added to)',
    },
    accept: 'Accept the invite',
    expires: 'This invite expires in 7 days.',
  },
  fr: {
    subject: (o: string) => `Invitation à rejoindre ${o} sur Tikèm`,
    preheader: (o: string, r: string) => `Rejoignez ${o} en tant que ${r}.`,
    status: 'Invitation',
    eyebrow: "Invitation à l'équipe",
    headline: (o: string) => `Rejoignez ${o}`,
    body: (o: string, r: string, by: string) =>
      `${by} vous invite à gérer ${o} sur Tikèm en tant que ${r}. Acceptez avec le compte que vous voulez utiliser ; vous pourrez passer de votre compte à ${o} à tout moment.`,
    roles: {
      admin: 'administrateur (événements, commandes, invités, équipe et paramètres)',
      manager: 'gestionnaire (événements, commandes, invités et contrôle)',
      staff: "membre du staff (contrôle à l'entrée des événements où vous êtes ajouté)",
    },
    accept: "Accepter l'invitation",
    expires: 'Cette invitation expire dans 7 jours.',
  },
  ht: {
    subject: (o: string) => `Yo envite w nan ${o} sou Tikèm`,
    preheader: (o: string, r: string) => `Vin nan ${o} kòm ${r}.`,
    status: 'Envitasyon',
    eyebrow: 'Envitasyon ekip',
    headline: (o: string) => `Vin nan ${o}`,
    body: (o: string, r: string, by: string) =>
      `${by} envite w ede jere ${o} sou Tikèm kòm ${r}. Aksepte ak kont ou vle itilize a; ou ka pase de kont pa w la a ${o} nenpòt lè.`,
    roles: {
      admin: 'administratè (evènman, kòmand, envite, ekip ak paramèt)',
      manager: 'jeran (evènman, kòmand, envite ak kontwòl antre)',
      staff: 'estaf (kontwòl antre pou evènman yo mete w ladan yo)',
    },
    accept: 'Aksepte envitasyon an',
    expires: 'Envitasyon sa a ap ekspire nan 7 jou.',
  },
} as const

export function teamInviteEmail(params: {
  lang: EmailLang
  orgName: string
  invitedBy: string
  role: TeamRole
  acceptUrl: string
}): { subject: string; html: string } {
  const t = COPY[params.lang] || COPY.en
  const org = params.orgName.replace(/[\r\n]+/g, ' ').trim() || 'Tikèm'
  const by = params.invitedBy.replace(/[\r\n]+/g, ' ').trim() || org
  const role = t.roles[params.role]
  const html = renderEmail({
    lang: params.lang,
    title: t.headline(org),
    preheader: t.preheader(org, role),
    status: { label: t.status, tone: 'teal' },
    footer: 'account',
    blocks: [
      eyebrow(t.eyebrow),
      title(t.headline(org), 34),
      gap(20),
      p(t.body(org, role, by)),
      gap(4),
      button(t.accept, params.acceptUrl),
      gap(20),
      p(t.expires, C.text3),
    ],
  })
  return { subject: t.subject(org), html }
}
