import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StatusBar, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { useAppAlert } from '../../components/AppAlert';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTabBarSpace } from '../../hooks/useTabBarSpace';
import { useNavigation } from '@react-navigation/native';
import { Calendar, Image as ImageIcon, ScanQrCode, UserSearch } from 'lucide-react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import { getTodayEvents, TodayEvent } from '../../lib/api/organizer';
import { colors as T, radius } from '../../theme/tokens';
import EventSelectorSheet from '../../components/organizer/EventSelectorSheet';
import EmptyState from '../../components/EmptyState';
import WhitePillCTA from '../../components/WhitePillCTA';
import StatusChip from '../../components/StatusChip';
import SectionHeader from '../../components/SectionHeader';
import { Skeleton } from '../../components/Skeleton';

export default function OrganizerScanScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const navigation = useNavigation<any>();
  const { userProfile } = useAuth();
  const { t, language } = useI18n();
  const showAlert = useAppAlert();
  const locale = language === 'fr' ? 'fr-FR' : language === 'ht' ? 'fr-HT' : 'en-US';
  const insets = useSafeAreaInsets();
  // The tab bar is a translucent overlay, so reserve its height here or the
  // last row ends up sitting behind it.
  const tabBarSpace = useTabBarSpace();
  const [todayEvents, setTodayEvents] = useState<TodayEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<TodayEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [showEventSelector, setShowEventSelector] = useState(false);

  useEffect(() => {
    loadEvents();
  }, [userProfile?.id]);

  const loadEvents = async () => {
    if (!userProfile?.id) return;

    try {
      const events = await getTodayEvents(userProfile.id);
      setTodayEvents(events);
      if (events.length > 0) setSelectedEvent(events[0]);
    } catch (error) {
      console.error('Error loading events:', error);
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

  const guideSteps = [
    t('organizerScan.howStep1'),
    t('organizerScan.howStep2'),
    t('organizerScan.howStep3'),
    t('organizerScan.howStep4'),
  ];

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
      <Text style={styles.headerTitle} numberOfLines={1}>
        {t('organizerScan.title')}
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
          <Skeleton width="100%" height={80} radius={radius.lg} style={{ marginBottom: 16 }} />
          <Skeleton width="100%" height={220} radius={radius.xl} style={{ marginBottom: 16 }} />
          <Skeleton width="100%" height={64} radius={radius.button} />
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

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarSpace + 16 }]}>
        {todayEvents.length === 0 ? (
          <View style={styles.emptyWrap}>
            <EmptyState icon={Calendar} title={t('organizerScan.noEventsToday')} compact />
          </View>
        ) : selectedEvent ? (
          <>
            {/* Event selector: one filled row, the poster thumb carries the color. */}
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
                <TouchableOpacity
                  onPress={() => setShowEventSelector(true)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityRole="button"
                >
                  <Text style={styles.changeLink}>{t('organizerScan.changeEvent')}</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Check-in counter. */}
            <View style={styles.counterCard}>
              <Text style={styles.counterLabel}>{t('organizerScan.checkedIn')}</Text>
              <View style={styles.counterRow}>
                <Text style={styles.counterNumber} adjustsFontSizeToFit numberOfLines={1}>
                  {inCount.toLocaleString(locale)}
                </Text>
                <Text style={styles.counterTotal}>/ {sold.toLocaleString(locale)}</Text>
              </View>
              <View style={styles.track}>
                <View style={[styles.trackFill, { width: `${Math.round(pct * 100)}%` }]} />
              </View>
            </View>
          </>
        ) : null}

        <View style={{ height: 20 }} />

        {/* The one white primary on this screen. */}
        <WhitePillCTA
          label={t('organizerScan.startScanning')}
          onPress={() => openScanner()}
          disabled={!selectedEvent}
          icon={<ScanQrCode size={22} color={T.onWhite} strokeWidth={1.75} />}
          style={styles.primary}
        />

        {selectedEvent ? (
          <>
            <TouchableOpacity
              style={styles.secondary}
              onPress={() => openScanner({ openLookup: true })}
              accessibilityRole="button"
              activeOpacity={0.8}
            >
              <UserSearch size={18} color={colors.text} strokeWidth={1.75} />
              <Text style={styles.secondaryText}>{t('organizerScan.findGuest')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.textAction}
              onPress={() => openScanner({ doorMode: true })}
              accessibilityRole="button"
            >
              <Text style={styles.textActionLabel}>{t('organizerScan.doorMode')}</Text>
            </TouchableOpacity>
            <Text style={styles.offlineCaption}>
              {t('organizerScan.offlineReady').replace('{n}', String(sold))}
            </Text>
          </>
        ) : null}

        <View style={styles.howWrap}>
          <SectionHeader title={t('organizerScan.howTitle')} />
          <View style={styles.stepsCard}>
            {guideSteps.map((step, i) => (
              <View key={i} style={styles.step}>
                <Text style={styles.stepNum}>{String(i + 1).padStart(2, '0')}</Text>
                <Text style={styles.stepText}>{step}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

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
      fontSize: 38,
      lineHeight: 44,
      fontWeight: '700',
      letterSpacing: -0.8,
      color: colors.text,
    },
    content: {
      paddingHorizontal: 20,
      paddingTop: 12,
    },
    emptyWrap: {
      borderRadius: radius.xl,
      backgroundColor: T.surface,
      paddingVertical: 8,
    },
    // Filled selector row: no outline.
    eventRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      padding: 14,
      borderRadius: radius.lg,
      backgroundColor: T.surface,
    },
    thumb: {
      width: 52,
      height: 52,
      borderRadius: radius.sm,
      backgroundColor: T.surfaceRaised,
    },
    thumbFallback: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    eventBody: {
      flex: 1,
    },
    eventTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    eventSub: {
      marginTop: 3,
      fontSize: 13,
      color: colors.textSecondary,
    },
    changeLink: {
      fontSize: 14,
      fontWeight: '600',
      color: T.accent,
    },
    counterCard: {
      marginTop: 16,
      paddingTop: 24,
      paddingBottom: 28,
      paddingHorizontal: 24,
      borderRadius: radius.xl,
      backgroundColor: T.surface,
      alignItems: 'center',
    },
    counterLabel: {
      fontSize: 12,
      fontWeight: '600',
      letterSpacing: 1.4,
      textTransform: 'uppercase',
      color: colors.textSecondary,
    },
    counterRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'center',
      gap: 8,
      marginTop: 4,
    },
    counterNumber: {
      flexShrink: 1,
      fontSize: 92,
      lineHeight: 104,
      fontWeight: '800',
      letterSpacing: -3,
      color: colors.text,
      fontVariant: ['tabular-nums'],
    },
    counterTotal: {
      fontSize: 26,
      fontWeight: '500',
      color: colors.textSecondary,
      fontVariant: ['tabular-nums'],
    },
    track: {
      alignSelf: 'stretch',
      height: 4,
      borderRadius: 2,
      backgroundColor: T.surfaceRaised,
      overflow: 'hidden',
      marginTop: 16,
    },
    trackFill: {
      height: '100%',
      backgroundColor: T.white,
    },
    primary: {
      height: 64,
    },
    secondary: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      height: 56,
      marginTop: 12,
      borderRadius: radius.button,
      backgroundColor: T.surfaceRaised,
    },
    secondaryText: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.text,
    },
    textAction: {
      alignSelf: 'center',
      paddingTop: 16,
      paddingBottom: 4,
    },
    textActionLabel: {
      fontSize: 15,
      color: colors.textSecondary,
    },
    offlineCaption: {
      marginTop: 8,
      textAlign: 'center',
      fontSize: 12,
      color: colors.textTertiary,
    },
    howWrap: {
      marginTop: 36,
    },
    stepsCard: {
      borderRadius: radius.lg,
      backgroundColor: T.surface,
      paddingVertical: 8,
      paddingHorizontal: 16,
    },
    step: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 14,
      paddingVertical: 10,
    },
    stepNum: {
      minWidth: 20,
      fontSize: 13,
      fontWeight: '600',
      lineHeight: 20,
      color: colors.textTertiary,
      fontVariant: ['tabular-nums'],
    },
    stepText: {
      flex: 1,
      fontSize: 14,
      lineHeight: 20,
      color: colors.text,
    },
  });
