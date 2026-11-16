import React, { useState, useEffect, useCallback, useMemo } from 'react';
import OrgMark from '../../components/OrgMark';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors as T, radius, font } from '../../theme/tokens';
import { useTabBarSpace } from '../../hooks/useTabBarSpace';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import {
  getOrganizerEvents,
  getOrganizerStats,
  getTodayEvents,
  OrganizerEvent,
  OrganizerStats,
  TodayEvent,
} from '../../lib/api/organizer';
import { Skeleton } from '../../components/Skeleton';
import { Touchable } from '../../components/ui/Touchable';
import { Text as UIText } from '../../components/ui/Text';
import StatTriplet from '../../components/StatTriplet';
import StatusChip from '../../components/StatusChip';
import GettingStartedCard from '../../components/organizer/GettingStartedCard';
import { ListGroup, ListRow } from '../../components/ui/ListRow';
import StatusBarBackdrop from '../../components/StatusBarBackdrop';
import { Banknote, ChartColumn, Wallet, RotateCcw, Users, MessageCircle, type LucideIcon } from 'lucide-react-native';
import { backendJson } from '../../lib/api/backend';
import { displayCapacity } from '../../lib/ticketPricing';
import SectionHeader from '../../components/SectionHeader';
import { TikemWordmark } from '../../components/TikemWordmark';
import PosterImage from '../../components/PosterImage';
import { resolvePosterTheme } from '../../lib/posterGradient';
import { formatPrice } from '../../lib/currency';
import { prefetchEarningsHub } from '../../lib/earningsHubCache';
import { useActiveOrg } from '../../lib/activeOrg';
import { loadOrgBrand } from '../../lib/api/orgSettings';
import { OrgSwitcherSheet, useOrgLabel } from '../../components/organizer/OrgSwitcher';

/** How many upcoming events the rail shows before "view all" takes over. */
const UPCOMING_RAIL_MAX = 10;
/** An event with no end time counts as running for this long after it starts. */
const NO_END_RUNNING_MS = 6 * 60 * 60 * 1000;

/**
 * The revenue cell: the largest currency is the figure, any other currency is
 * a caption beneath it. HTG and USD are never added together.
 */
function revenueCell(stats: OrganizerStats | null): { value: string | null; caption?: string } {
  if (!stats) return { value: null };
  const [primary, ...rest] = stats.revenueByCurrency;
  if (!primary) return { value: formatPrice(0, stats.defaultCurrency) };
  return {
    value: formatPrice(primary.amount, primary.currency),
    caption: rest.length
      ? rest.map((r) => `+ ${formatPrice(r.amount, r.currency)}`).join('\n')
      : undefined,
  };
}

export default function OrganizerDashboardScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { userProfile } = useAuth();
  const { t, language } = useI18n();
  const locale = language === 'fr' ? 'fr-FR' : language === 'ht' ? 'fr-HT' : 'en-US';
  // The tab bar is a translucent overlay, so reserve its height here or the
  // last row ends up sitting behind it.
  const tabBarSpace = useTabBarSpace();
  // Tonight's poster frame is a true 4:5 flyer (owner, 2026-11-16: "this is
  // not 4:5" — the old square frame letterboxed it). To keep the scan button
  // above the tab bar (TestFlight 2026-11-02), the poster is capped at ~46% of
  // the screen height and centred when that makes it narrower than the column.
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const heroRatio = 4 / 5;
  const heroWidth = Math.min(windowWidth - 32, Math.round(windowHeight * 0.46 * heroRatio));
  const [todayEvents, setTodayEvents] = useState<TodayEvent[]>([]);
  const [allEvents, setAllEvents] = useState<OrganizerEvent[]>([]);
  const [stats, setStats] = useState<OrganizerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // The org this dashboard is for: the person's own, or a team they run
  // (lib/activeOrg.ts). Every query below is keyed on it, not on the uid.
  const activeOrg = useActiveOrg();
  const orgId = activeOrg.orgId;
  const isOwner = activeOrg.isOwner;
  const financeView = activeOrg.financeView;
  const { roleLabel } = useOrgLabel();
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [teamBrand, setTeamBrand] = useState<{ name: string; logo: string } | null>(null);

  // Acting for someone else's org: greet with THAT org's name and logo.
  useEffect(() => {
    setTeamBrand(null);
    if (!orgId || isOwner) return;
    let cancelled = false;
    loadOrgBrand(orgId)
      .then((b) => {
        if (!cancelled) setTeamBrand({ name: b.organization_name, logo: b.organization_logo });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [orgId, isOwner]);

  // A different org: drop the previous org's numbers before loading.
  useEffect(() => {
    setLoading(true);
    setTodayEvents([]);
    setAllEvents([]);
    setStats(null);
  }, [orgId]);

  const loadData = useCallback(async () => {
    if (!orgId) return;
    // Warm Earnings in the background so it opens on fresh numbers (anyone who
    // may see the org's finances).
    if (financeView) prefetchEarningsHub(orgId);

    try {
      const [eventsData, statsData, organizerEvents] = await Promise.all([
        getTodayEvents(orgId),
        getOrganizerStats(orgId, '7d'),
        getOrganizerEvents(orgId, 200),
      ]);

      setTodayEvents(eventsData);
      setStats(statsData);
      setAllEvents(organizerEvents);
    } catch (error) {
      console.error('Error loading organizer dashboard:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [orgId, financeView]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Reload data when screen comes into focus (e.g., after editing an event)
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  // Unread attendee messages for the Messages row. Staff can't read the inbox,
  // so they never ask. A failed count just hides the number.
  const canMessages = activeOrg.can('manage_events');
  const [unreadMessages, setUnreadMessages] = useState(0);
  useFocusEffect(
    useCallback(() => {
      if (!canMessages) return;
      let live = true;
      backendJson<{ unreadCount?: number }>('/api/organizer/messages?limit=100')
        .then((r) => live && setUnreadMessages(Number(r?.unreadCount) || 0))
        .catch(() => live && setUnreadMessages(0));
      return () => {
        live = false;
      };
    }, [canMessages, activeOrg.orgId])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
  }, [loadData]);

  // Upcoming rail: published, not cancelled, starting later than now, and not
  // already shown in the tonight block. Soonest first.
  const upcomingEvents = useMemo(() => {
    const now = Date.now();
    const todayIds = new Set(todayEvents.map((e) => e.id));
    return allEvents
      .filter((e) => {
        if (todayIds.has(e.id)) return false;
        if (e.status === 'cancelled' || !e.is_published || (e as any).rejected === true) return false;
        const start = new Date(e.start_datetime).getTime();
        return !isNaN(start) && start > now;
      })
      .sort((a, b) => new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime())
      .slice(0, UPCOMING_RAIL_MAX);
  }, [allEvents, todayEvents]);

  const displayName = isOwner
    ? userProfile?.organization_name || userProfile?.full_name || t('organizerDashboard.organizerFallback')
    : teamBrand?.name || activeOrg.orgName || t('orgTeam.unnamedOrg');
  const avatarUri = isOwner
    ? userProfile?.organization_logo || userProfile?.photo_url || null
    : teamBrand?.logo || null;
  // "Admin" / "Manager" under a team org's name; a switch when there is a choice.
  const canSwitch = activeOrg.options.length > 1;
  const showRoleLine = !isOwner || canSwitch;

  const greeting = (
    <View style={[styles.greetingRow, { paddingTop: insets.top + 16 }]}>
      <View style={styles.greetingText}>
        <UIText variant="eyebrow" style={styles.eyebrow} numberOfLines={1}>
          {`${t('organizerDashboard.welcomeBack')},`}
        </UIText>
        <Text style={styles.screenTitle} numberOfLines={2}>
          {displayName}
        </Text>
        {showRoleLine ? (
          <Touchable
            style={styles.roleLine}
            onPress={canSwitch ? () => setShowSwitcher(true) : undefined}
            disabled={!canSwitch}
            accessibilityRole={canSwitch ? 'button' : 'text'}
            accessibilityLabel={canSwitch ? t('orgTeam.switcher.title') : roleLabel(activeOrg.role)}
          >
            <Text style={styles.roleLineText} numberOfLines={1}>
              {roleLabel(activeOrg.role)}
              {canSwitch ? ` · ${t('orgTeam.switcher.switch')}` : ''}
            </Text>
            {canSwitch ? <Ionicons name="chevron-down" size={14} color={colors.textSecondary} /> : null}
          </Touchable>
        ) : null}
      </View>
      <View style={styles.avatar}>
        {avatarUri ? (
          <Image
            source={{ uri: avatarUri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={150}
          />
        ) : (
          <OrgMark size={56} color={colors.text} />
        )}
      </View>
    </View>
  );

  type ManageRow = { key: string; label: string; icon: LucideIcon; onPress: () => void; value?: string };
  const allActions: Array<ManageRow & { ownerOnly?: boolean; finance?: boolean; messages?: boolean }> = [
    {
      messages: true,
      key: 'messages',
      label: t('organizerMessages.title'),
      icon: MessageCircle,
      value: unreadMessages > 0 ? String(unreadMessages) : undefined,
      onPress: () => navigation.navigate('OrganizerMessages'),
    },
    {
      finance: true,
      key: 'earnings',
      label: t('organizerDashboard.earnings') || 'Earnings',
      icon: Banknote,
      onPress: () => navigation.navigate('OrganizerEarningsHub'),
    },
    {
      key: 'analytics',
      label: t('organizerDashboard.analytics') || 'Analytics',
      icon: ChartColumn,
      onPress: () => navigation.navigate('OrganizerAnalytics'),
    },
    {
      ownerOnly: true,
      key: 'payouts',
      label: t('organizerDashboard.payouts') || 'Payouts',
      icon: Wallet,
      onPress: () => navigation.navigate('OrganizerPayoutSettings'),
    },
    {
      key: 'refunds',
      label: t('organizerDashboard.refunds') || 'Refunds',
      icon: RotateCcw,
      onPress: () => navigation.navigate('OrganizerRefunds'),
    },
    {
      key: 'team',
      label: t('organizerDashboard.team') || 'Team',
      icon: Users,
      onPress: () => navigation.navigate('OrganizerTeamHub'),
    },
    // No Scan row: it duplicates the Scan tab. No Create row either (per beta
    // feedback): Create already lives in My Events' header button.
  ];
  // Payouts (money out) are the owner's alone; Earnings also show to an admin
  // the owner granted read-only finances.
  const quickActions: ManageRow[] = allActions
    .filter(
      (a) =>
        (!a.ownerOnly || activeOrg.can('owner_only')) &&
        (!a.finance || financeView) &&
        (!a.messages || canMessages)
    )
    .map(({ ownerOnly: _ownerOnly, finance: _finance, messages: _messages, ...row }) => row);

  const renderPoster = (
    id: string,
    uri: string | null | undefined,
    themeSource: any,
    wordmarkSize: number,
  ) =>
    uri ? (
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={200}
        recyclingKey={id}
      />
    ) : (
      <>
        <LinearGradient
          colors={resolvePosterTheme(themeSource, id || themeSource?.title, themeSource?.category).colors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.posterBrand}>
          <TikemWordmark fontSize={wordmarkSize} />
        </View>
      </>
    );

  const eventTime = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });

  const shortDate = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { month: 'short', day: 'numeric' });

  const renderTonightHero = (event: TodayEvent) => {
    const start = new Date(event.start_datetime).getTime();
    const running = !isNaN(start) && start <= Date.now() && Date.now() < start + NO_END_RUNNING_MS;
    const cap = displayCapacity(event.capacity);
    const soldOut = cap > 0 && event.ticketsSold >= cap;
    // Time, then the place when we have one. An empty location used to
    // leave a pin icon with nothing next to it (TestFlight 2026-09-06).
    const meta = [eventTime(event.start_datetime), event.location].filter(Boolean).join(' · ');
    const progress = cap > 0 ? Math.min(1, event.ticketsSold / cap) : 0;

    return (
      <Touchable
        key={event.id}
        scale={0.98}
        style={[styles.heroCard, { width: heroWidth }]}
        onPress={() => navigation.navigate('OrganizerEventManagement', { eventId: event.id })}
      >
        <View style={[styles.heroPoster, { width: heroWidth, aspectRatio: heroRatio }]}>
          {event.posterUri ? (
            <PosterImage uri={event.posterUri} frameRatio={heroRatio} recyclingKey={event.id} />
          ) : (
            renderPoster(event.id, null, event, 22)
          )}
        </View>

        {/* The flyer already states the name, time and place, so the lines
            under it repeated it (owner, 2026-11-16: "remove all that"). Only
            a poster-less event keeps its title + meta here. */}
        {!event.posterUri && (
          <>
            <Text style={styles.heroTitle} numberOfLines={2}>{event.title}</Text>
            {!!meta && <Text style={styles.heroMeta} numberOfLines={1}>{meta}</Text>}
          </>
        )}

        <View style={styles.heroStatusRow}>
          {soldOut ? (
            <StatusChip status="soldout" label={t('organizerEvents.status.soldOut')} />
          ) : running ? (
            <StatusChip status="live" label={t('organizerDashboard.liveNow')} />
          ) : (
            <StatusChip status="upcoming" label={t('organizerDashboard.onSale')} />
          )}
          <Text style={styles.heroSoldText}>
            {cap > 0
              ? t('organizerDashboard.soldOf', { sold: event.ticketsSold, total: cap })
              : `${event.ticketsSold} ${t('common.sold')}`}
          </Text>
        </View>
        {cap > 0 && (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>
        )}
        {event.ticketsCheckedIn > 0 && (
          <Text style={styles.heroCheckedIn}>
            {`${event.ticketsCheckedIn} ${t('organizerDashboard.checkedIn').toLowerCase()}`}
          </Text>
        )}

        {/* Scanning is the day-of job: the screen's one primary action. */}
        <Touchable
          style={styles.primaryButton}
          accessibilityRole="button"
          onPress={(e) => {
            e.stopPropagation();
            navigation.navigate('TicketScanner', { eventId: event.id });
          }}
        >
          <Ionicons name="qr-code-outline" size={20} color="#000" />
          <Text style={styles.primaryButtonText}>{t('organizerDashboard.openScanner')}</Text>
        </Touchable>
      </Touchable>
    );
  };

  // Further events today (rare): a compact row each, with a secondary scan
  // button so the hero keeps the only primary fill.
  const renderTonightRow = (event: TodayEvent) => {
    const meta = [eventTime(event.start_datetime), event.location].filter(Boolean).join(' · ');
    const cap = displayCapacity(event.capacity);
    return (
      <Touchable
        key={event.id}
        scale={0.98}
        style={styles.tonightRow}
        onPress={() => navigation.navigate('OrganizerEventManagement', { eventId: event.id })}
      >
        <View style={styles.tonightRowPoster}>{renderPoster(event.id, event.posterUri, event, 12)}</View>
        <View style={styles.tonightRowBody}>
          <Text style={styles.tonightRowTitle} numberOfLines={2}>{event.title}</Text>
          {!!meta && <Text style={styles.tonightRowMeta} numberOfLines={1}>{meta}</Text>}
          <Text style={styles.tonightRowMeta} numberOfLines={1}>
            {cap > 0
              ? t('organizerDashboard.soldOf', { sold: event.ticketsSold, total: cap })
              : `${event.ticketsSold} ${t('common.sold')}`}
          </Text>
        </View>
        <Touchable
          style={styles.secondaryButton}
          accessibilityRole="button"
          accessibilityLabel={t('tabs.scan')}
          onPress={(e) => {
            e.stopPropagation();
            navigation.navigate('TicketScanner', { eventId: event.id });
          }}
        >
          <Ionicons name="qr-code-outline" size={18} color={colors.text} />
        </Touchable>
      </Touchable>
    );
  };

  if (loading) {
    return (
      <View style={styles.container}>
        {greeting}
        {/* Tonight: a poster-led hero, poster straight on the canvas. */}
        <View style={styles.section}>
          <Skeleton width={110} height={22} radius={4} style={{ marginBottom: 12 }} />
          <Skeleton width={heroWidth} aspectRatio={heroRatio} radius={radius.poster} style={{ alignSelf: 'center' }} />
        </View>
        {/* This week: section title + the metric triplet (••• while loading). */}
        <View style={styles.section}>
          <Skeleton width={120} height={22} radius={4} style={{ marginBottom: 12 }} />
          <StatTriplet
            items={[
              { label: t('organizerDashboard.revenue'), value: null },
              { label: t('organizerDashboard.statSold'), value: null },
              { label: t('organizerDashboard.statUpcoming'), value: null },
            ]}
          />
        </View>
      </View>
    );
  }

  const [heroEvent, ...moreToday] = todayEvents;

  return (
    <View style={styles.container}>
      <OrgSwitcherSheet visible={showSwitcher} onClose={() => setShowSwitcher(false)} />
      <ScrollView
        style={styles.scrollContent}
        contentContainerStyle={{ paddingBottom: tabBarSpace + 24 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            progressViewOffset={insets.top}
          />
        }
      >
        {greeting}

        {/* Activation checklist — only renders while steps remain (new organizers).
            It is the owner's setup (payouts, verification), so not for a team. */}
        {isOwner ? <GettingStartedCard /> : null}

        {/* Tonight: only when something is on today. */}
        {heroEvent && (
          <View style={styles.section}>
            <SectionHeader title={t('organizerDashboard.tonight')} />
            {renderTonightHero(heroEvent)}
            {moreToday.map(renderTonightRow)}
          </View>
        )}

        {/* This week — the POSH metric triplet, numbers on the canvas.
            Revenue is per currency: the largest is the figure, others sit under
            it as a caption (a 25 HTG sale once rendered as "$25.00"). */}
        <View style={styles.section}>
          <SectionHeader title={t('organizerDashboard.thisWeek')} />
          <Touchable
            scale={0.98}
            accessibilityRole="button"
            onPress={() => navigation.navigate('OrganizerAnalytics')}
          >
            <StatTriplet
              items={[
                { label: t('organizerDashboard.revenue'), ...revenueCell(stats) },
                { label: t('organizerDashboard.statSold'), value: stats ? (stats.ticketsSold || 0) : null },
                { label: t('organizerDashboard.statUpcoming'), value: stats ? (stats.upcomingEvents || 0) : null },
              ]}
            />
          </Touchable>
        </View>

        {/* Upcoming: portrait poster rail, hidden when there is nothing ahead. */}
        {upcomingEvents.length > 0 && (
          <View style={styles.railSection}>
            <View style={styles.railHeader}>
              <SectionHeader
                title={t('organizerDashboard.upcoming')}
                onViewAll={() => navigation.navigate('MyEvents')}
              />
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.railContent}
            >
              {upcomingEvents.map((event) => {
                const place = event.venue_name || event.city || event.location;
                const meta = [shortDate(event.start_datetime), place].filter(Boolean).join(' · ');
                return (
                  <Touchable
                    key={event.id}
                    scale={0.98}
                    style={styles.railCard}
                    onPress={() => navigation.navigate('OrganizerEventManagement', { eventId: event.id })}
                  >
                    <View style={styles.railPoster}>
                      {renderPoster(
                        event.id,
                        event.banner_image_url || event.cover_image_url,
                        event,
                        15,
                      )}
                    </View>
                    <Text style={styles.railTitle} numberOfLines={2}>{event.title}</Text>
                    {!!meta && <Text style={styles.railMeta} numberOfLines={1}>{meta}</Text>}
                    <Text style={styles.railSold} numberOfLines={1}>
                      {`${event.tickets_sold || 0} ${t('common.sold')}`}
                    </Text>
                  </Touchable>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Manage */}
        <View style={styles.section}>
          <SectionHeader title={t('organizerDashboard.manage')} />
          <ListGroup>
            {quickActions.map((row) => (
              <ListRow key={row.key} icon={row.icon} title={row.label} value={row.value} onPress={row.onPress} />
            ))}
          </ListGroup>
        </View>
      </ScrollView>
      {/* No top bar here, so keep content from sliding under the clock. */}
      <StatusBarBackdrop />
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flex: 1,
  },
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    paddingBottom: 8,
    gap: 16,
  },
  greetingText: {
    flex: 1,
  },
  eyebrow: {
    marginBottom: 6,
  },
  roleLine: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
  },
  roleLineText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  screenTitle: {
    fontSize: 36,
    lineHeight: 40,
    fontWeight: '700',
    letterSpacing: -0.8,
    color: colors.text,
  },
  // A true circle: avatars keep the round shape.
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  section: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 4,
  },
  // Tonight hero: no card fill (owner: "no background behind the posters").
  // The flyer sits on the canvas, uncropped, text below it; the frame's
  // ratio is set in the component (heroRatio).
  // The status row, progress and scan button share the poster's width and
  // centring (heroWidth is applied inline), so the block reads as one column.
  heroCard: {
    alignSelf: 'center',
  },
  // surfaceRaised is the poster's own placeholder while the image loads.
  heroPoster: {
    borderRadius: radius.poster,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  posterBrand: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.9,
    paddingHorizontal: 8,
  },
  // Event names are set in the serif everywhere (owner, 2026-11-16).
  heroTitle: {
    marginTop: 16,
    fontFamily: font.serif,
    fontSize: 26,
    lineHeight: 30,
    color: colors.text,
  },
  heroMeta: {
    marginTop: 6,
    fontSize: 15,
    color: colors.textSecondary,
  },
  heroStatusRow: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  heroSoldText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  progressTrack: {
    marginTop: 10,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
  },
  heroCheckedIn: {
    marginTop: 8,
    fontSize: 13,
    color: T.textTertiary,
  },
  primaryButton: {
    marginTop: 18,
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: radius.button,
  },
  primaryButtonText: {
    color: '#000',
    fontSize: 17,
    fontWeight: '700',
  },
  // Standalone poster left, details right, no row fill (like EventListCard).
  tonightRow: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  tonightRowPoster: {
    width: 72,
    aspectRatio: 4 / 5,
    borderRadius: radius.poster,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  tonightRowBody: {
    flex: 1,
    gap: 3,
  },
  tonightRowTitle: {
    fontFamily: font.serif,
    fontSize: 19,
    lineHeight: 22,
    color: colors.text,
  },
  tonightRowMeta: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  secondaryButton: {
    width: 48,
    height: 48,
    borderRadius: radius.button,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Rail: header keeps the gutter, the scroller bleeds to the edge.
  railSection: {
    paddingTop: 20,
    paddingBottom: 4,
  },
  railHeader: {
    paddingHorizontal: 20,
  },
  railContent: {
    paddingHorizontal: 20,
    gap: 14,
  },
  railCard: {
    width: 160,
  },
  // 4:5 like the flyers themselves (2:3 cropped their baked-in text), with
  // the same whisper of rounding as the attendee posters.
  railPoster: {
    width: '100%',
    aspectRatio: 4 / 5,
    borderRadius: radius.poster,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  railTitle: {
    marginTop: 8,
    fontFamily: font.serif,
    fontSize: 19,
    lineHeight: 22,
    color: colors.text,
  },
  railMeta: {
    marginTop: 4,
    fontSize: 13,
    color: colors.textSecondary,
  },
  railSold: {
    marginTop: 4,
    fontSize: 13,
    color: T.textTertiary,
  },
});
