// The line icon for an occasion (lib/occasions `icon`), from lucide-react.
// A fixed map rather than a dynamic lookup so only these twelve are bundled.

import {
  Drama,
  Drum,
  Flag,
  Flame,
  Gift,
  Globe,
  Heart,
  HeartHandshake,
  Landmark,
  PartyPopper,
  Soup,
  Sun,
  type LucideIcon,
} from 'lucide-react'
import type { OccasionIcon as IconName } from '@/lib/occasions'

const ICONS: Record<IconName, LucideIcon> = {
  Drama,
  Drum,
  Flag,
  Flame,
  Gift,
  Globe,
  Heart,
  HeartHandshake,
  Landmark,
  PartyPopper,
  Soup,
  Sun,
}

export default function OccasionIcon({ name, className }: { name: IconName; className?: string }) {
  const Icon = ICONS[name] ?? Globe
  return <Icon aria-hidden className={className} strokeWidth={1.75} />
}
