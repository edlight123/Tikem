/**
 * "Good to know" on the event page: the venue details the organizer ticked
 * (lib/venueDetails), as quiet line-icon rows, the same as the website's
 * components/events/VenueDetailsList. Renders nothing when the event says
 * nothing.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Accessibility, House, IdCard, Luggage, Shirt, SquareParking, Tent, Toilet, Trees } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import SectionHeader from './SectionHeader';
import { venueDetailLines, venueDetailsOf, type VenueDetailIcon } from '../lib/venueDetails';

const ICONS: Record<VenueDetailIcon, React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>> = {
  parking: SquareParking,
  step_free: Accessibility,
  accessible_washrooms: Toilet,
  coat_check: Luggage,
  indoor: House,
  outdoor: Trees,
  mixed: Tent,
  age: IdCard,
  dress: Shirt,
};

export default function VenueDetailsLines({ event, style }: { event: unknown; style?: any }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const lines = venueDetailLines(venueDetailsOf(event));
  if (!lines.length) return null;
  return (
    <View style={style}>
      <SectionHeader title={t('venueDetails.title')} />
      <View style={styles.list}>
        {lines.map((line) => {
          const Icon = ICONS[line.icon];
          return (
            <View key={line.key} style={styles.row}>
              <Icon size={18} color={colors.textSecondary} strokeWidth={1.75} />
              <Text style={[styles.text, { color: colors.text }]}>
                {t(`venueDetails.lines.${line.key}`, line.value ? { value: line.value } : undefined)}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  text: { flex: 1, fontSize: 15, lineHeight: 21 },
});
