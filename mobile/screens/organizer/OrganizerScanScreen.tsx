import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StatusBar, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAppAlert } from '../../components/AppAlert';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTabBarSpace } from '../../hooks/useTabBarSpace';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Calendar } from 'lucide-react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import { getTodayEvents, TodayEvent } from '../../lib/api/organizer';
import { RADIUS } from '../../config/brand';
import { colors as T, font, radius } from '../../theme/tokens';
import EventSelectorSheet from '../../components/organizer/EventSelectorSheet';
import EmptyState from '../../components/EmptyState';
import WhitePillCTA from '../../components/WhitePillCTA';
import { Skeleton } from '../../components/Skeleton';
import FormSheet from '../../components/organizer/FormSheet';

/**
 * Set once the organizer has started a scan session or closed the guide. The
 * "how to scan" steps open by themselves as a sheet on the first visit only;
 * after that they live behind the ⓘ next to the title.
 */
const SCAN_GUIDE_SEEN_KEY = 'organizer_scan_guide_seen_v1';

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
  const [guideSeen, setGuideSeen] = useState<boolean | null>(null);
  const [showGuideSheet, setShowGuideSheet] = useState(false);

  useEffect(() => {
    loadEvents();
  }, [userProfile?.id]);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(SCAN_GUIDE_SEEN_KEY)
      .then((v) => alive && setGuideSeen(v === '1'))
      .catch(() => alive && setGuideSeen(true));
    return () => {
      alive = false;
    };
  }, []);

  // First visit: open the guide once, as a sheet (never inline on the page).
  useEffect(() => {
    if (guideSeen === false && !loading) setShowGuideSheet(true);
  }, [guideSeen, loading]);

  const markGuideSeen = () => {
    if (guideSeen) return;
    setGuideSeen(true);
    AsyncStorage.setItem(SCAN_GUIDE_SEEN_KEY, '1').catch(() => {});
  };

  const closeGuide = () => {
    setShowGuideSheet(false);
    markGuideSeen();
  };

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
    // Scanning once is what the guide was for: from now on it sits behind ⓘ.
    markGuideSeen();
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
      <View style={styles.titleRow}>
        <Text style={styles.headerTitle}>{t('organizerScan.title').toLowerCase()}</Text>
        <TouchableOpacity
          onPress={() => setShowGuideSheet(true)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel={t('organizerScan.howTitle')}
        >
          <Ionicons name="information-circle-outline" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={colors.background} />
        {header}
        <View style={styles.content}>
          <Skeleton width={80} height={12} radius={5} style={{ marginBottom: 12 }} />
          <Skeleton width="100%" height={150} radius={RADIUS.lg} style={{ marginBottom: 24 }} />
          <Skeleton width="100%" height={56} radius={RADIUS.md} />
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
          <EmptyState icon={Calendar} title={t('organizerScan.noEventsToday')} compact />
        ) : selectedEvent ? (
          <>
            <Text style={styles.monoLabel}>{t('organizerScan.tonight')}</Text>
            <View style={styles.eventCard}>
              {selectedEvent.posterUri ? (
                <Image
                  source={{ uri: selectedEvent.posterUri }}
                  style={styles.poster}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  recyclingKey={selectedEvent.id}
                />
              ) : (
                <View style={[styles.poster, styles.posterFallback]}>
                  <Ionicons name="image-outline" size={18} color={colors.textTertiary} />
                </View>
              )}
              <View style={styles.eventBody}>
                <Text style={styles.eventTitle} numberOfLines={2}>
                  {selectedEvent.title}
                </Text>
                <Text style={styles.eventSub} numberOfLines={1}>
                  {eventSubtitle(selectedEvent)}
                </Text>
                <View style={styles.countRow}>
                  <Text style={styles.countText}>
                    {t('organizerScan.inCount').replace('{in}', String(inCount)).replace('{total}', String(sold))}
                  </Text>
                  {sold > 0 ? <Text style={styles.countPct}>{Math.round(pct * 100)}%</Text> : null}
                </View>
                <View style={styles.track}>
                  <View style={[styles.trackFill, { width: `${Math.round(pct * 100)}%` }]} />
                </View>
                {todayEvents.length > 1 ? (
                  <TouchableOpacity
                    onPress={() => setShowEventSelector(true)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    style={{ alignSelf: 'flex-start' }}
                  >
                    <Text style={styles.changeLink}>{t('organizerScan.changeEvent')}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          </>
        ) : null}

        <View style={{ height: 24 }} />

        {/* The one white pill on this screen. */}
        <WhitePillCTA
          label={t('organizerScan.startScanning')}
          onPress={() => openScanner()}
          disabled={!selectedEvent}
          icon={<Ionicons name="qr-code-outline" size={20} color="#000" />}
        />

        {selectedEvent ? (
          <>
            <TouchableOpacity style={styles.textAction} onPress={() => openScanner({ openLookup: true })} accessibilityRole="button">
              <Text style={styles.textActionPrimary}>{t('organizerScan.findGuest')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.textActionTight} onPress={() => openScanner({ doorMode: true })} accessibilityRole="button">
              <Text style={styles.textActionSecondary}>{t('organizerScan.doorMode')}</Text>
            </TouchableOpacity>

            <View style={styles.offlineRow}>
              <View style={styles.offlineDot} />
              <Text style={styles.offlineText}>
                {t('organizerScan.offlineReady').replace('{n}', String(sold))}
              </Text>
            </View>
          </>
        ) : null}
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

      <FormSheet visible={showGuideSheet} title={t('organizerScan.howTitle')} onClose={closeGuide} closeLabel={t('common.close')}>
        {guideSteps.map((step, i) => (
          <View key={i} style={styles.guideStep}>
            <Text style={styles.guideStepNum}>{String(i + 1).padStart(2, '0')}</Text>
            <Text style={styles.guideStepText}>{step}</Text>
          </View>
        ))}
      </FormSheet>
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
      paddingHorizontal: 20,
      paddingBottom: 8,
      backgroundColor: colors.background,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    headerTitle: {
      fontFamily: font.serif,
      fontSize: 48,
      lineHeight: 56,
      color: colors.text,
    },
    content: {
      padding: 20,
    },
    monoLabel: {
      fontFamily: font.mono,
      fontSize: 11,
      letterSpacing: 1.6,
      textTransform: 'uppercase',
      color: colors.textSecondary,
      marginBottom: 12,
    },
    // Filled event surface: no outline.
    eventCard: {
      flexDirection: 'row',
      gap: 16,
      padding: 16,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
    },
    poster: {
      width: 84,
      height: 105,
      borderRadius: radius.poster,
      backgroundColor: colors.surfaceRaised,
    },
    posterFallback: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    eventBody: {
      flex: 1,
    },
    eventTitle: {
      fontSize: 17,
      fontWeight: '600',
      color: colors.text,
    },
    eventSub: {
      marginTop: 3,
      fontSize: 14,
      color: colors.textSecondary,
    },
    countRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      marginTop: 12,
    },
    countText: {
      fontFamily: font.mono,
      fontSize: 12,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: colors.text,
    },
    countPct: {
      fontFamily: font.mono,
      fontSize: 11,
      color: colors.textSecondary,
    },
    track: {
      height: 3,
      borderRadius: 2,
      backgroundColor: colors.surfaceRaised,
      overflow: 'hidden',
      marginTop: 8,
      marginBottom: 12,
    },
    // Teal means "live" here: people coming through the door right now.
    trackFill: {
      height: '100%',
      backgroundColor: T.teal,
    },
    changeLink: {
      fontSize: 14,
      color: colors.textSecondary,
      textDecorationLine: 'underline',
    },
    textAction: {
      alignSelf: 'center',
      paddingTop: 20,
      paddingBottom: 8,
    },
    textActionTight: {
      alignSelf: 'center',
      paddingVertical: 8,
    },
    textActionPrimary: {
      fontSize: 16,
      color: colors.text,
    },
    textActionSecondary: {
      fontSize: 16,
      color: colors.textSecondary,
    },
    offlineRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginTop: 20,
    },
    offlineDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: T.teal,
    },
    offlineText: {
      fontFamily: font.mono,
      fontSize: 10,
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: colors.textSecondary,
    },
    guideStep: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 14,
      paddingVertical: 10,
    },
    guideStepNum: {
      fontFamily: font.mono,
      fontSize: 12,
      marginTop: 2,
      color: colors.textTertiary,
    },
    guideStepText: {
      flex: 1,
      fontSize: 15,
      lineHeight: 22,
      color: colors.text,
    },
  });
