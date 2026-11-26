import { collapseSeries } from '../lib/eventSeries';
import { isPubliclyListed } from '../lib/eventVisibility';
import React, { useState, useEffect } from 'react';
import { defaultAvatar } from '../lib/defaultAvatar';
import OrgMark from '../components/OrgMark';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
    TouchableOpacity,
  Dimensions,
  RefreshControl,
  Linking,
  Animated,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  Calendar,
  MapPin,
  Globe,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Instagram,
  Facebook,
  Twitter,
  Linkedin,
  Music2,
  ImagePlus,
  Images,
  Eye,
  Pencil,
  type LucideIcon,
} from 'lucide-react-native';
import { doc, getDoc, collection, query, where, getDocs, addDoc, deleteDoc, Timestamp } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import { requireAuth, takePendingAuthIntent } from '../lib/authGate';
import { useI18n } from '../contexts/I18nContext';
import { useTheme } from '../contexts/ThemeContext';
import { radius, font } from '../theme/tokens';
import ConnectButton from '../components/ConnectButton';
import { safeFormatForLanguage } from '../lib/dates';
import SectionHeader from '../components/SectionHeader';
import PosterEventCard from '../components/PosterEventCard';
import VerifiedBadge from '../components/VerifiedBadge';
import { OrganizerProfileSkeleton } from '../components/Skeleton';
import { fetchConnections } from '../lib/api/social';
import { fetchPublicProfileDetails, type PublicProfileDetails } from '../lib/api/publicDetails';
import { goBackOrHome } from '../lib/goBackOrHome';
import { type FriendshipState } from '../types/social';
import ReportContentModal from '../components/ReportContentModal';
import { useAppAlert } from '../components/AppAlert';
import { useBlockedOrganizers } from '../lib/blockedOrganizers';
import { AFTER_ALERT_MS, promptBlockToggle } from '../lib/moderationActions';
import StretchyHero from '../components/StretchyHero';
import GalleryStrip from '../components/GalleryStrip';
import OrgCoverSheet from '../components/organizer/OrgCoverSheet';
import OrgHeroBackdrop from '../components/organizer/OrgHeroBackdrop';
import { useActiveOrg } from '../lib/activeOrg';
import { soldForPeople } from '../lib/printedBundle';
import { COVER_TEMPLATE_SOURCES, readGallery, readOrgCover, type OrgCoverState } from '../lib/orgPage';

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

type SocialType = 'website' | 'instagram' | 'facebook' | 'twitter' | 'linkedin' | 'tiktok';

interface SocialLink {
  type: SocialType;
  url: string;
}

// Website and socials as line icons (lucide), the same set as the website's
// organizer page. lucide has no TikTok glyph; Music2 stands in, as on the web.
const SOCIAL_ICON: Record<SocialType, { Icon: LucideIcon; label: string }> = {
  website: { Icon: Globe, label: 'Website' },
  instagram: { Icon: Instagram, label: 'Instagram' },
  facebook: { Icon: Facebook, label: 'Facebook' },
  twitter: { Icon: Twitter, label: 'X' },
  linkedin: { Icon: Linkedin, label: 'LinkedIn' },
  tiktok: { Icon: Music2, label: 'TikTok' },
};

// The org page's banner. Always a band (a photo banner, or OrgHeroBackdrop's
// blurred newest poster / monogram when there is none), never an empty void.
// The back button sits at insets.top + 8 (40pt tall); the logo overlaps the
// band's foot by half, so with these heights the two never meet
// (TestFlight 2026-11-24: the chevron sat on the logo).
const BANNER_PHOTO_H = 156;
const BANNER_PLAIN_H = 128;
const ORG_LOGO = 64;

export default function OrganizerProfileScreen({ route, navigation }: any) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const insets = useSafeAreaInsets();
  const { organizerId } = route.params;
  // preview: "Preview my page" (what visitors see: no owner prompts).
  const preview = route.params?.preview === true;
  // view 'person': the PERSONAL page, also for an organization's owner.
  const personView = route.params?.view === 'person';
  const { user } = useAuth();
  const activeOrg = useActiveOrg();
  const scrollY = React.useRef(new Animated.Value(0)).current;
  const [showCover, setShowCover] = useState(false);
  const { t, language } = useI18n();
  const scrollViewRef = React.useRef<ScrollView>(null);
  
  const [organizer, setOrganizer] = useState<any>(null);
  // Org details or a person's privacy-gated bio + socials, from the server
  // (lib/api/publicDetails.ts). null until loaded, or when the call fails.
  const [details, setDetails] = useState<PublicProfileDetails | null>(null);
  // A guest can't read public_profiles (signed-in only in firestore.rules):
  // fill the page's name, logo, badge, banner and photos from the server's
  // org card instead, never overwriting what the signed-in read returned.
  useEffect(() => {
    const card = details?.kind === 'org' ? details.card : undefined;
    if (!card) return;
    setOrganizer((prev: any) => {
      if (!prev) return prev;
      const next = { ...prev };
      let changed = false;
      const fill = (key: string, value: unknown) => {
        const empty = next[key] === undefined || next[key] === null || next[key] === '' ||
          (Array.isArray(next[key]) && next[key].length === 0);
        const has = value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0);
        if (empty && has) { next[key] = value; changed = true; }
      };
      fill('organization_name', card.organization_name);
      fill('organization_logo', card.organization_logo);
      fill('coverTemplate', card.coverTemplate);
      fill('coverImageUrl', card.coverImageUrl);
      fill('gallery', card.gallery);
      fill('city', card.city);
      fill('country', card.country);
      if (card.is_verified && next.is_verified !== true) { next.is_verified = true; changed = true; }
      return changed ? next : prev;
    });
  }, [details, organizer]);
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

  // Signed in from this page (the sheet over it): read their follow state now
  // there is an account, which also finishes a Follow tapped as a guest. The
  // focus listener below holds the pre-sign-in closure, so it cannot.
  const followUidRef = React.useRef(user?.uid);
  useEffect(() => {
    const prev = followUidRef.current;
    followUidRef.current = user?.uid;
    if (!user?.uid || prev === user.uid) return;
    const timer = setTimeout(() => checkFollowStatus(), 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

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
      // What shows under the name, privacy-checked server-side. In parallel
      // with the reads below; a failure leaves the legacy brand fields.
      fetchPublicProfileDetails(organizerId, { view: personView ? 'person' : undefined }).then(setDetails);

      // H4: cross-user read of the organizer's SAFE public projection (name,
      // photo, is_verified, organization_name/logo) instead of users/{uid}.
      // If the projection isn't backfilled yet, fall back to a name/avatar
      // placeholder so the screen still renders (events below still load).
      // public_profiles is readable only when signed in (firestore.rules), so a
      // guest's read is refused: keep the placeholder and name the page from
      // the organizer's own (public) events below instead of failing the screen.
      let organizerData: any = { id: organizerId };
      try {
        const organizerDoc = await getDoc(doc(db, 'public_profiles', organizerId));
        if (organizerDoc.exists()) organizerData = { id: organizerDoc.id, ...organizerDoc.data() };
      } catch {
        // Signed out (or offline): keep the placeholder.
      }
      setOrganizer(organizerData);

      // The personal page lists no hosted events: those are the org's page.
      if (personView) return;

      // Fetch events
      const eventsQuery = query(
        collection(db, 'events'),
        where('organizer_id', '==', organizerId),
        where('is_published', '==', true)
      );
      const eventsSnapshot = await getDocs(eventsQuery);
      if (!organizerData.organization_name && !organizerData.full_name) {
        const named: any = eventsSnapshot.docs.map((d) => d.data()).find((d: any) => d.organizer_name);
        if (named) {
          organizerData = { ...organizerData, organization_name: named.organizer_name };
          setOrganizer(organizerData);
        }
      }

      const now = new Date();
      const upcoming: any[] = [];
      const past: any[] = [];
      let totalSold = 0;

      eventsSnapshot.docs.forEach(doc => {
        const data = doc.data();
        // Unlisted events are link-only (lib/eventVisibility): not on the public profile.
        if (!isPubliclyListed(data)) return;
        const eventData = {
          id: doc.id,
          ...data,
          start_datetime: data.start_datetime?.toDate ? data.start_datetime.toDate() : new Date(data.start_datetime),
          end_datetime: data.end_datetime?.toDate ? data.end_datetime.toDate() : (data.end_datetime ? new Date(data.end_datetime) : null),
        };

        totalSold += soldForPeople(data);

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

      // A recurring series is listed once, at its next date (lib/eventSeries).
      setUpcomingEvents(collapseSeries(upcoming));
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
      } else if (takePendingAuthIntent('follow', organizerId)) {
        // A guest tapped Follow, signed in, and is back on this page.
        handleFollow();
      }
    } catch (error) {
      console.error('Error checking follow status:', error);
    }
  };

  const handleFollow = async () => {
    if (!requireAuth(user, navigation, { kind: 'follow', key: organizerId })) return;
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
    if (!requireAuth(user, navigation)) return;
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

  /**
   * The links under the profile, from the server's one rule
   * (lib/profile/public-details.ts): an org's settings links, or a person's
   * socials when their privacy lets this viewer see them. Every url is
   * already an absolute http(s) href. Until it loads (or if it fails), an
   * org falls back to the brand fields on its public_profiles projection.
   */
  const getSocialLinks = (): SocialLink[] => {
    const links: SocialLink[] = [];
    const add = (type: SocialType, url: string | undefined) => {
      if (url && url.trim()) links.push({ type, url: url.trim() });
    };

    if (details?.kind === 'org' && details.org) {
      const o = details.org;
      add('website', o.website);
      add('instagram', o.instagram);
      add('facebook', o.facebook);
      add('twitter', o.twitter);
      add('linkedin', o.linkedin);
      add('tiktok', o.tiktok);
      return links;
    }
    if (details?.kind === 'person') {
      const p = details.person?.socials;
      add('instagram', p?.instagram);
      add('facebook', p?.facebook);
      add('twitter', p?.twitter);
      add('tiktok', p?.tiktok);
      return links;
    }

    // Legacy fallback (details not loaded): the projection's brand fields.
    add('website', organizer?.website);
    if (organizer?.instagram) add('instagram', `https://instagram.com/${organizer.instagram.replace('@', '')}`);
    if (organizer?.facebook) add('facebook', `https://facebook.com/${organizer.facebook}`);
    if (organizer?.tiktok) add('tiktok', `https://tiktok.com/@${organizer.tiktok.replace('@', '')}`);
    // H4: whatsapp/email are contact PII and are never surfaced here.
    return links;
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchOrganizerProfile();
    checkFollowStatus();
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
        <OrganizerProfileSkeleton variant={personView ? 'person' : 'org'} />
        {/* The real back button, where the loaded page puts it. */}
        <TouchableOpacity
          style={[styles.backButton, { top: insets.top + HERO_CONTROL_TOP }]}
          onPress={() => goBackOrHome(navigation)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <Ionicons name="chevron-back" size={26} color={colors.white} />
        </TouchableOpacity>
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
  const hostingYear = createdAtRaw
    ? new Date(
        createdAtRaw.seconds
          ? createdAtRaw.seconds * 1000
          : typeof createdAtRaw.toDate === 'function'
            ? createdAtRaw.toDate()
            : createdAtRaw
      ).getFullYear()
    : NaN;
  // A malformed date must hide the row: a bare NaN in JSX renders as text
  // outside <Text>, which crashes on device.
  const hostingSince = Number.isFinite(hostingYear) ? hostingYear : null;
  // Month and year for people: "Joined Nov 2026" reads warmer than a bare year.
  const joinedLabel = hostingSince && createdAtRaw
    ? safeFormatForLanguage(
        createdAtRaw.seconds
          ? createdAtRaw.seconds * 1000
          : typeof createdAtRaw.toDate === 'function'
            ? createdAtRaw.toDate()
            : createdAtRaw,
        'MMM yyyy',
        language
      ) || null
    : null;
  const subtitle = getSubtitle();

  // Org description, or a person's bio when the server says this viewer may
  // see it. Before details load, the projection's legacy description.
  const aboutText =
    details?.kind === 'org'
      ? details.org?.description || ''
      : details?.kind === 'person'
        ? details.person?.bio || ''
        : organizer.description || '';
  const personHidden = details?.kind === 'person' && details.person === null;
  const isOrgProfile = !personView && (!!organizer.organization_name || details?.kind === 'org');
  // Not everyone is an organizer (owner, 2026-11-17). Someone who has never
  // hosted gets a person's profile: no "0 events", no Follow, no empty
  // "upcoming events", and "Joined Tikèm" instead of "Hosting events since".
  const isHost =
    !personView &&
    (isOrgProfile ||
    (stats.totalEvents || 0) > 0 ||
    upcomingEvents.length > 0 ||
    pastEvents.length > 0 ||
    organizer.role === 'organizer' ||
    organizer.is_organizer === true);

  // Connect (friend-request) action still sits inline next to the stats.
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

  // The org page's banner and photos (server-written on public_profiles;
  // lib/galleryRules re-checks them: a known template or this org's uploads).
  const cover = readOrgCover(organizerId, organizer);
  const coverSource = cover?.kind === 'template' ? COVER_TEMPLATE_SOURCES[cover.key] : cover?.kind === 'upload' ? { uri: cover.url } : null;
  const gallery = readGallery(organizer.gallery, organizerId);
  const coverState: OrgCoverState = {
    coverTemplate: cover?.kind === 'template' ? cover.key : null,
    coverImageUrl: cover?.kind === 'upload' ? cover.url : null,
  };
  // Owner prompts: the owner, or a team admin of this org; never in a preview.
  const canManage =
    !preview &&
    !personView &&
    !!user &&
    (user.uid === organizerId || activeOrg.options.some((o) => o.orgId === organizerId && (o.role === 'owner' || o.role === 'admin')));
  const orgHero = isHost && !personView;
  const bannerHeight = insets.top + (coverSource ? BANNER_PHOTO_H : BANNER_PLAIN_H);
  // No banner: the newest poster, blurred, carries the org's colours instead.
  const heroPosterUri: string | null =
    [...upcomingEvents, ...pastEvents].find((e: any) => !!e?.banner_image_url)?.banner_image_url || null;
  const orgDisplayName: string = organizer.organization_name || organizer.full_name || '';
  const identity = personView ? details?.identity : undefined;
  const alsoRuns = personView ? details?.also_runs || null : null;
  const personName = identity?.full_name || organizer.full_name || organizer.organization_name || '';
  const personPhoto = personView
    ? identity?.photo_url || organizer.photo_url || ''
    : organizer.organization_logo || organizer.avatarUrl || organizer.photo_url || '';

  const statItems = [
    { label: t('organizerProfile.stats.events'), value: String(stats.totalEvents || 0) },
    { label: t('organizerProfile.stats.followers'), value: String(stats.followerCount || 0) },
    { label: t('organizerProfile.stats.sold'), value: (stats.totalTicketsSold || 0).toLocaleString() },
  ].filter((item, i) => i < 2 || (stats.totalTicketsSold || 0) > 0); // "0 sold" says nothing
  // A person's line: friends-facing facts only, never "0 events · 0 followers".
  const personLine = !isHost && joinedLabel ? t('organizerProfile.joinedOn', { date: joinedLabel }) : null;

  // The controls over the top of the page: back, "…", Follow.
  const controls = (
    <>
      {/* Back: a clean chevron on a scrim, top-left, never over the logo. */}
      <TouchableOpacity
        style={[styles.backButton, { top: insets.top + HERO_CONTROL_TOP }]}
        onPress={() => goBackOrHome(navigation)}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel={t('common.back')}
      >
        <Ionicons name="chevron-back" size={26} color={colors.white} />
      </TouchableOpacity>

      {/* "…": report / block. Not on your own page, not in a preview. */}
      {!isSelf && !preview && (
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

      {/* Follow, top right. Hidden while blocked (the block removed the
          follow and re-following is refused) and on a personal page. */}
      {!isSelf && !preview && !isBlocked && !personView && (isHost || isFollowing) && (
        <TouchableOpacity
          style={[
            styles.followButtonSmall,
            { top: insets.top + HERO_CONTROL_TOP },
            isFollowing && styles.followingButtonSmall,
          ]}
          onPress={handleFollow}
        >
          {isFollowing ? <Ionicons name="checkmark" size={15} color={colors.white} /> : null}
          <Text style={[styles.followButtonSmallText, isFollowing && styles.followingButtonSmallText]}>
            {isFollowing ? t('organizerProfile.following') : t('organizerProfile.follow')}
          </Text>
        </TouchableOpacity>
      )}
    </>
  );

  // Website and socials as line icons on one row (lucide, like the website).
  const socialRow =
    socialLinks.length > 0 ? (
      <View style={styles.socialRow}>
        {socialLinks.map((link) => {
          const Icon = SOCIAL_ICON[link.type].Icon;
          return (
            <TouchableOpacity
              key={link.type}
              style={styles.socialIcon}
              onPress={() => openLink(link.url)}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              accessibilityRole="link"
              accessibilityLabel={
                link.type === 'website' ? t('organizerProfile.websiteLabel') : SOCIAL_ICON[link.type].label
              }
            >
              <Icon size={19} color={colors.textSecondary} strokeWidth={1.75} />
            </TouchableOpacity>
          );
        })}
      </View>
    ) : null;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Animated.ScrollView
        ref={scrollViewRef as any}
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.white} />
        }
      >
        {orgHero ? (
          <View>
            {/* The banner stretches into the pull-down: no empty band above it. */}
            <StretchyHero
              scrollY={scrollY}
              height={bannerHeight}
              backgroundColor={colors.background}
              background={
                <OrgHeroBackdrop coverSource={coverSource} posterUri={heroPosterUri} name={orgDisplayName} />
              }
            >
              {/* The owner edits the banner from the banner itself: one small
                  pill at its foot, right (the logo takes the left). */}
              {canManage ? (
                <TouchableOpacity
                  style={styles.editBanner}
                  onPress={() => setShowCover(true)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={coverSource ? t('orgPage.changeBanner') : t('orgPage.addBanner')}
                >
                  {coverSource ? <Pencil size={14} color={colors.white} /> : <ImagePlus size={14} color={colors.white} />}
                  <Text style={styles.editBannerText} numberOfLines={1}>
                    {coverSource ? t('orgPage.changeBanner') : t('orgPage.addBanner')}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </StretchyHero>
            {controls}

            <View style={styles.orgHead}>
              {/* The logo overlaps the banner; the counts sit beside it. */}
              <View style={styles.logoRow}>
                <View style={styles.orgLogo}>
                  {organizer.organization_logo || organizer.photo_url ? (
                    <ExpoImage
                      source={{ uri: organizer.organization_logo || organizer.photo_url }}
                      style={styles.orgLogoImage}
                      contentFit="cover"
                    />
                  ) : (
                    <OrgMark size={32} color="#000000" />
                  )}
                </View>
                <View style={styles.statsBeside}>
                  {statItems.slice(0, 2).map((item) => (
                    <View key={item.label} style={styles.statBlock}>
                      <Text style={styles.statFigure}>{item.value}</Text>
                      <Text style={styles.statCaption}>{item.label}</Text>
                    </View>
                  ))}
                </View>
              </View>

              <Text style={styles.orgName} numberOfLines={2} accessibilityRole="header">
                {orgDisplayName}
              </Text>

              {(organizer.is_verified || !!subtitle) && (
                <View style={styles.metaRow}>
                  {organizer.is_verified && <VerifiedBadge size="small" showLabel />}
                  {organizer.is_verified && !!subtitle && <Text style={styles.metaDotMuted}>·</Text>}
                  {!!subtitle && (
                    <Text style={styles.subtitleMuted} numberOfLines={1}>
                      {subtitle}
                    </Text>
                  )}
                </View>
              )}

              {!!aboutText && <Text style={styles.orgAbout}>{aboutText}</Text>}

              {socialRow}

              {/* Add-prompt: only for the owner (or a team admin), only when
                  the page has no photos, never in a preview. A quiet text
                  link, not a boxed button (the banner's own pill handles the
                  banner). */}
              {canManage && gallery.length === 0 ? (
                <TouchableOpacity
                  style={styles.promptLink}
                  onPress={() => navigation.navigate('OrgGallery', { orgId: organizerId })}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                >
                  <Images size={14} color={colors.textSecondary} />
                  <Text style={styles.promptLinkText}>{t('orgPage.addPhotos')}</Text>
                </TouchableOpacity>
              ) : null}

              {preview ? (
                <View style={styles.previewNote}>
                  <Eye size={14} color={colors.textSecondary} />
                  <Text style={styles.previewNoteText}>{t('orgPage.previewNote')}</Text>
                </View>
              ) : null}
            </View>
          </View>
        ) : (
          <View style={[styles.hero, styles.heroPlain]}>
            {controls}
            <View style={[styles.heroContent, { paddingTop: insets.top + HERO_IDENTITY_OFFSET }]}>
              <View style={styles.identityRow}>
                {/* A person: their face at 72, no ring. */}
                <View style={[styles.avatar, styles.avatarPerson]}>
                  {personPhoto ? (
                    <ExpoImage source={{ uri: personPhoto }} style={styles.avatarImage} contentFit="cover" />
                  ) : (
                    <ExpoImage source={defaultAvatar(organizerId)} style={styles.avatarImage} contentFit="cover" />
                  )}
                </View>
                <View style={styles.identityText}>
                  <Text style={styles.organizerName} numberOfLines={1}>
                    {personName}
                  </Text>
                  {(organizer.is_verified || !!subtitle) && (
                    <View style={styles.metaRow}>
                      {organizer.is_verified && <VerifiedBadge size="small" showLabel />}
                      {organizer.is_verified && !!subtitle && <Text style={styles.metaDot}>·</Text>}
                      {!!subtitle && (
                        <Text style={styles.subtitle} numberOfLines={1}>
                          {subtitle}
                        </Text>
                      )}
                    </View>
                  )}
                </View>
              </View>

              {/* An organization's owner seen as a person: the org they run. */}
              {alsoRuns ? (
                <TouchableOpacity
                  style={styles.alsoRuns}
                  onPress={() => navigation.push('OrganizerProfile', { organizerId })}
                  accessibilityRole="link"
                >
                  <View style={styles.alsoRunsLogo}>
                    {alsoRuns.logo ? (
                      <ExpoImage source={{ uri: alsoRuns.logo }} style={styles.orgLogoImage} contentFit="cover" />
                    ) : (
                      <OrgMark size={16} color="#000000" />
                    )}
                  </View>
                  <Text style={styles.alsoRunsText} numberOfLines={1}>
                    {t('orgPage.alsoRuns', { name: alsoRuns.name })}
                  </Text>
                  <ChevronRight size={16} color={colors.textTertiary} />
                </TouchableOpacity>
              ) : null}

              {socialRow}
            </View>
          </View>
        )}

        <View style={styles.content}>

          {/* Stats — one quiet tabular-numeral line rather than a full-width row of three
              27px numerals. All three figures are kept, just at reading size:
              "4 EVENTS · 4 FOLLOWERS · 0 SOLD". */}
          {/* A person's line (hosts show their counts beside the logo). */}
          {!isHost && personLine ? (
            <View style={styles.statLine}>
              <Text style={styles.statLabel}>{personLine}</Text>
            </View>
          ) : null}

          {/* Connect action — a quiet secondary pill inline under the stats,
              not a prominent full-width card. */}
          {showConnect && !preview ? (
            <View style={styles.connectRow}>
              <ConnectButton
                targetUserId={organizerId}
                initialState={friendship}
                size="sm"
                variant="secondary"
                onChange={setFriendship}
                onRequireAuth={() => requireAuth(null, navigation)}
              />
            </View>
          ) : null}

          {/* Upcoming Events (hosts only, or anyone who has one) */}
          {(isHost || upcomingEvents.length > 0) && (
          <View style={styles.section}>
            {/* The shared editorial header (lowercase serif), like every other
                section in the app and on the website. */}
            <SectionHeader
              title={t('organizerProfile.upcomingTitle')}
              subtitle={
                upcomingEvents.length > 0
                  ? `${upcomingEvents.length} ${t(
                      upcomingEvents.length === 1
                        ? 'organizerProfile.upcomingCountSingular'
                        : 'organizerProfile.upcomingCountPlural'
                    )}`
                  : undefined
              }
            />
            {upcomingEvents.length > 0 ? (
              <>
                <View style={styles.eventsGrid}>
                  {upcomingEvents.map((event) => renderEventCard(event))}
                </View>
              </>
            ) : (
              // One quiet line, not an icon + bold heading + "0 events" count
              // filling half the screen.
              <Text style={styles.quietLine}>
                {t('organizerProfile.noUpcomingTitle')}
              </Text>
            )}
          </View>
          )}

          {/* Photos: a strip with a full-screen viewer. */}
          {orgHero && gallery.length > 0 ? (
            <View style={styles.section}>
              <SectionHeader title={t('orgPage.photosTitle')} />
              <GalleryStrip photos={gallery} style={styles.galleryBleed} />
            </View>
          ) : null}

          {/* Past Events — beta feedback: these used to be hidden behind a
              collapsed accordion, so the profile read as "Upcoming only". They
              now render inline, dimmed, newest first. The whole section is
              omitted (header included) when the organizer has no history. */}
          {pastEvents.length > 0 && (
            <View style={styles.section}>
              <SectionHeader
                title={t('organizerProfile.pastTitle')}
                subtitle={`${pastEvents.length} ${t(
                  pastEvents.length === 1
                    ? 'organizerProfile.pastCountSingular'
                    : 'organizerProfile.pastCountPlural'
                )}`}
              />

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

          {/* About Section: hidden for a person with nothing to say in it. */}
          {((isHost && !orgHero) || (!!aboutText && !orgHero) || (personHidden && !isSelf) || !!(organizer.city && organizer.country) || (organizer.languages && organizer.languages.length > 0)) && (
          <View style={styles.section}>
            <SectionHeader title={t('organizerProfile.aboutTitle')} />
            
            {!!aboutText && !orgHero && <Text style={styles.aboutText}>{aboutText}</Text>}
            {personHidden && !isSelf && (
              <Text style={styles.privateNote}>{t('organizerProfile.privateDetails')}</Text>
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

              {/* A person's join date is already the line under their name. */}
              {hostingSince && isHost && (
                <View style={styles.aboutRow}>
                  <Calendar size={18} color={colors.textSecondary} />
                  <Text style={styles.aboutLabel}>
                    {isHost ? t('organizerProfile.hostingSinceLabel') : t('organizerProfile.memberSinceLabel')}
                  </Text>
                  <Text style={styles.aboutValue}>{isHost ? hostingSince : joinedLabel || hostingSince}</Text>
                </View>
              )}
            </View>
          </View>
          )}

        </View>
      </Animated.ScrollView>
      {showCover ? (
        <OrgCoverSheet
          visible={showCover}
          orgId={organizerId}
          current={coverState}
          onClose={() => setShowCover(false)}
          onChanged={(next) => setOrganizer((prev: any) => ({ ...prev, coverTemplate: next.coverTemplate, coverImageUrl: next.coverImageUrl }))}
          orgName={orgDisplayName}
          logoUri={organizer.organization_logo || organizer.photo_url || null}
          posterUri={heroPosterUri}
        />
      ) : null}
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
  heroPlain: {
    backgroundColor: colors.background,
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
    borderRadius: radius.md,
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
    borderRadius: radius.md,
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
  // Following = a quiet dark fill with a check, like the app-wide FollowButton.
  // The old white outline read as a call to action (owner: "misleading").
  followingButtonSmall: {
    backgroundColor: 'rgba(28, 28, 28, 0.85)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
  avatarPerson: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 0,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    shadowOpacity: 0,
    elevation: 0,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 999,
  },
  avatarText: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.primary,
  },
  organizerName: {
    // Instrument Serif ships one weight; a bold request only fakes it.
    fontFamily: font.serif,
    fontSize: 30,
    lineHeight: 36,
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

  // Org hero: logo overlapping the banner, counts beside it.
  orgHead: {
    paddingHorizontal: 20,
    marginTop: -ORG_LOGO / 2,
    paddingBottom: 4,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 18,
  },
  orgLogo: {
    width: ORG_LOGO,
    height: ORG_LOGO,
    borderRadius: radius.sm,
    backgroundColor: colors.white,
    borderWidth: 3,
    borderColor: colors.background,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orgLogoImage: {
    width: '100%',
    height: '100%',
  },
  statsBeside: {
    flexDirection: 'row',
    gap: 18,
    paddingBottom: 2,
  },
  statBlock: {
    alignItems: 'flex-start',
  },
  statFigure: {
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '700',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  statCaption: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSecondary,
    textTransform: 'lowercase',
  },
  orgName: {
    marginTop: 12,
    fontFamily: font.serif,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.5,
    color: colors.text,
  },
  metaDotMuted: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  subtitleMuted: {
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  orgAbout: {
    marginTop: 10,
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
  },
  socialRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
    marginLeft: -8,
  },
  socialIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promptLink: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 12,
  },
  promptLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  previewNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
  },
  previewNoteText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  editBanner: {
    position: 'absolute',
    right: 16,
    bottom: 12,
    height: 32,
    paddingHorizontal: 10,
    flexDirection: 'row',
    gap: 6,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editBannerText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.white,
  },
  alsoRuns: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    marginTop: 14,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  alsoRunsLogo: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alsoRunsText: {
    flexShrink: 1,
    fontSize: 13,
    color: colors.text,
  },
  galleryBleed: {
    marginHorizontal: -16,
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
  // A fill, not a hairline around a tinted box (house rule).
  socialButton: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  quietLine: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  privateNote: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    marginBottom: 16,
  },

});
