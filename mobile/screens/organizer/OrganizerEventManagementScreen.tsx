import React, { useState, useCallback, useLayoutEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  StatusBar,
  Share,
} from 'react-native';
import { useAppAlert } from '../../components/AppAlert';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, RouteProp, useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../../contexts/ThemeContext';
import {
  getEventById,
  getEventTicketBreakdown,
  getCachedEvent,
  getCachedBreakdown,
  OrganizerEvent,
  EventTicketBreakdown,
} from '../../lib/api/organizer';
import {
  toggleEventPublication,
  cancelEvent,
} from '../../lib/api/events';
import { useI18n } from '../../contexts/I18nContext';
import { useLocaleFormat } from '../../lib/format';
import { RADIUS } from '../../config/brand';
import { Skeleton } from '../../components/Skeleton';
import ActionTileGrid from '../../components/organizer/ActionTileGrid';
import OrganizerScreenHeader from '../../components/organizer/OrganizerScreenHeader';
import { useOverlayHeaderInset } from '../../components/OverlayHeader';

type RouteParams = {
  OrganizerEventManagement: {
    eventId: string;
    event?: OrganizerEvent;
  };
};

// Derive a first-paint ticket breakdown from the fields the list already carries
// (sold + capacity). Ticket-type rows fill in once the background refresh lands.
const seedBreakdownFromEvent = (e: OrganizerEvent): EventTicketBreakdown => ({
  ticketsSold: e.tickets_sold ?? 0,
  ticketsCheckedIn: 0,
  capacity: e.total_tickets ?? 0,
  ticketTypes: [],
});

export default function OrganizerEventManagementScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const route = useRoute<RouteProp<RouteParams, 'OrganizerEventManagement'>>();
  const navigation = useNavigation<any>();
  const { eventId } = route.params;
  const insets = useSafeAreaInsets();
  const { height: headerH, onHeight } = useOverlayHeaderInset();

  // The stack registers this route with a generic "Manage Event" nav bar. Hide it
  // so the in-screen POSH header (serif event title + back arrow) is the only one.
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  const { t } = useI18n();
  const showAlert = useAppAlert();
  const { formatDate, formatTime } = useLocaleFormat();

  // Seed from the nav param (the list already holds the event) or the in-memory
  // cache from a previous open, so the header + known fields paint on mount with
  // no Firestore round-trip. Falls back to a skeleton only on a true cold open.
  const seedEvent = route.params.event ?? getCachedEvent(eventId) ?? null;
  const seedBreakdown =
    getCachedBreakdown(eventId) ?? (seedEvent ? seedBreakdownFromEvent(seedEvent) : null);

  const [event, setEvent] = useState<OrganizerEvent | null>(seedEvent);
  const [isPaused, setIsPaused] = useState(seedEvent ? !seedEvent.is_published : false);
  const [ticketData, setTicketData] = useState<EventTicketBreakdown | null>(seedBreakdown);
  // Only block on a full-screen skeleton when we have nothing to show yet.
  const [loading, setLoading] = useState(!seedEvent);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadEventData();
    setRefreshing(false);
  };

  // Refresh on focus (covers initial mount + returning after an edit). The
  // background fetch reconciles the seeded values with live numbers; it never
  // flips `loading` back on, so a seeded screen never regresses to a skeleton.
  useFocusEffect(
    useCallback(() => {
      loadEventData();
    }, [eventId])
  );

  const loadEventData = async () => {
    try {
      const [eventData, breakdown] = await Promise.all([
        getEventById(eventId),
        getEventTicketBreakdown(eventId),
      ]);

      if (eventData) {
        setEvent(eventData);
        setTicketData(breakdown);
        setIsPaused(!eventData.is_published);
      }
    } catch (error) {
      console.error('Error loading event management data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleScanTickets = () => {
    navigation.navigate('TicketScanner', { eventId });
  };

  const handleViewAttendees = () => {
    navigation.navigate('EventAttendees', { eventId });
  };

  const handleViewEarnings = () => {
    navigation.navigate('OrganizerEventEarnings', { eventId });
  };

  const handleViewComps = () => {
    navigation.navigate('OrganizerComps', { eventId });
  };

  const handleViewMessages = () => {
    navigation.navigate('OrganizerMessages', { eventId, eventTitle: event?.title });
  };

  const handlePromoCodes = () => {
    navigation.navigate('OrganizerPromoCodes', { eventId });
  };

  const handlePromoters = () => {
    navigation.navigate('OrganizerPromoters', { eventId });
  };

  const handleEditEvent = () => {
    navigation.navigate('EditEvent', { eventId });
  };

  const handleViewPublicPage = () => {
    navigation.navigate('EventDetail', { eventId });
  };

  const handleShareEvent = async () => {
    try {
      const url = `https://www.tikem.co/events/${eventId}`;
      await Share.share({
        message: `${event?.title || t('common.event')}\n\n${url}`,
      });
    } catch {
      // Share sheet dismissed / unavailable — nothing to surface.
    }
  };

  const handleManageStaff = async () => {
    try {
      navigation.navigate('OrganizerEventStaff', { eventId });
    } catch {
      showAlert(t('common.error'), t('organizerEventManagement.errors.openStaffFailed'));
    }
  };

  const handleToggleSales = async () => {
    const action = isPaused ? 'resume' : 'pause';
    showAlert(
      action === 'pause'
        ? t('organizerEventManagement.toggleSales.pauseTitle')
        : t('organizerEventManagement.toggleSales.resumeTitle'),
      action === 'pause'
        ? t('organizerEventManagement.toggleSales.pauseBody')
        : t('organizerEventManagement.toggleSales.resumeBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: action === 'pause' ? t('organizerEventManagement.toggleSales.pauseCta') : t('organizerEventManagement.toggleSales.resumeCta'),
          style: action === 'pause' ? 'destructive' : 'default',
          onPress: async () => {
            try {
              // isPaused is the inverse of is_published
              // If isPaused=true, we want to set is_published=true (resume)
              // If isPaused=false, we want to set is_published=false (pause)
              const newPublishedState = isPaused; // Resume if paused, pause if not paused
              await toggleEventPublication(eventId, newPublishedState);
              // Reload event data to get the updated status from database
              await loadEventData();
              showAlert(
                t('common.success'),
                action === 'pause'
                  ? t('organizerEventManagement.toggleSales.pausedSuccess')
                  : t('organizerEventManagement.toggleSales.resumedSuccess')
              );
            } catch (error: any) {
              showAlert(
                t('common.error'),
                error.message || (action === 'pause'
                  ? t('organizerEventManagement.toggleSales.pauseFailed')
                  : t('organizerEventManagement.toggleSales.resumeFailed'))
              );
            }
          },
        },
      ]
    );
  };

  const handleSendUpdate = () => {
    navigation.navigate('SendEventUpdate', { eventId, eventTitle: event?.title });
  };

  const handleCancelEvent = async () => {
    showAlert(
      t('organizerEventManagement.cancelEvent.title'),
      t('organizerEventManagement.cancelEvent.body'),
      [
        { text: t('common.no'), style: 'cancel' },
        {
          text: t('organizerEventManagement.cancelEvent.confirmCta'),
          style: 'destructive',
          onPress: async () => {
            try {
              const outcome = await cancelEvent(eventId);
              showAlert(
                t('organizerEventManagement.cancelEvent.successTitle'),
                t('organizerEventManagement.cancelEvent.successBody')
                  .replace('{n}', String(outcome?.refundsSucceeded ?? 0))
                  .replace('{m}', String(outcome?.refundsQueuedManual ?? 0)),
                [{ text: t('common.ok'), onPress: () => navigation.goBack() }]
              );
            } catch (error: any) {
              showAlert(t('common.error'), error.message || t('organizerEventManagement.cancelEvent.failed'));
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={colors.background} />
        {/* Identical header to the loaded branch — no in-flow -> overlay flash. */}
        <OrganizerScreenHeader
          title={t('organizerEventManagement.headerTitle')}
          onBack={() => navigation.goBack()}
          overlay
          onHeight={onHeight}
        />
        <View style={[styles.skeletonBody, { paddingTop: headerH }]}>
          <Skeleton width={120} height={12} radius={6} style={{ marginBottom: 16 }} />
          <View style={styles.skeletonGrid}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} width="48%" height={96} radius={RADIUS.lg} />
            ))}
          </View>
          <Skeleton width={120} height={12} radius={6} style={{ marginTop: 28, marginBottom: 16 }} />
          <Skeleton width="100%" height={120} radius={RADIUS.lg} />
          <Skeleton width={120} height={12} radius={6} style={{ marginTop: 28, marginBottom: 16 }} />
          <Skeleton width="100%" height={168} radius={RADIUS.lg} />
        </View>
      </View>
    );
  }

  if (!event || !ticketData) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={colors.background} />
        <OrganizerScreenHeader
          title={t('organizerEventManagement.headerTitle')}
          onBack={() => navigation.goBack()}
          overlay
          onHeight={onHeight}
        />
        <View style={[styles.errorWrap, { paddingTop: headerH }]}>
          <Ionicons name="alert-circle-outline" size={56} color={colors.error} />
          <Text style={styles.errorText}>{t('organizerEventManagement.notFound')}</Text>
        </View>
      </View>
    );
  }

  const formattedDate = formatDate(event.start_datetime);
  const formattedTime = formatTime(event.start_datetime);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />

      {/* POSH header: serif event title + back arrow, matching the rest of the app.
          Share moved out of the tile grid into a header icon (beta feedback). */}
      <OrganizerScreenHeader
        title={event.title}
        subtitle={`${formattedDate} • ${formattedTime}`}
        onBack={() => navigation.goBack()}
        right={
          <TouchableOpacity
            onPress={handleShareEvent}
            style={styles.headerShareButton}
            accessibilityRole="button"
            accessibilityLabel={t('organizerEventManagement.actions.shareEvent')}
          >
            <Ionicons name="share-outline" size={22} color={colors.text} />
          </TouchableOpacity>
        }
        overlay
        onHeight={onHeight}
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingTop: headerH, paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
      {/* Quick Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t('organizerEventManagement.sections.quickActions')}</Text>
        <ActionTileGrid
          tiles={[
            { key: 'scan', icon: 'qr-code-outline', label: t('organizerEventManagement.actions.scanTickets'), onPress: handleScanTickets },
            { key: 'staff', icon: 'people-outline', label: t('organizerEventManagement.actions.staff'), onPress: handleManageStaff },
            { key: 'attendees', icon: 'people-circle-outline', label: t('organizerEventManagement.actions.viewAttendees'), onPress: handleViewAttendees },
            { key: 'messages', icon: 'chatbubble-ellipses-outline', label: t('organizerEventManagement.actions.messages'), onPress: handleViewMessages },
            { key: 'earnings', icon: 'cash-outline', label: t('organizerEventManagement.actions.earnings'), onPress: handleViewEarnings },
            { key: 'comps', icon: 'gift-outline', label: t('organizerEventManagement.actions.comps'), onPress: handleViewComps },
            { key: 'promo', icon: 'pricetag-outline', label: t('organizerEventManagement.actions.promoCodes'), onPress: handlePromoCodes },
            { key: 'promoters', icon: 'megaphone-outline', label: t('organizerEventManagement.actions.promoters'), onPress: handlePromoters },
            { key: 'edit', icon: 'create-outline', label: t('organizerEventManagement.actions.editEvent'), onPress: handleEditEvent },
            { key: 'public', icon: 'eye-outline', label: t('organizerEventManagement.actions.viewPublicPage'), onPress: handleViewPublicPage },
          ]}
        />
      </View>

      {/* Performance */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t('organizerEventManagement.sections.performance')}</Text>
        <View style={styles.performanceCard}>
          <View style={styles.performanceHeader}>
            <Text style={styles.performanceTitle}>{t('organizerEventManagement.performance.ticketSales')}</Text>
            <Text style={styles.performanceValue}>
              {ticketData.ticketsSold} / {ticketData.capacity}
            </Text>
          </View>
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${
                    ticketData.capacity > 0
                      ? (ticketData.ticketsSold / ticketData.capacity) * 100
                      : 0
                  }%`,
                },
              ]}
            />
          </View>
          <Text style={styles.progressText}>
            {ticketData.capacity > 0
              ? ((ticketData.ticketsSold / ticketData.capacity) * 100).toFixed(1)
              : 0}
            % {t('common.sold')}
          </Text>
        </View>

        {/* Ticket Type Breakdown */}
        {ticketData.ticketTypes.length > 0 && (
          <View style={styles.ticketBreakdown}>
            <Text style={styles.breakdownTitle}>{t('organizerEventManagement.performance.byTicketType')}</Text>
            {ticketData.ticketTypes.map((ticketType, index) => (
              <View key={index} style={styles.ticketTypeRow}>
                <View style={styles.ticketTypeInfo}>
                  <Text style={styles.ticketTypeName} numberOfLines={1}>{ticketType.name}</Text>
                  <Text style={styles.ticketTypeStats}>
                    {ticketType.sold} / {ticketType.capacity}
                  </Text>
                </View>
                <View style={styles.miniProgressBar}>
                  <View
                    style={[
                      styles.miniProgressFill,
                      {
                        width: `${
                          ticketType.capacity > 0
                            ? (ticketType.sold / ticketType.capacity) * 100
                            : 0
                        }%`,
                      },
                    ]}
                  />
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Event Controls */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t('organizerEventManagement.sections.eventControls')}</Text>
        <TouchableOpacity style={styles.controlButton} onPress={handleToggleSales}>
          <Ionicons 
            name={isPaused ? "play-circle-outline" : "pause-circle-outline"} 
            size={24} 
            color={isPaused ? colors.success : colors.warning} 
          />
          <Text style={styles.controlButtonText}>
            {isPaused
              ? t('organizerEventManagement.controls.resumeTicketSales')
              : t('organizerEventManagement.controls.pauseTicketSales')}
          </Text>
          <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.controlButton} onPress={handleSendUpdate}>
          <Ionicons name="notifications-outline" size={24} color={colors.primary} />
          <Text style={styles.controlButtonText}>{t('organizerEventManagement.controls.sendUpdate')}</Text>
          <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
        {event?.status !== 'cancelled' && (
          <TouchableOpacity style={styles.controlButton} onPress={handleCancelEvent}>
            <Ionicons name="close-circle-outline" size={24} color={colors.error} />
            <Text style={[styles.controlButtonText, styles.dangerText]}>{t('organizerEventManagement.controls.cancelEvent')}</Text>
            <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>
      </ScrollView>
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  // 44px tap target for the header share icon, keeping the glyph optically centered.
  headerShareButton: {
    width: 44,
    height: 44,
    marginRight: -10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skeletonBody: {
    padding: 20,
  },
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  errorWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    marginTop: 12,
    fontSize: 16,
    color: colors.error,
    fontWeight: '600',
    textAlign: 'center',
  },
  section: {
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  // Uppercase, letter-spaced eyebrow — the app's `sectionHeader` treatment
  // (POSH §2.7). Sans, not mono: monospace is reserved for true identifiers.
  sectionLabel: {
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textSecondary,
    marginBottom: 14,
  },
  // Cards separate from the canvas by a brightness step, not a border (POSH §1).
  performanceCard: {
    backgroundColor: colors.surface,
    borderRadius: RADIUS.lg,
    padding: 16,
    marginBottom: 12,
  },
  performanceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  performanceTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  performanceValue: {
    fontSize: 18,
    color: colors.text,
  },
  progressBar: {
    height: 8,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 4,
  },
  progressText: {
    fontSize: 11.5,
    letterSpacing: 0.3,
    color: colors.textSecondary,
    textAlign: 'right',
  },
  ticketBreakdown: {
    backgroundColor: colors.surface,
    borderRadius: RADIUS.lg,
    padding: 16,
  },
  breakdownTitle: {
    fontSize: 11,
    letterSpacing: 0.8,
    color: colors.textSecondary,
    marginBottom: 14,
    textTransform: 'uppercase',
  },
  ticketTypeRow: {
    marginBottom: 14,
  },
  ticketTypeInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  ticketTypeName: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
    marginRight: 12,
  },
  ticketTypeStats: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  miniProgressBar: {
    height: 4,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 2,
    overflow: 'hidden',
  },
  miniProgressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  controlButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: RADIUS.lg,
    marginBottom: 12,
  },
  controlButtonText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  dangerText: {
    color: colors.error,
  },
});
