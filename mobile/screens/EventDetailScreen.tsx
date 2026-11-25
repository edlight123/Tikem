import React, { useState, useEffect, useRef } from 'react';
import OccasionLink from '../components/OccasionLink';
import PosterImage from '../components/PosterImage';
import { usePosterAlt } from '../lib/usePosterAlt';
import OrgMark from '../components/OrgMark';
import { 
  View, 
  Text, 
    StyleSheet, 
    TouchableOpacity, 
  ActivityIndicator,
  Dimensions,
  Linking,
    Animated,
  Modal,
  TextInput,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { 
      Share2, 
  Heart, 
        ExternalLink,
  MessageCircle,
  ChevronLeft,
  PlayCircle,
  MoreHorizontal,
  Globe,
  CalendarPlus,
  Lock,
  X,
} from 'lucide-react-native';
import { doc, getDoc, collection, addDoc, Timestamp, query, where, getDocs, deleteDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { backendJson } from '../lib/api/backend';
import { getPromoterRef, setPromoterRef } from '../lib/promoterRef';
import { Attribution, attributionFromParams, sendClickOnce } from '../lib/attribution';
import { pingEventView } from '../lib/eventViews';
import { requireAuth, takePendingAuthIntent } from '../lib/authGate';
import { goBackOrHome } from '../lib/goBackOrHome';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { useTheme } from '../contexts/ThemeContext';
import { parseVideoEmbed } from '../lib/videoEmbed';
import { colors as T, radius, withAlpha, font } from '../theme/tokens';
import { formatEventTime } from '../lib/dates';
import { shareLink } from '../lib/share';
import { isValidDate } from '../lib/dates';
import WhitePillCTA from '../components/WhitePillCTA';
import VerifiedBadge from '../components/VerifiedBadge';
import PaymentModal from '../components/PaymentModal';
import { externalTicketsUrl } from '../lib/integrationWeb';
import { communityTicketsUrl, isCommunityEvent, isSafeHttpUrl } from '../lib/community';
import TieredTicketSelector, { PurchaseSelectionMeta } from '../components/TieredTicketSelector';
import { eventAddOns } from '../lib/addOns';
import { resolveEventPricing } from '../lib/ticketPricing';
import { doorPriceLabel, isDoorEvent, isDoorTier, lowestDoorPrice } from '../lib/payAtDoor';
import { familyMax, freeClaimCapFor } from '../lib/family';
import { advertisedPrice } from '../lib/buyerPricing';
import { formatPrice } from '../lib/currency';
import { setTicketsRefreshHint } from '../lib/ticketsRefreshHint';
import { resolvePosterTheme } from '../lib/posterGradient';
import FreeTicketModal from '../components/FreeTicketModal';
import AddToCalendarButton from '../components/AddToCalendarButton';
import JoinWaitlistButton from '../components/JoinWaitlistButton';
import FollowButton from '../components/FollowButton';
import CountdownTimer from '../components/CountdownTimer';
import VenueStaticMap from '../components/VenueStaticMap';
import { useVenueDistance } from '../hooks/useVenueDistance';
import WhosGoing from '../components/WhosGoing';
import SectionHeader from '../components/SectionHeader';
import VenueDetailsLines from '../components/VenueDetailsLines';
import { guestlistVisibilityFrom } from '../lib/guestlistVisibility';
import ContactOrganizerModal from '../components/ContactOrganizerModal';
import { getEventPreview, primeEventPreview } from '../lib/eventPreviewCache';
import ReportContentModal from '../components/ReportContentModal';
import { useBlockedOrganizers } from '../lib/blockedOrganizers';
import { AFTER_ALERT_MS, promptBlockToggle } from '../lib/moderationActions';
import PurchaseSuccessSheet from '../components/PurchaseSuccessSheet';
import FriendsGoingRow from '../components/FriendsGoingRow';
import RichText from '../components/RichText';
import InviteFriendsRow from '../components/InviteFriendsSheet';
import { requestPhonePrompt } from '../lib/phonePrompt';
import { useAppAlert } from '../components/AppAlert';
import ChromeBlur from '../components/ChromeBlur';
import * as haptics from '../lib/haptics';
import { EventDetailSkeleton } from '../components/Skeleton';
import EventLineupRail from '../components/EventLineupRail';
import TrailerCard from '../components/TrailerCard';
import SpotifyTrackCard from '../components/SpotifyTrackCard';
import { useOpenAttendeeTab } from '../hooks/useOpenAttendeeTab';
import AttendRequestSheet from '../components/AttendRequestSheet';
import RequestStatusDot, { requestTone } from '../components/RequestStatusDot';
import { isLiveTicketStatus } from '../lib/profileStats';
import {
  attendErrorKey,
  cancelAttendRequest,
  eventAllowedPlusOnes,
  eventRequiresApproval,
  getOwnAttendRequest,
  type OwnAttendRequest,
} from '../lib/attendRequests';
import { isHaitiEvent } from '../lib/eventClock';
const { width } = Dimensions.get('window');
// Full-bleed poster (posh): the flyer spans the screen width and the same
// art, blurred and darkened, fills the band behind the header above it and
// bleeds a little below before melting into the page.
const POSTER_W = width;
const POSTER_H = POSTER_W * 1.25;
const HERO_BLEED = 28;
// Height of the sticky header's button row (below the status bar).
const HEADER_BAR = 52;

// Dictionary key for the compact countdown prefix ("Starts in").
const STARTS_IN_KEY = 'eventDetail.startsIn';

/** Organizer display fields from its public profile (never PII). */
function organizerFields(profile: any) {
  return {
    full_name: profile?.full_name || '',
    // Organization brand overrides the personal name wherever the organizer
    // is shown (falls back to full_name when unset).
    organization_name: profile?.organization_name || '',
    organization_logo: profile?.organization_logo || '',
    is_verified: profile?.is_verified ?? false,
  };
}

const toDateOrNull = (v: any) => (v?.toDate ? v.toDate() : v ? new Date(v) : null);

/**
 * One shape for the screen whether the data came from a list preview or the
 * event document: Dates for the datetimes, and `users` from the organizer's
 * profile when we have it (else whatever was already shown, else blanks).
 */
function normalizeEvent(data: any, profile: any | null, previousUsers?: any) {
  return {
    ...data,
    start_datetime: toDateOrNull(data.start_datetime),
    end_datetime: toDateOrNull(data.end_datetime),
    users: profile
      ? organizerFields(profile)
      : previousUsers || data.users || organizerFields(null),
  };
}

export default function EventDetailScreen({ route, navigation }: any) {
  const openAttendeeTab = useOpenAttendeeTab();
  const { eventId } = route.params;
  // Promoter attribution. Universal links open promoter share links
  // (tikem.co/events/{id}?ref=CODE) in THIS app instead of the browser, and React
  // Navigation delivers the query string as route.params.ref. Capture it (last
  // click wins), persist per event so it survives re-navigation and auth, and
  // thread it into every purchase body as `refCode` — the server re-validates and
  // silently drops junk, so this can never block a purchase.
  const [refCode, setRefCode] = useState<string | undefined>();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fromLink = await setPromoterRef(eventId, (route.params as any)?.ref);
      const code = fromLink || (await getPromoterRef(eventId));
      if (!cancelled && code) setRefCode(code);
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, (route.params as any)?.ref]);
  // Tracking-link / utm attribution from the same deep link (`?t=` + utm_*).
  // Held in memory and threaded into every purchase body as `attribution`; the
  // server re-resolves it. Opening through a link also counts one click
  // (deduped per device per link for 30 minutes), fire-and-forget.
  const rp = (route.params || {}) as Record<string, unknown>;
  const [attribution, setAttribution] = useState<Attribution | null>(null);
  useEffect(() => {
    const fromLink = attributionFromParams(rp);
    if (!fromLink) return;
    setAttribution(fromLink);
    sendClickOnce(eventId, fromLink).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, rp.t, rp.ref, rp.utm_source, rp.utm_medium, rp.utm_campaign]);
  // One page view for the organizer's count (lib/eventViews.ts). The server
  // dedupes per viewer per day and skips the organizer's own team.
  useEffect(() => {
    pingEventView(eventId);
  }, [eventId]);
  const { user, userProfile } = useAuth();
  const { t, language } = useI18n();
  const posterAlt = usePosterAlt();
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const showAlert = useAppAlert();
  // Instant open (owner, 2026-11-17): paint from the copy the tapped card
  // already had (lib/eventPreviewCache), then refresh from Firestore. `fresh`
  // gates everything money-related (the buy bar) on the real document.
  const [event, setEvent] = useState<any>(() => {
    const preview = getEventPreview(eventId);
    return preview ? normalizeEvent(preview, null) : null;
  });
  const [loading, setLoading] = useState(() => !getEventPreview(eventId));
  const [fresh, setFresh] = useState(false);
  // "2.4 km away", only once the person shared their location (never asks here).
  const venueDistance = useVenueDistance(event);
  const [purchasing, setPurchasing] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showTierSelector, setShowTierSelector] = useState(false);
  const [showFreeTicketModal, setShowFreeTicketModal] = useState(false);
  const [showContactOrganizer, setShowContactOrganizer] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const blockedOrganizers = useBlockedOrganizers();
  // Set the moment a purchase or free claim lands; carries the count so the
  // confirmation can say "2 tickets" rather than a generic success message.
  const [successQuantity, setSuccessQuantity] = useState<number | null>(null);
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null);
  const [selectedTierName, setSelectedTierName] = useState<string>('');
  const [selectedTierPrice, setSelectedTierPrice] = useState<number>(0);
  // Undiscounted total for the current selection. Used when a promo-zeroed claim
  // is refused by the server and the buyer continues to normal checkout — showing
  // the discounted 0 there would promise a price we can't honor.
  const [selectedTierGrossPrice, setSelectedTierGrossPrice] = useState<number>(0);
  // The whole cart when it mixes ticket types; sent to checkout as `tiers[]`.
  const [selectedLines, setSelectedLines] = useState<{ tierId: string; quantity: number }[]>([]);
  const [selectedPaidQuantity, setSelectedPaidQuantity] = useState<number | undefined>(undefined);
  // Add-ons picked with the tickets (lib/addOns), sent with the card order.
  const [selectedAddOns, setSelectedAddOns] = useState<NonNullable<PurchaseSelectionMeta['addOns']>>([]);
  const [ticketQuantity, setTicketQuantity] = useState(1);
  const [promoCode, setPromoCode] = useState<string | undefined>();
  // Password-gate state. accessGranted: null = unknown/not-yet-checked, true =
  // an access_grants/{uid} doc exists (or unlock succeeded), false = gated.
  const [accessGranted, setAccessGranted] = useState<boolean | null>(null);
  const [showAccessGate, setShowAccessGate] = useState(false);
  const [accessCodeInput, setAccessCodeInput] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [accessError, setAccessError] = useState('');
  // Approval lists (docs/specs/approval-lists-and-plus-ones.md). The guest's own
  // request on an approval event, read through the API (never Firestore), and
  // the plus-ones the server says they may name.
  const [attendRequest, setAttendRequest] = useState<OwnAttendRequest | null>(null);
  const [attendAllowedPlusOnes, setAttendAllowedPlusOnes] = useState<number | null>(null);
  const [showRequestSheet, setShowRequestSheet] = useState(false);
  const [cancellingRequest, setCancellingRequest] = useState(false);
  // How many LIVE free tickets the signed-in user already holds for this event.
  // The server allows one free claim per buyer per event (lib/tickets/
  // free-claim-issue), so once this is > 0 a free-only event shows "You're
  // going" instead of the claim CTA, and a mixed event closes its free tiers.
  const [heldFreeTickets, setHeldFreeTickets] = useState(0);
  const scrollY = useRef(new Animated.Value(0)).current;
  const floatingBarAnim = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();

  useEffect(() => {
    fetchEventDetails();
    checkFavoriteStatus();
  }, [eventId]);

  // Signed in from this page (lib/authGate): the sign-in sheet has gone and
  // the guest is back here. Pick up what they tapped. The latest handlers are
  // read through a ref, since the ones in this closure predate the account.
  const resumeRef = useRef<() => void>(() => undefined);
  resumeRef.current = () => {
    if (takePendingAuthIntent('purchase', eventId)) {
      if (event) handlePurchaseTicket();
    } else if (takePendingAuthIntent('message', eventId)) {
      if (event?.organizer_id && event.organizer_id !== user?.uid) setShowContactOrganizer(true);
    } else if (takePendingAuthIntent('favorite', eventId)) {
      saveFavoriteAfterSignIn();
    }
  };
  const resumeUidRef = useRef(user?.uid);
  useEffect(() => {
    const prevUid = resumeUidRef.current;
    resumeUidRef.current = user?.uid;
    // Only on the guest -> signed-in change, not on every open.
    if (!user?.uid || prevUid === user.uid) return;
    // Their heart state, now that there is an account to read it for.
    checkFavoriteStatus();
    // After the sheet's slide-down: two modals at once do not stack on iOS.
    const timer = setTimeout(() => resumeRef.current(), 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  // Animate floating bar entrance
  useEffect(() => {
    if (event && fresh) {
      Animated.timing(floatingBarAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
  }, [event, fresh]);

  // Once the event (and its is_password_protected flag) is loaded, check whether
  // the signed-in user already holds an access grant. Access proof is the mere
  // existence of events/{id}/access_grants/{uid} (written only by the server
  // verify endpoint). Non-protected events are always "granted".
  useEffect(() => {
    let cancelled = false;
    const checkAccessGrant = async () => {
      if (!event) return;
      if (!event.is_password_protected) {
        if (!cancelled) setAccessGranted(true);
        return;
      }
      if (!user) {
        if (!cancelled) setAccessGranted(false);
        return;
      }
      try {
        const grantSnap = await getDoc(doc(db, 'events', eventId, 'access_grants', user.uid));
        if (!cancelled) setAccessGranted(grantSnap.exists());
      } catch (err) {
        console.error('Error checking access grant:', err);
        if (!cancelled) setAccessGranted(false);
      }
    };
    checkAccessGrant();
    return () => {
      cancelled = true;
    };
  }, [event, user, eventId]);

  // Mirrors the server's dedup exactly (liveFreeTicketsFor): tickets stamped
  // with this attendee, price 0, in a live status. Same two-equality query
  // EventTicketsScreen already runs, so the rules and indexes allow it.
  const loadHeldFreeTickets = async () => {
    if (!user?.uid) {
      setHeldFreeTickets(0);
      return;
    }
    try {
      const snap = await getDocs(
        query(collection(db, 'tickets'), where('event_id', '==', eventId), where('attendee_id', '==', user.uid))
      );
      const held = snap.docs.filter((d) => {
        const data: any = d.data();
        return Number(data.price_paid ?? 0) === 0 && isLiveTicketStatus(data.status);
      }).length;
      setHeldFreeTickets(held);
    } catch (err) {
      // Not fatal: the claim CTA stays, and the server answers a repeat claim
      // with the existing tickets (FreeTicketModal shows "already have N").
      console.warn('[EventDetail] held free tickets load failed', (err as any)?.code);
    }
  };
  useEffect(() => {
    loadHeldFreeTickets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, user?.uid]);

  const eventNeedsApproval = eventRequiresApproval(event);
  const loadAttendRequest = async () => {
    if (!user || !eventNeedsApproval) {
      setAttendRequest(null);
      return;
    }
    try {
      const res = await getOwnAttendRequest(eventId);
      setAttendRequest(res.request && res.request.status !== 'cancelled' ? res.request : null);
      setAttendAllowedPlusOnes(res.allowedPlusOnes);
    } catch (err) {
      // Not fatal: the CTA still offers "Request to join", and the server
      // answers a duplicate with the existing request.
      console.warn('[EventDetail] attend request load failed', (err as any)?.code);
    }
  };
  useEffect(() => {
    loadAttendRequest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, user?.uid, eventNeedsApproval]);

  // Verify the typed code against the web endpoint. On { ok:true } the server
  // has written the access grant; mark unlocked and continue into purchase.
  const handleUnlock = async () => {
    const code = accessCodeInput.trim();
    if (!code || unlocking) return;
    setUnlocking(true);
    setAccessError('');
    try {
      const res = await backendJson<{ ok?: boolean }>('/api/events/verify-access', {
        method: 'POST',
        body: JSON.stringify({ eventId, code }),
      });
      if (res?.ok) {
        setAccessGranted(true);
        setShowAccessGate(false);
        setAccessCodeInput('');
        // Grant now exists downstream — proceed to the right purchase flow.
        if (requiresApproval) {
          // The gate is itself a Modal: open the sheet once it has gone.
          setTimeout(() => setShowRequestSheet(true), AFTER_ALERT_MS);
        } else if (isFree) {
          setShowFreeTicketModal(true);
        } else {
          setShowTierSelector(true);
        }
      } else {
        setAccessError(t('eventAccess.wrongCode'));
      }
    } catch (err: any) {
      // backendJson throws on non-2xx. Only a 403 means the code was wrong;
      // telling someone with no signal (or a server hiccup) that their correct
      // code is "incorrect" sends them hunting for a different one.
      const status = Number(err?.status || 0);
      console.warn('[EventDetail] verify-access failed:', status || 'network', err?.message);
      if (status === 403) {
        setAccessError(t('eventAccess.wrongCode'));
      } else if (status === 429) {
        setAccessError(t('eventAccess.tooManyAttempts'));
      } else if (!status) {
        setAccessError(t('eventAccess.networkError'));
      } else {
        setAccessError(t('eventAccess.verifyFailed'));
      }
    } finally {
      setUnlocking(false);
    }
  };

  const fetchEventDetails = async () => {
    try {
      // The organizer's public profile is read IN PARALLEL with the event when
      // the preview already told us who it is (the common case); otherwise it
      // follows, but the event paints first instead of waiting for both.
      const knownOrganizer: string | undefined = getEventPreview(eventId)?.organizer_id;
      const readProfile = (uid: string) =>
        // public_profiles is signed-in only (firestore.rules): a guest keeps
        // the organizer fields the event itself carries.
        !user
          ? Promise.resolve(null)
          : // H4: cross-user read of the organizer's SAFE public projection (not users/{uid}).
        getDoc(doc(db, 'public_profiles', uid))
          .then((d) => (d.exists() ? d.data() : null))
          .catch((err) => {
            console.error('Error fetching organizer:', err);
            return null;
          });
      const [eventDoc, earlyProfile] = await Promise.all([
        getDoc(doc(db, 'events', eventId)),
        knownOrganizer ? readProfile(knownOrganizer) : Promise.resolve(undefined),
      ]);
      if (eventDoc.exists()) {
        const data: any = { id: eventDoc.id, ...eventDoc.data() };
        primeEventPreview(data);
        const sameOrganizer = earlyProfile !== undefined && data.organizer_id === knownOrganizer;
        setEvent((prev: any) => normalizeEvent(data, sameOrganizer ? earlyProfile : null, prev?.users));
        setFresh(true);
        setLoading(false);
        if (!sameOrganizer && data.organizer_id) {
          const profile = await readProfile(data.organizer_id);
          if (profile) setEvent((prev: any) => (prev ? { ...prev, users: organizerFields(profile) } : prev));
        }
      } else {
        setEvent(null);
      }
    } catch (error) {
      console.error('Error fetching event:', error);
      // A preview on screen beats an error: only alert when there is nothing to show.
      if (!getEventPreview(eventId)) showAlert(t('common.error'), t('eventDetail.loadError'));
    } finally {
      setLoading(false);
    }
  };

  const checkFavoriteStatus = async () => {
    if (!user) return;
    
    try {
      const q = query(
        collection(db, 'event_favorites'),
        where('user_id', '==', user.uid),
        where('event_id', '==', eventId)
      );
      const snapshot = await getDocs(q);
      setIsFavorite(!snapshot.empty);
    } catch (error) {
      console.error('Error checking favorite status:', error);
    }
  };

  const toggleFavorite = async () => {
    // A guest signs in first; the heart is filled once they are back here.
    if (!requireAuth(user, navigation, { kind: 'favorite', key: eventId })) return;

    setFavoriteLoading(true);
    try {
      if (isFavorite) {
        // Remove from favorites
        const q = query(
          collection(db, 'event_favorites'),
          where('user_id', '==', user.uid),
          where('event_id', '==', eventId)
        );
        const snapshot = await getDocs(q);
        await Promise.all(
          snapshot.docs.map((d) => deleteDoc(doc(db, 'event_favorites', d.id)))
        );
        setIsFavorite(false);
        haptics.select();
      } else {
        // Add to favorites
        await addDoc(collection(db, 'event_favorites'), {
          user_id: user.uid,
          event_id: eventId,
          created_at: Timestamp.now()
        });
        setIsFavorite(true);
      }
    } catch (error) {
      console.error('Error toggling favorite:', error);
      showAlert(t('common.error'), t('eventDetail.favorites.updateError'));
    } finally {
      setFavoriteLoading(false);
    }
  };

  // The heart a guest tapped before signing in: saved once, never toggled off
  // (they may already have had this event saved on another device).
  const saveFavoriteAfterSignIn = async () => {
    if (!user) return;
    try {
      const existing = await getDocs(
        query(collection(db, 'event_favorites'), where('user_id', '==', user.uid), where('event_id', '==', eventId))
      );
      if (existing.empty) {
        await addDoc(collection(db, 'event_favorites'), {
          user_id: user.uid,
          event_id: eventId,
          created_at: Timestamp.now(),
        });
      }
      setIsFavorite(true);
      haptics.select();
    } catch (error) {
      console.warn('[EventDetail] save after sign-in failed', (error as any)?.code);
    }
  };

  const shareEventSheet = async () => {
    try {
      // Minimal on purpose (owner, 2026-11-17): the link's preview card is the
      // poster, so the message is just the name, the date and the link.
      const when = event.start_datetime ? formatEventTime(event.start_datetime, event, 'EEE, MMM d', language) : '';
      // iOS: the link travels as `url` so iMessage shows the poster preview
      // without the link printed twice (lib/share shareLink).
      await shareLink({
        title: event.title,
        text: [event.title, when].filter(Boolean).join(' · '),
        url: `https://www.tikem.co/events/${eventId}`,
      });
    } catch (error) {
      console.error('Error sharing:', error);
    }
  };


  const handleShare = () => {
    // Straight to the share sheet (owner, 2026-11-17: the "Share this event /
    // Invite friends to Tikèm" menu was two plain buttons in the way). The
    // event link's preview is the poster; the personal invite link lives in
    // the Invite friends sheet ("Share your invite link").
    shareEventSheet();
  };

  // "…" menu: report the event, block its organizer (App Store 1.2).
  const handleMore = () => {
    if (!requireAuth(user, navigation)) return;
    const organizerId: string = event?.organizer_id || '';
    const isOwn = !!organizerId && organizerId === user.uid;
    if (isOwn) {
      showAlert(t('moderation.moreTitle'), t('moderation.ownEvent'));
      return;
    }
    const organizerName =
      event?.users?.organization_name || event?.users?.full_name || event?.organizer_name || '';
    const blocked = !!organizerId && blockedOrganizers.has(organizerId);
    showAlert(t('moderation.moreTitle'), undefined, [
      {
        text: t('moderation.reportEvent'),
        onPress: () => setTimeout(() => setShowReport(true), AFTER_ALERT_MS),
      },
      ...(organizerId
        ? [
            {
              text: blocked ? t('moderation.unblock') : t('moderation.block'),
              style: 'destructive' as const,
              onPress: () =>
                setTimeout(
                  () =>
                    promptBlockToggle({
                      showAlert,
                      t,
                      organizerId,
                      organizerName,
                      currentlyBlocked: blocked,
                    }),
                  AFTER_ALERT_MS
                ),
            },
          ]
        : []),
      { text: t('common.cancel'), style: 'cancel' as const },
    ]);
  };

  const openInMaps = () => {
    const address = event.address || `${event.venue_name}, ${event.city}`;
    const encodedAddress = encodeURIComponent(address);
    
    showAlert(
      t('eventDetail.maps.title'),
      t('eventDetail.maps.body'),
      [
        {
          text: t('eventDetail.maps.apple'),
          onPress: () => Linking.openURL(`http://maps.apple.com/?q=${encodedAddress}`)
        },
        {
          text: t('eventDetail.maps.google'),
          onPress: () => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodedAddress}`)
        },
        { text: t('common.cancel'), style: 'cancel' }
      ]
    );
  };

  /**
   * Play the trailer WITHOUT leaving the app (owner ask).
   *
   * This used to be `Linking.openURL`, which hands the viewer to Safari or the
   * YouTube app — they watch, and then they are somewhere else, several taps
   * from the ticket they were about to buy. A recognised YouTube or Vimeo link
   * now opens in the app's own WebView screen with the player embedded, so
   * Back returns to the event.
   *
   * `Linking` stays as the fallback for a link we cannot embed: for an
   * unrecognised host, an external browser is better than a bare WebView with
   * no chrome pointed at an arbitrary page.
   */
  const openPromoVideo = async () => {
    const raw = (event as any)?.video_url;
    if (typeof raw !== 'string' || !raw.trim()) return;

    const embed = parseVideoEmbed(raw);
    if (embed) {
      navigation.navigate('InAppWebView', {
        url: embed.embedUrl,
        title: t('organizerCreateEventFlow.canvas.trailer'),
      });
      return;
    }

    const trimmed = raw.trim();
    // The URL is organizer-supplied. Only open web links — a bare domain gets
    // https:// prepended, but anything carrying another scheme (javascript:,
    // file:, a custom app/deep-link scheme, etc.) is rejected outright.
    const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
    const candidate = hasScheme ? trimmed : `https://${trimmed}`;
    if (!/^https?:\/\//i.test(candidate)) {
      console.warn('Blocked non-http(s) promo video URL');
      return;
    }
    try {
      await Linking.openURL(candidate);
    } catch (error) {
      console.error('Error opening promo video:', error);
    }
  };

  const navigateToOrganizerProfile = () => {
    if (event.organizer_id) {
      navigation.navigate('OrganizerProfile', { organizerId: event.organizer_id });
    }
  };

  const handlePurchaseTicket = async () => {
    // Shared by the community (lib/community): nothing is sold here. The CTA
    // links out to the organizer's own tickets when the share carried a link.
    if (isCommunityEvent(event)) {
      const url = communityTicketsUrl(event);
      if (url && !isPastEvent) Linking.openURL(url).catch(() => undefined);
      return;
    }
    // Tickets sold on Eventbrite (a synced event): no account needed here.
    if (outsideTicketsUrl && !isPastEvent) {
      Linking.openURL(outsideTicketsUrl).catch(() => undefined);
      return;
    }
    // A guest signs in (sheet over this page) and comes back to the ticket
    // sheet: see the resume effect below.
    if (!requireAuth(user, navigation, { kind: 'purchase', key: eventId })) return;

    // Prevent purchase for past events
    if (isPastEvent) {
      showAlert(t('eventDetail.purchase.pastTitle'), t('eventDetail.purchase.pastBody'));
      return;
    }

    // Drafts, rejected and cancelled events are not on sale. The CTA is already
    // disabled for them; this guards any other path into the purchase flow.
    if (notOnSale) {
      showAlert(
        isCancelled ? t('eventDetail.floating.eventCancelled') : t('eventDetail.floating.notOnSale'),
        isCancelled ? t('eventDetail.purchase.cancelledBody') : t('eventDetail.purchase.notOnSaleBody')
      );
      return;
    }

    // Password gate — a protected event with no access grant must be unlocked
    // (code verified server-side) before any purchase flow opens.
    if (event.is_password_protected && accessGranted !== true) {
      setAccessError('');
      setShowAccessGate(true);
      return;
    }

    // Approval list: the guest asks, the host issues. No direct claim.
    if (requiresApproval) {
      setShowRequestSheet(true);
      return;
    }

    // Free-ONLY event: nothing to choose, claim directly. Clear any tier picked
    // in an earlier flow so the server resolves the event's free tier itself and
    // the sheet owns the quantity (see lockedQuantity below).
    if (freeOnly && heldFreeTickets > 0) {
      // Already going: one free claim per event. Show their tickets instead.
      navigation.navigate('EventTickets', { eventId });
      return;
    }
    if (isFree) {
      setSelectedTierId(null);
      setSelectedTierName('');
      // Drop any promo left over from an earlier tier selection: an all-free event
      // has nothing to discount, and a stale code would be sent (and re-validated,
      // possibly redeemed) for a claim that never needed it.
      setPromoCode(undefined);
      setSelectedTierGrossPrice(0);
      setShowFreeTicketModal(true);
    } else {
      // Paid or mixed: the buyer must pick a tier.
      setShowTierSelector(true);
    }
  };

  const handleFreeTicketSuccess = () => {
    // The one moment the phone vibrates: the RSVP is confirmed (lib/haptics).
    haptics.success();
    // Refresh event data to show updated ticket count
    fetchEventDetails();
    // Close the claim modal FIRST. Two RN modals visible at once do not stack
    // reliably on iOS — the success sheet would simply never appear.
    setShowFreeTicketModal(false);
    // Confirm before moving them: jumping straight to the Tickets tab told the
    // attendee nothing about what they just got and skipped the follow /
    // calendar / share actions they most often want next.
    setSuccessQuantity(ticketQuantity || 1);
  };

  const handleTierSelection = (
    tierId: string,
    finalPrice: number,
    quantity: number,
    promo?: string,
    meta?: PurchaseSelectionMeta
  ) => {
    // Store tier selection
    setSelectedTierId(tierId);
    setSelectedTierPrice(finalPrice);
    setSelectedTierGrossPrice(meta?.grossPrice ?? finalPrice);
    setTicketQuantity(quantity);
    setPromoCode(promo);
    setSelectedTierName(meta?.tierName || '');
    setSelectedLines(meta?.lines || []);
    setSelectedPaidQuantity(meta?.paidQuantity);
    setSelectedAddOns(meta?.addOns || []);

    setShowTierSelector(false);

    // A zero total goes to the free-claim path, never to a gateway. Sending 0 to
    // MonCash/Stripe would either be rejected outright (Stripe enforces a minimum
    // charge) or leave a dangling pending transaction the buyer can't complete —
    // and the ticket would never be issued. This also covers a paid tier discounted
    // to 0 by a 100%-off promo: the code travels with the claim and the SERVER
    // re-validates it, refusing (with a checkout fallback) if it disagrees.
    if (meta?.isFree ?? finalPrice <= 0) {
      setShowFreeTicketModal(true);
      return;
    }

    setShowPaymentModal(true);
  };

  /**
   * The server refused a promo-zeroed free claim (code spent, expired, or only a
   * partial discount). Send the buyer to normal checkout at the UNDISCOUNTED price
   * — the payment initiators re-validate the same promo and will apply whatever
   * discount actually still holds.
   */
  const handleClaimCheckoutFallback = () => {
    setShowFreeTicketModal(false);
    setSelectedTierPrice(selectedTierGrossPrice);
    setShowPaymentModal(true);
  };

  const handlePaymentSuccess = async (_paymentMethod: string, _transactionId: string) => {
    // A ticket in hand: the one moment the phone vibrates (lib/haptics).
    haptics.success();
    // Was a bare OS alert, which is the least celebratory way to confirm a
    // purchase and offered nothing but "OK". Same sheet as the free path.
    fetchEventDetails();
    // Tell My Tickets a purchase just landed so it refetches (and keeps polling
    // for the webhook-issued ticket) instead of showing its cached list. The
    // MonCash path does the same in PaymentWebViewScreen.
    setTicketsRefreshHint({ reason: 'payment', createdAt: Date.now() }).catch(() => {});
    // Same reason as the free path: dismiss the payment modal before the sheet.
    setShowPaymentModal(false);
    setSuccessQuantity(ticketQuantity || 1);
  };

  const confirmCancelRequest = () => {
    showAlert(t('attendRequests.state.cancelTitle'), t('attendRequests.state.cancelBody'), [
      { text: t('attendRequests.state.keep'), style: 'cancel' },
      {
        text: t('attendRequests.state.cancel'),
        style: 'destructive',
        onPress: async () => {
          setCancellingRequest(true);
          try {
            await cancelAttendRequest(eventId);
            setAttendRequest(null);
          } catch (err: any) {
            setTimeout(
              () => showAlert(t('common.error'), t(`attendRequests.errors.${attendErrorKey(err?.code)}`)),
              AFTER_ALERT_MS
            );
            loadAttendRequest();
          } finally {
            setCancellingRequest(false);
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      // A plain View: the skeleton insets its own floating CTA by the bottom
      // safe area, as the loaded page does. A bottom-edge SafeAreaView here
      // counted it twice and lifted the placeholder ~34pt above the real pill.
      <View style={styles.container}>
        <EventDetailSkeleton />
        {/* The real back button, where the loaded page puts it: a slow fetch
            must never leave the placeholder with no way out. */}
        <View style={[styles.stickyHeader, { paddingTop: insets.top, height: insets.top + HEADER_BAR }]}>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => goBackOrHome(navigation)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
          >
            <ChevronLeft size={22} color="#FFF" />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!event) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.errorText}>{t('eventDetail.notFound')}</Text>
          <TouchableOpacity 
            style={styles.retryButton}
            onPress={fetchEventDetails}
          >
            <Text style={styles.retryButtonText}>{t('common.retry')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const remainingTickets = (event.total_tickets || 0) - (event.tickets_sold || 0);
  const isSoldOut = remainingTickets <= 0 && (event.total_tickets || 0) > 0;
  // Freeness is a property of the TIER SET, not of `event.ticket_price`.
  // `ticket_price` holds the LOWEST tier price, so an event offering a free tier
  // alongside a paid one has ticket_price === 0 — testing it sent every buyer
  // straight to the free-claim modal and hid the paid tier entirely.
  const pricing = resolveEventPricing(event);
  const eventTiers: any[] = Array.isArray((event as any).ticket_tiers) ? (event as any).ticket_tiers : [];
  // Pay at the door (lib/payAtDoor): tiers cost 0 online and carry what is owed
  // on arrival. Reserved through the tier picker ("Reserve a spot").
  const payAtDoor = isDoorEvent(event as any, eventTiers);
  const doorFrom = payAtDoor ? lowestDoorPrice(eventTiers) ?? (Number((event as any).door_price_from) || null) : null;
  // A free event with several ticket types (Adults, Children...) is picked in
  // the tier picker too; one free type keeps the quick RSVP sheet.
  const freeOnly = pricing.isFreeOnly && !payAtDoor;
  const freeTypes =
    freeOnly && eventTiers.filter((tier) => Number(tier?.price ?? 0) === 0 && !isDoorTier(tier) && tier?.is_active !== false).length > 1;
  // `isFree` now means "there is no paid way in", i.e. tier selection can be
  // skipped. A mixed event is NOT free: the buyer must choose a tier.
  // Paid add-ons (lib/addOns) on a free event are picked in the tier picker too.
  const sellsAddOns = eventAddOns(event as any).some((a) => a.is_active !== false);
  const isFree = freeOnly && !freeTypes && !sellsAddOns;
  // Family registration (lib/family): one person registers up to N people.
  const familySize = familyMax(event as any);
  // v1 approval lists are free-only; a paid event with a stray flag sells as usual.
  const requiresApproval = eventNeedsApproval && freeOnly;
  // Kept in sync from Eventbrite: tickets are sold there, so the CTA links out.
  const outsideTicketsUrl = externalTicketsUrl(event);
  // Shared by the community, not posted by its organizer (lib/community): no
  // sales on Tikèm, a credit with the source link, and "Claim it".
  const communityShared = isCommunityEvent(event);
  const communityTickets = communityTicketsUrl(event);
  const communitySource = communityShared ? isSafeHttpUrl((event as any).source_url) : null;
  const allowedPlusOnesHere = attendAllowedPlusOnes ?? eventAllowedPlusOnes(event);

  // Prevent purchase only after the event has ended (not after it has started).
  const purchaseCutoffDate = event.end_datetime || event.start_datetime;
  const isPastEvent = purchaseCutoffDate && new Date(purchaseCutoffDate) < new Date();
  // Same visibility test the server uses (drafts and rejected events are not
  // public), plus cancellation. Any of these means nothing can be bought here,
  // even if the screen was reached through a direct link.
  const isCancelled = ['cancelled', 'canceled'].includes(String(event.status || '').toLowerCase());
  const notOnSale = event.is_published === false || event.rejected === true || isCancelled;
  
  // Premium badge logic (matching PWA)
  // isVIP removed: it was computed here and never rendered.
  const isTrending = (event.tickets_sold || 0) > 10;
  const selloutSoon = !isSoldOut && remainingTickets > 0 && remainingTickets < 10;

  // Guarded dates — never hand an Invalid Date to date-fns `format` (it throws).
  const startValid = isValidDate(event.start_datetime) ? event.start_datetime : null;
  const endValid = isValidDate(event.end_datetime) ? event.end_datetime : null;
  // Price sub-label for the paid CTA. A mixed event reads "Free – 1,500 HTG"
  // rather than "from 0 HTG", which would imply everything is free. When the tier
  // set isn't visible on the doc (legacy events) `lowestPaidPrice` is null and we
  // show no amount at all instead of guessing one.
  // Every figure here is ALL-IN: in a buyer-pays market the service fee is added
  // at checkout, so quoting the face value on the CTA would advertise a price the
  // buyer is never charged. Haiti absorbs the fee, so the numbers are unchanged.
  const priceSubLabel = (() => {
    const currency = event.currency || 'HTG';
    if (pricing.kind === 'mixed') {
      return pricing.lowestPaidPrice != null
        ? `${t('common.free')} – ${formatPrice(
            advertisedPrice(pricing.lowestPaidPrice, event as any),
            currency
          )}`
        : undefined;
    }
    const from = pricing.lowestPaidPrice ?? Number(event.ticket_price || 0);
    if (!(from > 0)) return undefined;
    return `${t('common.from')} ${formatPrice(advertisedPrice(from, event as any), currency)}`;
  })();

  // Compact countdown prefix. `t()` echoes the key back when it is missing from
  // the dictionaries, so fall back to English until `eventDetail.startsIn` lands.
  const startsInLabel =
    t(STARTS_IN_KEY) === STARTS_IN_KEY ? 'Starts in' : t(STARTS_IN_KEY);

 // The header's backdrop and title fade in over the last stretch before the
  // poster's bottom edge passes under the bar.
  const posterBottom = insets.top + HEADER_BAR + POSTER_H;
  const fadeEnd = Math.max(1, posterBottom - (insets.top + HEADER_BAR));
  const headerBgOpacity = scrollY.interpolate({
    inputRange: [fadeEnd - 160, fadeEnd],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const headerTitleOpacity = scrollY.interpolate({
    inputRange: [fadeEnd - 20, fadeEnd + 40],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Animated.ScrollView
        style={styles.scrollView} 
        showsVerticalScrollIndicator={false}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true }
        )}
        scrollEventThrottle={16}
      >
        {/* Hero — same poster blurred as backdrop, sharp poster centered */}
        <View style={[styles.heroContainer, { paddingTop: insets.top + HEADER_BAR }]}>
          {/* The teal theme gradient is the art for an event with NO poster.
              Behind a loading poster it flashed teal before the image painted;
              with one, the neutral surface (and the poster's shimmer) shows. */}
          {!(event.banner_image_url || event.cover_image_url) && (
            <LinearGradient
              colors={resolvePosterTheme(event, event.id || event.title, event.category).colors}
              start={{ x: 0.1, y: 0 }}
              end={{ x: 0.9, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
          )}
          {(event.banner_image_url || event.cover_image_url) && (
            <ExpoImage
              accessible={false}
              source={{ uri: event.banner_image_url || event.cover_image_url }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              blurRadius={28}
              cachePolicy="memory-disk"
              recyclingKey={event.id ? String(event.id) : undefined}
            />
          )}
          <View style={styles.heroBackdropScrim} />

          {/* Bottom blend into the page and top scrim for the buttons. Drawn
              BEHIND the poster: on top, the 140px blend covered the poster's
              lower 88px and the scrim its top, dimming the date and venue a
              designed flyer prints there. The buttons carry their own scrim
              circles, so they stay legible over the art. */}
          <LinearGradient
            colors={['transparent', colors.background]}
            style={styles.heroBottomBlend}
          />
          <LinearGradient
            colors={['rgba(0,0,0,0.45)', 'transparent']}
            style={styles.heroTopScrim}
          />

          {/* Centered sharp poster — expo-image so it reuses the memory-disk
              cache the Discover/Home card already filled, showing instantly. */}
          <View style={styles.heroPoster}>
            {!(event.banner_image_url || event.cover_image_url) && (
              <LinearGradient
                colors={resolvePosterTheme(event, event.id || event.title, event.category).colors}
                start={{ x: 0.1, y: 0 }}
                end={{ x: 0.9, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
            )}
            {(event.banner_image_url || event.cover_image_url) && (
              <PosterImage
                uri={(event.banner_image_url || event.cover_image_url)!}
                frameRatio={4 / 5}
                transition={120}
                recyclingKey={event.id ? String(event.id) : undefined}
                accessibilityLabel={posterAlt(event as any)}
              />
            )}
          </View>


        </View>

        <View style={styles.content}>
          {/* Title block — text-first, under the poster */}
          <Text style={styles.title} accessibilityRole="header">{event.title}</Text>
          {familySize > 0 && (
            <Text style={styles.familyText}>{t('eventDetail.familyBadge', { count: familySize })}</Text>
          )}
          {/* The occasion it is tagged for (Kanaval, Fèt Manman…), linking to its page. */}
          <OccasionLink occasion={(event as any).occasion} onPress={(key) => navigation.navigate('Occasion', { key })} />

          {/* Date, then where, at the same size (owner, 2026-11-18, from a
              Stitch reference: "the date is above, the location immediately
              below but similar sizing"). Tapping the place opens Maps. */}
          <View style={styles.factList}>
            <Text style={styles.whenText}>
              {startValid && formatEventTime(startValid, event, 'EEE, MMM d', language)}
              {startValid && ` · ${formatEventTime(startValid, event, 'h:mm a', language)}`}
              {endValid && ` – ${formatEventTime(endValid, event, 'h:mm a', language)}`}
            </Text>

            {/* An online event has no venue to map: say so, and don't offer a
                Maps hand-off for an empty address. */}
            {(event as any).is_online && !event.venue_name && !event.address ? (
              <View style={styles.venueLine}>
                <Globe size={14} color={colors.textSecondary} />
                <Text style={styles.venueText} numberOfLines={1}>
                  {t('eventDetail.onlineEvent')}
                </Text>
              </View>
            ) : (
              <TouchableOpacity onPress={openInMaps} activeOpacity={0.6} style={styles.venueLine}>
                <Text style={styles.venueText} numberOfLines={1}>
                  {[
                    event.venue_name || event.address || event.city,
                    (() => {
                      // The neighbourhood people say ("Pétion-Ville"), else the city.
                      const area = (event as any).commune || event.city;
                      return event.venue_name && area && !String(event.venue_name).includes(String(area)) ? area : '';
                    })(),
                    venueDistance,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
                <ExternalLink size={13} color={colors.textTertiary} />
              </TouchableOpacity>
            )}
          </View>

          {/* Who's going sits right under the facts, so nobody scrolls to the
              foot of the page to see it (owner, 2026-11-18). Faces, a count,
              or nothing, per the organizer's guest-list setting. */}
          <WhosGoing
            eventId={eventId}
            visibility={guestlistVisibilityFrom(event as any)}
            capacity={event.total_tickets}
            alwaysCount={(event as any).show_going_count === true}
          />

          {/* Organizer row, posh order: event name first, then when/where, then
              who is throwing it — with Follow (and Contact) right on the row.
              Owner feedback 2026-11-15 replaced the byline above the title and
              the duplicate "hosted by" card at the foot of the page. */}
          <View style={styles.orgBlock}>
            {/* Identity and Follow share ONE line, posh-style (owner,
                2026-11-17: "following should be on the line"). The name side
                opens the organizer's profile; Follow sits at the line's end. */}
            <View style={styles.orgLine}>
              <TouchableOpacity
                style={styles.orgRowMain}
                onPress={navigateToOrganizerProfile}
                activeOpacity={0.7}
                accessibilityRole="button"
              >
                <View style={styles.hostedByAvatar}>
                  {event.users?.organization_logo ? (
                    <ExpoImage
                      source={{ uri: event.users.organization_logo }}
                      style={styles.hostedByAvatarImage}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                    />
                  ) : (
                    <OrgMark size={44} color={colors.text} />
                  )}
                </View>
                <Text style={styles.orgRowName} numberOfLines={1}>
                  {event.users?.organization_name || event.users?.full_name || event.organizer_name || t('eventDetail.organizerFallback')}
                </Text>
                {(event.users?.is_verified || event.is_verified) && (
                  <VerifiedBadge size="small" label={t('eventDetail.verified')} />
                )}
              </TouchableOpacity>
              {/* Message is a quiet icon at the end of the line, beside Follow
                  (owner, 2026-11-17: the full-width "Message the organizer"
                  button was "too prominent ... maybe just an icon"). Hidden on
                  the organizer's own event and when signed out. */}
              {!!event.organizer_id && event.organizer_id !== user?.uid && !communityShared && (
                <TouchableOpacity
                  style={styles.orgMessageIcon}
                  onPress={() => {
                    // A guest signs in first, then the message sheet opens.
                    if (!requireAuth(user, navigation, { kind: 'message', key: eventId })) return;
                    setShowContactOrganizer(true);
                  }}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityLabel={t('contactOrganizer.open')}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <MessageCircle size={18} color={colors.text} />
                </TouchableOpacity>
              )}
              {!!event.organizer_id && event.organizer_id !== user?.uid && (
                <FollowButton organizerId={event.organizer_id} style={styles.orgFollow} />
              )}
            </View>
            {communityShared ? (
              <View style={styles.communityCredit}>
                <Text style={styles.communityCreditText}>
                  {(event as any).source_name
                    ? t('community.event.sharedFrom', { name: String((event as any).source_name) })
                    : t('community.event.shared')}
                </Text>
                <View style={styles.communityLinks}>
                  {communitySource ? (
                    <TouchableOpacity
                      onPress={() => Linking.openURL(communitySource).catch(() => undefined)}
                      accessibilityRole="link"
                      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                    >
                      <Text style={styles.communityLink}>{t('community.event.seeOriginal')}</Text>
                    </TouchableOpacity>
                  ) : null}
                  {(event as any).claimable === true ? (
                    <TouchableOpacity
                      onPress={() => navigation.navigate('ClaimEvent', { eventId, eventTitle: event.title })}
                      accessibilityRole="button"
                      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                    >
                      <Text style={styles.communityLink}>{t('community.event.claim')}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            ) : null}
          </View>

          {/* Waitlist (Add to Calendar moved to the header as an icon). Only
              when the organizer turned the waitlist on: the server refuses to
              join anything else. */}
          {isSoldOut && (event as any).enable_waitlist === true && (
            <View style={styles.quickActionsRow}>
              <JoinWaitlistButton
                eventId={eventId}
                eventTitle={event.title}
                isSoldOut={isSoldOut}
                style={styles.quickActionButton}
              />
            </View>
          )}

          {/* About: only when there is something to say (a blank or
              whitespace-only description left an empty, tall section). */}
          {!!String(event.description || '').trim() && (
            <View style={styles.section}>
              <SectionHeader title={t('eventDetail.sections.about')} />
              <RichText text={String(event.description)} style={styles.description} />
            </View>
          )}

          {/* Good to know: access, setting, age, dress code (organizer-ticked). */}
          <VenueDetailsLines event={event} style={styles.section} />

          {/* Trailer: plays muted on the page when it is a YouTube/Vimeo link
              (TrailerCard); any other link keeps the plain row below. */}
          <TrailerCard url={(event as any).video_url} title={t('organizerCreateEventFlow.canvas.trailer')} />
          {typeof (event as any).video_url === 'string' && (event as any).video_url.trim() !== '' && !parseVideoEmbed((event as any).video_url) && (
            <TouchableOpacity
              style={styles.promoVideoRow}
              onPress={openPromoVideo}
              activeOpacity={0.7}
            >
              <PlayCircle size={20} color={colors.primary} />
              <Text style={styles.promoVideoText}>{t('organizerCreateEventFlow.canvas.trailer')}</Text>
              {/* The external-link glyph only when the tap ACTUALLY leaves the
                  app. A recognised YouTube/Vimeo link now plays in-app, and
                  promising an exit it does not make is worse than no icon. */}
              {!parseVideoEmbed((event as any).video_url) && (
                <ExternalLink size={15} color={colors.textSecondary} />
              )}
            </TouchableOpacity>
          )}

          {/* Lineup — who is on the bill (event doc `guestlist`, same records
              the web renders). Renders nothing when there is no lineup. */}
          <EventLineupRail guestlist={(event as any).guestlist} gutter={18} twelveHour={isHaitiEvent(event as any)} />

          {/* The song — a track card that opens Spotify. Nothing when unset. */}
          <SpotifyTrackCard url={(event as any).spotify_url} />

          {/* Venue map — foot of the page, directly above the organizer
              (tester ask): by the time you want the map you have decided to go;
              up top it pushed the description below the fold. An online event
              has no venue, so no map. */}
          {!((event as any).is_online && !event.venue_name && !event.address) && (
            <VenueStaticMap
              event={event}
              onPress={openInMaps}
              accessibilityLabel={t('eventDetail.maps.title')}
              style={styles.venueMap}
            />
          )}

          {/* Your own connections going (config/auth.friend_suggestions). Renders
              nothing when the flag is off, signed out, or no friend is going. */}
          <FriendsGoingRow eventId={eventId} />

          {/* Invite your connections (config/auth.invites). Nothing when off,
              signed out, or the event is not on sale. */}
          <InviteFriendsRow
            eventId={eventId}
            invitable={!isPastEvent && !notOnSale}
            event={{
              title: event.title,
              details: [
                startValid ? formatEventTime(startValid, event, 'EEE, MMM d', language) : '',
                (event as any).is_online && !event.venue_name ? '' : event.venue_name || event.city || '',
              ]
                .filter(Boolean)
                .join(' · '),
            }}
          />

          {/* Bottom padding so the floating CTA never overlaps page content */}
          <View style={{ height: 160 }} />
        </View>
      </Animated.ScrollView>

      {/* Sticky header. The buttons never scroll away (they used to ride off
          with the poster, leaving no way back), and once the poster has
          scrolled under the bar a blurred canvas fades in behind them with
          the event name, so content never slides under the status bar. */}
      <View style={[styles.stickyHeader, { paddingTop: insets.top, height: insets.top + HEADER_BAR }]}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: headerBgOpacity }]}>
          <ChromeBlur edge="top" tintOpacity={0.7} scrimExtra={24} />
        </Animated.View>
        <TouchableOpacity
          style={styles.iconButton}
          onPress={() => goBackOrHome(navigation)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <ChevronLeft size={22} color="#FFF" />
        </TouchableOpacity>
        <Animated.Text
          style={[styles.stickyTitle, { opacity: headerTitleOpacity }]}
          numberOfLines={1}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          {event.title}
        </Animated.Text>
        <View style={styles.headerActions}>
          <AddToCalendarButton
            event={{
              id: eventId,
              title: event.title,
              description: event.description,
              start_datetime: event.start_datetime,
              end_datetime: event.end_datetime,
              venue_name: event.venue_name,
              address: event.address,
              city: event.city,
            }}
            renderTrigger={(open) => (
              <TouchableOpacity
                style={styles.iconButton}
                onPress={open}
                hitSlop={4}
                accessibilityRole="button"
                accessibilityLabel={t('calendar.addToCalendar')}
              >
                <CalendarPlus size={19} color="#FFF" />
              </TouchableOpacity>
            )}
          />
          <TouchableOpacity
            style={styles.iconButton}
            onPress={handleShare}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={t('common.share')}
          >
            <Share2 size={19} color="#FFF" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={handleMore}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={t('moderation.moreTitle')}
          >
            <MoreHorizontal size={19} color="#FFF" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={toggleFavorite}
            disabled={favoriteLoading}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={t('a11y.save')}
            accessibilityState={{ selected: isFavorite }}
          >
            <Heart size={19} color="#FFF" fill={isFavorite ? '#FFF' : 'transparent'} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Floating Bottom CTA Pill Card. Untappable until the fresh event
          document has landed: a list preview never drives a purchase. */}
      <Animated.View
        pointerEvents={fresh ? 'auto' : 'none'}
        style={[
          styles.floatingBottomCard,
          {
            bottom: insets.bottom + 8,
            opacity: floatingBarAnim,
            transform: [{
              translateY: floatingBarAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [16, 0],
              }),
            }],
          }
        ]}
      >
        {/* Fades the page out beneath the CTA. Without it the About copy ran
            right up to the pill's edges and reappeared underneath it, so the
            button read as pasted on top of the text rather than sitting on a
            footer. Same scrim language as the tab bar. */}
        <LinearGradient
          colors={[withAlpha(colors.background, 0), withAlpha(colors.background, 0.85), colors.background]}
          locations={[0, 0.55, 1]}
          style={styles.floatingCtaScrim}
          pointerEvents="none"
        />
        {isPastEvent ? (
          <View style={[styles.ctaDisabled, styles.floatingCtaPill]}>
            <Text style={styles.ctaDisabledText}>{t('eventDetail.floating.eventEnded')}</Text>
          </View>
        ) : notOnSale ? (
          <View style={[styles.ctaDisabled, styles.floatingCtaPill]}>
            <Text style={styles.ctaDisabledText}>
              {isCancelled ? t('eventDetail.floating.eventCancelled') : t('eventDetail.floating.notOnSale')}
            </Text>
          </View>
        ) : communityShared ? (
          communityTickets ? (
            <WhitePillCTA
              label={t('community.event.ticketsOnSite')}
              onPress={() => Linking.openURL(communityTickets).catch(() => undefined)}
              style={styles.floatingCtaPill}
            />
          ) : (
            <View style={[styles.ctaDisabled, styles.floatingCtaPill]}>
              <Text style={styles.ctaDisabledText}>{t('community.event.notSoldHere')}</Text>
            </View>
          )
        ) : freeOnly && !requiresApproval && heldFreeTickets > 0 ? (
          // Already holds this free-only event's claim: no claim sheet to open.
          // Dot + label status (never a pill badge) and one way to the tickets.
          <View style={styles.goingRow}>
            <View style={styles.goingText}>
              <RequestStatusDot tone="approved" label={t('freeTicket.alreadyTitle')} />
              <Text style={styles.goingCount} numberOfLines={1}>
                {heldFreeTickets}{' '}
                {(heldFreeTickets === 1 ? t('freeTicket.ticketWord.one') : t('freeTicket.ticketWord.other')).toLowerCase()}
              </Text>
            </View>
            <WhitePillCTA
              compact
              label={t('freeTicket.viewTickets')}
              onPress={() => navigation.navigate('EventTickets', { eventId })}
              style={styles.goingButton}
            />
          </View>
        ) : isSoldOut ? (
          <View style={[styles.ctaDisabled, styles.floatingCtaPill]}>
            <Text style={styles.ctaDisabledText}>{t('badges.soldout')}</Text>
          </View>
        ) : requiresApproval && attendRequest ? (
          // Request states (Stitch 3d94ae23570d41ccb95b15d7888e9f86): a filled
          // card with a dot + label status, never a pill badge.
          <View style={styles.requestCard}>
            <RequestStatusDot
              tone={requestTone(attendRequest.status)}
              label={
                attendRequest.status === 'approved'
                  ? t('attendRequests.state.approved')
                  : attendRequest.status === 'declined'
                    ? t('attendRequests.state.declined')
                    : t('attendRequests.state.pending')
              }
            />
            <Text style={styles.requestCardBody}>
              {attendRequest.status === 'approved'
                ? attendRequest.quantity > 1
                  ? t('attendRequests.state.approvedBody', { count: attendRequest.quantity })
                  : t('attendRequests.state.approvedBodyOne')
                : attendRequest.status === 'declined'
                  ? t('attendRequests.state.declinedBody')
                  : attendRequest.quantity > 1
                    ? t('attendRequests.state.pendingBodyPlus', { count: attendRequest.quantity - 1 })
                    : t('attendRequests.state.pendingBody')}
            </Text>
            {attendRequest.status === 'approved' ? (
              <WhitePillCTA
                label={t('attendRequests.state.viewTickets')}
                onPress={() => navigation.navigate('EventTickets', { eventId })}
                style={styles.floatingCtaPill}
              />
            ) : attendRequest.status !== 'declined' ? (
              <TouchableOpacity
                style={[styles.ctaDisabled, styles.floatingCtaPill, cancellingRequest && { opacity: 0.5 }]}
                onPress={confirmCancelRequest}
                disabled={cancellingRequest}
                accessibilityRole="button"
              >
                {cancellingRequest ? (
                  <ActivityIndicator color={colors.text} />
                ) : (
                  <Text style={styles.requestCancelText}>{t('attendRequests.state.cancel')}</Text>
                )}
              </TouchableOpacity>
            ) : null}
          </View>
        ) : (
          // Adaptive white-pill primary action (POSH §2.2): free → RSVP,
          // paid → Get Tickets with a muted price sub-label.
          <WhitePillCTA
            variant={freeOnly || payAtDoor ? 'rsvp' : 'paid'}
            label={
              outsideTicketsUrl
                ? t('eventDetail.floating.ticketsOnEventbrite')
                : requiresApproval
                ? t('attendRequests.requestToJoin')
                : payAtDoor
                  ? t('eventDetail.floating.reserveSpot')
                  : freeOnly
                  ? t('common.rsvp')
                  : t('eventDetail.floating.getTickets')
            }
            subLabel={
              payAtDoor
                ? doorFrom
                  ? doorPriceLabel(doorFrom, event.currency || 'HTG', language)
                  : undefined
                : freeOnly
                  ? undefined
                  : priceSubLabel
            }
            onPress={handlePurchaseTicket}
            loading={purchasing}
            style={styles.floatingCtaPill}
          />
        )}
      </Animated.View>

      {/* Tiered Ticket Selector */}
      <TieredTicketSelector
        visible={showTierSelector}
        onClose={() => setShowTierSelector(false)}
        eventId={eventId}
        onPurchase={handleTierSelection}
        currency={event?.currency || 'HTG'}
        // Decides whether the service fee is added to the total the buyer reads.
        country={event?.country}
        feeIncidence={(event as any)?.fee_incidence ?? (event as any)?.feeIncidence}
        freeClaimHeld={heldFreeTickets > 0}
        freeCap={freeClaimCapFor(event as any)}
        addOns={(event as any)?.add_ons}
        addOnsSold={(event as any)?.add_ons_sold}
      />

      <PurchaseSuccessSheet
        visible={successQuantity !== null}
        onClose={() => {
          setSuccessQuantity(null);
          // After the confirmation, never on top of it (two RN modals do not
          // stack on iOS). The host applies the 7-day / 3-times policy.
          requestPhonePrompt({ trigger: 'post_purchase' });
        }}
        onViewTickets={() => {
          setSuccessQuantity(null);
          openAttendeeTab('Tickets');
          requestPhonePrompt({ trigger: 'post_purchase' });
        }}
        event={event}
        quantity={successQuantity ?? 1}
      />

      <ReportContentModal
        visible={showReport}
        onClose={() => setShowReport(false)}
        kind="event"
        targetId={eventId}
      />

      <ContactOrganizerModal
        visible={showContactOrganizer}
        onClose={() => setShowContactOrganizer(false)}
        eventId={eventId}
        eventTitle={event?.title}
      />

      {/* Request to join (approval lists) */}
      <AttendRequestSheet
        visible={showRequestSheet}
        onClose={() => setShowRequestSheet(false)}
        eventId={eventId}
        allowedPlusOnes={allowedPlusOnesHere}
        family={familySize > 0}
        onSent={(request) => {
          // Close the sheet FIRST: two RN modals do not stack on iOS.
          setShowRequestSheet(false);
          setAttendRequest(request);
          setTimeout(
            () => showAlert(t('attendRequests.state.sentTitle'), t('attendRequests.state.sentBody')),
            AFTER_ALERT_MS
          );
        }}
      />

      {/* Free Ticket Modal */}
      <FreeTicketModal
        visible={showFreeTicketModal}
        onClose={() => {
          setShowFreeTicketModal(false);
          // A claim may just have landed: flip the CTA to "You're going".
          loadHeldFreeTickets();
        }}
        eventId={eventId}
        eventTitle={event?.title || ''}
        userId={user?.uid || ''}
        userEmail={userProfile?.email || user?.email || ''}
        userName={userProfile?.full_name || t('common.guest')}
        event={event}
        tierId={selectedTierId || undefined}
        tierName={selectedTierName || undefined}
        // `selectedTierId` is only ever set by the tier selector, where the buyer
        // already chose a quantity — don't ask a second time in that case.
        lockedQuantity={selectedTierId ? ticketQuantity : undefined}
        // Only meaningful with an explicit tier — the server refuses a promo it
        // would have to guess a tier for.
        promoCode={selectedTierId ? promoCode : undefined}
        // Unlike promoCode this is never tier-gated: a free RSVP still credits
        // the promoter (with zero commission).
        refCode={refCode}
        attribution={attribution}
        // Named plus-ones on a free event that allows them (claim-free `plusOnes`).
        allowedPlusOnes={selectedTierId ? 0 : allowedPlusOnesHere}
        onCheckoutFallback={selectedTierId ? handleClaimCheckoutFallback : undefined}
        onSuccess={handleFreeTicketSuccess}
        onViewTickets={() => navigation.navigate('EventTickets', { eventId })}
        onAlreadyClaimed={(count) => setHeldFreeTickets(count)}
      />

      {/* Password gate — code prompt shown when a protected event has no grant */}
      <Modal
        visible={showAccessGate}
        transparent
        animationType="fade"
        onRequestClose={() => !unlocking && setShowAccessGate(false)}
      >
        <View style={styles.accessBackdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => !unlocking && setShowAccessGate(false)}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
          />
          <View style={styles.accessCard}>
            <TouchableOpacity
              style={styles.accessClose}
              onPress={() => setShowAccessGate(false)}
              disabled={unlocking}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
            >
              <X size={18} color={colors.textSecondary} />
            </TouchableOpacity>
            <View style={styles.accessTitleRow}>
              <Lock size={16} color={colors.text} />
              <Text style={styles.accessTitle}>{t('eventAccess.locked')}</Text>
            </View>
            <TextInput
              style={styles.accessInput}
              placeholder={t('eventAccess.enterCode')}
              placeholderTextColor={colors.textSecondary}
              value={accessCodeInput}
              onChangeText={(text) => {
                setAccessCodeInput(text);
                if (accessError) setAccessError('');
              }}
              autoCapitalize="none"
              autoCorrect={false}
              selectionColor={colors.primary}
              editable={!unlocking}
              onSubmitEditing={handleUnlock}
              returnKeyType="go"
            />
            {!!accessError && <Text style={styles.accessError}>{accessError}</Text>}
            <TouchableOpacity
              style={[styles.accessButton, (unlocking || !accessCodeInput.trim()) && styles.accessButtonDisabled]}
              onPress={handleUnlock}
              disabled={unlocking || !accessCodeInput.trim()}
              activeOpacity={0.8}
            >
              {unlocking ? (
                <ActivityIndicator size="small" color={T.onWhite} />
              ) : (
                <Text style={styles.accessButtonText}>{t('eventAccess.unlock')}</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.accessCancel}
              onPress={() => setShowAccessGate(false)}
              disabled={unlocking}
              accessibilityRole="button"
            >
              <Text style={styles.accessCancelText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Payment Modal */}
      <PaymentModal
        visible={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        eventId={eventId}
        eventTitle={event?.title || ''}
        userId={user?.uid || ''}
        quantity={ticketQuantity}
        totalAmount={selectedTierPrice || event?.ticket_price || 0}
        currency={event?.currency || 'HTG'}
        country={event?.country || ''}
        // The organizer's absorb/pass-on choice. Without it the fee line fell
        // back to the country default and could disagree with the selector and
        // with what the server charges (it reads the same field).
        feeIncidence={(event as any)?.fee_incidence ?? (event as any)?.feeIncidence}
        tierId={selectedTierId || undefined}
        tiers={selectedLines.length > 1 ? selectedLines : undefined}
        feeQuantity={selectedPaidQuantity}
        addOns={selectedAddOns}
        promoCodeId={promoCode}
        refCode={refCode}
        attribution={attribution}
        onSuccess={handlePaymentSuccess}
      />
    </SafeAreaView>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  // Family registration line under the title (lib/family).
  familyText: { marginTop: 6, fontSize: 13, color: colors.textSecondary },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: radius.button,
  },
  retryButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },

  // Hero Section with Overlay
  heroContainer: {
    position: 'relative',
    width: width,
    paddingBottom: HERO_BLEED,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
  },
  // 0.35, not 0.55. The backdrop is the SAME poster blurred, and the point of
  // it is the artwork's colour bleeding into the page — posh's defining hero
  // quality. At 0.55 the bleed was crushed to near-grey, so the poster sat on
  // flat black instead of melting into it. The sharp poster on top carries its
  // own shadow, so legibility does not depend on this layer.
  heroBackdropScrim: {
    ...StyleSheet.absoluteFillObject,
    // Darker than when the poster floated inset (0.35): the backdrop now only
    // shows in the header band and the bleed below, where it must read as a
    // dark glow behind the white buttons, not as competing art.
    backgroundColor: 'rgba(10,10,10,0.5)',
  },
  heroPoster: {
    width: POSTER_W,
    aspectRatio: 4 / 5,
    borderRadius: radius.poster,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 12,
  },
  heroBottomBlend: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 140,
  },
  heroTopScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 130,
  },
  
  // Sticky header: back on the left, actions on the right, the event name
  // fading in between once the poster has scrolled away.
  stickyHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
    zIndex: 20,
  },
  stickyTitle: {
    flex: 1,
    // Same serif as the page title (owner: event names stay serif).
    fontFamily: font.serif,
    fontSize: 19,
    color: colors.text,
    textAlign: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    gap: 6,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  

  // Content Area — text-first
  content: {
    paddingHorizontal: 18,
    paddingTop: 9,
  },
  title: {
    fontFamily: font.serif,
    fontSize: 34,
    color: colors.text,
    lineHeight: 38,
    letterSpacing: 0,
  },
  hostBylineTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
    marginBottom: 12,
  },
  hostBylineTopName: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  // Section spacing now that the organizer lives at the foot of the page,
  // not tucked under the poster as a byline.
  hostByline: {
    marginTop: 32,
    marginBottom: 8,
  },
  factList: {
    marginTop: 12,
    marginBottom: 4,
  },
  // Venue: the louder of the two lines — it is what someone scans for. Row
  // rather than plain text so the ⧉ affordance sits with it.
  venueLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  venueText: {
    flexShrink: 1,
    fontSize: 15,
    color: colors.textSecondary,
    lineHeight: 21,
  },
  // Date + time range on ONE grey line beneath it, matching how posh states
  // "Sat, Aug 22 at 4:00 PM - 9:00 PM".
  // Same voice as the place line under it (owner, 2026-11-18).
  whenText: {
    fontSize: 15,
    color: colors.textSecondary,
    lineHeight: 21,
    marginBottom: 2,
  },
  // 10, not 14: two rows of 14 plus a divider spent ~64pt stating a date and a
  // venue, which is the "all this space wasted" a tester marked up twice. Posh
  // gives the same two facts roughly half that.
  // Compact countdown line inside the date row (see CountdownTimer).
  factCountdown: {
    marginTop: 2,
  },
  // Static venue map, tucked under the location row. Indented to the row's text
  // column so it reads as part of that row, not as a new section.
  venueMap: {
    // Full content width, NOT indented to clear the pin icon. Hanging the map
    // off the text column made it read as a thumbnail attached to the address
    // line; posh gives the location its own full-width block, which is the
    // comparison a tester drew. The address above stays indented — only the
    // map breaks out.
    marginLeft: 0,
    // Breathing room from the About text above, now that the map closes the
    // page instead of sitting inside the fact list.
    marginTop: 20,
    marginBottom: 4,
  },

  

  // Sections
  section: {
    paddingVertical: 22,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderLight,
  },
  // Section headings go through components/SectionHeader (the house rail:
  // Instrument Serif 22, lowercased), so About, Hosted by and Who's going all
  // read in one voice. A hand-rolled heading here drifted to 26pt.
  description: {
    fontSize: 15,
    color: colors.text,
    lineHeight: 23,
  },

  // Promo video row
  promoVideoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderLight,
  },
  promoVideoText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },


  // Hosted By Section
  hostedByCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  // 28, not 48. Posh states the host as a byline — a small mark and a name —
  // rather than a profile card. At 48 with a solid teal fill it was the
  // loudest thing on a poster-led page and competed with the title beneath it.
  hostedByAvatar: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  hostedByAvatarText: {
    // Scaled for the 28pt mark, and on the canvas token rather than a literal
    // white — the fill behind it is no longer teal.
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  hostedByAvatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: radius.md,
  },
  hostedByInfo: {
    flex: 1,
  },
  hostedByName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 2,
  },
  // Who's throwing it: one tappable identity row, then Follow / Message.
  // Top hairline only: the next section draws its own top line, so a bottom
  // border here doubled it (owner: "one extra line").
  orgBlock: {
    paddingTop: 16,
    paddingBottom: 18,
    gap: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  orgLine: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  // Community credit under the host line: quiet meta, two text links.
  communityCredit: { gap: 6 },
  communityCreditText: { fontSize: 13, lineHeight: 18, color: colors.textSecondary },
  communityLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  communityLink: { fontSize: 13, fontWeight: '600', color: colors.text, textDecorationLine: 'underline' },
  // Follow at the end of the identity line: its own white / "Following"
  // fills (FollowButton), sized to sit level with the 44pt avatar.
  orgFollow: { height: 36, minWidth: 96, paddingHorizontal: 16 },
  orgMessageIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    backgroundColor: colors.surfaceRaised,
  },
  orgRowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  orgRowName: {
    flexShrink: 1,
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },

  verifiedBadgeInline: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
  },
  // Quiet uppercase label, teal because teal here CARRIES MEANING (verified).
  // No backgroundColor / borderWidth — deliberately not a pill.
  verifiedTextInline: {
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.primary,
  },
  hostedByMain: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },

  quickActionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  quickActionButton: {
    flex: 1,
  },



  // A filled row, not an outline: depth by fill (POSH ladder), never a
  // hairline box. Still quieter than the white Get Tickets pill.
  contactOrganizerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius.button,
    backgroundColor: colors.surface,
  },
  contactOrganizerIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactOrganizerText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },

  // Floating Bottom CTA — a transparent bar carrying the full-width primary
  // pill. It stretches edge-to-edge (inside a 20pt gutter) rather than hugging
  // its label; page content clears it via the 160pt spacer at the list foot.
  floatingBottomCard: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    // `stretch`, not `center`: centering makes the pill shrink-wrap its label,
    // so "Get Tickets" rendered as a narrow island floating over the page. The
    // primary action should span the bar the way it does on posh.
    alignItems: 'stretch',
    backgroundColor: 'transparent',
  },
  floatingCtaPill: {
    width: '100%',
    // 50, not the 56 system height: a tester asked for 10% off THIS pill —
    // floating over content it read heavier than the same button in flow.
    height: 50,
  },
  // Extends well above the pill so the fade starts before the text reaches it,
  // and past the bar's own bottom so nothing peeks out under the home indicator.
  floatingCtaScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: -56,
    bottom: -40,
  },
  ctaDisabled: {
    backgroundColor: colors.surfaceRaised,
    // Matches the live CTA's pill geometry so "Sold out" / "Event ended" sit
    // in exactly the same footprint the button occupied.
    borderRadius: radius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaDisabledText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '700',
  },
  // Request state card: a fill, not a hairline (fill-not-hairline rule).
  goingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingVertical: 10,
    paddingLeft: 16,
    paddingRight: 10,
  },
  goingText: {
    flex: 1,
    gap: 4,
  },
  goingCount: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  goingButton: {
    paddingHorizontal: 18,
  },
  requestCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 16,
    gap: 10,
  },
  requestCardBody: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  requestCancelText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  

  // ── Password gate modal ──
  accessBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  accessCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 22,
    gap: 14,
  },
  accessClose: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 1,
    padding: 4,
  },
  accessTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 24,
  },
  accessTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  // A filled field (canvas on the surface card), no hairline box.
  accessInput: {
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.background,
  },
  accessError: {
    fontSize: 13,
    color: colors.error,
    fontWeight: '500',
    textAlign: 'center',
  },
  // The white pill: the one primary CTA (teal is not a button colour).
  accessButton: {
    backgroundColor: T.white,
    borderRadius: radius.button,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accessButtonDisabled: {
    opacity: 0.5,
  },
  accessButtonText: {
    color: T.onWhite,
    fontSize: 16,
    fontWeight: '800',
  },
  accessCancel: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  accessCancelText: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
});
