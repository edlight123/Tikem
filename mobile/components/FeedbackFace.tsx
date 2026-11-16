import { Frown, Laugh, Smile, type LucideIcon } from 'lucide-react-native';

/**
 * The three post-event ratings as line faces (not emoji: emoji render in the
 * phone's own colorful style, which reads cheap next to the POSH canvas).
 * 1 = meh, 2 = good, 3 = loved it. Shared by the attendee sheet and the
 * organizer recap so both show the same marks.
 */
export const FEEDBACK_FACES: Array<{ rating: 1 | 2 | 3; Icon: LucideIcon; key: string }> = [
  { rating: 1, Icon: Frown, key: 'eventFeedback.faces.meh' },
  { rating: 2, Icon: Smile, key: 'eventFeedback.faces.good' },
  { rating: 3, Icon: Laugh, key: 'eventFeedback.faces.great' },
];

export const faceIcon = (rating: number): LucideIcon | null =>
  FEEDBACK_FACES.find((f) => f.rating === rating)?.Icon ?? null;
