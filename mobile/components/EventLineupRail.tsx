/**
 * The bill, on the event page — a peeking horizontal rail of circular
 * portraits under an editorial "lineup" header.
 *
 * Reads the same `guestlist` records the web's components/events/EventLineup
 * renders (via lib/lineup), and degrades the same way: no photo falls back to
 * the initial, no set time omits it, no link or bio makes the act static.
 * An act with a bio or a link opens a small sheet with the whole entry.
 *
 * Renders nothing at all when there is no lineup, so the section never
 * appears as an empty heading.
 */

import React, { useMemo, useState } from 'react';
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { ArrowUpRight } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import SectionHeader from './SectionHeader';
import {
  ROLE_LABEL_KEY,
  lineupFromEvent,
  lineupLinkLabel,
  lineupTimeRange,
  safeLineupLink,
  type LineupEntry,
} from '../lib/lineup';
import { font, radius } from '../theme/tokens';

const PORTRAIT = 88;

interface Props {
  guestlist: unknown;
  /** The page's horizontal gutter, so the rail can bleed past it. */
  gutter?: number;
}

export default function EventLineupRail({ guestlist, gutter = 18 }: Props) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const styles = getStyles(colors);
  const entries = useMemo(() => lineupFromEvent(guestlist), [guestlist]);
  const [open, setOpen] = useState<LineupEntry | null>(null);

  if (entries.length === 0) return null;

  const roleLabel = (g: LineupEntry) => t(`organizerCreateEventFlow.canvas.lineup.roles.${ROLE_LABEL_KEY[g.role]}`);
  const openHref = open ? safeLineupLink(open.link) : null;

  return (
    <View style={styles.section}>
      <SectionHeader title={t('eventDetail.lineup.title')} />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // Bleed past the page gutter so the half-cut portrait signals "swipe".
        style={{ marginHorizontal: -gutter }}
        contentContainerStyle={[styles.rail, { paddingHorizontal: gutter }]}
      >
        {entries.map((g) => {
          const when = lineupTimeRange(g.startTime, g.endTime);
          const tappable = !!g.description || !!safeLineupLink(g.link);
          const body = (
            <>
              <View style={styles.portrait}>
                {g.photoUrl ? (
                  <Image
                    source={{ uri: g.photoUrl }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    transition={120}
                  />
                ) : (
                  <Text style={styles.initial}>{g.name.trim().charAt(0).toUpperCase()}</Text>
                )}
              </View>
              <Text style={styles.name} numberOfLines={2}>
                {g.name}
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                {roleLabel(g)}
              </Text>
              {!!when && (
                <Text style={styles.time} numberOfLines={1}>
                  {when}
                </Text>
              )}
            </>
          );
          return tappable ? (
            <TouchableOpacity
              key={g.id}
              style={styles.item}
              activeOpacity={0.8}
              onPress={() => setOpen(g)}
              accessibilityRole="button"
              accessibilityLabel={`${g.name}, ${roleLabel(g)}`}
            >
              {body}
            </TouchableOpacity>
          ) : (
            <View key={g.id} style={styles.item} accessible accessibilityLabel={`${g.name}, ${roleLabel(g)}`}>
              {body}
            </View>
          );
        })}
      </ScrollView>

      <Modal visible={!!open} transparent animationType="slide" onRequestClose={() => setOpen(null)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(null)} />
        {open && (
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.handle} />
            <View style={styles.sheetHead}>
              <View style={[styles.portrait, styles.sheetPortrait]}>
                {open.photoUrl ? (
                  <Image source={{ uri: open.photoUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
                ) : (
                  <Text style={styles.initial}>{open.name.trim().charAt(0).toUpperCase()}</Text>
                )}
              </View>
              <View style={styles.sheetHeadText}>
                <Text style={styles.sheetName} numberOfLines={2}>
                  {open.name}
                </Text>
                <Text style={styles.sheetMeta}>
                  {roleLabel(open)}
                  {lineupTimeRange(open.startTime, open.endTime)
                    ? `  ·  ${lineupTimeRange(open.startTime, open.endTime)}`
                    : ''}
                </Text>
              </View>
            </View>
            {!!open.description && <Text style={styles.sheetBody}>{open.description}</Text>}
            {openHref && (
              <TouchableOpacity
                style={styles.linkBtn}
                onPress={() => Linking.openURL(openHref).catch(() => undefined)}
                activeOpacity={0.8}
                accessibilityRole="link"
                accessibilityLabel={t('eventDetail.lineup.openLink')}
              >
                <Text style={styles.linkText} numberOfLines={1}>
                  {lineupLinkLabel(openHref)}
                </Text>
                <ArrowUpRight size={18} color={colors.text} />
              </TouchableOpacity>
            )}
          </View>
        )}
      </Modal>
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    section: { paddingTop: 22, paddingBottom: 6 },
    rail: { gap: 16 },
    item: { width: PORTRAIT + 8, alignItems: 'center' },
    portrait: {
      width: PORTRAIT,
      height: PORTRAIT,
      borderRadius: radius.pill,
      overflow: 'hidden',
      backgroundColor: colors.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    initial: { fontFamily: font.serif, fontSize: 36, color: colors.text },
    name: {
      marginTop: 10,
      fontSize: 14,
      lineHeight: 18,
      fontWeight: '600',
      color: colors.text,
      textAlign: 'center',
    },
    meta: {
      marginTop: 2,
      fontSize: 12,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    time: {
      marginTop: 1,
      fontSize: 11,
      color: colors.textTertiary,
      textAlign: 'center',
      fontVariant: ['tabular-nums'],
    },

    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
    sheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingHorizontal: 20,
      paddingTop: 10,
    },
    handle: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      marginBottom: 18,
    },
    sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 16 },
    sheetPortrait: { width: 76, height: 76 },
    sheetHeadText: { flex: 1, minWidth: 0 },
    sheetName: { fontFamily: font.serif, fontSize: 30, lineHeight: 34, color: colors.text },
    sheetMeta: { marginTop: 4, fontSize: 13, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
    sheetBody: { marginTop: 18, fontSize: 15, lineHeight: 22, color: colors.text },
    // Secondary action — a dark-grey fill; the page's one white pill is the ticket CTA.
    linkBtn: {
      marginTop: 20,
      height: 52,
      borderRadius: radius.button,
      backgroundColor: colors.surfaceRaised,
      paddingHorizontal: 16,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    linkText: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  });
