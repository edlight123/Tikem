import React from 'react';
import { Building2 } from 'lucide-react-native';

/**
 * Stand-in for an organizer with no logo: an organization glyph, not the
 * first letter of the name (a letter reads as a person, and every "Tikèm"-
 * style brand collapsed to the same "T"). Sized to the mark it sits in.
 */
export default function OrgMark({ size, color }: { size: number; color: string }) {
  return <Building2 size={Math.round(size * 0.46)} color={color} strokeWidth={1.8} />;
}
