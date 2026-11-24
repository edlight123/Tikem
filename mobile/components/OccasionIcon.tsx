// The line icon for an occasion (lib/occasions `icon`), from lucide-react-native.
// A fixed map so only these twelve icons are bundled.

import React from 'react';
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
} from 'lucide-react-native';
import type { OccasionIcon as IconName } from '../lib/occasions';

const ICONS: Record<IconName, typeof Globe> = {
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
};

export default function OccasionIcon({ name, size = 14, color }: { name: IconName; size?: number; color: string }) {
  const Icon = ICONS[name] ?? Globe;
  return <Icon size={size} color={color} strokeWidth={1.75} />;
}
