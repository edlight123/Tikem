import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTabBarSpace } from '../../hooks/useTabBarSpace';
import { Ticket, CalendarDays, ScanQrCode } from 'lucide-react-native';
import { auth } from '../../config/firebase';
import { useTheme } from '../../contexts/ThemeContext';
import { useI18n } from '../../contexts/I18nContext';
import { useStaffEvents, StaffEventSummary } from '../../hooks/useStaffEvents';
import EventSelectorSheet from '../../components/organizer/EventSelectorSheet';
import EmptyState from '../../components/EmptyState';
import WhitePillCTA from '../../components/WhitePillCTA';
import SectionHeader from '../../components/SectionHeader';
import { Skeleton } from '../../components/Skeleton';
import { useAppAlert } from '../../components/AppAlert';
import { colors as T, radius } from '../../theme/tokens';
import { flushCheckInQueue } from '../../lib/doorCheckIn';

export default function StaffScanScreen() {
  const { colors } = useTheme();
  const showAlert = useAppAlert();
  const styles = getStyles(colors);
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const uid = auth.currentUser?.uid || null;
  const { t } = useI18n();
  // The tab bar is a translucent overlay, so reserve its height here or the
  // last row ends up sitting behind it.
  const tabBarSpace = useTabBarSpace();

  const { events, loading, refreshing, refresh } = useStaffEvents();

  // Check-ins a door-only phone queued while offline are replayed whenever
  // staff come back here, not only while the scanner is open.
  useFocusEffect(
    useCallback(() => {
      if (uid) flushCheckInQueue(uid).catch(() => {});
    }, [uid]),
  );
  const [selectedEvent, setSelectedEvent] = useState<StaffEventSummary | null>(null);
  const [showEventSelector, setShowEventSelector] = useState(false);

  // Keep the selection in sync with the loaded events: preserve a still-valid
  // selection, otherwise fall back to the first event (mirrors prior behavior).
  useEffect(() => {
    setSelectedEvent((prev) => {
      if (prev && events.some((e) => e.id === prev.id)) return prev;
      return events.length > 0 ? events[0] : null;
    });
  }, [events]);

  const emptyText = useMemo(() => {
    if (!uid) return t('staffEvents.signIn');
    return t('staffEvents.noAssigned');
  }, [uid, t]);

  const eventSubtitle = (e: StaffEventSummary) =>
    `${e.venue_name ? e.venue_name : t('common.venue')}${e.city ? ` • ${e.city}` : ''}`;

  const handleStartScanning = () => {
    if (!selectedEvent) {
      showAlert(t('staffScan.noEventTitle'), t('staffScan.noEventBody'), [{ text: t('common.ok') }]);
      return;
    }

    (navigation as any).navigate('TicketScanner', { eventId: selectedEvent.id });
  };

  // Same steps the organizer door screen shows; the flow is identical.
  const guideSteps = [
    t('organizerScan.howStep1'),
    t('organizerScan.howStep2'),
    t('organizerScan.howStep3'),
    t('organizerScan.howStep4'),
  ];

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {t('staffScan.title')}
        </Text>
        <Text style={styles.headerSub} numberOfLines={1}>
          {t('staffScan.subtitle')}
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 24 + tabBarSpace }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />
        }
      >
        {loading ? (
          <View>
            <Skeleton width="100%" height={80} radius={radius.lg} style={{ marginBottom: 20 }} />
            <Skeleton width="100%" height={64} radius={radius.button} />
          </View>
        ) : events.length === 0 ? (
          <View style={styles.emptyWrap}>
            <EmptyState icon={Ticket} title={emptyText} compact />
          </View>
        ) : (
          <>
            {/* Event selector: one filled row; the whole row opens the picker. */}
            <TouchableOpacity
              style={styles.eventRow}
              onPress={() => setShowEventSelector(true)}
              accessibilityRole="button"
              accessibilityLabel={t('staffScan.selectEvent')}
              activeOpacity={0.8}
            >
              <View style={styles.thumb}>
                <CalendarDays size={20} color={colors.textTertiary} strokeWidth={1.5} />
              </View>
              {selectedEvent ? (
                <View style={styles.eventBody}>
                  <Text style={styles.eventTitle} numberOfLines={1}>
                    {selectedEvent.title}
                  </Text>
                  <Text style={styles.eventSub} numberOfLines={1}>
                    {eventSubtitle(selectedEvent)}
                  </Text>
                </View>
              ) : (
                <Text style={[styles.eventBody, styles.eventPlaceholder]} numberOfLines={1}>
                  {t('staffScan.selectEventPlaceholder')}
                </Text>
              )}
              <Text style={styles.changeLink}>{t('organizerScan.changeEvent')}</Text>
            </TouchableOpacity>

            <View style={{ height: 20 }} />

            {/* The one white primary on this screen. */}
            <WhitePillCTA
              label={t('staffScan.startScanning')}
              onPress={handleStartScanning}
              disabled={!selectedEvent}
              icon={<ScanQrCode size={22} color={T.onWhite} strokeWidth={1.75} />}
              style={styles.primary}
            />

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
          </>
        )}
      </ScrollView>

      <EventSelectorSheet
        visible={showEventSelector}
        title={t('staffScan.selectEvent')}
        events={events.map((e) => ({ id: e.id, title: e.title, subtitle: eventSubtitle(e) }))}
        selectedId={selectedEvent?.id}
        onSelect={(picked) => {
          const match = events.find((e) => e.id === picked.id) || null;
          setSelectedEvent(match);
          setShowEventSelector(false);
        }}
        onClose={() => setShowEventSelector(false)}
      />
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 8,
    backgroundColor: colors.background,
  },
  headerTitle: {
    fontSize: 38,
    lineHeight: 44,
    fontWeight: '700',
    letterSpacing: -0.8,
    color: colors.text,
  },
  headerSub: {
    marginTop: 4,
    fontSize: 14,
    color: colors.textSecondary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
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
  eventPlaceholder: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  changeLink: {
    fontSize: 14,
    fontWeight: '600',
    color: T.accent,
  },
  primary: {
    height: 64,
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
