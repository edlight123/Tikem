import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
    TouchableOpacity,
  Image,
  Dimensions,
  RefreshControl,
  Linking,
    ImageBackground,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  Calendar,
    Star,
  MapPin,
  Globe,
  MessageCircle,
  ChevronDown,
  ExternalLink,
  MoreHorizontal,
} from 'lucide-react-native';
import { doc, getDoc, collection, query, where, getDocs, addDoc, deleteDoc, Timestamp } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { useTheme } from '../contexts/ThemeContext';
import { radius } from '../theme/tokens';
import ConnectButton from '../components/ConnectButton';
import PosterEventCard from '../components/PosterEventCard';
import VerifiedBadge from '../components/VerifiedBadge';
import EmptyState from '../components/EmptyState';
import { OrganizerProfileSkeleton } from '../components/Skeleton';
import { fetchConnections } from '../lib/api/social';
import { goBackOrHome } from '../lib/goBackOrHome';
import { type FriendshipState } from '../types/social';
import ReportContentModal from '../components/ReportContentModal';
import { useAppAlert } from '../components/AppAlert';
import { useBlockedOrganizers } from '../lib/blockedOrganizers';
import { AFTER_ALERT_MS, promptBlockToggle } from '../lib/moderationActions';

const { width } = Dimensions.get('window');
// Hero geometry. Build 13 gave the hero a fixed 232pt floor and bottom-aligned
// the identity block inside it, which made the block's Y a function of
// (floor − its own height): every optional part it lost (contact chip, meta
// line) pushed the avatar *further down* into dead cover art — up to ~70pt of
// gap under the controls for an organizer with no public socials. The block is
// now anchored to the TOP of the hero, directly under the absolutely-positioned
// back chevron / Follow pill, and the hero's height is whatever its content
// needs. These three numbers are the only thing standing between the safe-area
// top and the avatar:
const HERO_CONTROL_TOP = 8;   // controls sit at insets.top + this
const HERO_CONTROL_SIZE = 40; // …and are this tall (both chevron and pill)
const HERO_IDENTITY_GAP = 10; // clearance under both controls
// Distance from the safe-area top to the first pixel of the identity block.
const HERO_IDENTITY_OFFSET = HERO_CONTROL_TOP + HERO_CONTROL_SIZE + HERO_IDENTITY_GAP;
// Two-column flyer grid inside the 16px-padded content area.
const PROFILE_COLUMN_WIDTH = (width - 32 - 12) / 2;
// Past events are shown inline (three rows of the two-up grid) with a quiet
// "Show all" beneath, so a decade-old organizer can't produce endless scroll.
const PAST_EVENTS_PREVIEW = 6;
// Dictionary key for that affordance — see the guarded fallback below.
const PAST_SHOW_ALL_KEY = 'organizerProfile.pastShowAll';

/** Milliseconds for a Date that may be missing/invalid, so sorts never NaN. */
const timeOf = (d: Date | null | undefined) => {
  const ms = d instanceof Date ? d.getTime() : NaN;
  return Number.isFinite(ms) ? ms : 0;
};

interface SocialLink {
  type: 'website' | 'instagram' | 'facebook' | 'tiktok' | 'whatsapp' | 'email';
  url: string;
  icon: any;
  color: string;
}

export default function OrganizerProfileScreen({ route, navigation }: any) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const insets = useSafeAreaInsets();
  const { organizerId } = route.params;
  const { user } = useAuth();
  const { t } = useI18n();
  const scrollViewRef = React.useRef<ScrollView>(null);
  
  const [organizer, setOrganizer] = useState<any>(null);
  const [upcomingEvents, setUpcomingEvents] = useState<any[]>([]);
  const [pastEvents, setPastEvents] = useState<any[]>([]);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followDocId, setFollowDocId] = useState<string | null>(null);
  const [showAllPastEvents, setShowAllPastEvents] = useState(false);
  const [stats, setStats] = useState({
    followerCount: 0,
    totalEvents: 0,
    totalTicketsSold: 0,
    rating: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [friendship, setFriendship] = useState<FriendshipState>('none');
  const [friendshipLoaded, setFriendshipLoaded] = useState(false);
  const showAlert = useAppAlert();
  const [showReport, setShowReport] = useState(false);
  const isBlocked = useBlockedOrganizers().has(organizerId);

  // Resolve the viewer's friendship with this profile (drives connect button + privacy gating)
  useEffect(() => {
    let active = true;
    (async () => {
      if (!user) {
        if (active) { setFriendship('none'); setFriendshipLoaded(true); }
        return;
      }
      if (user.uid === organizerId) {
        if (active) { setFriendship('self'); setFriendshipLoaded(true); }
        return;
      }
      try {
        const { friends, incoming, outgoing } = await fetchConnections();
        if (!active) return;
        if (friends.some((f) => f.uid === organizerId)) setFriendship('friends');
        else if (outgoing.some((f) => f.uid === organizerId)) setFriendship('request_sent');
        else if (incoming.some((f) => f.uid === organizerId)) setFriendship('request_received');
        else setFriendship('none');
      } catch {
        if (active) setFriendship('none');
      } finally {
        if (active) setFriendshipLoaded(true);
      }
    })();
    return () => { active = false; };
  }, [user, organizerId]);

  useEffect(() => {
    fetchOrganizerProfile();
    checkFollowStatus();
  }, [organizerId]);

  // Refetch on screen focus to ensure fresh data
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      fetchOrganizerProfile();
      checkFollowStatus();
    });
    return unsubscribe;
  }, [navigation, organizerId]);

  const fetchOrganizerProfile = async () => {
    try {
      // H4: cross-user read of the organizer's SAFE public projection (name,
      // photo, is_verified, bio, organization_name/logo) instead of users/{uid}.
      // If the projection isn't backfilled yet, fall back to a name/avatar
      // placeholder so the screen still renders (events below still load).
      const organizerDoc = await getDoc(doc(db, 'public_profiles', organizerId));
      const organizerData = organizerDoc.exists()
        ? { id: organizerDoc.id, ...organizerDoc.data() }
        : { id: organizerId };
      setOrganizer(organizerData);

      // Fetch events
      const eventsQuery = query(
        collection(db, 'events'),
        where('organizer_id', '==', organizerId),
        where('is_published', '==', true)
      );
      const eventsSnapshot = await getDocs(eventsQuery);
      
      const now = new Date();
      const upcoming: any[] = [];
      const past: any[] = [];
      let totalSold = 0;

      eventsSnapshot.docs.forEach(doc => {
        const data = doc.data();
        const eventData = {
          id: doc.id,
          ...data,
          start_datetime: data.start_datetime?.toDate ? data.start_datetime.toDate() : new Date(data.start_datetime),
          end_datetime: data.end_datetime?.toDate ? data.end_datetime.toDate() : (data.end_datetime ? new Date(data.end_datetime) : null),
        };

        totalSold += data.tickets_sold || 0;

        // An event is over once it *ends*; multi-day events stay "upcoming"
        // while they are running. `end_datetime` is optional on event docs, so
        // a single-session event falls back to its start. (`event_date` is a
        // ticket-doc field in this codebase, never an event-doc one.)
        const cutoff = eventData.end_datetime || eventData.start_datetime;
        if (cutoff && cutoff >= now) {
          upcoming.push(eventData);
        } else {
          past.push(eventData);
        }
      });

      // Upcoming: soonest first. Past: most recent first, on the same cutoff
      // field the split used, so the ordering matches the filter.
      upcoming.sort((a, b) => timeOf(a.start_datetime) - timeOf(b.start_datetime));
      past.sort(
        (a, b) =>
          timeOf(b.end_datetime || b.start_datetime) - timeOf(a.end_datetime || a.start_datetime)
      );

      setUpcomingEvents(upcoming);
      setPastEvents(past);

      // Fetch follower count
      const followersQuery = query(
        collection(db, 'organizer_follows'),
        where('organizer_id', '==', organizerId)
      );
      const followersSnapshot = await getDocs(followersQuery);

      setStats({
        followerCount: followersSnapshot.size,
        totalEvents: eventsSnapshot.size,
        totalTicketsSold: totalSold,
        rating: (organizerData as any).rating || 0,
      });

    } catch (error) {
      console.error('Error fetching organizer profile:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const checkFollowStatus = async () => {
    if (!user) return;
    
    try {
      const followQuery = query(
        collection(db, 'organizer_follows'),
        where('organizer_id', '==', organizerId),
        where('follower_id', '==', user.uid)
      );
      const snapshot = await getDocs(followQuery);
      
      if (!snapshot.empty) {
        setIsFollowing(true);
        setFollowDocId(snapshot.docs[0].id);
      }
    } catch (error) {
      console.error('Error checking follow status:', error);
    }
  };

  const handleFollow = async () => {
    if (!user) {
      navigation.navigate('Auth');
      return;
    }
    // Blocking dropped the follow server-side; re-following is refused.
    if (isBlocked && !isFollowing) return;

    try {
      if (isFollowing && followDocId) {
        await deleteDoc(doc(db, 'organizer_follows', followDocId));
        setIsFollowing(false);
        setFollowDocId(null);
        setStats(prev => ({ ...prev, followerCount: prev.followerCount - 1 }));
      } else {
        const docRef = await addDoc(collection(db, 'organizer_follows'), {
          organizer_id: organizerId,
          follower_id: user.uid,
          created_at: Timestamp.now(),
        });
        setIsFollowing(true);
        setFollowDocId(docRef.id);
        setStats(prev => ({ ...prev, followerCount: prev.followerCount + 1 }));
      }
    } catch (error) {
      console.error('Error toggling follow:', error);
    }
  };

  // "…" menu: report or block this organizer (App Store 1.2).
  const handleMore = () => {
    if (!user) {
      showAlert(t('auth.loginRequiredTitle'), t('moderation.signInToReport'));
      return;
    }
    const name = organizer?.organization_name || organizer?.full_name || '';
    showAlert(t('moderation.moreTitle'), undefined, [
      {
        text: t('moderation.reportOrganizer'),
        onPress: () => setTimeout(() => setShowReport(true), AFTER_ALERT_MS),
      },
      {
        text: isBlocked ? t('moderation.unblock') : t('moderation.block'),
        style: 'destructive',
        onPress: () =>
          setTimeout(
            () =>
              promptBlockToggle({
                showAlert,
                t,
                organizerId,
                organizerName: name,
                currentlyBlocked: isBlocked,
                onChanged: (nowBlocked) => {
                  if (nowBlocked && isFollowing) {
                    setIsFollowing(false);
                    setFollowDocId(null);
                    setStats((prev) => ({ ...prev, followerCount: Math.max(0, prev.followerCount - 1) }));
                  }
                },
              }),
            AFTER_ALERT_MS
          ),
      },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  const openLink = async (raw: string) => {
    // Organizer-supplied (website is free text). Only open web links: a bare
    // domain gets https://, anything with another scheme (javascript:, file:,
    // a custom deep-link scheme) is refused, same rule as EventDetailScreen.
    const trimmed = (raw || '').trim();
    const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
    const url = hasScheme ? trimmed : `https://${trimmed}`;
    if (!/^https?:\/\/[^\s/]+\.[^\s/]+/i.test(url)) {
      console.warn('Blocked non-http(s) organizer link');
      return;
    }
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      }
    } catch (error) {
      console.error('Error opening link:', error);
    }
  };

  const getSocialLinks = (): SocialLink[] => {
    const links: SocialLink[] = [];
    
    if (organizer?.website) {
      links.push({
        type: 'website',
        url: organizer.website,
        icon: Globe,
        color: '#6B7280',
      });
    }
    
    if (organizer?.instagram) {
      links.push({
        type: 'instagram',
        url: `https://instagram.com/${organizer.instagram.replace('@', '')}`,
        icon: ExternalLink,
        color: '#E4405F',
      });
    }
    
    if (organizer?.facebook) {
      links.push({
        type: 'facebook',
        url: `https://facebook.com/${organizer.facebook}`,
        icon: ExternalLink,
        color: '#1877F2',
      });
    }
    
    if (organizer?.tiktok) {
      links.push({
        type: 'tiktok',
        url: `https://tiktok.com/@${organizer.tiktok.replace('@', '')}`,
        icon: ExternalLink,
        color: '#000000',
      });
    }

    // H4: whatsapp/email are contact PII and are NOT part of the public
    // projection, so they are intentionally no longer surfaced here.

    return links;
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchOrganizerProfile();
    checkFollowStatus();
  };

  const scrollToBottom = () => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  };

  const renderEventCard = (event: any) => (
    <PosterEventCard
      key={event.id}
      event={event}
      width={PROFILE_COLUMN_WIDTH}
      onPress={() => navigation.navigate('EventDetail', { eventId: event.id })}
    />
  );

  // Past events use the very same card (same poster, same caption, same tap
  // target → EventDetail); only its opacity is dropped so the row reads as
  // archive rather than inventory. No "PAST" pill — the house style dims, it
  // doesn't badge.
  const renderPastEventCard = (event: any) => (
    <View key={event.id} style={styles.pastCard}>
      {renderEventCard(event)}
    </View>
  );

  const getSubtitle = () => {
    const parts = [];
    if (organizer.categories && organizer.categories.length > 0) {
      parts.push(organizer.categories[0]);
    }
    if (organizer.city) {
      parts.push(organizer.city);
    }
    return parts.join(' · ');
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <OrganizerProfileSkeleton />
      </SafeAreaView>
    );
  }

  if (!organizer) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.errorText}>{t('organizerProfile.notFound')}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => {
              setLoading(true);
              fetchOrganizerProfile();
            }}
          >
            <Text style={styles.retryButtonText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const socialLinks = getSocialLinks();
  // "Hosting since" — account age. The projection stores created_at (snake);
  // accept the legacy camelCase too. Value may be an ISO string or a Firestore
  // Timestamp-like { seconds }.
  const createdAtRaw = organizer.created_at ?? organizer.createdAt;
  const hostingSince = createdAtRaw
    ? new Date(createdAtRaw.seconds ? createdAtRaw.seconds * 1000 : createdAtRaw).getFullYear()
    : null;
  const subtitle = getSubtitle();

  // Connect (friend-request) action still sits inline next to the stats.
  // H4: the former "personal bio + social handles" card was gated by the
  // owner's privacy settings and read the personal `social_links` object —
  // neither is part of the public projection, so that card has been removed
  // (email/whatsapp/personal socials can't be exposed publicly).
  const isSelf = !!user && user.uid === organizerId;
  const showConnect = friendshipLoaded && !isSelf && friendship !== 'self';

  // The same three figures the old StatTriplet showed, rendered as one line.
  // Nothing is dropped — only the typographic weight is.
  // Past events: newest first, capped at PAST_EVENTS_PREVIEW until the viewer
  // asks for the rest. `t()` echoes a missing key back, so the "Show all"
  // affordance falls back to English until the dictionaries carry it.
  const visiblePastEvents = showAllPastEvents
    ? pastEvents
    : pastEvents.slice(0, PAST_EVENTS_PREVIEW);
  const showAllPastLabel =
    t(PAST_SHOW_ALL_KEY) === PAST_SHOW_ALL_KEY ? 'Show all' : t(PAST_SHOW_ALL_KEY);

  const statItems = [
    { label: t('organizerProfile.stats.events'), value: String(stats.totalEvents || 0) },
    { label: t('organizerProfile.stats.followers'), value: String(stats.followerCount || 0) },
    { label: t('organizerProfile.stats.sold'), value: (stats.totalTicketsSold || 0).toLocaleString() },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Premium Hero Section with ImageBackground */}
        <ImageBackground
          source={organizer.coverImageUrl ? { uri: organizer.coverImageUrl } : undefined}
          style={styles.hero}
          resizeMode="cover"
        >
          {/* Dark scrim overlay for readability */}
          <View style={styles.heroScrim} />

          {/* Back Button — a clean chevron-back, consistent with the
              organizer-surface headers (top-left, never over the avatar). */}
          <TouchableOpacity
            style={[styles.backButton, { top: insets.top + HERO_CONTROL_TOP }]}
            onPress={() => goBackOrHome(navigation)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
          >
            <Ionicons name="chevron-back" size={26} color={colors.white} />
          </TouchableOpacity>

          {/* "…" — report / block. Top right, the Follow button sits beside it.
              Not on your own profile. */}
          {!isSelf && (
            <TouchableOpacity
              style={[styles.moreButton, { top: insets.top + HERO_CONTROL_TOP }]}
              onPress={handleMore}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel={t('moderation.moreTitle')}
            >
              <MoreHorizontal size={20} color={colors.white} />
            </TouchableOpacity>
          )}

          {/* Small Follow Button - Top Right. Hidden while blocked: the block
              removed the follow and re-following is refused. */}
          {!isSelf && !isBlocked && (
            <TouchableOpacity
              style={[
                styles.followButtonSmall,
                { top: insets.top + HERO_CONTROL_TOP },
                isFollowing && styles.followingButtonSmall,
              ]}
              onPress={handleFollow}
            >
              <Text style={[styles.followButtonSmallText, isFollowing && styles.followingButtonSmallText]}>
                {isFollowing ? t('organizerProfile.following') : t('organizerProfile.follow')}
              </Text>
            </TouchableOpacity>
          )}

          {/* Hero Content — TOP-anchored (build 13 shipped it bottom-aligned
              inside a 232pt floor, which left dead cover art above it). It is a
              SINGLE identity row: the avatar sits beside the name instead of
              stacked above it, and verified + category · city share one meta
              line beneath the name. paddingTop clears the back chevron and the
              Follow pill by HERO_IDENTITY_GAP at every safe-area inset. */}
          <View style={[styles.heroContent, { paddingTop: insets.top + HERO_IDENTITY_OFFSET }]}>
            <View style={styles.identityRow}>
              {/* Avatar — 70 → 52; inline, so it costs no row of its own. */}
              <View style={styles.avatar}>
                {(organizer.organization_logo || organizer.avatarUrl || organizer.photo_url) ? (
                  <Image
                    source={{ uri: organizer.organization_logo || organizer.avatarUrl || organizer.photo_url }}
                    style={styles.avatarImage}
                  />
                ) : (
                  <Text style={styles.avatarText}>
                    {((organizer.organization_name || organizer.full_name)?.[0] || '?').toUpperCase()}
                  </Text>
                )}
              </View>

              <View style={styles.identityText}>
                {/* Organization brand overrides the personal name here and
                    everywhere the organizer is shown. */}
                <Text style={styles.organizerName} numberOfLines={1}>
                  {organizer.organization_name || organizer.full_name}
                </Text>

                {/* Verified mark + category · city on one line. VerifiedBadge is
                    a bare teal glyph + label — never a filled pill. */}
                {(organizer.is_verified || !!subtitle) && (
                  <View style={styles.metaRow}>
                    {organizer.is_verified && <VerifiedBadge size="small" showLabel />}
                    {organizer.is_verified && !!subtitle && (
                      <Text style={styles.metaDot}>·</Text>
                    )}
                    {!!subtitle && (
                      <Text style={styles.subtitle} numberOfLines={1}>
                        {subtitle}
                      </Text>
                    )}
                  </View>
                )}
              </View>
            </View>

            {/* Contact — scrolls to the socials at the bottom. Was a full-width
                button; now a compact self-start chip so it doesn't eat a row.
                H4: gated only on public brand socials now (no email/whatsapp/phone). */}
            {socialLinks.length > 0 && (
              <TouchableOpacity
                style={styles.contactButtonHero}
                onPress={scrollToBottom}
              >
                <MessageCircle size={14} color={colors.white} />
                <Text style={styles.contactButtonHeroText}>{t('organizerProfile.contactSocial')}</Text>
              </TouchableOpacity>
            )}
          </View>
        </ImageBackground>

        <View style={styles.content}>

          {/* Stats — one quiet tabular-numeral line rather than a full-width row of three
              27px numerals. All three figures are kept, just at reading size:
              "4 EVENTS · 4 FOLLOWERS · 0 SOLD". */}
          <View style={styles.statLine}>
            {statItems.map((item, i) => (
              <React.Fragment key={item.label}>
                {i > 0 && <Text style={styles.statSep}>·</Text>}
                <Text style={styles.statValue}>{item.value}</Text>
                <Text style={styles.statLabel}>{item.label}</Text>
              </React.Fragment>
            ))}
          </View>

          {/* Connect action — a quiet secondary pill inline under the stats,
              not a prominent full-width card. */}
          {showConnect ? (
            <View style={styles.connectRow}>
              <ConnectButton
                targetUserId={organizerId}
                initialState={friendship}
                size="sm"
                variant="secondary"
                onChange={setFriendship}
                onRequireAuth={() => navigation.navigate('Auth')}
              />
            </View>
          ) : null}

          {/* Upcoming Events */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('organizerProfile.upcomingTitle')}</Text>
            <Text style={styles.sectionSubtitle}>
              {upcomingEvents.length}{' '}
              {t(
                upcomingEvents.length === 1
                  ? 'organizerProfile.upcomingCountSingular'
                  : 'organizerProfile.upcomingCountPlural'
              )}
            </Text>

            {upcomingEvents.length > 0 ? (
              <View style={styles.eventsGrid}>
                {upcomingEvents.map((event) => renderEventCard(event))}
              </View>
            ) : (
              <EmptyState
                icon={Calendar}
                title={t('organizerProfile.noUpcomingTitle')}
                subtitle={
                  isFollowing
                    ? t('organizerProfile.noUpcomingBodyFollowing')
                    : t('organizerProfile.noUpcomingBodyNotFollowing')
                }
                compact
              />
            )}
          </View>

          {/* Past Events — beta feedback: these used to be hidden behind a
              collapsed accordion, so the profile read as "Upcoming only". They
              now render inline, dimmed, newest first. The whole section is
              omitted (header included) when the organizer has no history. */}
          {pastEvents.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('organizerProfile.pastTitle')}</Text>
              <Text style={styles.sectionSubtitle}>
                {pastEvents.length}{' '}
                {t(
                  pastEvents.length === 1
                    ? 'organizerProfile.pastCountSingular'
                    : 'organizerProfile.pastCountPlural'
                )}
              </Text>

              <View style={styles.eventsGrid}>
                {visiblePastEvents.map((event) => renderPastEventCard(event))}
              </View>

              {/* Quiet text affordance, not a filled pill. */}
              {pastEvents.length > visiblePastEvents.length && (
                <TouchableOpacity
                  style={styles.showAllRow}
                  onPress={() => setShowAllPastEvents(true)}
                  accessibilityRole="button"
                >
                  <Text style={styles.showAllText}>
                    {showAllPastLabel} ({pastEvents.length})
                  </Text>
                  <ChevronDown size={14} color={colors.primary} />
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* About Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('organizerProfile.aboutTitle')}</Text>
            
            {organizer.description && (
              <Text style={styles.aboutText}>{organizer.description}</Text>
            )}

            <View style={styles.aboutDetails}>
              {organizer.city && organizer.country && (
                <View style={styles.aboutRow}>
                  <MapPin size={18} color={colors.textSecondary} />
                  <Text style={styles.aboutLabel}>{t('organizerProfile.locationLabel')}</Text>
                  <Text style={styles.aboutValue}>
                    {organizer.city}, {organizer.country}
                  </Text>
                </View>
              )}

              {organizer.languages && organizer.languages.length > 0 && (
                <View style={styles.aboutRow}>
                  <Globe size={18} color={colors.textSecondary} />
                  <Text style={styles.aboutLabel}>{t('organizerProfile.languagesLabel')}</Text>
                  <Text style={styles.aboutValue}>
                    {organizer.languages.join(', ')}
                  </Text>
                </View>
              )}

              {hostingSince && (
                <View style={styles.aboutRow}>
                  <Calendar size={18} color={colors.textSecondary} />
                  <Text style={styles.aboutLabel}>{t('organizerProfile.hostingSinceLabel')}</Text>
                  <Text style={styles.aboutValue}>{hostingSince}</Text>
                </View>
              )}
            </View>
          </View>

          {/* Social & Contact Section */}
          {socialLinks.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('organizerProfile.connectTitle')}</Text>
              <View style={styles.socialLinks}>
                {socialLinks.map((link, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={[styles.socialButton, { backgroundColor: link.color + '15' }]}
                    onPress={() => openLink(link.url)}
                  >
                    <link.icon size={22} color={link.color} />
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* Reviews Placeholder */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('organizerProfile.reviewsTitle')}</Text>
            <EmptyState
              icon={Star}
              title={t('organizerProfile.reviewsComingSoon')}
              compact
            />
          </View>
        </View>
      </ScrollView>
      <ReportContentModal
        visible={showReport}
        onClose={() => setShowReport(false)}
        kind="organizer"
        targetId={organizerId}
      />
    </SafeAreaView>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    fontSize: 16,
    color: colors.textSecondary,
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: radius.sm,
  },
  retryButtonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },

  // Premium Hero Section
  // Content-driven height: no fixed floor, no bottom alignment. The identity
  // block's own paddingTop (insets.top + HERO_IDENTITY_OFFSET) is what keeps it
  // clear of the controls, so the hero is exactly as tall as it needs to be.
  hero: {
    backgroundColor: colors.surfaceRaised, // neutral fallback behind poster (not decorative teal)
  },
  heroScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  // A clean chevron-back in the top-left, on a subtle scrim disc for legibility
  // over any hero image. Content is bottom-aligned so it never sits on this.
  backButton: {
    position: 'absolute',
    top: 16,
    left: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  moreButton: {
    position: 'absolute',
    top: 24,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  followButtonSmall: {
    position: 'absolute',
    top: 24,
    // Clears the 40pt "…" button at right: 16, plus an 8pt gap.
    right: 64,
    height: 40,
    paddingHorizontal: 16,
    justifyContent: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.button,
    zIndex: 10,
  },
  followingButtonSmall: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderWidth: 1.5,
    borderColor: colors.white,
  },
  // White pill = the follow CTA (POSH §2.2): black label on white, never teal.
  followButtonSmallText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#000000',
  },
  followingButtonSmallText: {
    color: colors.white,
  },
  // paddingTop is applied inline (insets.top + HERO_IDENTITY_OFFSET) — it is
  // what holds the block clear of the controls at any safe-area inset.
  heroContent: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  // Avatar beside the name, not above it.
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  identityText: {
    flex: 1,
    gap: 4,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 24,
  },
  avatarText: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.primary,
  },
  organizerName: {
    fontFamily: 'InstrumentSerif_400Regular',
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: -0.5,
    color: colors.white,
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  // Verified mark + category · city on one line under the name.
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaDot: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  subtitle: {
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 16,
    color: 'rgba(255, 255, 255, 0.95)',
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  // Compact self-start chip, not a full-width button.
  contactButtonHero: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.28)',
    marginTop: 10,
  },
  contactButtonHeroText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '600',
  },

  // Content
  content: {
    padding: 16,
    paddingTop: 16,
  },
  // One quiet line of figures instead of a full-width triplet of big numerals.
  statLine: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 5,
    marginBottom: 20,
  },
  statValue: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    fontSize: 11,
    lineHeight: 18,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textSecondary,
  },
  statSep: {
    fontSize: 11,
    lineHeight: 18,
    color: colors.textTertiary,
    marginHorizontal: 3,
  },

  connectRow: {
    alignItems: 'flex-start',
    marginBottom: 24,
  },


  // Sections
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    fontFamily: 'InstrumentSerif_400Regular',
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: colors.text,
    marginBottom: 6,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 16,
  },

  // Events
  eventsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  // "It's over" without a badge: the identical card, held back. Poster and
  // caption dim together so the row reads as archive at a glance (POSH: no
  // filled PAST pill, no tinted card).
  pastCard: {
    width: PROFILE_COLUMN_WIDTH,
    opacity: 0.55,
  },
  // Quiet inline "Show all (N)" — a text link, never a filled pill. Teal is
  // used here in its reserved role: a link.
  showAllRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingVertical: 12,
    marginTop: 4,
  },
  showAllText: {
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.primary,
  },
  // About Section
  aboutText: {
    fontSize: 15,
    lineHeight: 24,
    color: colors.text,
    marginBottom: 16,
  },
  aboutDetails: {
    gap: 12,
  },
  aboutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  aboutLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  aboutValue: {
    fontSize: 14,
    color: colors.textSecondary,
    flex: 1,
  },

  // Social Links
  socialLinks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  socialButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },

});
