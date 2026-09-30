import React, { useState, useEffect, useRef } from 'react';
import { 
  View, 
  Text, 
    StyleSheet, 
    TouchableOpacity, 
  ActivityIndicator,
  Share,
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
  ChevronRight,
  ChevronLeft,
  PlayCircle
} from 'lucide-react-native';
import { doc, getDoc, collection, addDoc, Timestamp, query, where, getDocs, deleteDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { backendJson } from '../lib/api/backend';
import { getPromoterRef, setPromoterRef } from '../lib/promoterRef';
import { goBackOrHome } from '../lib/goBackOrHome';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { useTheme } from '../contexts/ThemeContext';
import { parseVideoEmbed } from '../lib/videoEmbed';
import { colors as T, radius, withAlpha } from '../theme/tokens';
import { safeFormatForLanguage } from '../lib/dates';
import { isValidDate } from '../lib/dates';
import WhitePillCTA from '../components/WhitePillCTA';
import VerifiedBadge from '../components/VerifiedBadge';
import PaymentModal from '../components/PaymentModal';
import TieredTicketSelector, { PurchaseSelectionMeta } from '../components/TieredTicketSelector';
import { resolveEventPricing } from '../lib/ticketPricing';
import { advertisedPrice } from '../lib/buyerPricing';
import { resolvePosterTheme } from '../lib/posterGradient';
import FreeTicketModal from '../components/FreeTicketModal';
import AddToCalendarButton from '../components/AddToCalendarButton';
import JoinWaitlistButton from '../components/JoinWaitlistButton';
import FollowButton from '../components/FollowButton';
import CountdownTimer from '../components/CountdownTimer';
import VenueStaticMap from '../components/VenueStaticMap';
import WhosGoing from '../components/WhosGoing';
import { guestlistVisibilityFrom } from '../lib/guestlistVisibility';
import ContactOrganizerModal from '../components/ContactOrganizerModal';
import PurchaseSuccessSheet from '../components/PurchaseSuccessSheet';
import { useAppAlert } from '../components/AppAlert';
import { EventDetailSkeleton } from '../components/Skeleton';
const { width } = Dimensions.get('window');
const POSTER_W = width * 0.86;
// The poster is 4:5, so its height follows from its width. The hero adds a
// fixed bleed band above and below rather than a magic total height: at a flat
// 600pt the hero ate 71% of an 844pt screen, so the host, title and date all
// began below the fold — where posh shows them immediately.
const POSTER_H = POSTER_W * 1.25;
const HERO_BLEED = 52;

// Dictionary key for the compact countdown prefix ("Starts in").
const STARTS_IN_KEY = 'eventDetail.startsIn';

export default function EventDetailScreen({ route, navigation }: any) {
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
  const { user, userProfile } = useAuth();
  const { t, language } = useI18n();
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const showAlert = useAppAlert();
  const [event, setEvent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showTierSelector, setShowTierSelector] = useState(false);
  const [showFreeTicketModal, setShowFreeTicketModal] = useState(false);
  const [showContactOrganizer, setShowContactOrganizer] = useState(false);
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
  const [ticketQuantity, setTicketQuantity] = useState(1);
  const [promoCode, setPromoCode] = useState<string | undefined>();
  // Password-gate state. accessGranted: null = unknown/not-yet-checked, true =
  // an access_grants/{uid} doc exists (or unlock succeeded), false = gated.
  const [accessGranted, setAccessGranted] = useState<boolean | null>(null);
  const [showAccessGate, setShowAccessGate] = useState(false);
  const [accessCodeInput, setAccessCodeInput] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [accessError, setAccessError] = useState('');
  const scrollY = useRef(new Animated.Value(0)).current;
  const floatingBarAnim = useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();

  useEffect(() => {
    fetchEventDetails();
    checkFavoriteStatus();
  }, [eventId]);

  // Animate floating bar entrance
  useEffect(() => {
    if (event) {
      Animated.timing(floatingBarAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
  }, [event]);

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
        if (isFree) {
          setShowFreeTicketModal(true);
        } else {
          setShowTierSelector(true);
        }
      } else {
        setAccessError(t('eventAccess.wrongCode'));
      }
    } catch (err) {
      // backendJson throws on non-2xx (403 wrong code) — treat as incorrect.
      setAccessError(t('eventAccess.wrongCode'));
    } finally {
      setUnlocking(false);
    }
  };

  const fetchEventDetails = async () => {
    try {
      const eventDoc = await getDoc(doc(db, 'events', eventId));
      if (eventDoc.exists()) {
        const data = eventDoc.data();
        
        // Fetch organizer data
        let organizerData = null;
        if (data.organizer_id) {
          try {
            // H4: cross-user read of the organizer's SAFE public projection
            // (not users/{uid}). Falls back to a placeholder below if the
            // projection isn't backfilled yet.
            const organizerDoc = await getDoc(doc(db, 'public_profiles', data.organizer_id));
            if (organizerDoc.exists()) {
              organizerData = organizerDoc.data();
            }
          } catch (err) {
            console.error('Error fetching organizer:', err);
          }
        }
        
        setEvent({ 
          id: eventDoc.id, 
          ...data,
          start_datetime: data.start_datetime?.toDate ? data.start_datetime.toDate() : data.start_datetime ? new Date(data.start_datetime) : null,
          end_datetime: data.end_datetime?.toDate ? data.end_datetime.toDate() : data.end_datetime ? new Date(data.end_datetime) : null,
          users: organizerData ? {
            full_name: organizerData.full_name || '',
            // Organization brand overrides the personal name wherever the
            // organizer is shown (falls back to full_name when unset).
            organization_name: organizerData.organization_name || '',
            organization_logo: organizerData.organization_logo || '',
            is_verified: organizerData.is_verified ?? false
          } : {
            full_name: '',
            organization_name: '',
            organization_logo: '',
            is_verified: false
          }
        });
      }
    } catch (error) {
      console.error('Error fetching event:', error);
      showAlert(t('common.error'), t('eventDetail.loadError'));
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
    if (!user) {
      showAlert(t('auth.loginRequiredTitle'), t('eventDetail.favorites.loginBody'));
      return;
    }

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
        snapshot.docs.forEach(async (docSnapshot) => {
          await deleteDoc(doc(db, 'event_favorites', docSnapshot.id));
        });
        setIsFavorite(false);
        showAlert(t('common.success'), t('eventDetail.favorites.removed'));
      } else {
        // Add to favorites
        await addDoc(collection(db, 'event_favorites'), {
          user_id: user.uid,
          event_id: eventId,
          created_at: Timestamp.now()
        });
        setIsFavorite(true);
        showAlert(t('common.success'), t('eventDetail.favorites.saved'));
      }
    } catch (error) {
      console.error('Error toggling favorite:', error);
      showAlert(t('common.error'), t('eventDetail.favorites.updateError'));
    } finally {
      setFavoriteLoading(false);
    }
  };

  const handleShare = async () => {
    try {
      await Share.share({
        message: `${t('eventDetail.share.checkOut')} ${event.title}!\n\n${event.description?.substring(0, 100)}...\n\n${t('eventDetail.share.date')}: ${event.start_datetime && safeFormatForLanguage(event.start_datetime, 'EEEE, MMMM dd, yyyy', language)}\n${t('eventDetail.share.venue')}: ${event.venue_name}\n${t('eventDetail.share.organizer')}: ${event.users?.organization_name || event.users?.full_name || event.organizer_name || t('eventDetail.organizerFallback')}\n\nhttps://tikem.co/events/${eventId}`,
        title: event.title,
      });
    } catch (error) {
      console.error('Error sharing:', error);
    }
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
    if (!user) {
      showAlert(t('auth.loginRequiredTitle'), t('eventDetail.purchase.loginBody'));
      return;
    }

    // Prevent purchase for past events
    if (isPastEvent) {
      showAlert(t('eventDetail.purchase.pastTitle'), t('eventDetail.purchase.pastBody'));
      return;
    }

    // Password gate — a protected event with no access grant must be unlocked
    // (code verified server-side) before any purchase flow opens.
    if (event.is_password_protected && accessGranted !== true) {
      setAccessError('');
      setShowAccessGate(true);
      return;
    }

    // Free-ONLY event: nothing to choose, claim directly. Clear any tier picked
    // in an earlier flow so the server resolves the event's free tier itself and
    // the sheet owns the quantity (see lockedQuantity below).
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
    // Was a bare OS alert, which is the least celebratory way to confirm a
    // purchase and offered nothing but "OK". Same sheet as the free path.
    fetchEventDetails();
    // Same reason as the free path: dismiss the payment modal before the sheet.
    setShowPaymentModal(false);
    setSuccessQuantity(ticketQuantity || 1);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <EventDetailSkeleton />
      </SafeAreaView>
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
  // `isFree` now means "there is no paid way in", i.e. tier selection can be
  // skipped. A mixed event is NOT free: the buyer must choose a tier.
  const isFree = pricing.isFreeOnly;

  // Prevent purchase only after the event has ended (not after it has started).
  const purchaseCutoffDate = event.end_datetime || event.start_datetime;
  const isPastEvent = purchaseCutoffDate && new Date(purchaseCutoffDate) < new Date();
  
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
        ? `${t('common.free')} – ${advertisedPrice(
            pricing.lowestPaidPrice,
            event as any
          ).toLocaleString()} ${currency}`
        : undefined;
    }
    const from = pricing.lowestPaidPrice ?? Number(event.ticket_price || 0);
    if (!(from > 0)) return undefined;
    return `${t('common.from')} ${advertisedPrice(from, event as any).toLocaleString()} ${currency}`;
  })();

  // Compact countdown prefix. `t()` echoes the key back when it is missing from
  // the dictionaries, so fall back to English until `eventDetail.startsIn` lands.
  const startsInLabel =
    t(STARTS_IN_KEY) === STARTS_IN_KEY ? 'Starts in' : t(STARTS_IN_KEY);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Animated.ScrollView 
        style={styles.scrollView} 
        showsVerticalScrollIndicator={false}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: false }
        )}
        scrollEventThrottle={16}
      >
        {/* Hero — same poster blurred as backdrop, sharp poster centered */}
        <View style={styles.heroContainer}>
          <LinearGradient
            colors={resolvePosterTheme(event, event.id || event.title, event.category).colors}
            start={{ x: 0.1, y: 0 }}
            end={{ x: 0.9, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          {(event.banner_image_url || event.cover_image_url) && (
            <ExpoImage
              source={{ uri: event.banner_image_url || event.cover_image_url }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              blurRadius={28}
              cachePolicy="memory-disk"
              recyclingKey={event.id ? String(event.id) : undefined}
            />
          )}
          <View style={styles.heroBackdropScrim} />

          {/* Centered sharp poster — expo-image so it reuses the memory-disk
              cache the Discover/Home card already filled, showing instantly. */}
          <View style={styles.heroPoster}>
            <LinearGradient
              colors={resolvePosterTheme(event, event.id || event.title, event.category).colors}
              start={{ x: 0.1, y: 0 }}
              end={{ x: 0.9, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            {(event.banner_image_url || event.cover_image_url) && (
              <ExpoImage
                source={{ uri: event.banner_image_url || event.cover_image_url }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={120}
                recyclingKey={event.id ? String(event.id) : undefined}
              />
            )}
          </View>

          {/* Bottom blend into page background */}
          <LinearGradient
            colors={['transparent', colors.background]}
            style={styles.heroBottomBlend}
          />

          {/* Top scrim for button legibility */}
          <LinearGradient
            colors={['rgba(0,0,0,0.45)', 'transparent']}
            style={styles.heroTopScrim}
          />

          {/* Top Right Actions: Share & Save */}
          {/* Back — the most-visited pushed screen shipped with no back
              affordance at all; only the edge-swipe worked. Same scrim-circle
              as the share/heart cluster opposite. */}
          <TouchableOpacity
            style={[styles.iconButton, styles.heroBack, { top: insets.top + 8 }]}
            onPress={() => goBackOrHome(navigation)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
          >
            <ChevronLeft size={22} color="#FFF" />
          </TouchableOpacity>
          <View style={[styles.heroActions, { top: insets.top + 8 }]}>
            <TouchableOpacity style={styles.iconButton} onPress={handleShare} hitSlop={8}>
              <Share2 size={20} color="#FFF" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={toggleFavorite}
              disabled={favoriteLoading}
              hitSlop={8}
            >
              <Heart 
                size={20} 
                color="#FFF"
                fill={isFavorite ? '#FFF' : 'transparent'}
              />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.content}>
          {/* Compact host byline — back above the title by request ("I want
              both"): a small mark and the name, tappable to the profile. The
              full organizer section, with Follow and Contact, lives at the
              FOOT of the page — this line is identity, that one is actions. */}
          <TouchableOpacity
            style={styles.hostBylineTop}
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
                <Text style={styles.hostedByAvatarText}>
                  {(event.users?.organization_name || event.users?.full_name || event.organizer_name || 'E')[0].toUpperCase()}
                </Text>
              )}
            </View>
            <Text style={styles.hostBylineTopName} numberOfLines={1}>
              {event.users?.organization_name || event.users?.full_name || event.organizer_name || t('eventDetail.organizerFallback')}
            </Text>
            {(event.users?.is_verified || event.is_verified) && (
              <VerifiedBadge size="small" label={t('eventDetail.verified')} />
            )}
          </TouchableOpacity>

          {/* Title block — text-first, under the poster */}
          <Text style={styles.title}>{event.title}</Text>

          {/* Venue and date as two plain lines, the way posh states them:
              "Professor Miller's house near Target" / "Sat, Aug 22 at 4:00 PM
              - 9:00 PM". The old version spent two icon rows, a divider and
              four stacked lines on the same two facts — the wasted space a
              tester marked up twice. Tapping the venue still opens Maps, which
              is what the ⧉ affordance did. */}
          <View style={styles.factList}>
            <TouchableOpacity onPress={openInMaps} activeOpacity={0.6} style={styles.venueLine}>
              <Text style={styles.venueText} numberOfLines={2}>
                {event.venue_name || event.address || event.city}
              </Text>
              <ExternalLink size={14} color={colors.textSecondary} />
            </TouchableOpacity>

            <Text style={styles.whenText}>
              {startValid && safeFormatForLanguage(startValid, 'EEE, MMM d', language)}
              {startValid && ` ${t('common.at')} ${safeFormatForLanguage(startValid, 'h:mm a', language)}`}
              {endValid && ` – ${safeFormatForLanguage(endValid, 'h:mm a', language)}`}
            </Text>

            {/* Kept — posh has no countdown, but urgency is genuinely useful on
                a ticketing app. Demoted to one quiet line rather than its own row. */}
            {startValid && startValid > new Date() && (
              <CountdownTimer targetDate={startValid} label={startsInLabel} style={styles.factCountdown} />
            )}

          </View>

          {/* Quick Actions - Calendar & Waitlist */}
          <View style={styles.quickActionsRow}>
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
              style={styles.quickActionButton}
            />
            {isSoldOut && (
              <JoinWaitlistButton
                eventId={eventId}
                eventTitle={event.title}
                isSoldOut={isSoldOut}
                style={styles.quickActionButton}
              />
            )}
          </View>

          {/* About Section */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('eventDetail.sections.about')}</Text>
            <Text style={styles.description}>{event.description}</Text>
          </View>

          {/* Promo Video — only when a valid URL is provided */}
          {typeof (event as any).video_url === 'string' && (event as any).video_url.trim() !== '' && (
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

          {/* Venue map — foot of the page, directly above the organizer
              (tester ask): by the time you want the map you have decided to go;
              up top it pushed the description below the fold. */}
          <VenueStaticMap
            event={event}
            onPress={openInMaps}
            accessibilityLabel={t('eventDetail.maps.title')}
            style={styles.venueMap}
          />

          {/* Organizer — back at the FOOT of the page, reversing the
              byline-above-title experiment (tester ask): read the event first,
              then who is throwing it, with Follow and Contact right here. */}
          <View style={styles.hostByline}>
            <Text style={styles.sectionTitle}>{t('eventDetail.sections.hostedBy')}</Text>
            <View style={styles.hostedByCard}>
              <TouchableOpacity 
                style={styles.hostedByMain}
                onPress={navigateToOrganizerProfile}
                activeOpacity={0.7}
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
                    <Text style={styles.hostedByAvatarText}>
                      {(event.users?.organization_name || event.users?.full_name || event.organizer_name || 'E')[0].toUpperCase()}
                    </Text>
                  )}
                </View>
                <View style={styles.hostedByInfo}>
                  <Text style={styles.hostedByName}>
                    {event.users?.organization_name || event.users?.full_name || event.organizer_name || t('eventDetail.organizerFallback')}
                  </Text>
                  {/* House rule: no filled status pills. Bare shield glyph + quiet
                      teal label — no background, no border. VerifiedBadge without
                      `showLabel` renders just the icon, so the shared badge stays
                      untouched for the screens that still use its pill form. */}
                  {(event.users?.is_verified || event.is_verified) && (
                    <View
                      style={styles.verifiedBadgeInline}
                      accessible
                      accessibilityRole="text"
                      accessibilityLabel={t('eventDetail.verified')}
                    >
                      <VerifiedBadge size="small" label={t('eventDetail.verified')} />
                      <Text style={styles.verifiedTextInline}>{t('eventDetail.verified')}</Text>
                    </View>
                  )}
                </View>
                <ChevronRight size={16} color={colors.textSecondary} />
              </TouchableOpacity>
              {event.organizer_id && (
                <FollowButton
                  organizerId={event.organizer_id}
                  style={styles.followButtonInCard}
                />
              )}
            </View>
            {/* Hidden from the organizer's own event — messaging yourself just
                fills your own inbox, and the server rejects it anyway. */}
            {!!user && !!event.organizer_id && event.organizer_id !== user.uid && (
              <TouchableOpacity
                style={styles.contactOrganizerRow}
                onPress={() => setShowContactOrganizer(true)}
                activeOpacity={0.7}
                accessibilityRole="button"
              >
                <Text style={styles.contactOrganizerText}>{t('contactOrganizer.open')}</Text>
                <ChevronRight size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>

          {/* Who's Going: faces, a count, or nothing, per the organizer's
              guest-list setting (same resolver as the web event page). */}
          <WhosGoing eventId={eventId} visibility={guestlistVisibilityFrom(event as any)} />

          {/* Bottom padding so the floating CTA never overlaps page content */}
          <View style={{ height: 160 }} />
        </View>
      </Animated.ScrollView>

      {/* Floating Bottom CTA Pill Card */}
      <Animated.View 
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
        ) : isSoldOut ? (
          <View style={[styles.ctaDisabled, styles.floatingCtaPill]}>
            <Text style={styles.ctaDisabledText}>{t('badges.soldout')}</Text>
          </View>
        ) : (
          // Adaptive white-pill primary action (POSH §2.2): free → RSVP,
          // paid → Get Tickets with a muted price sub-label.
          <WhitePillCTA
            variant={isFree ? 'rsvp' : 'paid'}
            label={isFree ? t('common.rsvp') : t('eventDetail.floating.getTickets')}
            subLabel={isFree ? undefined : priceSubLabel}
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
        feeIncidence={(event as any)?.fee_incidence}
      />

      <PurchaseSuccessSheet
        visible={successQuantity !== null}
        onClose={() => setSuccessQuantity(null)}
        onViewTickets={() => {
          setSuccessQuantity(null);
          navigation.navigate('Main', { screen: 'Tickets' });
        }}
        event={event}
        quantity={successQuantity ?? 1}
      />

      <ContactOrganizerModal
        visible={showContactOrganizer}
        onClose={() => setShowContactOrganizer(false)}
        eventId={eventId}
        eventTitle={event?.title}
      />

      {/* Free Ticket Modal */}
      <FreeTicketModal
        visible={showFreeTicketModal}
        onClose={() => setShowFreeTicketModal(false)}
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
        onCheckoutFallback={selectedTierId ? handleClaimCheckoutFallback : undefined}
        onSuccess={handleFreeTicketSuccess}
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
          />
          <View style={styles.accessCard}>
            <Text style={styles.accessTitle}>🔒 {t('eventAccess.locked')}</Text>
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
                <ActivityIndicator size="small" color={T.onTeal} />
              ) : (
                <Text style={styles.accessButtonText}>{t('eventAccess.unlock')}</Text>
              )}
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
        tierId={selectedTierId || undefined}
        promoCodeId={promoCode}
        refCode={refCode}
        onSuccess={handlePaymentSuccess}
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
    borderRadius: 8,
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
    height: POSTER_H + HERO_BLEED * 2,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 0.35, not 0.55. The backdrop is the SAME poster blurred, and the point of
  // it is the artwork's colour bleeding into the page — posh's defining hero
  // quality. At 0.55 the bleed was crushed to near-grey, so the poster sat on
  // flat black instead of melting into it. The sharp poster on top carries its
  // own shadow, so legibility does not depend on this layer.
  heroBackdropScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10,10,10,0.35)',
  },
  heroPoster: {
    width: POSTER_W,
    aspectRatio: 4 / 5,
    borderRadius: 0,
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
  
  // Top Right Actions (Share & Save)
  heroActions: {
    position: 'absolute',
    top: 60,
    right: 16,
    flexDirection: 'row',
    gap: 8,
  },
  heroBack: {
    position: 'absolute',
    left: 16,
    zIndex: 10,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
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
    fontFamily: 'InstrumentSerif_400Regular',
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
    marginTop: 24,
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
    gap: 8,
  },
  venueText: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    lineHeight: 23,
  },
  // Date + time range on ONE grey line beneath it, matching how posh states
  // "Sat, Aug 22 at 4:00 PM - 9:00 PM".
  whenText: {
    marginTop: 3,
    fontSize: 15,
    color: colors.textSecondary,
    lineHeight: 21,
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
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
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
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  hostedByAvatarText: {
    // Scaled for the 28pt mark, and on the canvas token rather than a literal
    // white — the fill behind it is no longer teal.
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  hostedByAvatarImage: {
    width: '100%',
    height: '100%',
    // Matches the container's new squarer corner, not the old 24 circle.
    borderRadius: radius.sm,
  },
  hostedByInfo: {
    flex: 1,
  },
  hostedByName: {
    fontSize: 15,
    fontWeight: '700',
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
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.primary,
  },
  hostedByMain: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  followButtonInCard: {
    marginLeft: 12,
  },
  quickActionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  quickActionButton: {
    flex: 1,
  },



  // Quiet outlined row under the host card — an outline, not a filled pill, so
  // it never competes with the white Get Tickets CTA for primary-action weight.
  contactOrganizerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  contactOrganizerText: {
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
  

  // ── Password gate modal ──
  accessBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  accessCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 22,
    gap: 14,
  },
  accessTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  accessInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
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
  accessButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accessButtonDisabled: {
    opacity: 0.5,
  },
  accessButtonText: {
    color: T.onTeal,
    fontSize: 16,
    fontWeight: '800',
  },
});
