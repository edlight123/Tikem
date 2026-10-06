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
  useWindowDimensions,
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
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Skeleton } from '../../components/Skeleton';
import ActionTileGrid from '../../components/organizer/ActionTileGrid';
import OrganizerScreenHeader from '../../components/organizer/OrganizerScreenHeader';
import { useOverlayHeaderInset } from '../../components/OverlayHeader';
import StatusChip from '../../components/StatusChip';
import StatTriplet from '../../components/StatTriplet';
import SectionHeader from '../../components/SectionHeader';
import { resolvePosterTheme } from '../../lib/posterGradient';
import { colors as T, radius } from '../../theme/tokens';

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
  const { width: screenW } = useWindowDimensions();
  // Centred poster: ~66% of the screen width, capped for tablets.
  const posterW = Math.min(Math.round(screenW * 0.66), 320);
  const { height: headerH, onHeight } = useOverlayHeaderInset();

  // The stack registers this route with a generic "Manage Event" nav bar. Hide it
  // so the poster hero with its floating back/share buttons owns the top edge.
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

  const handleViewOrders = () => {
    navigation.navigate('EventOrders', { eventId, eventTitle: event?.title });
  };

  const handleViewAnalytics = () => {
    navigation.navigate('EventAnalytics', { eventId, eventTitle: event?.title });
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

  const handleGuestList = () => {
    navigation.navigate('OrganizerGuestList', { eventId });
  };

  const handleTrackingLinks = () => {
    navigation.navigate('OrganizerTrackingLinks', { eventId });
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

  // Floating hero controls (back / share): small dark translucent rounded squares
  // pinned under the status bar, over the poster backdrop.
  const renderFloatingControls = (withShare: boolean) => (
    <View style={[styles.floatingBar, { top: insets.top + 8 }]} pointerEvents="box-none">
      <TouchableOpacity
        onPress={() => navigation.goBack()}
        style={styles.floatingButton}
        accessibilityRole="button"
        accessibilityLabel={t('common.back')}
        hitSlop={6}
      >
        <Ionicons name="chevron-back" size={22} color={T.white} />
      </TouchableOpacity>
      {withShare && (
        <TouchableOpacity
          onPress={handleShareEvent}
          style={styles.floatingButton}
          accessibilityRole="button"
          accessibilityLabel={t('organizerEventManagement.actions.shareEvent')}
          hitSlop={6}
        >
          <Ionicons name="share-outline" size={20} color={T.white} />
        </TouchableOpacity>
      )}
    </View>
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={colors.background} />
        <View style={[styles.skeletonBody, { paddingTop: insets.top + 64 }]}>
          <Skeleton width={posterW} height={posterW * 1.25} radius={radius.xl} style={{ alignSelf: 'center' }} />
          <Skeleton width={90} height={12} radius={6} style={{ marginTop: 28 }} />
          <Skeleton width="80%" height={30} radius={8} style={{ marginTop: 12 }} />
          <Skeleton width="60%" height={14} radius={6} style={{ marginTop: 12 }} />
          <Skeleton width="100%" height={64} radius={radius.lg} style={{ marginTop: 28 }} />
          <Skeleton width="100%" height={140} radius={radius.xl} style={{ marginTop: 28 }} />
        </View>
        {renderFloatingControls(false)}
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
  const venue = event.venue_name || event.location || event.city;
  const metaLine = [formattedDate, formattedTime, venue].filter(Boolean).join(' · ');
  const posterUri = event.cover_image_url || event.banner_image_url;
  const posterTheme = resolvePosterTheme(event, event.id || event.title, event.category);

  const { ticketsSold, ticketsCheckedIn, capacity } = ticketData;
  const isSoldOut = capacity > 0 && ticketsSold >= capacity;
  const sellThrough = capacity > 0 ? Math.round((ticketsSold / capacity) * 100) : null;

  // Locked StatusChip semantics (POSH §2.7): live teal, paused/draft amber,
  // sold out / cancelled red, completed grey.
  const chip = (() => {
    if (event.status === 'cancelled') return { status: 'error', label: t('organizerEvents.status.cancelled') };
    if (event.status === 'completed') return { status: 'neutral', label: t('organizerEvents.status.completed') };
    if (event.status === 'draft') return { status: 'actionNeeded', label: t('organizerEvents.status.draft') };
    if (isPaused) return { status: 'actionNeeded', label: t('organizerEventManagement.status.paused') };
    if (isSoldOut) return { status: 'soldOut', label: t('organizerEvents.status.soldOut') };
    return { status: 'live', label: t('organizerEventManagement.status.onSale') };
  })();

  const stats = [
    {
      label: t('organizerEventManagement.stats.sold'),
      value: capacity > 0 ? `${ticketsSold}/${capacity}` : String(ticketsSold),
    },
    { label: t('organizerEventManagement.stats.checkedIn'), value: String(ticketsCheckedIn) },
    ...(sellThrough !== null
      ? [{ label: t('organizerEventManagement.stats.sellThrough'), value: `${sellThrough}%` }]
      : []),
  ];

  const canCancel = event?.status !== 'cancelled';
  const ctaBlockH = 56 + 16 + Math.max(insets.bottom, 16);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: ctaBlockH + 32 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            progressViewOffset={insets.top}
          />
        }
      >
        {/* Poster hero: a soft blurred copy of the artwork bleeds behind the sharp,
            centred poster and fades into the canvas. */}
        <View style={[styles.hero, { paddingTop: insets.top + 64 }]}>
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <LinearGradient
              colors={posterTheme.colors}
              start={{ x: 0.1, y: 0 }}
              end={{ x: 0.9, y: 1 }}
              style={[StyleSheet.absoluteFill, { opacity: 0.35 }]}
            />
            {!!posterUri && (
              <ExpoImage
                source={{ uri: posterUri }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                blurRadius={40}
                cachePolicy="memory-disk"
              />
            )}
            <View style={styles.heroScrim} />
            <LinearGradient
              colors={['rgba(10,10,10,0)', T.bg]}
              locations={[0.35, 1]}
              style={StyleSheet.absoluteFill}
            />
          </View>
          <View style={[styles.poster, { width: posterW }]}>
            <LinearGradient
              colors={posterTheme.colors}
              start={{ x: 0.1, y: 0 }}
              end={{ x: 0.9, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            {!!posterUri && (
              <ExpoImage
                source={{ uri: posterUri }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={120}
              />
            )}
          </View>
        </View>

        {/* Identity */}
        <View style={styles.identity}>
          <StatusChip status={chip.status} label={chip.label} />
          <Text style={styles.title} numberOfLines={3}>{event.title}</Text>
          {!!metaLine && <Text style={styles.meta}>{metaLine}</Text>}
        </View>

        {/* Metrics sit directly on the canvas (no stat boxes). */}
        <View style={styles.statsWrap}>
          <StatTriplet items={stats} />
        </View>

        {/* Ticket types */}
        {ticketData.ticketTypes.length > 0 && (
          <View style={styles.section}>
            <SectionHeader title={t('organizerEventManagement.sections.ticketTypes')} />
            <View style={styles.group}>
              {ticketData.ticketTypes.map((ticketType, index) => {
                const pct =
                  ticketType.capacity > 0
                    ? Math.min(100, (ticketType.sold / ticketType.capacity) * 100)
                    : 0;
                return (
                  <View key={index} style={[styles.tierRow, index > 0 && styles.tierRowSpaced]}>
                    <View style={styles.tierInfo}>
                      <Text style={styles.tierName} numberOfLines={1}>{ticketType.name}</Text>
                      <Text style={styles.tierStats}>
                        {ticketType.sold} / {ticketType.capacity} {t('common.sold')}
                      </Text>
                    </View>
                    <View style={styles.tierTrack}>
                      <View style={[styles.tierFill, { width: `${pct}%` }]} />
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Quick actions */}
        <View style={styles.section}>
          <SectionHeader title={t('organizerEventManagement.sections.quickActions')} />
          <ActionTileGrid
            variant="stacked"
            columns={3}
            tiles={[
              { key: 'scan', icon: 'qr-code-outline', label: t('organizerEventManagement.actions.scanTickets'), onPress: handleScanTickets },
              { key: 'staff', icon: 'people-outline', label: t('organizerEventManagement.actions.staff'), onPress: handleManageStaff },
              { key: 'attendees', icon: 'people-circle-outline', label: t('organizerEventManagement.actions.viewAttendees'), onPress: handleViewAttendees },
              { key: 'orders', icon: 'receipt-outline', label: t('organizerEventManagement.actions.orders'), onPress: handleViewOrders },
              { key: 'earnings', icon: 'cash-outline', label: t('organizerEventManagement.actions.earnings'), onPress: handleViewEarnings },
              { key: 'analytics', icon: 'bar-chart-outline', label: t('organizerEventManagement.actions.analytics'), onPress: handleViewAnalytics },
              { key: 'messages', icon: 'chatbubble-ellipses-outline', label: t('organizerEventManagement.actions.messages'), onPress: handleViewMessages },
              { key: 'comps', icon: 'gift-outline', label: t('organizerEventManagement.actions.comps'), onPress: handleViewComps },
              { key: 'promo', icon: 'pricetag-outline', label: t('organizerEventManagement.actions.promoCodes'), onPress: handlePromoCodes },
              { key: 'promoters', icon: 'megaphone-outline', label: t('organizerEventManagement.actions.promoters'), onPress: handlePromoters },
              { key: 'guestList', icon: 'list-outline', label: t('organizerEventManagement.actions.guestList'), onPress: handleGuestList },
              { key: 'tracking', icon: 'link-outline', label: t('organizerEventManagement.actions.trackingLinks'), onPress: handleTrackingLinks },
              { key: 'public', icon: 'eye-outline', label: t('organizerEventManagement.actions.viewPublicPage'), onPress: handleViewPublicPage },
            ]}
          />
        </View>

        {/* Controls: one surface-filled group, rows split by a subtle inset divider. */}
        <View style={styles.section}>
          <SectionHeader title={t('organizerEventManagement.sections.eventControls')} />
          <View style={styles.controlsGroup}>
            <TouchableOpacity style={styles.controlRow} onPress={handleEditEvent} activeOpacity={0.7}>
              <Text style={styles.controlText}>{t('organizerEventManagement.actions.editEvent')}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
            <View style={styles.divider} />
            <TouchableOpacity style={styles.controlRow} onPress={handleSendUpdate} activeOpacity={0.7}>
              <Text style={styles.controlText}>{t('organizerEventManagement.controls.sendUpdate')}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
            <View style={styles.divider} />
            <TouchableOpacity
              style={styles.controlRow}
              onPress={handleToggleSales}
              activeOpacity={0.7}
              accessibilityRole="switch"
              accessibilityState={{ checked: isPaused }}
            >
              <Text style={styles.controlText}>
                {t('organizerEventManagement.controls.pauseTicketSales')}
              </Text>
              {/* Rounded-rect toggle (no stadium pills); on = sales paused. */}
              <View style={[styles.toggleTrack, isPaused && styles.toggleTrackOn]}>
                <View style={[styles.toggleThumb, isPaused && styles.toggleThumbOn]} />
              </View>
            </TouchableOpacity>
            {canCancel && (
              <>
                <View style={styles.divider} />
                <TouchableOpacity style={styles.controlRow} onPress={handleCancelEvent} activeOpacity={0.7}>
                  <Text style={[styles.controlText, styles.dangerText]}>
                    {t('organizerEventManagement.controls.cancelEvent')}
                  </Text>
                  <Ionicons name="warning-outline" size={19} color={T.red} />
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </ScrollView>

      {renderFloatingControls(true)}

      {/* The one primary action: door scanner, pinned over a dark fade. */}
      <View style={[styles.ctaDock, { paddingBottom: Math.max(insets.bottom, 16) }]} pointerEvents="box-none">
        <LinearGradient
          colors={['rgba(10,10,10,0)', 'rgba(10,10,10,0.92)', T.bg]}
          locations={[0, 0.45, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <TouchableOpacity
          style={styles.cta}
          onPress={handleScanTickets}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={t('organizerEventManagement.openScanner')}
        >
          <Ionicons name="scan-outline" size={22} color={T.black} />
          <Text style={styles.ctaText}>{t('organizerEventManagement.openScanner')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.bg,
  },
  scroll: {
    flex: 1,
  },
  floatingBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  floatingButton: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  skeletonBody: {
    paddingHorizontal: 20,
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
  hero: {
    alignItems: 'center',
    paddingBottom: 36,
    overflow: 'hidden',
  },
  heroScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10,10,10,0.35)',
  },
  poster: {
    aspectRatio: 4 / 5,
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: T.surface,
  },
  identity: {
    paddingHorizontal: 20,
    gap: 10,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.8,
    lineHeight: 38,
    color: T.white,
  },
  meta: {
    fontSize: 15,
    color: colors.textSecondary,
  },
  statsWrap: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  section: {
    paddingHorizontal: 20,
    paddingTop: 32,
  },
  group: {
    backgroundColor: T.surface,
    borderRadius: radius.xl,
    padding: 20,
  },
  tierRow: {},
  tierRowSpaced: {
    marginTop: 20,
  },
  tierInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 10,
  },
  tierName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: T.white,
    marginRight: 12,
  },
  tierStats: {
    fontSize: 13,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  tierTrack: {
    height: 6,
    backgroundColor: T.surfaceRaised,
    borderRadius: 3,
    overflow: 'hidden',
  },
  tierFill: {
    height: '100%',
    backgroundColor: T.white,
    borderRadius: 3,
  },
  controlsGroup: {
    backgroundColor: T.surface,
    borderRadius: radius.xl,
    overflow: 'hidden',
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    minHeight: 60,
  },
  controlText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: T.white,
  },
  dangerText: {
    color: T.red,
  },
  // Very subtle inset divider between grouped rows.
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginLeft: 20,
  },
  toggleTrack: {
    width: 46,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: T.surfaceRaised,
    padding: 3,
    justifyContent: 'center',
  },
  toggleTrackOn: {
    backgroundColor: T.accent,
  },
  toggleThumb: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: T.white,
  },
  toggleThumbOn: {
    alignSelf: 'flex-end',
  },
  ctaDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 20,
    paddingTop: 40,
  },
  cta: {
    height: 56,
    borderRadius: radius.button,
    backgroundColor: T.white,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  ctaText: {
    fontSize: 17,
    fontWeight: '700',
    color: T.black,
  },
});
