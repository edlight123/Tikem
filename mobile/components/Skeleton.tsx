import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, ViewStyle, DimensionValue, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';

const { width: SCREEN_W } = Dimensions.get('window');

// Geometry copied from the real components so placeholders line up exactly.
const HOME_CARD_WIDTH = Math.min(248, SCREEN_W * 0.62); // EventRail CARD_WIDTH
const FAV_COLUMN_WIDTH = (SCREEN_W - 32 - 12) / 2; // FavoritesScreen grid column
// OrganizerProfileScreen HERO_IDENTITY_OFFSET (control top 8 + control 40 + gap 10):
// the identity block is top-anchored under the back/Follow controls, so the
// placeholder has to start at the same insets.top + 58 or the header jumps.
const PROFILE_IDENTITY_OFFSET = 58;

interface SkeletonProps {
  width?: DimensionValue;
  height?: DimensionValue;
  radius?: number;
  /**
   * Size by ratio instead of a fixed height. Callers used to express this as
   * `height={undefined as any}` plus `style={{ aspectRatio }}`, which silently
   * did NOT work: a JS default parameter fires on `undefined`, so `height` fell
   * back to 16 and every poster placeholder rendered as a thin bar rather than
   * a poster. Pass this instead — it suppresses the height entirely.
   */
  aspectRatio?: number;
  style?: ViewStyle | ViewStyle[];
}

/** A single shimmering placeholder block. */
export function Skeleton({ width = '100%', height, radius = 4, aspectRatio, style }: SkeletonProps) {
  const { colors, isDark } = useTheme();
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 850, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 850, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer]);

  const opacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.9] });

  return (
    <Animated.View
      style={[
        {
          width,
          // Height and aspectRatio are mutually exclusive: setting both leaves
          // the fixed height winning and the ratio inert.
          ...(aspectRatio != null ? { aspectRatio } : { height: height ?? 16 }),
          borderRadius: radius,
          backgroundColor: isDark ? colors.borderLight : colors.border,
          opacity,
        },
        style as ViewStyle,
      ]}
    />
  );
}

/**
 * Matches PosterEventCard: a transparent card (no border/fill) with a
 * rounded-16 poster, then a title line and a date/price meta row beneath it.
 */
export function PosterCardSkeleton({ width, ratio = 1.25 }: { width?: number; ratio?: number }) {
  return (
    <View style={width ? { width } : { flex: 1 }}>
      <Skeleton radius={4} aspectRatio={1 / ratio} style={{ width: '100%' } as ViewStyle} />
      <View style={styles.posterMeta}>
        {/* Three lines, like the real card: serif title (16), price · venue
            (11.5), date (11). Two lines left each card ~15pt short. */}
        <Skeleton width={'74%'} height={16} radius={4} />
        <View style={styles.posterMetaRow}>
          <Skeleton width={'60%'} height={12} radius={4} />
          <Skeleton width={34} height={12} radius={4} />
        </View>
        <Skeleton width={'38%'} height={11} radius={4} style={{ marginTop: 6 }} />
      </View>
    </View>
  );
}

/** A horizontal rail of poster-card skeletons (Home / "see all" sections). */
export function PosterRailSkeleton({ cardWidth = HOME_CARD_WIDTH, count = 3 }: { cardWidth?: number; count?: number }) {
  return (
    <View style={styles.rail}>
      {Array.from({ length: count }).map((_, i) => (
        <PosterCardSkeleton key={i} width={cardWidth} />
      ))}
    </View>
  );
}

/**
 * Matches SectionHeader: serif title (22) PLUS its subtitle line (11 + 3 gap).
 * The subtitle bar is not decoration — without it every skeleton section was
 * ~25pt shorter than the real one, so when data arrived the whole feed
 * reflowed downward and the swap read as the page sliding in instead of the
 * placeholders becoming the posters.
 */
export function SectionHeaderSkeleton() {
  return (
    <View style={styles.sectionHeader}>
      <View style={{ gap: 4 }}>
        <Skeleton width={138} height={22} radius={4} />
        <Skeleton width={96} height={11} radius={4} />
      </View>
      <Skeleton width={46} height={13} radius={4} />
    </View>
  );
}

/** The full Home feed placeholder: repeated section header + poster rail. */
export function HomeFeedSkeleton({ sections = 3 }: { sections?: number }) {
  return (
    <View style={styles.homeFeed}>
      {Array.from({ length: sections }).map((_, i) => (
        <View key={i} style={styles.homeSection}>
          <SectionHeaderSkeleton />
          <PosterRailSkeleton />
        </View>
      ))}
    </View>
  );
}

/**
 * Matches DiscoverEventCard: a tall full-bleed poster, a title/organizer/meta
 * block with two action dots on the right, then a full-width CTA bar.
 */
export function DiscoverCardSkeleton() {
  return (
    <View style={styles.discoverCard}>
      {/* 2:3 like the card's default aspect and the single 4pt brand radius like its
          poster — the old fixed 1.15x height was ~30% too short and the 16pt
          corners read rounder than anything on the real card. */}
      <Skeleton aspectRatio={2 / 3} radius={4} style={{ width: '100%' } as ViewStyle} />
      <View style={styles.discoverBody}>
        <View style={styles.discoverBodyText}>
          <Skeleton width={'88%'} height={20} radius={4} />
          <Skeleton width={'52%'} height={20} radius={4} />
          <Skeleton width={'40%'} height={13} radius={4} style={{ marginTop: 3 } as ViewStyle} />
          <Skeleton width={'72%'} height={13} radius={4} />
        </View>
        <View style={styles.discoverActions}>
          <Skeleton width={20} height={20} radius={4} />
          <Skeleton width={20} height={20} radius={4} />
        </View>
      </View>
      {/* Compact WhitePillCTA: 46 tall, radius.button (4). */}
      <Skeleton height={46} radius={4} style={{ width: '100%', marginTop: 14 } as ViewStyle} />
    </View>
  );
}

/** A vertical feed of Discover card skeletons. */
export function DiscoverFeedSkeleton({ count = 3 }: { count?: number }) {
  return (
    <View style={styles.discoverFeed}>
      {Array.from({ length: count }).map((_, i) => (
        <DiscoverCardSkeleton key={i} />
      ))}
    </View>
  );
}

/** Matches EventListCard: a 4:5 poster on the left, stacked text on the right. */
export function ListCardSkeleton() {
  return (
    <View style={styles.listCard}>
      <Skeleton width={92} radius={4} aspectRatio={4 / 5} />
      <View style={styles.listBody}>
        <Skeleton width={'82%'} height={15} radius={4} />
        <Skeleton width={'55%'} height={12} radius={4} />
        <Skeleton width={'45%'} height={12} radius={4} />
        <Skeleton width={54} height={12} radius={4} style={{ marginTop: 2 } as ViewStyle} />
      </View>
    </View>
  );
}

/** A vertical list of horizontal list-card skeletons (Category page). */
export function ListSkeleton({ count = 7 }: { count?: number }) {
  return (
    <View style={styles.list}>
      {Array.from({ length: count }).map((_, i) => (
        <ListCardSkeleton key={i} />
      ))}
    </View>
  );
}

/** A two-column grid of poster-card skeletons (Favorites page). */
export function GridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <View style={styles.grid}>
      {Array.from({ length: count }).map((_, i) => (
        <PosterCardSkeleton key={i} width={FAV_COLUMN_WIDTH} />
      ))}
    </View>
  );
}

const EVENT_POSTER_W = SCREEN_W * 0.86; // EventDetailScreen POSTER_W

/** Three evenly-spaced stat columns (value over label) — mirrors StatTriplet. */
function StatTripletSkeleton() {
  return (
    <View style={styles.statTriplet}>
      {Array.from({ length: 3 }).map((_, i) => (
        <View key={i} style={styles.statCol}>
          <Skeleton width={46} height={22} radius={4} />
          <Skeleton width={58} height={11} radius={4} style={{ marginTop: 8 } as ViewStyle} />
        </View>
      ))}
    </View>
  );
}

/**
 * EventDetailScreen initial load: a centered poster hero, a two-line title,
 * a couple of meta rows, an about block, and a floating CTA pill.
 */
export function EventDetailSkeleton() {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.eventHero, { backgroundColor: colors.surfaceMuted }]}>
        <Skeleton radius={4} aspectRatio={4 / 5} style={{ width: EVENT_POSTER_W } as ViewStyle} />
      </View>
      <View style={styles.eventContent}>
        <Skeleton width={'82%'} height={30} radius={4} />
        <Skeleton width={'54%'} height={30} radius={4} style={{ marginTop: 8 } as ViewStyle} />
        <View style={styles.eventFacts}>
          {Array.from({ length: 2 }).map((_, i) => (
            <View key={i} style={styles.eventFactRow}>
              <Skeleton width={18} height={18} radius={4} />
              <View style={styles.eventFactText}>
                <Skeleton width={'62%'} height={13} radius={4} />
                <Skeleton width={'40%'} height={11} radius={4} />
              </View>
            </View>
          ))}
        </View>
        <View style={styles.eventSection}>
          <Skeleton width={120} height={18} radius={4} />
          <Skeleton width={'100%'} height={13} radius={4} style={{ marginTop: 14 } as ViewStyle} />
          <Skeleton width={'92%'} height={13} radius={4} style={{ marginTop: 8 } as ViewStyle} />
          <Skeleton width={'70%'} height={13} radius={4} style={{ marginTop: 8 } as ViewStyle} />
        </View>
      </View>
      <View style={styles.eventFloatingCta}>
        <Skeleton height={54} radius={4} />
      </View>
    </View>
  );
}

/** TicketDetailScreen initial load: title, status chip, QR-card block, info rows. */
export function TicketDetailSkeleton() {
  const { colors } = useTheme();
  return (
    <View style={styles.ticketDetail}>
      <Skeleton width={'70%'} height={28} radius={4} />
      <Skeleton width={96} height={26} radius={4} style={{ alignSelf: 'center', marginTop: 18 } as ViewStyle} />
      <Skeleton height={360} radius={4} style={{ width: '86%', alignSelf: 'center', marginTop: 24 } as ViewStyle} />
      <Skeleton width={'60%'} height={13} radius={4} style={{ alignSelf: 'center', marginTop: 16 } as ViewStyle} />
      <View style={styles.ticketInfoCards}>
        {Array.from({ length: 3 }).map((_, i) => (
          <View key={i} style={[styles.ticketInfoCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Skeleton width={40} height={40} radius={4} />
            <View style={styles.ticketInfoText}>
              <Skeleton width={'40%'} height={11} radius={4} />
              <Skeleton width={'70%'} height={14} radius={4} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

/** EventTicketsScreen initial load: centered event title + a large ticket-pass card. */
export function TicketPassSkeleton() {
  return (
    <View style={styles.ticketPass}>
      <Skeleton width={'70%'} height={24} radius={4} style={{ alignSelf: 'center' } as ViewStyle} />
      <Skeleton width={120} height={12} radius={4} style={{ alignSelf: 'center', marginTop: 10 } as ViewStyle} />
      <Skeleton height={480} radius={4} style={{ width: '100%', marginTop: 28 } as ViewStyle} />
    </View>
  );
}

/** NotificationsScreen initial load: elevated cards with an icon and two text lines. */
export function NotificationsSkeleton({ count = 6 }: { count?: number }) {
  const { colors } = useTheme();
  return (
    <View style={styles.notifList}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={[styles.notifCard, { backgroundColor: colors.surfaceRaised }]}>
          <Skeleton width={40} height={40} radius={4} />
          <View style={styles.notifBody}>
            <Skeleton width={'70%'} height={14} radius={4} />
            <Skeleton width={'92%'} height={12} radius={4} />
            <Skeleton width={90} height={11} radius={4} style={{ marginTop: 2 } as ViewStyle} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** People rows (Connections): a card of avatar + name + connect-pill rows. */
export function PeopleRowsSkeleton({ count = 7 }: { count?: number }) {
  const { colors } = useTheme();
  return (
    <View style={styles.peopleWrap}>
      <View style={[styles.peopleCard, { backgroundColor: colors.surface }]}>
        {Array.from({ length: count }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.peopleRow,
              i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
            ]}
          >
            <Skeleton width={44} height={44} radius={22} />
            <View style={{ flex: 1 }}>
              <Skeleton width={'55%'} height={14} radius={4} />
            </View>
            <Skeleton width={74} height={32} radius={4} />
          </View>
        ))}
      </View>
    </View>
  );
}

/** OrganizerEventEarningsScreen initial load: balance card + stat triplet + CTA pills. */
export function EarningsSkeleton() {
  const { colors } = useTheme();
  return (
    <View style={styles.earnings}>
      <View style={[styles.earningsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Skeleton width={'40%'} height={12} radius={4} />
        <Skeleton width={'62%'} height={34} radius={4} style={{ marginTop: 10 } as ViewStyle} />
        <Skeleton width={'50%'} height={12} radius={4} style={{ marginTop: 14 } as ViewStyle} />
      </View>
      <View style={{ height: 12 }} />
      <StatTripletSkeleton />
      <View style={{ height: 24 }} />
      <Skeleton height={52} radius={4} />
      <Skeleton height={52} radius={4} style={{ marginTop: 12 } as ViewStyle} />
    </View>
  );
}

/** OrganizerProfileScreen initial load: hero (avatar + name), stat triplet, event grid. */
export function OrganizerProfileSkeleton() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1 }}>
      {/* Mirrors the compacted header: a 52px avatar INLINE beside the name,
          meta line beneath, then a single quiet stats line — so the placeholder
          and the real screen are the same height and nothing jumps on load.
          Like the real hero it is TOP-anchored under the (absent here) back /
          Follow controls rather than bottom-aligned in a fixed-height box. */}
      <View
        style={[
          styles.profileHero,
          { backgroundColor: colors.surfaceRaised, paddingTop: insets.top + PROFILE_IDENTITY_OFFSET },
        ]}
      >
        <View style={styles.profileIdentityRow}>
          <Skeleton width={52} height={52} radius={26} />
          {/* 36 (name lineHeight) + 4 (gap) + 18 (meta line) = the real 58pt
              identity column, so the hero lands at the same height. */}
          <View style={{ flex: 1 }}>
            <Skeleton width={'75%'} height={36} radius={4} />
            <Skeleton width={'45%'} height={18} radius={4} style={{ marginTop: 4 } as ViewStyle} />
          </View>
        </View>
      </View>
      <View style={styles.profileContent}>
        <Skeleton width={'62%'} height={18} radius={4} />
        <View style={{ height: 20 }} />
        <Skeleton width={160} height={24} radius={4} />
        <Skeleton width={120} height={13} radius={4} style={{ marginTop: 8 } as ViewStyle} />
      </View>
      <GridSkeleton count={4} />
    </View>
  );
}

/**
 * ReviewScreen initial load: header (back + title), an event card, two
 * star-rating blocks, a recommend row, a comment box, and a submit pill —
 * mirrors the populated form instead of a bare centered spinner.
 */
export function ReviewSkeleton() {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.reviewHeader, { borderBottomColor: colors.border }]}>
        <Skeleton width={24} height={24} radius={4} />
        <Skeleton width={140} height={20} radius={4} />
        <View style={{ width: 40 }} />
      </View>

      <View style={[styles.reviewCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Skeleton width={'80%'} height={18} radius={4} />
        <Skeleton width={'45%'} height={13} radius={4} style={{ marginTop: 8 } as ViewStyle} />
      </View>

      {Array.from({ length: 2 }).map((_, i) => (
        <View key={i} style={[styles.reviewRatingBlock, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Skeleton width={'60%'} height={15} radius={4} />
          <View style={styles.reviewStarsRow}>
            {Array.from({ length: 5 }).map((__, s) => (
              <Skeleton key={s} width={36} height={36} radius={4} />
            ))}
          </View>
          <Skeleton width={80} height={12} radius={4} style={{ marginTop: 8 } as ViewStyle} />
        </View>
      ))}

      <View style={[styles.reviewRatingBlock, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Skeleton width={'70%'} height={15} radius={4} />
        <View style={styles.reviewRecommendRow}>
          <Skeleton width={110} height={48} radius={4} />
          <Skeleton width={110} height={48} radius={4} />
        </View>
      </View>

      <View style={styles.reviewComment}>
        <Skeleton width={'55%'} height={15} radius={4} />
        <Skeleton height={120} radius={4} style={{ marginTop: 16 } as ViewStyle} />
      </View>

      <Skeleton height={52} radius={4} style={styles.reviewSubmit as ViewStyle} />
    </View>
  );
}

/**
 * PaymentWebViewScreen loading state: mirrors a checkout/payment form instead
 * of a bare centered spinner — a merchant/total summary card, two labelled
 * input-field placeholders, and a full-width pay-button pill.
 */
export function PaymentSkeleton() {
  const { colors } = useTheme();
  return (
    <View style={styles.payment}>
      <View style={[styles.paymentSummary, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.paymentRow}>
          <Skeleton width={'46%'} height={14} radius={4} />
          <Skeleton width={72} height={22} radius={4} />
        </View>
        <View style={[styles.paymentDivider, { backgroundColor: colors.border }]} />
        <View style={styles.paymentRow}>
          <Skeleton width={'34%'} height={12} radius={4} />
          <Skeleton width={90} height={12} radius={4} />
        </View>
      </View>

      {Array.from({ length: 2 }).map((_, i) => (
        <View key={i} style={styles.paymentField}>
          <Skeleton width={i === 0 ? '40%' : '52%'} height={12} radius={4} />
          <Skeleton height={52} radius={4} style={{ marginTop: 10 } as ViewStyle} />
        </View>
      ))}

      <Skeleton height={54} radius={4} style={{ marginTop: 28 } as ViewStyle} />
    </View>
  );
}

const styles = StyleSheet.create({
  // PosterEventCard content block (paddingTop 8, title then meta row).
  posterMeta: {
    paddingTop: 8,
  },

  // PaymentWebViewScreen checkout-form skeleton.
  payment: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  paymentSummary: {
    borderRadius: 4,
    borderWidth: 1,
    padding: 18,
  },
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  paymentDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 16,
  },
  paymentField: {
    marginTop: 22,
  },
  posterMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 7,
  },
  // EventRail: paddingHorizontal 16, gap = CARD_SPACING 16.
  rail: {
    flexDirection: 'row',
    gap: 16,
    paddingHorizontal: 16,
  },
  // SectionHeader: row with right-aligned link, marginBottom 14, page gutter.
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    paddingHorizontal: 16,
  },
  // Home feed spacing: firstSection marginTop 16, section marginBottom 24.
  homeFeed: {
    paddingTop: 16,
  },
  homeSection: {
    marginBottom: 24,
  },
  // DiscoverEventCard: wrap marginBottom 28, body row marginTop 12 gap 12.
  discoverCard: {
    marginBottom: 28,
  },
  discoverBody: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 12,
    gap: 12,
  },
  discoverBodyText: {
    flex: 1,
    gap: 8,
  },
  discoverActions: {
    flexDirection: 'row',
    gap: 14,
    paddingTop: 4,
  },
  // Discover feed content padding.
  discoverFeed: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  // EventListCard: row, paddingVertical 10, gap 12, center-aligned.
  listCard: {
    flexDirection: 'row',
    paddingVertical: 10,
    gap: 12,
    alignItems: 'center',
  },
  listBody: {
    flex: 1,
    gap: 8,
  },
  // CategoryEventsScreen list content padding.
  list: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  // FavoritesScreen grid: wrap, gap 12, page gutter, paddingTop 16.
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
  },

  // StatTriplet: three centered columns spread across the row.
  statTriplet: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statCol: {
    flex: 1,
    alignItems: 'center',
  },

  // EventDetailScreen: hero (height 600, centered poster), content pad 18.
  eventHero: {
    height: 600,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventContent: {
    paddingHorizontal: 18,
    paddingTop: 12,
  },
  eventFacts: {
    marginTop: 22,
    gap: 22,
  },
  eventFactRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  eventFactText: {
    flex: 1,
    gap: 8,
  },
  eventSection: {
    marginTop: 24,
  },
  eventFloatingCta: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 28,
  },

  // TicketDetailScreen: content padding 20.
  ticketDetail: {
    flex: 1,
    padding: 20,
  },
  ticketInfoCards: {
    marginTop: 28,
    gap: 16,
  },
  ticketInfoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 4,
    borderWidth: 1,
    gap: 12,
  },
  ticketInfoText: {
    flex: 1,
    gap: 8,
  },

  // EventTicketsScreen: pass card pager.
  ticketPass: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 12,
  },

  // NotificationsScreen list: gutter 16, top 16, gap 8.
  notifList: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 8,
  },
  notifCard: {
    flexDirection: 'row',
    borderRadius: 4,
    padding: 16,
    gap: 12,
  },
  notifBody: {
    flex: 1,
    gap: 6,
  },

  // ConnectionsScreen people rows.
  peopleWrap: {
    padding: 16,
  },
  peopleCard: {
    borderRadius: 4,
    paddingHorizontal: 14,
  },
  peopleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },

  // OrganizerEventEarningsScreen: content padding 16.
  earnings: {
    padding: 16,
  },
  earningsCard: {
    borderRadius: 4,
    padding: 20,
    borderWidth: 1,
  },

  // OrganizerProfileScreen: hero (content-driven height, top-anchored identity
  // block — paddingTop is applied inline from the safe-area inset) + content.
  profileHero: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  profileIdentityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  profileContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },

  // ReviewScreen: header, event card, rating/recommend blocks, comment, submit.
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  reviewCard: {
    margin: 16,
    padding: 16,
    borderRadius: 4,
    borderWidth: 1,
  },
  reviewRatingBlock: {
    marginHorizontal: 16,
    marginTop: 8,
    padding: 20,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
  },
  reviewStarsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  reviewRecommendRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 16,
  },
  reviewComment: {
    marginHorizontal: 16,
    marginTop: 16,
  },
  reviewSubmit: {
    marginHorizontal: 16,
    marginTop: 24,
  },
});
