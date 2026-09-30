/**
 * How the guest list appears on the event page — faces, a count, or nothing —
 * chosen by tapping the eye on a live preview of the row the public will see.
 *
 * Port of the web composer's control (components/organizer/GuestlistVisibility
 * .tsx). It replaced an on/off Switch labelled "Show guest list", which could
 * only express two of the three states the web writes and so could not say
 * "show how many, but not who". "Who's going" and "how many are going" sound
 * alike as settings; as pictures they are obviously different, so the choice is
 * made by looking at the row rather than parsing a label.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { Eye, EyeOff, Hash } from 'lucide-react-native';
import { useI18n } from '../contexts/I18nContext';
import { radius } from '../theme/tokens';
import {
  GUESTLIST_VISIBILITIES,
  nextGuestlistVisibility,
  type GuestlistVisibility,
} from '../lib/guestlistVisibility';

const ICONS: Record<GuestlistVisibility, typeof Eye> = { faces: Eye, count: Hash, hidden: EyeOff };

/**
 * Stand-in guests, the same four photos the web preview uses (every id was
 * checked there). Named so the faces preview reads "Mika and 23 others going"
 * rather than the bare count the count mode prints. Never written anywhere.
 */
const unsplashFace = (photo: string) =>
  `https://images.unsplash.com/photo-${photo}?w=96&h=96&fit=crop&q=80`;
const SAMPLE_FACES = [
  { id: 's1', name: 'Mika', photoUrl: unsplashFace('1662850886700-4ec19bd30d11') },
  { id: 's2', name: 'Sherlie', photoUrl: unsplashFace('1531123897727-8f129e1688ce') },
  { id: 's3', name: 'Jonas', photoUrl: unsplashFace('1522529599102-193c0d76b5b6') },
  { id: 's4', name: 'Farah', photoUrl: unsplashFace('1507152832244-10d45c7eda57') },
];
const SAMPLE_COUNT = 24;
const FACE = 36;

export default function GuestlistVisibilityPicker({
  value,
  onChange,
  colors,
}: {
  value: GuestlistVisibility;
  onChange: (v: GuestlistVisibility) => void;
  colors: any;
}) {
  const { t } = useI18n();
  const styles = getStyles(colors);
  const k = (key: string) => `organizerCreateEventFlow.canvas.guestVis.${key}`;

  const sentence =
    value === 'hidden'
      ? t(k('previewHidden'))
      : value === 'count'
        ? t(k('previewCount'), { count: SAMPLE_COUNT })
        : t(k('previewFaces'), { name: SAMPLE_FACES[0].name, count: SAMPLE_COUNT - 1 });

  const Icon = ICONS[value];
  const upcoming = nextGuestlistVisibility(value);
  const dimmed = value === 'hidden';

  return (
    <View style={styles.block}>
      <Text style={styles.label}>{t(k('legend'))}</Text>
      <View style={styles.row}>
        {value !== 'count' && (
          <View style={[styles.pile, dimmed && styles.pileDim]}>
            {SAMPLE_FACES.map((f, i) => (
              <Image
                key={f.id}
                source={{ uri: f.photoUrl }}
                style={[styles.face, { marginLeft: i === 0 ? 0 : -FACE * 0.3, zIndex: i }]}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
            ))}
          </View>
        )}

        <View style={styles.textCol} accessibilityLiveRegion="polite">
          <Text style={styles.sentence}>{sentence}</Text>
          <Text style={styles.hint}>{t(k(`${value}Hint`))}</Text>
        </View>

        <TouchableOpacity
          onPress={() => onChange(upcoming)}
          style={[styles.cycle, dimmed && styles.cycleDim]}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel={t(k('cycleAria'), { current: t(k(value)), next: t(k(upcoming)) })}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          <Icon size={17} color={dimmed ? colors.textSecondary : colors.text} />
          {/* Every caption is laid out, but only the live one has height, so
              the column is always as wide as its widest label and the button
              never resizes under the finger (the web hit exactly this). */}
          <View>
            {GUESTLIST_VISIBILITIES.map((v) => (
              <Text
                key={v}
                style={[styles.caption, v !== value && styles.captionCollapsed]}
                importantForAccessibility="no"
                accessibilityElementsHidden
              >
                {t(k(`${v}Short`))}
              </Text>
            ))}
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const getStyles = (colors: any) =>
  StyleSheet.create({
    block: {
      paddingVertical: 16,
      gap: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    label: { fontSize: 16, fontWeight: '600', color: colors.text },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 12,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
    },
    pile: { flexDirection: 'row' },
    pileDim: { opacity: 0.3 },
    face: {
      width: FACE,
      height: FACE,
      borderRadius: FACE / 2,
      borderWidth: 2,
      borderColor: colors.surface,
      backgroundColor: colors.surfaceRaised,
    },
    textCol: { flex: 1, minWidth: 0 },
    sentence: { fontSize: 15, fontWeight: '600', color: colors.text, lineHeight: 19 },
    hint: { marginTop: 3, fontSize: 11, color: colors.textSecondary, lineHeight: 15 },
    cycle: {
      minHeight: 44,
      paddingHorizontal: 10,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      backgroundColor: colors.surfaceRaised,
    },
    cycleDim: { opacity: 0.75 },
    caption: {
      fontSize: 9,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      fontWeight: '600',
      color: colors.text,
      textAlign: 'center',
    },
    // Keeps its width in the column, gives up its height.
    captionCollapsed: { height: 0, overflow: 'hidden', opacity: 0 },
  });
