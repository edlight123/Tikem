/**
 * The who's-going sentence under an event's face pile ("You're going with
 * Olivier and 93 others", "Olivier et 93 autres y vont", "Olivier ak 93 lòt
 * moun prale"). Pure, so the grammar can be tested in every language.
 *
 * The locale templates (whosGoing.line.*) keep {you}, {lead} and {second} as
 * placeholders so the screen can draw those words in semibold; {count} and
 * {total} are filled by t(). "One" keys are the singular forms ("and 1 other",
 * "et une autre personne"), so a template never has to say "1 autres".
 */

export type WhosGoingLineInput = {
  /** The signed-in person has a ticket: the line starts with "You". */
  viewerIsGoing: boolean;
  /** First name of the first face, or '' when there is none. */
  leadName: string;
  /** First name of the second face ('' when the viewer leads the line). */
  secondName: string;
  /** Everyone going, the viewer included. */
  totalGoing: number;
  /** Whether the line may state a number (else "and others"). */
  sayCount: boolean;
};

export type WhosGoingLine = {
  key: string;
  /** People going beyond the viewer and the named faces. */
  count: number;
  total: number;
};

export function whosGoingLine({
  viewerIsGoing,
  leadName,
  secondName,
  totalGoing,
  sayCount,
}: WhosGoingLineInput): WhosGoingLine {
  const second = viewerIsGoing ? '' : secondName;
  const namedCount = (leadName ? 1 : 0) + (second ? 1 : 0);
  const count = Math.max(0, totalGoing - (viewerIsGoing ? 1 : 0) - namedCount);
  const many = (one: string, other: string) => `whosGoing.line.${count === 1 ? one : other}`;
  const k = (name: string) => `whosGoing.line.${name}`;
  let key: string;
  if (viewerIsGoing) {
    if (leadName) key = count > 0 ? many('youLeadOne', 'youLeadOthers') : k('youLead');
    else key = count > 0 ? many('youOne', 'youOthers') : k('youOnly');
  } else if (second) {
    key = count === 0 ? k('leadSecond') : sayCount ? many('leadSecondOne', 'leadSecondOthers') : k('leadSecondVague');
  } else if (leadName) {
    key = count === 0 ? k('leadOnly') : sayCount ? many('leadOne', 'leadOthers') : k('leadOthersVague');
  } else {
    key = sayCount ? (totalGoing === 1 ? k('countOne') : k('count')) : k('vague');
  }
  return { key, count, total: totalGoing };
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** The line as plain text (accessibility label, tests). */
export function formatWhosGoingLine(t: Translate, input: WhosGoingLineInput): string {
  const line = whosGoingLine(input);
  return t(line.key, { count: line.count, total: line.total })
    .replace('{you}', t('whosGoing.youBadge'))
    .replace('{lead}', input.leadName)
    .replace('{second}', input.viewerIsGoing ? '' : input.secondName);
}

/** "94 going" / "1 participant": the bare count, singular when it is one. */
export function goingCountKey(total: number): string {
  return total === 1 ? 'whosGoing.goingCountOne' : 'whosGoing.goingCount';
}
