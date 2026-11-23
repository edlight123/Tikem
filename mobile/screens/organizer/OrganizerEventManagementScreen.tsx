import React, { useState, useCallback, useLayoutEffect, useRef } from 'react';
import {
  ActivityIndicator,
  View,
  Text,
  StyleSheet,
  Animated,
  RefreshControl,
  StatusBar,
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
import { useActiveOrg } from '../../lib/activeOrg';
import { shareLink } from '../../lib/share';
import { useLocaleFormat } from '../../lib/format';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Skeleton } from '../../components/Skeleton';
import { Touchable } from '../../components/ui/Touchable';
import { Switch } from '../../components/ui/Switch';
import { ListGroup, ListRow } from '../../components/ui/ListRow';
import {
  Hand,
  Users,
  UserCheck,
  ListChecks,
  Gift,
  Receipt,
  Banknote,
  ChartColumn,
  Eye,
  MessageCircle,
  Tag,
  Megaphone,
  Link,
  Pencil,
  Send,
  Pause,
  TriangleAlert,
  type LucideIcon,
  Sparkles,
} from 'lucide-react-native';
import OrganizerScreenHeader from '../../components/organizer/OrganizerScreenHeader';
import { useOverlayHeaderInset } from '../../components/OverlayHeader';
import ChromeBlur from '../../components/ChromeBlur';
import StatusChip from '../../components/StatusChip';
import StatTriplet from '../../components/StatTriplet';
import { getEventViews, type EventViews } from '../../lib/eventViews';
import SectionHeader from '../../components/SectionHeader';
import { resolvePosterTheme } from '../../lib/posterGradient';
import { colors as T, radius, font } from '../../theme/tokens';
import { eventRequiresApproval, getEventRequests } from '../../lib/attendRequests';
import { displayCapacity } from '../../lib/ticketPricing';
import { canOfferPublish, publishFixFor } from '../../lib/publishFix';

type ActionRow = { key: string; label: string; icon: LucideIcon; onPress: () => void };

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
  // Drives the top chrome backdrop behind the floating back/share buttons.
  const scrollY = useRef(new Animated.Value(0)).current;

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
  // Page views (lib/eventViews.ts): loaded on the side, never blocks the screen.
  const [views, setViews] = useState<EventViews | null>(null);

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
    getEventViews(eventId).then((v) => {
      if (v) setViews(v);
    });
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

  // Owner, or an admin granted read-only finances (the screen is read-only for them).
  const activeOrg = useActiveOrg();
  const canSeeEarnings = activeOrg.financeView;

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

  // Approval list (docs/specs/approval-lists-and-plus-ones.md): a tile only on
  // events that take requests, labelled with the pending count.
  const requiresApproval = eventRequiresApproval(event as any);
  const [pendingRequests, setPendingRequests] = useState<number | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!requiresApproval) return;
      let cancelled = false;
      getEventRequests(eventId)
        .then((res) => {
          if (!cancelled) setPendingRequests(res.counts.pending);
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }, [eventId, requiresApproval])
  );
  const handleRequests = () => {
    navigation.navigate('EventRequests', { eventId });
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
      await shareLink({ text: event?.title || t('common.event'), url });
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

  // Publish (or put back on sale) right here. A draft, an imported one above
  // all, had no way to go live from this screen: the editor's Save never
  // publishes an existing event, and the only control was the pause switch.
  // The server decides; its refusal is shown as it is, with the way out.
  const canManagePayouts = activeOrg.can('owner_only');
  const [publishing, setPublishing] = useState(false);
  const handlePublish = async () => {
    if (publishing) return;
    setPublishing(true);
    try {
      await toggleEventPublication(eventId, true);
      await loadEventData();
      showAlert(t('organizerEventManagement.publish.successTitle'), t('organizerEventManagement.publish.successBody'));
    } catch (error: any) {
      const fix = publishFixFor(error?.code);
      const message = error?.message || t('organizerEventManagement.publish.failed');
      showAlert(
        t('organizerEventManagement.publish.blockedTitle'),
        message,
        fix === 'payouts' && canManagePayouts
          ? [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('organizerEarnings.openPayoutSettings'), onPress: () => navigation.navigate('OrganizerPayoutSettings') },
            ]
          : fix === 'edit'
            ? [
                { text: t('common.cancel'), style: 'cancel' },
                { text: t('organizerEventManagement.actions.editEvent'), onPress: handleEditEvent },
              ]
            : undefined
      );
    } finally {
      setPublishing(false);
    }
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
      <Touchable
        onPress={() => navigation.goBack()}
        style={styles.floatingButton}
        accessibilityRole="button"
        accessibilityLabel={t('common.back')}
        hitSlop={6}
      >
        <Ionicons name="chevron-back" size={22} color={T.white} />
      </Touchable>
      {withShare && (
        <Touchable
          onPress={handleShareEvent}
          style={styles.floatingButton}
          accessibilityRole="button"
          accessibilityLabel={t('organizerEventManagement.actions.shareEvent')}
          hitSlop={6}
        >
          <Ionicons name="share-outline" size={20} color={T.white} />
        </Touchable>
      )}
    </View>
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={colors.background} />
        <View style={[styles.skeletonBody, { paddingTop: insets.top + 64 }]}>
          <Skeleton width={posterW} height={posterW * 1.25} radius={radius.poster} style={{ alignSelf: 'center' }} />
          <Skeleton width={90} height={12} radius={4} style={{ marginTop: 28 }} />
          <Skeleton width="80%" height={30} radius={4} style={{ marginTop: 12 }} />
          <Skeleton width="60%" height={14} radius={4} style={{ marginTop: 12 }} />
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

  const { ticketsSold, ticketsCheckedIn } = ticketData;
  const capacity = displayCapacity(ticketData.capacity);
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
    ...(views
      ? [
          {
            label: t('eventViews.views'),
            value: views.total.toLocaleString(),
            caption: views.today > 0 ? t('eventViews.today', { count: views.today }) : undefined,
          },
        ]
      : []),
  ];

  const canCancel = event?.status !== 'cancelled';
  const offerPublish = canOfferPublish(event as any);
  const ctaBlockH = 56 + 16 + Math.max(insets.bottom, 16);

  const startMs = event?.start_datetime ? new Date(event.start_datetime as any).getTime() : NaN;
  const hasStarted = Number.isFinite(startMs) && startMs < Date.now();
  const actionGroups: { key: string; label: string; rows: ActionRow[] }[] = [
    {
      key: 'door',
      label: t('organizerEventManagement.actionGroups.door'),
      rows: [
        ...(requiresApproval
          ? [
              {
                key: 'requests',
                icon: Hand,
                label: pendingRequests
                  ? t('attendRequests.organizer.actionCount', { count: pendingRequests })
                  : t('attendRequests.organizer.action'),
                onPress: handleRequests,
              },
            ]
          : []),
        { key: 'staff', icon: Users, label: t('organizerEventManagement.actions.staff'), onPress: handleManageStaff },
        { key: 'attendees', icon: UserCheck, label: t('organizerEventManagement.actions.viewAttendees'), onPress: handleViewAttendees },
        { key: 'guestList', icon: ListChecks, label: t('organizerEventManagement.actions.guestList'), onPress: handleGuestList },
        { key: 'comps', icon: Gift, label: t('organizerEventManagement.actions.comps'), onPress: handleViewComps },
      ],
    },
    {
      key: 'sales',
      label: t('organizerEventManagement.actionGroups.sales'),
      rows: [
        // The morning-after recap, once the event has started.
        ...(hasStarted
          ? [
              {
                key: 'recap',
                icon: Sparkles,
                label: t('eventRecap.title'),
                onPress: () => navigation.navigate('OrganizerEventRecap', { eventId }),
              },
            ]
          : []),
        { key: 'orders', icon: Receipt, label: t('organizerEventManagement.actions.orders'), onPress: handleViewOrders },
        // Earnings: owner, or a finance-granted admin (read-only). Never managers.
        ...(canSeeEarnings
          ? [{ key: 'earnings', icon: Banknote, label: t('organizerEventManagement.actions.earnings'), onPress: handleViewEarnings }]
          : []),
        { key: 'analytics', icon: ChartColumn, label: t('organizerEventManagement.actions.analytics'), onPress: handleViewAnalytics },
        { key: 'public', icon: Eye, label: t('organizerEventManagement.actions.viewPublicPage'), onPress: handleViewPublicPage },
      ],
    },
    {
      key: 'promote',
      label: t('organizerEventManagement.actionGroups.promote'),
      rows: [
        { key: 'messages', icon: MessageCircle, label: t('organizerEventManagement.actions.messages'), onPress: handleViewMessages },
        { key: 'promo', icon: Tag, label: t('organizerEventManagement.actions.promoCodes'), onPress: handlePromoCodes },
        { key: 'promoters', icon: Megaphone, label: t('organizerEventManagement.actions.promoters'), onPress: handlePromoters },
        { key: 'tracking', icon: Link, label: t('organizerEventManagement.actions.trackingLinks'), onPress: handleTrackingLinks },
      ],
    },
  ];

  // Chrome covers the safe area plus the button row (8 + 40 + 8). The poster
  // passing under the buttons is fine; the identity block (which starts right
  // below the hero) is what must not. Begin the fade halfway down the poster
  // and land fully opaque just before the title reaches the chrome's lower edge.
  const chromeH = insets.top + 56;
  const posterH = posterW * 1.25;
  const chromeFull = Math.max(1, posterH + 36);
  const chromeOpacity = scrollY.interpolate({
    inputRange: [posterH * 0.5, chromeFull],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />

      <Animated.ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: ctaBlockH + 32 }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true }
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            progressViewOffset={insets.top}
          />
        }
      >
        {/* Poster hero: the flyer stands alone on the canvas. The blurred
            copy that used to bleed behind it read as a mismatched backdrop and
            ghosted the flyer's own text out past its edges (TestFlight: "fix
            the poster"; standing rule: no background behind the posters). */}
        <View style={[styles.hero, { paddingTop: insets.top + 64 }]}>
          {/* The flyer is the artwork: 4:5 with its text baked in, so it gets only
              the poster whisper of rounding and nothing painted behind it. The
              gradient is a stand-in for events without artwork, never an underlay. */}
          <View style={[styles.poster, { width: posterW }]}>
            {!posterUri && (
              <LinearGradient
                colors={posterTheme.colors}
                start={{ x: 0.1, y: 0 }}
                end={{ x: 0.9, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
            )}
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
          <StatTriplet items={stats} columns={stats.length === 4 ? 2 : 3} />
        </View>

        {/* Ticket types */}
        {ticketData.ticketTypes.length > 0 && (
          <View style={styles.section}>
            <SectionHeader title={t('organizerEventManagement.sections.ticketTypes')} />
            {/* Compact rows (owner: "height too big — what if several ticket
                types?"): name and count on one line, a hairline bar under. */}
            <View style={styles.tierGroup}>
              {ticketData.ticketTypes.map((ticketType, index) => {
                // The 1,000,000 "unlimited" sentinel is not a real cap: show
                // just "22 sold" and no progress bar.
                const tierCap = displayCapacity(ticketType.capacity);
                const pct = tierCap > 0 ? Math.min(100, (ticketType.sold / tierCap) * 100) : 0;
                return (
                  <View key={index} style={[styles.tierRow, index > 0 && styles.tierRowSpaced]}>
                    <View style={styles.tierInfo}>
                      <Text style={styles.tierName} numberOfLines={1}>{ticketType.name}</Text>
                      <Text style={styles.tierStats}>
                        {tierCap > 0
                          ? `${ticketType.sold} / ${tierCap} ${t('common.sold')}`
                          : `${ticketType.sold} ${t('common.sold')}`}
                      </Text>
                    </View>
                    {tierCap > 0 && (
                      <View style={styles.tierTrack}>
                        <View style={[styles.tierFill, { width: `${pct}%` }]} />
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Actions: grouped list rows (icon, label, chevron) under the serif
            section rail, one filled group each, instead of the old tile walls
            under uppercase eyebrows. Scan is not repeated here: the pinned
            "Open door scanner" button below already does it. */}
        {actionGroups.map((group) => (
          <View key={group.key} style={styles.section}>
            <SectionHeader title={group.label} />
            <ListGroup>
              {group.rows.map((row) => (
                <ListRow key={row.key} icon={row.icon} title={row.label} onPress={row.onPress} />
              ))}
            </ListGroup>
          </View>
        ))}

        {/* Controls: the same grouped rows. The pause row is a plain row with
            the switch as its trailing element, centred on the label (it used
            to ride above the label's baseline inside a pressable row). */}
        <View style={styles.section}>
          <SectionHeader title={t('organizerEventManagement.sections.eventControls')} />
          <ListGroup>
            <ListRow icon={Pencil} title={t('organizerEventManagement.actions.editEvent')} onPress={handleEditEvent} />
            <ListRow icon={Send} title={t('organizerEventManagement.controls.sendUpdate')} onPress={handleSendUpdate} />
            <ListRow
              icon={Pause}
              title={t('organizerEventManagement.controls.pauseTicketSales')}
              // On = sales paused. Controlled: it only flips once the
              // confirmation lands and the event reloads.
              trailing={
                <Switch
                  value={isPaused}
                  onValueChange={() => handleToggleSales()}
                  accessibilityLabel={t('organizerEventManagement.controls.pauseTicketSales')}
                />
              }
            />
            {canCancel ? (
              <ListRow
                icon={TriangleAlert}
                title={t('organizerEventManagement.controls.cancelEvent')}
                onPress={handleCancelEvent}
                destructive
                chevron={false}
              />
            ) : null}
          </ListGroup>
        </View>
      </Animated.ScrollView>

      {/* Top chrome: invisible over the poster hero, it fades in as the title
          and sections approach the floating buttons, so text scrolls under a
          blurred backdrop instead of colliding with the status bar and buttons. */}
      <Animated.View
        style={[styles.topChrome, { height: chromeH, opacity: chromeOpacity }]}
        pointerEvents="none"
      >
        <ChromeBlur edge="top" />
      </Animated.View>

      {renderFloatingControls(true)}

      {/* The one primary action: door scanner, pinned over a dark fade. */}
      <View style={[styles.ctaDock, { paddingBottom: Math.max(insets.bottom, 16) }]} pointerEvents="box-none">
        <LinearGradient
          colors={['rgba(10,10,10,0)', 'rgba(10,10,10,0.92)', T.bg]}
          locations={[0, 0.45, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        {offerPublish ? (
          // Not live yet: the one primary action is to publish, not to scan.
          <Touchable
            style={[styles.cta, publishing && { opacity: 0.7 }]}
            onPress={handlePublish}
            disabled={publishing}
            accessibilityRole="button"
            accessibilityLabel={t('organizerEventManagement.publish.cta')}
          >
            {publishing ? (
              <ActivityIndicator color={T.black} />
            ) : (
              <>
                <Ionicons name="rocket-outline" size={22} color={T.black} />
                <Text style={styles.ctaText}>{t('organizerEventManagement.publish.cta')}</Text>
              </>
            )}
          </Touchable>
        ) : (
          <Touchable
            style={styles.cta}
            onPress={handleScanTickets}
            accessibilityRole="button"
            accessibilityLabel={t('organizerEventManagement.openScanner')}
          >
            <Ionicons name="scan-outline" size={22} color={T.black} />
            <Text style={styles.ctaText}>{t('organizerEventManagement.openScanner')}</Text>
          </Touchable>
        )}
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
  topChrome: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
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
    // With no blurred hero behind them these sit on the bare canvas, so they
    // need a fill of their own; translucent so the poster still reads through.
    backgroundColor: 'rgba(38,38,38,0.72)',
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
    fontSize: 15,
    color: colors.error,
    fontWeight: '600',
    textAlign: 'center',
  },
  hero: {
    alignItems: 'center',
    paddingBottom: 36,
  },
  poster: {
    aspectRatio: 4 / 5,
    borderRadius: radius.poster,
    overflow: 'hidden',
  },
  identity: {
    paddingHorizontal: 20,
    gap: 10,
  },
  // Event names are set in the serif everywhere (owner, 2026-11-16), as on
  // the attendee event page.
  title: {
    fontFamily: font.serif,
    fontSize: 34,
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
  tierGroup: {
    backgroundColor: T.surface,
    borderRadius: radius.xl,
    paddingHorizontal: 16,
  },
  tierRow: { paddingVertical: 13 },
  tierRowSpaced: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: T.surfaceRaised,
  },
  tierInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  tierName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: T.white,
    marginRight: 12,
  },
  tierStats: {
    fontSize: 13,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  tierTrack: {
    marginTop: 8,
    height: 3,
    backgroundColor: T.surfaceRaised,
    borderRadius: 3,
    overflow: 'hidden',
  },
  tierFill: {
    height: '100%',
    backgroundColor: T.white,
    borderRadius: 3,
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
