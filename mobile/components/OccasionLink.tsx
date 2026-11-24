// The event screen's small occasion line ("Kanaval ›" under the title) when
// the event is tagged for one (lib/occasions). Opens the occasion's page.
// Nothing for an unknown or missing key.

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { Touchable } from './ui/Touchable';
import OccasionIcon from './OccasionIcon';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { occasionByKey, occasionName, parseOccasion } from '../lib/occasions';

export default function OccasionLink({ occasion, onPress }: { occasion: unknown; onPress: (key: string) => void }) {
  const { colors } = useTheme();
  const { t, language } = useI18n();
  const key = parseOccasion(occasion);
  if (!key) return null;
  const name = occasionName(key, language);
  return (
    <Touchable
      onPress={() => onPress(key)}
      style={styles.row}
      hitSlop={8}
      accessibilityRole="link"
      accessibilityLabel={t('occasions.partOf', { name })}
    >
      <OccasionIcon name={occasionByKey(key)!.icon} color={colors.textSecondary} />
      <Text style={[styles.text, { color: colors.textSecondary }]} numberOfLines={1}>
        {name}
      </Text>
      <ChevronRight size={14} color={colors.textTertiary} />
    </Touchable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 8, paddingVertical: 2 },
  text: { fontSize: 13, letterSpacing: 0.2 },
});
