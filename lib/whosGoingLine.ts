/**
 * The website's who's-going sentence under an event's faces (same grammar as
 * the app's mobile/lib/whosGoingLine.ts): which whos_going.line.* template,
 * and the count to fill.
 *
 * `count` is only set for templates that print a number. i18next picks a
 * plural form from `count`, and in French 0 and 1 are both "one": passing
 * count 0 to "you_lead" made it resolve "you_lead_one" ("Vous, Olivier et 1
 * autre") for a line with nobody else in it.
 */

export type WhosGoingLineInput = {
  viewerIsGoing: boolean
  leadName: string
  secondName: string
  totalGoing: number
  sayCount: boolean
}

export function whosGoingLineKey({
  viewerIsGoing,
  leadName,
  secondName,
  totalGoing,
  sayCount,
}: WhosGoingLineInput): { key: string; count?: number; others: number } {
  const second = viewerIsGoing ? '' : secondName
  const others = Math.max(0, totalGoing - (viewerIsGoing ? 1 : 0) - (leadName ? 1 : 0) - (second ? 1 : 0))
  const pick = (none: string, one: string, many: string, vague?: string) => {
    if (others === 0) return { key: none, others }
    if (vague && !sayCount) return { key: vague, others }
    return others === 1 ? { key: one, others } : { key: many, count: others, others }
  }
  if (viewerIsGoing) {
    return leadName ? pick('you_lead', 'you_lead_one', 'you_lead_others') : pick('you_only', 'you_one', 'you_others')
  }
  if (second) return pick('lead_second', 'lead_second_one', 'lead_second_others', 'lead_second_vague')
  if (leadName) return pick('lead_only', 'lead_one', 'lead_others', 'lead_vague')
  return sayCount ? { key: 'count', count: totalGoing, others } : { key: 'vague', others }
}
