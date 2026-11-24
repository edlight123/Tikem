import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View, ViewStyle, DimensionValue, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useTheme } from '../contexts/ThemeContext';
import { useReducedMotion } from '../lib/a11y';

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
  const reduced = useReducedMotion();

  useEffect(() => {
    // Reduce Motion: a still placeholder at mid-tone, no pulsing.
    if (reduced) {
      shimmer.setValue(0.5);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 850, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 850, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer, reduced]);

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
 * An expo-image that fills its (sized, overflow-hidden) parent and shimmers
 * until it paints, instead of showing a flat grey or teal box. Tracked per
 * URI, so a recycled row shimmers again for its new image. Event posters with
 * fit logic use PosterImage, which carries the same shimmer.
 */
export function ShimmerImage({
  uri,
  recyclingKey,
  transition = 200,
}: {
  uri: string;
  recyclingKey?: string;
  transition?: number;
}) {
  const [paintedUri, setPaintedUri] = useState<string | null>(null);
  return (
    <>
      {paintedUri !== uri && <Skeleton radius={0} style={StyleSheet.absoluteFill as ViewStyle} />}
      <Image
        accessible={false}
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={transition}
        recyclingKey={recyclingKey}
        onLoad={() => setPaintedUri(uri)}
        onError={() => setPaintedUri(uri)}
      />
    </>
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
          {/* One serif title line (28/30), organizer, meta — the card's rhythm. */}
          <Skeleton width={'70%'} height={26} radius={4} style={{ marginTop: 2 } as ViewStyle} />
          <Skeleton width={'38%'} height={13} radius={4} style={{ marginTop: 2 } as ViewStyle} />
          <Skeleton width={'76%'} height={12} radius={4} />
        </View>
        <View style={styles.discoverActions}>
          <Skeleton width={20} height={20} radius={4} />
          <Skeleton width={20} height={20} radius={4} />
        </View>
      </View>
      {/* Compact WhitePillCTA: 46 tall, radius.button (4). */}
      <Skeleton height={46} radius={4} style={{ width: '100%', marginTop: 16 } as ViewStyle} />
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

/**
 * A two-column grid of poster-card skeletons (Favorites, Category, Occasion).
 * `topPad` is the grid's own top padding (16); a screen that already pads the
 * top (Category's list header) passes 0 so the grid lands where the real one
 * does. `chips` adds the Category page's row of three 36pt filter chips.
 */
export function GridSkeleton({
  count = 6,
  topPad = 16,
  chips = false,
}: {
  count?: number;
  topPad?: number;
  chips?: boolean;
}) {
  return (
    <View style={[styles.grid, { paddingTop: topPad }]}>
      {chips ? (
        <View style={styles.gridChips}>
          {[92, 78, 104].map((w, i) => (
            <Skeleton key={i} width={w} height={36} radius={4} />
          ))}
        </View>
      ) : null}
      {Array.from({ length: count }).map((_, i) => (
        <PosterCardSkeleton key={i} width={FAV_COLUMN_WIDTH} />
      ))}
    </View>
  );
}

// EventDetailScreen geometry: a full-bleed 4:5 poster under the 52pt header
// bar, 28pt of backdrop bleed beneath it (POSTER_W / HEADER_BAR / HERO_BLEED).
const EVENT_HEADER_BAR = 52;
const EVENT_HERO_BLEED = 28;

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
 * EventDetailScreen initial load, in the loaded page's exact geometry: the
 * full-width 4:5 poster under the header bar, the serif title (34/38), the
 * date and place lines (15/21), the organizer line (44pt mark, name, Follow),
 * the About heading and copy, and the floating 50pt CTA over the bottom inset.
 */
export function EventDetailSkeleton() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1 }}>
      <View
        style={[
          styles.eventHero,
          { backgroundColor: colors.surfaceMuted, paddingTop: insets.top + EVENT_HEADER_BAR },
        ]}
      >
        <Skeleton radius={4} aspectRatio={4 / 5} style={{ width: SCREEN_W } as ViewStyle} />
      </View>
      <View style={styles.eventContent}>
        {/* Two 38pt title lines: most event names wrap at 34pt serif. */}
        <View style={styles.eventTitleLine}>
          <Skeleton width={'84%'} height={30} radius={4} />
        </View>
        <View style={styles.eventTitleLine}>
          <Skeleton width={'52%'} height={30} radius={4} />
        </View>
        <View style={styles.eventFacts}>
          <View style={styles.eventFactLine}>
            <Skeleton width={'62%'} height={14} radius={4} />
          </View>
          <View style={styles.eventFactLine}>
            <Skeleton width={'48%'} height={14} radius={4} />
          </View>
        </View>
        <View style={[styles.eventOrgLine, { borderTopColor: colors.border }]}>
          <Skeleton width={44} height={44} radius={4} />
          <Skeleton width={'38%'} height={15} radius={4} />
          <View style={{ flex: 1 }} />
          <Skeleton width={92} height={36} radius={4} />
        </View>
        <View style={styles.eventSection}>
          <Skeleton width={120} height={18} radius={4} />
          <Skeleton width={'100%'} height={13} radius={4} style={{ marginTop: 14 } as ViewStyle} />
          <Skeleton width={'92%'} height={13} radius={4} style={{ marginTop: 8 } as ViewStyle} />
          <Skeleton width={'70%'} height={13} radius={4} style={{ marginTop: 8 } as ViewStyle} />
        </View>
      </View>
      <View style={[styles.eventFloatingCta, { bottom: insets.bottom + 8 }]}>
        <Skeleton height={50} radius={4} />
      </View>
    </View>
  );
}

/**
 * TicketDetailScreen initial load, in the loaded page's order and sizes: the
 * header row (the screen's real back button + a two-line 28/34 serif title),
 * the status chip, the QR stub (~432 tall) with its instruction line, the
 * Transfer row, then ONE filled info surface of three rows split by hairlines
 * (it used to be three separate cards with bigger icons, so the page reflowed).
 */
export function TicketDetailSkeleton({ backButton }: { backButton?: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.ticketDetail}>
      <View style={styles.ticketHeader}>
        {backButton ?? <View style={{ width: 24, height: 24 }} />}
        <View style={styles.ticketTitle}>
          <Skeleton width={'100%'} height={26} radius={4} style={{ marginTop: 4 } as ViewStyle} />
          <Skeleton width={'62%'} height={26} radius={4} style={{ marginTop: 8 } as ViewStyle} />
        </View>
      </View>
      <Skeleton width={96} height={24} radius={4} style={{ alignSelf: 'center', marginBottom: 20 } as ViewStyle} />
      <Skeleton height={432} radius={4} style={{ width: '86%', alignSelf: 'center' } as ViewStyle} />
      <Skeleton width={'60%'} height={15} radius={4} style={{ alignSelf: 'center', marginTop: 4, marginBottom: 32 } as ViewStyle} />
      <View style={[styles.ticketTransfer, { backgroundColor: colors.surface }]}>
        <Skeleton width={40} height={40} radius={4} />
        <Skeleton width={'46%'} height={17} radius={4} />
      </View>
      <View style={[styles.ticketInfoCards, { backgroundColor: colors.surface }]}>
        {Array.from({ length: 3 }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.ticketInfoCard,
              i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
            ]}
          >
            <Skeleton width={36} height={36} radius={4} />
            <View style={styles.ticketInfoText}>
              <Skeleton width={'30%'} height={11} radius={4} />
              <Skeleton width={'62%'} height={15} radius={4} />
              <Skeleton width={'40%'} height={13} radius={4} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * EventTicketsScreen initial load, below the screen's own 44pt top bar: the
 * TicketPassCard centred in its 16pt page — status chip, the QR stub (24pt
 * padding, 27pt title, date, 200pt QR in a 16pt frame, tier/holder/ref ≈ 432),
 * then the Wallet button and the row of four square quick actions. The pass
 * names the event, so there is no title above it (the old placeholder had one).
 */
export function TicketPassSkeleton() {
  return (
    <View style={styles.ticketPass}>
      <Skeleton width={84} height={24} radius={4} style={{ alignSelf: 'center', marginBottom: 12 } as ViewStyle} />
      <Skeleton height={432} radius={4} style={{ width: '100%' } as ViewStyle} />
      <Skeleton height={50} radius={4} style={{ width: '100%', marginTop: 20 } as ViewStyle} />
      <View style={styles.ticketQuickRow}>
        {Array.from({ length: 4 }).map((_, i) => (
          <View key={i} style={styles.ticketQuick}>
            <Skeleton width={48} height={48} radius={4} />
            <Skeleton width={44} height={11} radius={4} />
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * NotificationsScreen initial load, matching the plain rows the screen now
 * draws (TestFlight 2026-11-14 retired the old 40pt-icon cards): the
 * "mark all read · clear all" bar, then rows of an unread-dot gutter, a 15pt
 * title with its time on the right, and two 18pt lines of detail.
 */
export function NotificationsSkeleton({ count = 8 }: { count?: number }) {
  return (
    <View>
      <View style={styles.notifBar}>
        <Skeleton width={132} height={13} radius={4} />
        <Skeleton width={58} height={13} radius={4} />
      </View>
      <View style={styles.notifList}>
        {Array.from({ length: count }).map((_, i) => (
          <View key={i} style={styles.notifRow}>
            <View style={{ width: 7 }} />
            <View style={styles.notifBody}>
              <View style={styles.notifHead}>
                <Skeleton width={i % 2 ? '54%' : '66%'} height={14} radius={4} />
                <Skeleton width={26} height={11} radius={4} />
              </View>
              <View style={styles.notifLine}>
                <Skeleton width={'94%'} height={12} radius={4} />
              </View>
              <View style={styles.notifLine}>
                <Skeleton width={i % 2 ? '48%' : '72%'} height={12} radius={4} />
              </View>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * People rows. `list` (Connections): plain rows on the canvas (that screen is
 * "a list, not a card"), hairlines between, a Connect button at the end.
 * `card` (Followers, Subscriptions): ONE filled card with 16pt row gutters and
 * a chevron at the end, exactly like those screens draw it. The old single
 * shape put Connections in a card and Followers' rows 2pt off with a pill.
 */
export function PeopleRowsSkeleton({ count = 7, variant = 'list' }: { count?: number; variant?: 'list' | 'card' }) {
  const { colors } = useTheme();
  const card = variant === 'card';
  return (
    <View style={styles.peopleWrap}>
      <View style={card ? [styles.peopleCard, { backgroundColor: colors.surface }] : undefined}>
        {Array.from({ length: count }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.peopleRow,
              card && { paddingHorizontal: 16 },
              i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
            ]}
          >
            <Skeleton width={44} height={44} radius={22} />
            <View style={{ flex: 1 }}>
              <Skeleton width={i % 2 ? '42%' : '55%'} height={14} radius={4} />
            </View>
            {card ? <Skeleton width={10} height={16} radius={4} /> : <Skeleton width={84} height={32} radius={4} />}
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
      <View style={[styles.earningsCard, { backgroundColor: colors.surface }]}>
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

// OrganizerProfileScreen org hero: plain banner 128 (+ inset), a 64pt logo
// riding half over it, counts beside the logo.
const ORG_BANNER_H = 128;
const ORG_LOGO = 64;

/**
 * OrganizerProfileScreen initial load. `org` (the default: every organizer
 * link) mirrors the org page — banner, the logo overlapping it with the two
 * counts beside it, the 28/34 serif name, the meta line, two lines of about,
 * then "upcoming" and a two-column poster grid. `person` (links that pass
 * view: 'person') mirrors the compact person header. The old placeholder only
 * had the person layout, so every organizer page jumped when it loaded.
 */
export function OrganizerProfileSkeleton({ variant = 'org' }: { variant?: 'org' | 'person' }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  if (variant === 'org') {
    return (
      <View style={{ flex: 1 }}>
        <View style={{ height: insets.top + ORG_BANNER_H, backgroundColor: colors.surfaceRaised }} />
        <View style={styles.orgHead}>
          <View style={styles.orgLogoRow}>
            {/* The logo tile keeps the page-colour ring the real one has. */}
            <View style={[styles.orgLogoRing, { backgroundColor: colors.background }]}>
              <Skeleton width={ORG_LOGO - 6} height={ORG_LOGO - 6} radius={4} />
            </View>
            <View style={styles.orgStats}>
              {Array.from({ length: 2 }).map((_, i) => (
                <View key={i} style={{ gap: 5 }}>
                  <Skeleton width={28} height={14} radius={4} />
                  <Skeleton width={56} height={11} radius={4} />
                </View>
              ))}
            </View>
          </View>
          <View style={styles.orgNameLine}>
            <Skeleton width={'62%'} height={26} radius={4} />
          </View>
          <Skeleton width={'42%'} height={12} radius={4} style={{ marginTop: 2 } as ViewStyle} />
          <Skeleton width={'94%'} height={13} radius={4} style={{ marginTop: 15 } as ViewStyle} />
          <Skeleton width={'70%'} height={13} radius={4} style={{ marginTop: 9 } as ViewStyle} />
        </View>
        <View style={styles.orgContent}>
          <View style={{ marginHorizontal: -16 }}>
            <SectionHeaderSkeleton />
          </View>
          <View style={styles.orgGrid}>
            {Array.from({ length: 4 }).map((_, i) => (
              <PosterCardSkeleton key={i} width={FAV_COLUMN_WIDTH} />
            ))}
          </View>
        </View>
      </View>
    );
  }
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

      <View style={[styles.reviewCard, { backgroundColor: colors.surface }]}>
        <Skeleton width={'80%'} height={18} radius={4} />
        <Skeleton width={'45%'} height={13} radius={4} style={{ marginTop: 8 } as ViewStyle} />
      </View>

      {Array.from({ length: 2 }).map((_, i) => (
        <View key={i} style={[styles.reviewRatingBlock, { backgroundColor: colors.surface }]}>
          <Skeleton width={'60%'} height={15} radius={4} />
          <View style={styles.reviewStarsRow}>
            {Array.from({ length: 5 }).map((__, s) => (
              <Skeleton key={s} width={36} height={36} radius={4} />
            ))}
          </View>
          <Skeleton width={80} height={12} radius={4} style={{ marginTop: 8 } as ViewStyle} />
        </View>
      ))}

      <View style={[styles.reviewRatingBlock, { backgroundColor: colors.surface }]}>
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
      <View style={[styles.paymentSummary, { backgroundColor: colors.surface }]}>
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
  // DiscoverEventCard: wrap marginBottom 32, body row marginTop 12 gap 12.
  discoverCard: {
    marginBottom: 32,
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
    gap: 16,
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
  // FavoritesScreen / CategoryEventsScreen grid: wrap, 12pt column gap, 24pt
  // row gap, page gutter, paddingTop 16.
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 12,
    rowGap: 24,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  // CategoryEventsScreen filterRow: 8 gap, marginBottom 16 (the grid's row
  // gap supplies 24, so this takes the difference back).
  gridChips: {
    width: '100%',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16 - 24,
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

  // EventDetailScreen: full-bleed hero (paddingTop applied inline from the
  // inset + header bar), content gutter 18 / top 9.
  eventHero: {
    paddingBottom: EVENT_HERO_BLEED,
    alignItems: 'center',
  },
  eventContent: {
    paddingHorizontal: 18,
    paddingTop: 9,
  },
  eventTitleLine: {
    height: 38,
    justifyContent: 'center',
  },
  // factList: marginTop 12 / bottom 4; each line 21pt tall.
  eventFacts: {
    marginTop: 12,
    marginBottom: 4,
  },
  eventFactLine: {
    height: 21,
    justifyContent: 'center',
  },
  // orgBlock: hairline divider above, paddingTop 16 / bottom 18, 12pt gaps.
  eventOrgLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
    paddingTop: 16,
    paddingBottom: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  eventSection: {
    marginTop: 12,
  },
  eventFloatingCta: {
    position: 'absolute',
    left: 20,
    right: 20,
  },

  // TicketDetailScreen: content padding 20; header row then centred blocks.
  ticketDetail: {
    flex: 1,
    padding: 20,
  },
  ticketHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 16,
  },
  ticketTitle: {
    flex: 1,
    height: 68,
  },
  ticketTransfer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 4,
    marginBottom: 32,
  },
  // infoCards: one filled surface, 16 gutter, rows of 16pt vertical padding.
  ticketInfoCards: {
    borderRadius: 4,
    paddingHorizontal: 16,
  },
  ticketInfoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    gap: 12,
  },
  ticketInfoText: {
    flex: 1,
    gap: 4,
  },

  // EventTicketsScreen: pass card page (pageScroll: 16 gutter, centred).
  ticketPass: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 16,
    justifyContent: 'center',
  },
  // TicketPassCard quickRow: marginTop 12 (gap) + 8, spread around.
  ticketQuickRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 20,
  },
  ticketQuick: {
    alignItems: 'center',
    gap: 6,
    minWidth: 64,
  },

  // NotificationsScreen: header bar (12 gutter + 12/6 button padding), list
  // paddingTop 4, rows 14/16 padding with a 10pt gap after the dot gutter.
  notifBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 4,
    height: 38,
  },
  notifList: {
    paddingTop: 4,
  },
  notifRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 10,
  },
  notifBody: {
    flex: 1,
    gap: 3,
  },
  notifHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    height: 18,
  },
  notifLine: {
    height: 18,
    justifyContent: 'center',
  },

  // ConnectionsScreen people rows.
  peopleWrap: {
    padding: 16,
  },
  peopleCard: {
    borderRadius: 4,
    overflow: 'hidden',
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
  // Org page: orgHead (20 gutter, pulled up half the logo), content 16.
  orgHead: {
    paddingHorizontal: 20,
    marginTop: -ORG_LOGO / 2,
    paddingBottom: 4,
  },
  orgLogoRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 18,
  },
  orgLogoRing: {
    width: ORG_LOGO,
    height: ORG_LOGO,
    borderRadius: 4,
    padding: 3,
  },
  orgStats: {
    flexDirection: 'row',
    gap: 18,
    paddingBottom: 2,
  },
  orgNameLine: {
    marginTop: 12,
    height: 34,
    justifyContent: 'center',
  },
  orgContent: {
    padding: 16,
  },
  orgGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
  },
  reviewRatingBlock: {
    marginHorizontal: 16,
    marginTop: 8,
    padding: 20,
    borderRadius: 4,
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
