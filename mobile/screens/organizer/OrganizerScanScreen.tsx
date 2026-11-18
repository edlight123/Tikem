import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, StatusBar, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { useAppAlert } from '../../components/AppAlert';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTabBarSpace } from '../../hooks/useTabBarSpace';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../config/firebase';
import SectionHeader from '../../components/SectionHeader';
import { Calendar, DoorOpen, Image as ImageIcon, ScanLine, ScanQrCode, UserSearch } from 'lucide-react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { useActiveOrg } from '../../lib/activeOrg';
import { useI18n } from '../../contexts/I18nContext';
import { getTodayEvents, TodayEvent } from '../../lib/api/organizer';
import { colors as T, radius, font } from '../../theme/tokens';
import EventSelectorSheet from '../../components/organizer/EventSelectorSheet';
import EmptyState from '../../components/EmptyState';
import WhitePillCTA from '../../components/WhitePillCTA';
import StatusChip from '../../components/StatusChip';
import { Skeleton } from '../../components/Skeleton';

import { Touchable } from '../../components/ui/Touchable';

/** How many recent check-ins the list under the actions shows. */
const RECENT_CHECKINS_MAX = 8;

type RecentCheckIn = { id: string; name: string; tier: string; at: number };

/** checked_in_at is a Firestore Timestamp on scanner writes, an ISO string on some older ones. */
function checkInMillis(raw: any): number {
  if (!raw) return 0;
  if (typeof raw?.toMillis === 'function') return raw.toMillis();
  if (typeof raw?.seconds === 'number') return raw.seconds * 1000;
  const n = new Date(raw).getTime();
  return Number.isFinite(n) ? n : 0;
}

export default function OrganizerScanScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const navigation = useNavigation<any>();
  const { userProfile } = useAuth();
  // Acting org (own or a team's), not the signed-in uid: lib/activeOrg.ts.
  const { orgId } = useActiveOrg();
  const { t, language } = useI18n();
  const showAlert = useAppAlert();
  const locale = language === 'fr' ? 'fr-FR' : language === 'ht' ? 'fr-HT' : 'en-US';
  const insets = useSafeAreaInsets();
  // The tab bar is a translucent overlay, so reserve its height here or the
  // last row ends up sitting behind it.
  const tabBarSpace = useTabBarSpace();
  const [todayEvents, setTodayEvents] = useState<TodayEvent[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<TodayEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [showEventSelector, setShowEventSelector] = useState(false);
  const [recent, setRecent] = useState<RecentCheckIn[]>([]);

  // Last few check-ins for the selected event: one equality query (the same
  // event_id + checked_in pair getTodayEvents already counts with, so no new
  // index), sorted on the client. Refreshed on focus, so coming back from the
  // scanner shows who just walked in; no polling.
  const selectedId = selectedEvent?.id;
  const loadRecent = useCallback(async () => {
    if (!selectedId) {
      setRecent([]);
      return;
    }
    try {
      const snap = await getDocs(
        query(collection(db, 'tickets'), where('event_id', '==', selectedId), where('checked_in', '==', true))
      );
      const rows = snap.docs
        .map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            name: data.attendee_name || data.attendee_email || '',
            tier: data.tier_name || data.ticket_type || '',
            at: checkInMillis(data.checked_in_at),
          };
        })
        .filter((r) => r.at > 0)
        .sort((a, b) => b.at - a.at)
        .slice(0, RECENT_CHECKINS_MAX);
      setRecent(rows);
    } catch (error) {
      // Quiet: the list is a nicety, the screen works without it.
      console.warn('[OrganizerScan] recent check-ins failed', error);
      setRecent([]);
    }
  }, [selectedId]);

  useFocusEffect(
    useCallback(() => {
      loadRecent();
    }, [loadRecent])
  );

  useEffect(() => {
    loadEvents();
  }, [orgId]);

  const loadEvents = async () => {
    if (!orgId) return;

    try {
      const events = await getTodayEvents(orgId);
      setLoadFailed(false);
      setTodayEvents(events);
      // A different org (or a new day) must not keep the old selection.
      setSelectedEvent(events[0] ?? null);
    } catch (error) {
      console.error('Error loading events:', error);
      // Otherwise a failed load reads exactly like "no events today".
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  };

  const openScanner = (extra: { openLookup?: boolean; doorMode?: boolean } = {}) => {
    if (!selectedEvent) {
      showAlert(t('organizerScan.noEventTitle'), t('organizerScan.noEventBody'), [{ text: t('common.ok') }]);
      return;
    }
    navigation.navigate('TicketScanner', { eventId: selectedEvent.id, ...extra });
  };

  // Drop the location half when the event has none, instead of "7:00 PM • ".
  const eventSubtitle = (e: TodayEvent) =>
    [
      new Date(e.start_datetime).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' }),
      e.location,
    ]
      .filter(Boolean)
      .join(' · ');

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
      <Text style={styles.headerTitle} numberOfLines={1}>
        {t('organizerScan.title').toLowerCase()}
      </Text>
      {!loading && selectedEvent ? (
        <StatusChip status="live" label={t('organizerScan.offlineReadyShort')} />
      ) : null}
    </View>
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={colors.background} />
        {header}
        <View style={styles.content}>
          {/* The loaded layout's shape: poster + two lines, then the count
              line and its track (was three generic blocks). */}
          <View style={styles.eventRow}>
            <Skeleton width={84} height={105} radius={radius.poster} />
            <View style={{ flex: 1, gap: 8 }}>
              <Skeleton width="70%" height={16} radius={radius.sm} />
              <Skeleton width="45%" height={12} radius={radius.sm} />
            </View>
          </View>
          <View style={styles.counterBlock}>
            <Skeleton width="40%" height={32} radius={radius.sm} />
            <Skeleton width="100%" height={4} radius={radius.sm} style={{ marginTop: 14 }} />
          </View>
        </View>
      </View>
    );
  }

  const sold = selectedEvent?.ticketsSold || 0;
  const inCount = selectedEvent?.ticketsCheckedIn || 0;
  const pct = sold > 0 ? Math.min(1, inCount / sold) : 0;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      {header}

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarSpace + (selectedEvent ? 170 : 16) }]}>
        {todayEvents.length === 0 ? (
          <View style={styles.emptyWrap}>
            {loadFailed ? (
              <EmptyState
                icon={Calendar}
                title={t('organizerScan.loadFailed')}
                actionLabel={t('common.retry')}
                onAction={loadEvents}
                compact
              />
            ) : (
              <EmptyState variant="panel" icon={ScanLine} title={t('organizerScan.noEventsToday')} />
            )}
          </View>
        ) : selectedEvent ? (
          <>
            {/* Event selector: standalone 4:5 poster left, details right, no card fill. */}
            <View style={styles.eventRow}>
              {selectedEvent.posterUri ? (
                <Image
                  source={{ uri: selectedEvent.posterUri }}
                  style={styles.thumb}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  recyclingKey={selectedEvent.id}
                />
              ) : (
                <View style={[styles.thumb, styles.thumbFallback]}>
                  <ImageIcon size={18} color={colors.textTertiary} strokeWidth={1.5} />
                </View>
              )}
              <View style={styles.eventBody}>
                <Text style={styles.eventTitle} numberOfLines={1}>
                  {selectedEvent.title}
                </Text>
                <Text style={styles.eventSub} numberOfLines={1}>
                  {eventSubtitle(selectedEvent)}
                </Text>
              </View>
              {todayEvents.length > 1 ? (
                <Touchable
                  onPress={() => setShowEventSelector(true)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityRole="button"
                >
                  <Text style={styles.changeLink}>{t('organizerScan.changeEvent')}</Text>
                </Touchable>
              ) : null}
            </View>

            {/* Check-in count straight on the canvas: one line of figures and a
                hairline progress track. The 92pt numeral in a filled card read
                as a placeholder, not a premium door tool (owner, 2026-11-16). */}
            <View style={styles.counterBlock}>
              <View style={styles.counterRow}>
                <Text style={styles.counterNumber} numberOfLines={1}>
                  {inCount.toLocaleString(locale)}
                  <Text style={styles.counterTotal}> / {sold.toLocaleString(locale)}</Text>
                </Text>
                <Text style={styles.counterLabel}>{t('organizerScan.checkedIn').toLowerCase()}</Text>
              </View>
              <View style={styles.track}>
                <View style={[styles.trackFill, { width: `${Math.round(pct * 100)}%` }]} />
              </View>
            </View>
          </>
        ) : null}

        {/* Recent check-ins: fills the lower half with who just came in.
            Renders nothing until the first guest is scanned. */}
        {selectedEvent && recent.length > 0 ? (
          <View style={styles.recentSection}>
            <SectionHeader title={t('organizerScan.recentCheckIns')} />
            {recent.map((r, i) => (
              <View key={r.id} style={[styles.recentRow, i === recent.length - 1 && styles.recentRowLast]}>
                <View style={styles.recentMain}>
                  <Text style={styles.recentName} numberOfLines={1}>
                    {r.name || t('common.attendee')}
                  </Text>
                  {!!r.tier && (
                    <Text style={styles.recentSub} numberOfLines={1}>
                      {r.tier}
                    </Text>
                  )}
                </View>
                <Text style={styles.recentTime}>
                  {new Date(r.at).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      {/* The door actions, pinned at thumb height above the tab bar (owner:
          "the start scanning button is too high up"). Only with an event to
          scan for: a greyed-out button on an empty day was a dead control. */}
      {selectedEvent ? (
        <View style={[styles.dock, { paddingBottom: tabBarSpace + 12 }]}>
          <View style={styles.secondaryRow}>
            <View style={styles.secondaryHalf}>
              <Touchable
                style={[styles.secondary, styles.secondaryFill]}
                onPress={() => openScanner({ openLookup: true })}
                accessibilityRole="button"
              >
                <UserSearch size={18} color={colors.text} strokeWidth={1.75} />
                <Text style={styles.secondaryText} numberOfLines={1}>{t('organizerScan.findGuest')}</Text>
              </Touchable>
            </View>
            <View style={styles.secondaryHalf}>
              <Touchable
                style={[styles.secondary, styles.secondaryFill]}
                onPress={() => openScanner({ doorMode: true })}
                accessibilityRole="button"
              >
                <DoorOpen size={18} color={colors.text} strokeWidth={1.75} />
                <Text style={styles.secondaryText} numberOfLines={1}>{t('organizerScan.doorMode')}</Text>
              </Touchable>
            </View>
          </View>
          <WhitePillCTA
            label={t('organizerScan.startScanning')}
            onPress={() => openScanner()}
            icon={<ScanQrCode size={20} color={T.onWhite} strokeWidth={1.75} />}
            compact
            style={styles.primary}
          />
        </View>
      ) : null}

      <EventSelectorSheet
        visible={showEventSelector}
        title={t('organizerScan.selectEvent')}
        events={todayEvents.map((e) => ({ id: e.id, title: e.title, subtitle: eventSubtitle(e) }))}
        selectedId={selectedEvent?.id}
        onSelect={(picked) => {
          const match = todayEvents.find((e) => e.id === picked.id) || null;
          setSelectedEvent(match);
          setShowEventSelector(false);
        }}
        onClose={() => setShowEventSelector(false)}
      />
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 20,
      paddingBottom: 8,
      backgroundColor: colors.background,
    },
    headerTitle: {
      flexShrink: 1,
      fontFamily: font.serif,
      fontSize: 30,
      lineHeight: 36,
      color: colors.text,
    },
    content: {
      paddingHorizontal: 20,
      paddingTop: 12,
    },
    // No card behind the empty state (owner, 2026-11-18).
    emptyWrap: {},
    // Selector row: no card behind it; the poster carries the color.
    eventRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 8,
    },
    thumb: {
      width: 84,
      aspectRatio: 4 / 5,
      borderRadius: radius.poster,
      overflow: 'hidden',
      backgroundColor: T.surfaceRaised,
    },
    thumbFallback: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    eventBody: {
      flex: 1,
    },
    // Event names are set in the serif everywhere (owner, 2026-11-16).
    eventTitle: {
      fontFamily: font.serif,
      fontSize: 22,
      lineHeight: 26,
      color: colors.text,
    },
    eventSub: {
      marginTop: 3,
      fontSize: 13,
      color: colors.textSecondary,
    },
    changeLink: {
      fontSize: 13,
      fontWeight: '600',
      color: T.accent,
    },
    counterBlock: {
      marginTop: 24,
    },
    counterRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: 12,
    },
    counterNumber: {
      flexShrink: 1,
      fontSize: 40,
      lineHeight: 46,
      fontWeight: '700',
      letterSpacing: -1,
      color: colors.text,
      fontVariant: ['tabular-nums'],
    },
    counterTotal: {
      fontSize: 22,
      fontWeight: '500',
      letterSpacing: 0,
      color: colors.textSecondary,
    },
    counterLabel: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    track: {
      alignSelf: 'stretch',
      height: 3,
      borderRadius: 2,
      backgroundColor: T.surfaceRaised,
      overflow: 'hidden',
      marginTop: 10,
    },
    trackFill: {
      height: '100%',
      backgroundColor: T.white,
    },
    // Smaller than before (owner: "kinda too big"): 52 / 46 instead of 64 / 56.
    primary: {
      height: 52,
    },
    dock: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: 20,
      paddingTop: 12,
      gap: 10,
      backgroundColor: colors.background,
    },
    secondaryRow: { flexDirection: 'row', gap: 10 },
    // Equal slots: Touchable styles its inner view, so the flex lives here.
    secondaryHalf: { flex: 1 },
    secondaryFill: { marginTop: 0 },
    secondary: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      height: 46,
      marginTop: 12,
      borderRadius: radius.button,
      backgroundColor: T.surfaceRaised,
    },
    secondaryText: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
    },
    recentSection: {
      marginTop: 28,
    },
    // Plain list rows (EventAttendeesScreen idiom): hairline between rows only.
    recentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: 56,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    recentRowLast: {
      borderBottomWidth: 0,
    },
    recentMain: {
      flex: 1,
      minWidth: 0,
    },
    recentName: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
    },
    recentSub: {
      marginTop: 2,
      fontSize: 13,
      color: colors.textSecondary,
    },
    recentTime: {
      fontSize: 13,
      color: colors.textSecondary,
      fontVariant: ['tabular-nums'],
    },
  });
