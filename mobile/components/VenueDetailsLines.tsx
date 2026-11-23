/**
 * "Good to know" on the event page: the venue details the organizer ticked
 * (lib/venueDetails), as quiet line-icon rows, the same as the website's
 * components/events/VenueDetailsList. What the place has, the setting and
 * the rules first; accessibility under its own short "accessibility"
 * heading. Renders nothing when the event says nothing.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import {
  Accessibility,
  AirVent,
  Armchair,
  ArrowUpDown,
  Captions,
  CircleParking,
  Dog,
  DoorOpen,
  Hand,
  House,
  IdCard,
  Luggage,
  Martini,
  PlugZap,
  ShieldCheck,
  Shirt,
  Sofa,
  SquareParking,
  Tent,
  Toilet,
  Trees,
  Utensils,
  VolumeOff,
} from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import SectionHeader from './SectionHeader';
import { font } from '../theme/tokens';
import {
  venueAccessLines,
  venueDetailLines,
  venueDetailsOf,
  type VenueDetailIcon,
  type VenueDetailLine,
} from '../lib/venueDetails';

const ICONS: Record<VenueDetailIcon, React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>> = {
  parking: SquareParking,
  backup_power: PlugZap,
  air_conditioning: AirVent,
  security: ShieldCheck,
  table_service: Sofa,
  food: Utensils,
  bar: Martini,
  coat_check: Luggage,
  step_free: DoorOpen,
  wheelchair: Accessibility,
  elevator: ArrowUpDown,
  accessible_washrooms: Toilet,
  accessible_parking: CircleParking,
  seating: Armchair,
  sign_language: Hand,
  captions: Captions,
  quiet_room: VolumeOff,
  service_animals: Dog,
  indoor: House,
  outdoor: Trees,
  mixed: Tent,
  age: IdCard,
  dress: Shirt,
};

function Lines({ lines }: { lines: VenueDetailLine[] }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
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
  );
}

export default function VenueDetailsLines({ event, style }: { event: unknown; style?: any }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const d = venueDetailsOf(event);
  const facts = venueDetailLines(d);
  const access = venueAccessLines(d);
  if (!facts.length && !access.length) return null;
  return (
    <View style={style}>
      <SectionHeader title={t('venueDetails.title')} />
      {facts.length > 0 && <Lines lines={facts} />}
      {access.length > 0 && (
        <View style={facts.length ? styles.accessBlock : undefined}>
          <Text style={[styles.subTitle, { color: colors.text }]}>{t('venueDetails.accessibilityTitle').toLowerCase()}</Text>
          <Lines lines={access} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  text: { flex: 1, fontSize: 15, lineHeight: 21 },
  accessBlock: { marginTop: 20 },
  subTitle: { fontFamily: font.serif, fontWeight: '400', fontSize: 18, lineHeight: 22, marginBottom: 6 },
});
