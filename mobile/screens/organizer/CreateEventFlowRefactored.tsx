/**
 * CreateEventFlow — POSH flyer-first single-canvas create/edit flow.
 *
 * Architecture:
 * - Single source of truth: eventDraft state.
 * - Create mode opens a two-tile entry chooser (Sell tickets vs free RSVP),
 *   then drops into ONE scrolling canvas. Edit mode goes straight to the canvas.
 * - No numbered stepper: the flyer hero + borderless inline fields ARE the form
 *   and the preview at once (POSH IMG_1843/1847/1848/1849).
 * - Inline per-field validation (red placeholder + red divider). A confirmation
 *   sheet gates publishing in create mode, with a save-as-draft escape hatch.
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Animated,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  Keyboard,
  SafeAreaView,
  ActivityIndicator,
  Modal,
  Switch,
  KeyboardTypeOptions,
} from 'react-native';
import { useAppAlert } from '../../components/AppAlert';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import FlyerLibrarySheet, { SelectedFlyer } from '../../components/FlyerLibrarySheet';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import { createEvent, updateEvent, SaveEventOptions } from '../../lib/api/events';
import { getEventById } from '../../lib/api/organizer';
import { RADIUS } from '../../config/brand';
import { COUNTRIES, CITIES_BY_COUNTRY } from '../../types/filters';
import { getDeviceLocationInfo } from '../../utils/deviceLocation';
import {
  HAITI_DEPARTMENTS,
  citiesForDepartment,
  communesForCity,
  departmentForCity,
} from '../../data/haitiGeo';
import WhitePillCTA from '../../components/WhitePillCTA';
import SpotifySongPicker from '../../components/SpotifySongPicker';
import OverlayHeader, { useOverlayHeaderInset } from '../../components/OverlayHeader';
import { font, radius, withAlpha } from '../../theme/tokens';
import { POSTER_THEME_KEYS, resolvePosterTheme } from '../../lib/posterGradient';
import {
  isComingSoon,
  countryName,
  currenciesForCountry,
  defaultCurrencyForCountry,
  normalizeSupportedCountry,
  providerForCountry,
  countrySupport,
} from '../../lib/countrySupport';
import { orderCountriesByMarkets, useDeclaredMarkets } from '../../lib/organizerMarkets';
import { backendFetch, backendJson } from '../../lib/api/backend';

type RouteParams = {
  CreateEvent: undefined;
  EditEvent: { eventId: string };
};

// Per-field inline validation errors, keyed by field name.
export type FieldErrors = Record<string, string>;

// Event draft shape - single source of truth
export interface EventDraft {
  // Basics
  title: string;
  description: string;
  category: string;
  banner_image_url: string;

  // Location
  venue_name: string;
  country?: string;
  department: string;   // Haiti département (cascade parent of city)
  city: string;
  commune: string;
  address: string;

  // Schedule - local times
  start_date: string;      // YYYY-MM-DD
  start_time: string;      // HH:MM AM/PM
  end_date: string;        // YYYY-MM-DD
  end_time: string;        // HH:MM AM/PM
  timezone: string;        // America/Port-au-Prince

  // Tickets
  ticket_tiers: Array<{
    name: string;
    price: string;
    quantity: string;
    description: string;
    unlimited: boolean;
    // Optional per-tier sale window. ISO 8601 datetime strings; '' / undefined
    // = no bound. Empty by default (tier purchasable whenever the event is live).
    sale_start?: string;
    sale_end?: string;
    // Optional per-tier ENTRY-admission window (distinct from the sale window
    // above). ISO 8601 datetime strings; '' / undefined = admits anytime. Read
    // by the scan/ticket layer to gate check-in ("Not valid yet" / "Expired").
    valid_from?: string;
    valid_until?: string;
  }>;
  currency: string;

  // Free RSVP path — no paid tiers, a single attendance cap instead.
  is_rsvp: boolean;
  capacity: string;

  // Advanced settings (POSH secondary sections).
  show_on_explore: boolean;   // false = share-by-link only, hidden from Discover
  video_url: string;          // optional promo video link
  // Spotify track URL (https://open.spotify.com/track/{id}) — rendered as the
  // official embed on the event page. Picked via song search, or pasted when
  // the search route has no credentials.
  spotify_url: string;
  show_guestlist: boolean;    // whether attendees can see who's going

  // Poster-theme override. '' = Auto (deterministic pick from seed/category);
  // a valid PosterThemeKey pins the poster gradient for this event everywhere.
  theme_key: string;

  // Recurring events (create-only). When recurrence !== 'none' the create flow
  // generates `recurrence_count` independent occurrences one cadence apart, all
  // sharing a series_id. Ignored/hidden in edit mode.
  recurrence: 'none' | 'daily' | 'weekly' | 'monthly';
  recurrence_count: number;   // TOTAL occurrences incl. the first; clamp 2–52
  // Alternative to recurrence_count: repeat UNTIL this date (ISO YYYY-MM-DD)
  // instead of by count. '' = use count. Only one mode is active at a time.
  recurrence_end_date: string;

  // Password gate. When on, attendees must enter access_code (verified server-
  // side) before buying. access_code is transient plaintext — it is hashed into
  // the private/access subdoc on save and never read back (blank in edit mode).
  is_password_protected: boolean;
  access_code: string;
}

const CATEGORIES = [
  'Music', 'Sports', 'Arts', 'Business', 'Food & Drink',
  'Community', 'Education', 'Tech', 'Health', 'Other',
];

// Recurring-event cadence options for the "Repeats" selector (create-only).
const RECURRENCE_OPTIONS: Array<{ value: EventDraft['recurrence']; labelKey: string }> = [
  { value: 'none', labelKey: 'organizerCreateEventFlow.canvas.repeatNever' },
  { value: 'daily', labelKey: 'organizerCreateEventFlow.canvas.repeatDaily' },
  { value: 'weekly', labelKey: 'organizerCreateEventFlow.canvas.repeatWeekly' },
  { value: 'monthly', labelKey: 'organizerCreateEventFlow.canvas.repeatMonthly' },
];

const CATEGORY_LABEL_KEYS: Record<string, string> = {
  Music: 'organizerCreateEvent.categories.music',
  Sports: 'organizerCreateEvent.categories.sports',
  Arts: 'organizerCreateEvent.categories.arts',
  Business: 'organizerCreateEvent.categories.business',
  'Food & Drink': 'organizerCreateEvent.categories.foodDrink',
  Community: 'organizerCreateEvent.categories.community',
  Education: 'organizerCreateEvent.categories.education',
  Tech: 'organizerCreateEvent.categories.tech',
  Health: 'organizerCreateEvent.categories.health',
  Other: 'organizerCreateEvent.categories.other',
};

// ── Borderless inline field (POSH IMG_1848/1849) ──────────────────────────
// Module-level so it doesn't remount every keystroke (which would drop focus).
// Transparent, no box: the label doubles as the placeholder, a hairline divider
// sits below. On error the placeholder + divider tint red (POSH required look).
type Colors = ReturnType<typeof useTheme>['colors'];

function InlineTextRow({
  colors,
  placeholder,
  value,
  onChangeText,
  error,
  multiline,
  keyboardType,
  maxLength,
  onFocus,
  autoCapitalize,
  // AutoFill is off by default: iOS was popping the password-manager "AutoFill"
  // bubble over free-text fields like Venue. Callers can override per-field.
  autoComplete = 'off',
  textContentType = 'none',
  autoCorrect = false,
}: {
  colors: Colors;
  placeholder: string;
  value: string;
  onChangeText: (t: string) => void;
  error?: boolean;
  multiline?: boolean;
  keyboardType?: KeyboardTypeOptions;
  maxLength?: number;
  onFocus?: () => void;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoComplete?: React.ComponentProps<typeof TextInput>['autoComplete'];
  textContentType?: React.ComponentProps<typeof TextInput>['textContentType'];
  autoCorrect?: boolean;
}) {
  return (
    <View style={[inline.row, { borderBottomColor: error ? colors.error : colors.border }]}>
      <TextInput
        style={[
          multiline ? inline.multiline : inline.input,
          { color: colors.text },
        ]}
        placeholder={placeholder}
        placeholderTextColor={error ? colors.error : colors.textSecondary}
        selectionColor={colors.primary}
        value={value}
        onChangeText={onChangeText}
        onFocus={onFocus}
        multiline={!!multiline}
        keyboardType={keyboardType}
        maxLength={maxLength}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        textContentType={textContentType}
        autoCorrect={autoCorrect}
        textAlignVertical={multiline ? 'top' : 'center'}
      />
    </View>
  );
}

// A borderless inline row that opens the date + time pickers. Left cell = date,
// right cell = time, so both halves of Start/End are reachable in one row.
function InlineDateTimeRow({
  colors,
  label,
  dateText,
  timeText,
  timePlaceholder,
  onPressDate,
  onPressTime,
  error,
}: {
  colors: Colors;
  label: string;
  dateText: string;
  timeText: string;
  timePlaceholder: string;
  onPressDate: () => void;
  onPressTime: () => void;
  error?: boolean;
}) {
  const hasDate = !!dateText;
  return (
    <View style={[inline.row, inline.rowInner, { borderBottomColor: error ? colors.error : colors.border }]}>
      <TouchableOpacity style={inline.flex} onPress={onPressDate} activeOpacity={0.7}>
        <Text style={[inline.rowText, { color: hasDate ? colors.text : error ? colors.error : colors.textSecondary }]}>
          {hasDate ? dateText : label}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onPressTime} activeOpacity={0.7} style={inline.timeCell}>
        <Ionicons name="time-outline" size={16} color={colors.textSecondary} />
        <Text style={[inline.timeText, { color: timeText ? colors.text : colors.textSecondary }]}>
          {timeText || timePlaceholder}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const inline = StyleSheet.create({
  row: {
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  flex: { flex: 1 },
  input: {
    fontSize: 17,
    padding: 0,
  },
  multiline: {
    fontSize: 16,
    minHeight: 96,
    padding: 0,
  },
  rowText: {
    fontSize: 17,
  },
  timeCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 12,
  },
  timeText: {
    fontSize: 15,
  },
});

/**
 * A faint graph-paper grid drawn purely with hairline-bordered flex cells — no
 * image asset, no SVG dependency. Used behind the empty flyer state to give it
 * a "design canvas" texture (à la Posh) instead of a floating glow blob.
 */
function GridCanvas({ lineColor, columns = 5, rows = 8 }: { lineColor: string; columns?: number; rows?: number }) {
  // INTERIOR lines only: the last column/row draws no border. Painting every
  // cell's trailing edge left a hairline hugging the panel's right and bottom
  // edges with no twin on the left/top, which skewed the texture and made the
  // whole dropzone read as pushed toward the right ("this poster is not
  // centered"). Interior-only lines are symmetric by construction.
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { flexDirection: 'row' }]}>
        {Array.from({ length: columns }).map((_, i) => (
          <View
            key={`c${i}`}
            style={{
              flex: 1,
              borderRightWidth: i < columns - 1 ? StyleSheet.hairlineWidth : 0,
              borderRightColor: lineColor,
            }}
          />
        ))}
      </View>
      <View style={StyleSheet.absoluteFill}>
        {Array.from({ length: rows }).map((_, i) => (
          <View
            key={`r${i}`}
            style={{
              flex: 1,
              borderBottomWidth: i < rows - 1 ? StyleSheet.hairlineWidth : 0,
              borderBottomColor: lineColor,
            }}
          />
        ))}
      </View>
    </View>
  );
}

export default function CreateEventFlowRefactored() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RouteParams, 'EditEvent'>>();
  const insets = useSafeAreaInsets();
  // 48 = the header's own paddingTop 12 + 24pt glyph + paddingBottom 12; it
  // carries no safe-area inset (the SafeAreaView above already does).
  const { height: headerH, onHeight } = useOverlayHeaderInset(48);
  const { user, userProfile } = useAuth();
  const { t } = useI18n();
  const showAlert = useAppAlert();
  const [saving, setSaving] = useState(false);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  // Measured height of the pinned footer, so the canvas's bottom padding clears it
  // by a real amount rather than a guessed constant. Seeded with the static height
  // (16 top pad + 56 button + 32 iOS bottom pad) for the first frame.
  const [footerHeight, setFooterHeight] = useState(104);
  // Slow Ken Burns drift on the entry background: ~14s per direction, gentle
  // scale+pan. Premium motion without a native video module (expo-video needs
  // a real build; this ships OTA). Native driver, transform-only.
  const entryDrift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(entryDrift, { toValue: 1, duration: 14000, useNativeDriver: true }),
        Animated.timing(entryDrift, { toValue: 0, duration: 14000, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [entryDrift]);
  const [loadingEvent, setLoadingEvent] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  // How many fields failed validation on the last Save attempt. Drives the
  // "Fix N field(s)" banner so off-screen errors don't make Create look broken.
  const [errorCount, setErrorCount] = useState(0);
  const [confirmVisible, setConfirmVisible] = useState(false);
  // Ref to the single scrolling canvas so a failed Save can scroll the user back
  // to the top where the error banner + first required fields live.
  const scrollRef = useRef<ScrollView>(null);
  // Haiti commune search dropdown visibility.
  const [communeListOpen, setCommuneListOpen] = useState(false);
  // Advanced-settings disclosure (POSH Show/Hide advanced settings).
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Natural aspect ratio of the uploaded poster (width / height), measured on
  // load so the preview renders at the flyer's TRUE proportions (posh shows
  // the poster as-is rather than forcing 2:3). Clamped to a sane band so a
  // degenerate panorama can't collapse the hero. null until first load; the
  // empty state keeps the 2:3 dropzone.
  const [posterAspect, setPosterAspect] = useState<number | null>(null);

  // Date/time picker visibility (ported from Step3ScheduleRefactored).
  const [showStartDate, setShowStartDate] = useState(false);
  const [showStartTime, setShowStartTime] = useState(false);
  const [showEndDate, setShowEndDate] = useState(false);
  const [showEndTime, setShowEndTime] = useState(false);
  const [scheduleErrorKey, setScheduleErrorKey] = useState<string | null>(null);

  // Per-tier sale-window AND validity-window pickers. One shared DateTimePicker
  // modal is driven by this object (which tier, which bound, date vs time) so any
  // number of tiers reuse the same picker infra as the schedule rows. `field`
  // covers both windows: start/end = SALE (purchase) window; validStart/validEnd
  // = VALIDITY (entry-admission) window.
  type SalePickerField = 'start' | 'end' | 'validStart' | 'validEnd';
  const [salePicker, setSalePicker] = useState<
    { tierIndex: number; field: SalePickerField; mode: 'date' | 'time' } | null
  >(null);
  // Which tiers have the "Set a sale period" switch revealed. Falls back to
  // "open" when a loaded tier already carries a bound (edit mode).
  const [salePeriodOpen, setSalePeriodOpen] = useState<Record<number, boolean>>({});
  // Which tiers have the "Set a validity period" switch revealed (parallel to
  // salePeriodOpen). Falls back to "open" when a loaded tier carries a bound.
  const [validityPeriodOpen, setValidityPeriodOpen] = useState<Record<number, boolean>>({});

  // Recurring "until date" picker visibility, and which repeat mode is active.
  // 'count' = the 2–52 stepper (recurrence_count); 'until' = a date picker
  // (recurrence_end_date). Only one mode drives generation at a time.
  const [showRecurrenceEndDate, setShowRecurrenceEndDate] = useState(false);
  const [recurrenceMode, setRecurrenceMode] = useState<'count' | 'until'>('count');

  // Edit mode: whether to apply this edit to every event in the loaded series.
  // series_id is captured from the loaded event (create/no-series → null).
  const [seriesId, setSeriesId] = useState<string | null>(null);
  const [applyToSeries, setApplyToSeries] = useState(false);

  const eventId = route.params?.eventId;
  const isEditMode = !!eventId;

  // In create mode the two-choice entry chooser is shown first; edit mode
  // jumps straight into the canvas (mode derived from the loaded event).
  const [entryChosen, setEntryChosen] = useState(isEditMode);

  // Single source of truth for all form data
  const [eventDraft, setEventDraft] = useState<EventDraft>({
    title: '',
    description: '',
    category: 'Music',
    banner_image_url: '',
    venue_name: '',
    country: 'HT',
    department: 'Ouest',
    city: 'Port-au-Prince',
    commune: '',
    address: '',
    start_date: '',
    start_time: '',
    end_date: '',
    end_time: '',
    timezone: 'America/Port-au-Prince',
    ticket_tiers: [{ name: 'General Admission', price: '0', quantity: '100', description: '', unlimited: false }],
    currency: 'HTG',
    is_rsvp: false,
    capacity: '100',
    show_on_explore: true,
    video_url: '',
    spotify_url: '',
    show_guestlist: true,
    theme_key: '',
    recurrence: 'none',
    recurrence_count: 4,
    recurrence_end_date: '',
    is_password_protected: false,
    access_code: '',
  });

  // Track keyboard visibility AND height. The height drives the canvas's
  // bottom padding directly — we deliberately do NOT use RN's
  // automaticallyAdjustKeyboardInsets: it applies a native contentInset that
  // iOS sometimes fails to remove after interactive drag-dismiss, leaving the
  // canvas scrollable a full keyboard-height past its end. Toggling the prop
  // off does not clear an inset already applied, which is why the first fix
  // ("gate it on visibility") did not hold. JS-owned padding cannot get stuck:
  // it is recomputed from state on every render.
  useEffect(() => {
    const keyboardWillShow = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        setIsKeyboardVisible(true);
        setKeyboardHeight(e?.endCoordinates?.height ?? 300);
      }
    );
    const keyboardWillHide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setIsKeyboardVisible(false);
        setKeyboardHeight(0);
      }
    );

    return () => {
      keyboardWillShow.remove();
      keyboardWillHide.remove();
    };
  }, []);

  const loadEventData = async () => {
    setLoadingEvent(true);
    try {
      const event = await getEventById(eventId!);
      if (event) {
        // Convert event data to draft format
        const startDate = new Date(event.start_datetime);
        const endDate = new Date(event.end_datetime);

        const formatTime = (date: Date) => {
          const hours = date.getHours();
          const minutes = date.getMinutes().toString().padStart(2, '0');
          const ampm = hours >= 12 ? 'PM' : 'AM';
          const displayHours = hours % 12 || 12;
          return `${displayHours}:${minutes} ${ampm}`;
        };

        // Convert ticket_tiers from database format (numbers) to form format (strings)
        const formattedTicketTiers = event.ticket_tiers && Array.isArray(event.ticket_tiers) && event.ticket_tiers.length > 0
          ? event.ticket_tiers.map((tier: any) => {
              const unlimited = Boolean(tier.unlimited);
              return {
                name: tier.name || 'General Admission',
                price: String(tier.price ?? 0),
                // Unlimited tiers store a large sentinel; don't surface it as the field value.
                quantity: unlimited ? '' : String(tier.quantity ?? tier.available ?? 100),
                description: tier.description || '',
                unlimited,
                // Restore any stored sale window (ISO strings) so editing keeps it.
                sale_start: tier.sales_start || undefined,
                sale_end: tier.sales_end || undefined,
                // Restore any stored entry-validity window (ISO strings).
                valid_from: tier.valid_from || undefined,
                valid_until: tier.valid_until || undefined,
              };
            })
          : [{ name: 'General Admission', price: '0', quantity: '100', description: '', unlimited: false }];

        const isRsvp = Boolean((event as any).is_rsvp);

        // Department: prefer the stored value; otherwise derive from the stored
        // city (arrondissement main-city) via the Haiti geo dataset.
        const storedCity = event.city || '';
        const resolvedDepartment =
          (event as any).department || departmentForCity(storedCity) || '';

        setEventDraft({
          title: event.title || '',
          description: event.description || '',
          category: event.category || '',
          // The poster is stored in banner_image_url (cover_image_url is a
          // legacy fallback) — reading only cover left edit mode showing the
          // empty "Upload Flyer" state for events that DO have a poster.
          banner_image_url: (event as any).banner_image_url || event.cover_image_url || '',
          venue_name: event.venue_name || '',
          country: (event as any).country || 'HT',
          department: resolvedDepartment,
          city: storedCity,
          commune: event.commune || '',
          address: event.address || '',
          start_date: startDate.toISOString().split('T')[0],
          start_time: formatTime(startDate),
          end_date: endDate.toISOString().split('T')[0],
          end_time: formatTime(endDate),
          timezone: 'America/Port-au-Prince',
          ticket_tiers: formattedTicketTiers,
          currency: event.currency || 'USD',
          is_rsvp: isRsvp,
          capacity: String((event as any).total_tickets ?? formattedTicketTiers[0]?.quantity ?? '100'),
          // Advanced settings — default to visible/on when the field is absent.
          show_on_explore: (event as any).show_on_explore !== false,
          video_url: (event as any).video_url || '',
          spotify_url: (event as any).spotify_url || '',
          show_guestlist: (event as any).show_guestlist !== false,
          // Poster-theme override; default '' (Auto) when the field is absent.
          theme_key: (event as any).theme_key || '',
          // Recurrence is create-only; editing never regenerates a series. The
          // control is hidden in edit mode, so force 'none' here. (A stored
          // series_id on the doc is left untouched — we read but don't act on it.)
          recurrence: 'none',
          recurrence_count: 4,
          recurrence_end_date: '',
          // Reflect the gate flag; the hash is write-only, so the code input
          // stays blank (a blank code on save preserves the existing hash).
          is_password_protected: Boolean((event as any).is_password_protected),
          access_code: '',
        });
        // Capture the series membership so edit mode can offer "apply to series".
        setSeriesId((event as any).series_id || null);
      }
    } catch (error) {
      console.error('Error loading event:', error);
      showAlert(t('common.error'), t('organizerCreateEventFlow.loadError'));
      navigation.goBack();
    } finally {
      setLoadingEvent(false);
    }
  };

  // Load event data if in edit mode
  useEffect(() => {
    if (isEditMode && eventId) {
      loadEventData();
    }
  }, [isEditMode, eventId]);

  // Generic update function - any field can be updated
  const updateDraft = (updates: Partial<EventDraft>) => {
    setEventDraft(prev => ({ ...prev, ...updates }));
  };

  // Coming-soon markets (e.g. Dominican Republic) allow FREE/RSVP events only:
  // there's no payout rail yet. Force the free path whenever such a country is
  // selected (covers edit mode / any entry path), so validation + save use RSVP.
  useEffect(() => {
    if (isComingSoon((eventDraft as any).country) && !eventDraft.is_rsvp) {
      updateDraft({ is_rsvp: true });
    }
  }, [eventDraft.country, eventDraft.is_rsvp]);

  // Choose the entry mode (sell tickets vs free RSVP) and enter the canvas.
  const chooseMode = (rsvp: boolean) => {
    updateDraft({ is_rsvp: rsvp });
    setEntryChosen(true);
  };

  const getCategoryLabel = (categoryId: string) => {
    const key = CATEGORY_LABEL_KEYS[categoryId] || CATEGORY_LABEL_KEYS.Other;
    return t(key);
  };

  // Flyer pick (ported from Step1Basics — aspect [2,3]).
  // Tapping the flyer area opens the posh-style library sheet (stock photos +
  // upload); the sheet's Upload pill falls through to the OS picker below.
  const [showFlyerLibrary, setShowFlyerLibrary] = useState(false);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      // Keep the whole flyer: iOS's built-in crop editor only ever crops to a
      // square (the `aspect` prop is Android-only), which chopped posters. No
      // editing → the full poster is uploaded and the card sizes to its ratio.
      allowsEditing: false,
      quality: 0.8,
    });

    if (!result.canceled) {
      updateDraft({ banner_image_url: result.assets[0].uri });
    }
  };

  // ── Location (ported from Step2Location) ──
  // The organizer's own country leads the chip row, and seeds a new draft:
  // a Miami organizer shouldn't have to scroll past Haiti and re-pick a city
  // every time ("list them by order of where the organizer is located").
  const organizerCountry = useMemo(() => {
    const stated = (userProfile as any)?.default_country;
    if (stated) return stated;
    // Profile silent — the location banner was never answered, or the account
    // predates it. Fall back to the DEVICE REGION (expo-localization, no IP,
    // no permission prompt). This only ever reorders the chips and seeds a
    // blank draft; an explicit pick and edit mode both win over it, which is
    // the line 1cab4462 drew — a guess may suggest, never decide.
    try {
      const device = getDeviceLocationInfo();
      return device.isSupported ? device.country : null;
    } catch {
      return null;
    }
  }, [userProfile]);
  // DECLARED markets lead the chip row when the organizer has stated them —
  // that's an explicit answer to "where do you run events", which beats the
  // stated default country and the device-region guess behind it. With nothing
  // declared, `orderCountriesByMarkets` falls straight through to the old
  // organizerCountry-first ordering.
  const { markets: declaredMarkets } = useDeclaredMarkets(user?.uid);
  const orderedCountries = useMemo(
    () => orderCountriesByMarkets(COUNTRIES, declaredMarkets, organizerCountry),
    [declaredMarkets, organizerCountry]
  );

  // Seed once, for a NEW draft only — never fight an edit or a manual pick.
  // Routed through handleCountryChange so the department/city/currency cascade
  // (and the coming-soon RSVP-only rule) stays in one place.
  const seededCountryRef = useRef(false);
  useEffect(() => {
    if (isEditMode || seededCountryRef.current) return;
    // A declared market is the strongest signal there is; fall back to the
    // stated country / device region exactly as before when there is none.
    const seed = declaredMarkets[0] || organizerCountry;
    if (!seed || seed === 'HT') return;
    if (!COUNTRIES.some((c) => c.code === seed)) return;
    seededCountryRef.current = true;
    handleCountryChange(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [declaredMarkets, organizerCountry, isEditMode]);

  const selectedCountry = (eventDraft as any).country || 'HT';
  const isHaiti = selectedCountry === 'HT';
  // Coming-soon markets (e.g. Dominican Republic): browsable + selectable, but no
  // payout rail yet → paid tickets are disabled, only free/RSVP is allowed.
  const countryComingSoon = isComingSoon(selectedCountry);
  const hasPaidTier =
    !eventDraft.is_rsvp &&
    eventDraft.ticket_tiers.some((tier) => {
      const price = parseFloat(tier.price);
      return Number.isFinite(price) && price > 0;
    });

  // ── Region payout-profile nudge (2026-08-12/29 tester feedback) ──
  // An event's country decides WHICH payout profile pays out — Haiti profile
  // (MonCash/bank, our KYC) vs the Stripe profile (US·CA·FR). Surface the gap
  // the moment a paid event targets a region whose profile isn't set up,
  // instead of dead-ending at publish. Unknown summary = stay quiet: this is a
  // nudge, the publish gate is the enforcement.
  const [payoutProfiles, setPayoutProfiles] = useState<{
    haiti?: { configured?: boolean };
    stripeConnect?: { configured?: boolean };
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await backendJson<{ profiles?: any }>('/api/organizer/payout-config-summary');
        if (!cancelled) setPayoutProfiles(data?.profiles || null);
      } catch {
        // Nudge only — no summary, no notice.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const eventUsesStripeRail = providerForCountry(selectedCountry) === 'stripe_connect';
  const requiredProfileConfigured = payoutProfiles
    ? Boolean(
        eventUsesStripeRail
          ? payoutProfiles.stripeConnect?.configured
          : payoutProfiles.haiti?.configured
      )
    : true;
  const showStripePayoutNotice =
    hasPaidTier && !countryComingSoon && !requiredProfileConfigured;

  // ── Cross-border payout advisory (WARN, never block) ──
  // A Stripe Express account's country is fixed at creation and an organizer
  // holds exactly ONE connected account. So a US-registered organizer running a
  // Canadian event still gets paid — into the USD account, after an FX
  // conversion nobody warned them about. Say it here, at the moment the country
  // is chosen, as well as at publish.
  const usesStripeRail = providerForCountry(selectedCountry) === 'stripe_connect';
  const [connectedStripeCountry, setConnectedStripeCountry] = useState<string | null>(null);
  useEffect(() => {
    if (!usesStripeRail) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await backendFetch('/api/organizer/stripe/status');
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setConnectedStripeCountry(
          data?.connected ? normalizeSupportedCountry(data?.account?.country) || null : null
        );
      } catch {
        // Advisory only — a failed lookup simply means no warning is shown.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [usesStripeRail]);

  const payoutCountryMismatch =
    usesStripeRail && connectedStripeCountry && connectedStripeCountry !== selectedCountry
      ? connectedStripeCountry
      : null;
  // Non-Haiti countries keep the flat city list.
  const cities = CITIES_BY_COUNTRY[selectedCountry] || [];
  // Haiti gets a Département → City (arrondissement) → Commune cascade.
  const department = eventDraft.department || 'Ouest';
  const haitiCities = citiesForDepartment(department);

  const handleCountryChange = (countryCode: string) => {
    // Coming-soon markets (e.g. Dominican Republic) have no payout rail yet, so an
    // organizer may only create FREE/RSVP events there. Force the free path on
    // selection; the tickets section shows a "coming soon" notice instead of tiers.
    const forceRsvp = isComingSoon(countryCode) ? { is_rsvp: true } : {};
    // Reset the event currency to the newly-selected country's default
    // (US→USD, CA→CAD, FR→EUR, HT→HTG) so a stale currency never carries over.
    const currency = defaultCurrencyForCountry(countryCode);
    if (countryCode === 'HT') {
      const dep = 'Ouest';
      const first = citiesForDepartment(dep)[0]?.name || '';
      updateDraft({ country: 'HT', department: dep, city: first, commune: '', currency, ...forceRsvp });
    } else {
      const newCities = CITIES_BY_COUNTRY[countryCode] || [];
      updateDraft({ country: countryCode, department: '', city: newCities[0] || '', commune: '', currency, ...forceRsvp });
    }
    setCommuneListOpen(false);
  };

  // On département select: reset city to the department's first arrondissement.
  const handleDepartmentChange = (dep: string) => {
    const first = citiesForDepartment(dep)[0]?.name || '';
    updateDraft({ department: dep, city: first, commune: '' });
    setCommuneListOpen(false);
  };

  // Accent/case-insensitive commune matching for the searchable dropdown.
  const normalizeText = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  const communeSuggestions = (() => {
    if (!isHaiti) return [];
    const all = communesForCity(department, eventDraft.city);
    const q = normalizeText(eventDraft.commune);
    const matches = q
      ? all.filter((c) => normalizeText(c).includes(q))
      : all;
    return matches.slice(0, 8);
  })();

  const selectCommune = (commune: string) => {
    updateDraft({ commune });
    setCommuneListOpen(false);
    Keyboard.dismiss();
  };

  // ── Tickets (ported from Step4Tickets) ──
  type Tier = EventDraft['ticket_tiers'][number];
  const addTier = () => {
    updateDraft({
      ticket_tiers: [
        ...eventDraft.ticket_tiers,
        { name: '', price: '', quantity: '', description: '', unlimited: false },
      ],
    });
  };
  const removeTier = (index: number) => {
    if (eventDraft.ticket_tiers.length > 1) {
      updateDraft({ ticket_tiers: eventDraft.ticket_tiers.filter((_, i) => i !== index) });
    }
  };
  const updateTier = (index: number, field: string, value: string) => {
    const newTiers = [...eventDraft.ticket_tiers];
    newTiers[index] = { ...newTiers[index], [field]: value };
    updateDraft({ ticket_tiers: newTiers });
  };
  // Patch multiple tier fields at once (accepts string + boolean values).
  const patchTier = (index: number, patch: Partial<Tier>) => {
    const newTiers = [...eventDraft.ticket_tiers];
    newTiers[index] = { ...newTiers[index], ...patch };
    updateDraft({ ticket_tiers: newTiers });
  };
  // Free-ticket toggle: on → price '0' & disabled; off → clear back to editable.
  const toggleFreeTier = (index: number, isFree: boolean) => {
    patchTier(index, { price: isFree ? '0' : '' });
  };
  // Unlimited-quantity toggle: on → hide qty; off → restore an editable qty.
  const toggleUnlimitedTier = (index: number, isUnlimited: boolean) => {
    patchTier(index, { unlimited: isUnlimited, quantity: isUnlimited ? '' : '100' });
  };
  const getCurrencySymbol = () => {
    switch (eventDraft.currency) {
      case 'USD':
        return '$';
      case 'CAD':
        return 'CA$';
      case 'EUR':
        return '€';
      case 'HTG':
      default:
        return 'HTG';
    }
  };

  // ── Per-tier sale window ──────────────────────────────────────────────────
  // Format an ISO datetime for the inline row: date as YYYY-MM-DD, time as
  // h:mm AM/PM (mirrors the schedule rows' local-time display).
  const formatSaleDate = (iso?: string): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const formatSaleTime = (iso?: string): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes} ${ampm}`;
  };
  // A tier's sale-period section is shown when the switch was flipped on, or when
  // a loaded tier already carries a bound.
  const isSalePeriodOpen = (index: number, tier: Tier): boolean =>
    salePeriodOpen[index] ?? (!!tier.sale_start || !!tier.sale_end);
  // Toggle the section. Turning it OFF clears that tier's window.
  const toggleSalePeriod = (index: number, on: boolean) => {
    setSalePeriodOpen((prev) => ({ ...prev, [index]: on }));
    if (!on) patchTier(index, { sale_start: undefined, sale_end: undefined });
  };
  // A tier's validity-period section — parallel to sale period (see above).
  const isValidityPeriodOpen = (index: number, tier: Tier): boolean =>
    validityPeriodOpen[index] ?? (!!tier.valid_from || !!tier.valid_until);
  const toggleValidityPeriod = (index: number, on: boolean) => {
    setValidityPeriodOpen((prev) => ({ ...prev, [index]: on }));
    if (!on) patchTier(index, { valid_from: undefined, valid_until: undefined });
  };
  // Map a picker field to the tier property it edits. start/end = sale window;
  // validStart/validEnd = entry-validity window.
  const salePickerKey = (field: SalePickerField): keyof Tier =>
    field === 'start' ? 'sale_start'
      : field === 'end' ? 'sale_end'
      : field === 'validStart' ? 'valid_from'
      : 'valid_until';
  // Open the shared picker for a given tier/bound/mode.
  const openSalePicker = (index: number, field: SalePickerField, mode: 'date' | 'time') => {
    closeAllPickers();
    Keyboard.dismiss();
    setSalePicker({ tierIndex: index, field, mode });
  };
  // Seed value for the picker: the tier's current bound, or now.
  const getSalePickerValue = (): Date => {
    if (!salePicker) return new Date();
    const tier = eventDraft.ticket_tiers[salePicker.tierIndex];
    const iso = tier?.[salePickerKey(salePicker.field)] as string | undefined;
    const d = iso ? new Date(iso) : new Date();
    return isNaN(d.getTime()) ? new Date() : d;
  };
  // On pick, compose the new ISO datetime (patch only the changed component) and
  // write it back to the tier.
  const handleSalePickerChange = (event: any, selected?: Date) => {
    if (Platform.OS === 'android') setSalePicker(null);
    if (!selected || !salePicker) return;
    const { tierIndex, field, mode } = salePicker;
    const key = salePickerKey(field);
    const existing = eventDraft.ticket_tiers[tierIndex]?.[key] as string | undefined;
    const base = existing ? new Date(existing) : new Date();
    if (isNaN(base.getTime())) base.setTime(Date.now());
    if (mode === 'date') {
      base.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
    } else {
      base.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    }
    patchTier(tierIndex, { [key]: base.toISOString() });
  };

  // ── Date/time helpers (ported verbatim from Step3ScheduleRefactored) ──
  const closeAllPickers = () => {
    setShowStartDate(false);
    setShowStartTime(false);
    setShowEndDate(false);
    setShowEndTime(false);
  };

  useEffect(() => {
    validateSchedule();
  }, [eventDraft.start_date, eventDraft.start_time, eventDraft.end_date, eventDraft.end_time]);

  // The moment a start date is set/changed, mirror it into the end date when the
  // end is still empty or now falls before the start — even if no time is set yet.
  // A valid, later end date the user already chose is left untouched.
  useEffect(() => {
    if (!eventDraft.start_date) return;
    if (!eventDraft.end_date || eventDraft.end_date < eventDraft.start_date) {
      updateDraft({ end_date: eventDraft.start_date });
    }
  }, [eventDraft.start_date]);

  // When a start time is set, push the end time to +1 hour (and keep end date valid).
  useEffect(() => {
    if (eventDraft.start_date && eventDraft.start_time) {
      const oneHourLater = addOneHour(eventDraft.start_time);
      const shouldUpdateEndDate = !eventDraft.end_date || eventDraft.end_date < eventDraft.start_date;
      updateDraft({
        end_date: shouldUpdateEndDate ? eventDraft.start_date : eventDraft.end_date,
        end_time: oneHourLater,
      });
    }
  }, [eventDraft.start_date, eventDraft.start_time]);

  const validateSchedule = (): boolean => {
    if (!eventDraft.start_date || !eventDraft.start_time || !eventDraft.end_date || !eventDraft.end_time) {
      setScheduleErrorKey(null);
      return false;
    }
    const start = combineDateAndTime(eventDraft.start_date, eventDraft.start_time);
    const end = combineDateAndTime(eventDraft.end_date, eventDraft.end_time);
    const now = new Date();
    if (start < now) {
      setScheduleErrorKey('organizerCreateEvent.schedule.errors.startInPast');
      return false;
    }
    if (end <= start) {
      setScheduleErrorKey('organizerCreateEvent.schedule.errors.endAfterStart');
      return false;
    }
    setScheduleErrorKey(null);
    return true;
  };

  const addOneHour = (timeStr: string): string => {
    const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (!match) return timeStr;
    let hours = parseInt(match[1]);
    const minutes = match[2];
    let period = match[3].toUpperCase();
    hours += 1;
    if (hours > 12) {
      hours = 1;
      period = period === 'AM' ? 'PM' : 'AM';
    } else if (hours === 12) {
      period = period === 'AM' ? 'PM' : 'AM';
    }
    return `${hours}:${minutes} ${period}`;
  };

  const combineDateAndTime = (dateStr: string, timeStr: string): Date => {
    const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (!match) return new Date(dateStr);
    let hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const period = match[3].toUpperCase();
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    const date = new Date(dateStr + 'T00:00:00');
    date.setHours(hours, minutes);
    return date;
  };

  const getDateValue = (dateStr: string): Date => {
    return dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
  };

  const getTimeValue = (timeStr: string): Date => {
    if (!timeStr) return new Date();
    const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (!match) return new Date();
    let hours = parseInt(match[1]);
    const minutes = parseInt(match[2]);
    const period = match[3].toUpperCase();
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    const date = new Date();
    date.setHours(hours, minutes);
    return date;
  };

  const handleStartDateChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') setShowStartDate(false);
    if (selectedDate) updateDraft({ start_date: selectedDate.toISOString().split('T')[0] });
  };
  const handleEndDateChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') setShowEndDate(false);
    if (selectedDate) updateDraft({ end_date: selectedDate.toISOString().split('T')[0] });
  };
  // Recurring "until date" — stores an ISO date (YYYY-MM-DD) in recurrence_end_date.
  const handleRecurrenceEndDateChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') setShowRecurrenceEndDate(false);
    if (selectedDate) updateDraft({ recurrence_end_date: selectedDate.toISOString().split('T')[0] });
  };
  const handleStartTimeChange = (event: any, selectedTime?: Date) => {
    if (Platform.OS === 'android') setShowStartTime(false);
    if (selectedTime) {
      const hours = selectedTime.getHours();
      const minutes = selectedTime.getMinutes().toString().padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 || 12;
      updateDraft({ start_time: `${displayHours}:${minutes} ${ampm}` });
    }
  };
  const handleEndTimeChange = (event: any, selectedTime?: Date) => {
    if (Platform.OS === 'android') setShowEndTime(false);
    if (selectedTime) {
      const hours = selectedTime.getHours();
      const minutes = selectedTime.getMinutes().toString().padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 || 12;
      updateDraft({ end_time: `${displayHours}:${minutes} ${ampm}` });
    }
  };

  // iOS picker modal — fixed 240px height container is CRITICAL (ported from Step3).
  const renderPickerModal = (
    visible: boolean,
    title: string,
    value: Date,
    mode: 'date' | 'time',
    onChange: (event: any, date?: Date) => void,
    onClose: () => void,
    minimumDate?: Date
  ) => {
    if (Platform.OS === 'android') return null;
    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
          <SafeAreaView style={styles.modalSafeArea}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <TouchableOpacity onPress={onClose}>
                  <Text style={styles.modalButton}>{t('common.cancel')}</Text>
                </TouchableOpacity>
                <Text style={styles.modalTitle}>{title}</Text>
                <TouchableOpacity onPress={onClose}>
                  <Text style={[styles.modalButton, styles.modalButtonDone]}>{t('common.done')}</Text>
                </TouchableOpacity>
              </View>
              {/* CRITICAL: fixed-height container or the picker renders at 0 height. */}
              <View style={styles.pickerContainer}>
                <DateTimePicker
                  value={value}
                  mode={mode}
                  is24Hour={false}
                  display="spinner"
                  onChange={onChange}
                  textColor={colors.text}
                  minimumDate={minimumDate}
                  style={styles.pickerSpinner}
                />
              </View>
            </View>
          </SafeAreaView>
        </TouchableOpacity>
      </Modal>
    );
  };

  /**
   * Validate the whole draft on Save. Sets inline per-field errors (the inline
   * rows show red). No step-jumping — this is a single canvas.
   */
  const validateForSubmit = (): boolean => {
    const errs: FieldErrors = {};
    if (!eventDraft.title.trim()) errs.title = t('organizerCreateEventFlow.validation.title');
    if (!eventDraft.venue_name.trim()) errs.venue_name = t('organizerCreateEventFlow.validation.venue');
    if (!eventDraft.start_date || !eventDraft.start_time) errs.start = t('organizerCreateEventFlow.validation.startDate');
    if (!eventDraft.end_date || !eventDraft.end_time) errs.end = t('organizerCreateEventFlow.validation.endDate');

    if (eventDraft.is_rsvp) {
      const cap = parseInt(eventDraft.capacity || '0', 10);
      if (!Number.isFinite(cap) || cap <= 0) errs.capacity = t('organizerCreateEventFlow.validation.capacity');
    } else {
      eventDraft.ticket_tiers.forEach((tier, i) => {
        if (!tier.name.trim()) errs[`tier_${i}_name`] = t('organizerCreateEventFlow.validation.tierName');
        // Free tier (price 0) is valid; only reject empty/negative/non-numeric.
        const price = parseFloat(tier.price);
        if (tier.price === '' || !Number.isFinite(price) || price < 0) errs[`tier_${i}_price`] = t('organizerCreateEventFlow.validation.tierPrice');
        // Unlimited tiers have no cap, so skip the quantity requirement.
        if (!tier.unlimited) {
          const qty = parseInt(tier.quantity || '0', 10);
          if (!Number.isFinite(qty) || qty <= 0) errs[`tier_${i}_quantity`] = t('organizerCreateEventFlow.validation.tierQuantity');
        }
        // Sale window: when both bounds are set, end must be after start.
        if (tier.sale_start && tier.sale_end) {
          const s = new Date(tier.sale_start).getTime();
          const e = new Date(tier.sale_end).getTime();
          if (Number.isFinite(s) && Number.isFinite(e) && e <= s) {
            errs[`tier_${i}_sale`] = t('organizerCreateEventFlow.canvas.saleEndBeforeStart');
          }
        }
        // Validity window: when both bounds are set, valid_until must be after valid_from.
        if (tier.valid_from && tier.valid_until) {
          const vs = new Date(tier.valid_from).getTime();
          const ve = new Date(tier.valid_until).getTime();
          if (Number.isFinite(vs) && Number.isFinite(ve) && ve <= vs) {
            errs[`tier_${i}_validity`] = t('organizerCreateEventFlow.canvas.validEndBeforeStart');
          }
        }
      });
    }

    // Recurrence is create-only; clamp the count into 2–52 (no hard error — a
    // bad value just gets corrected before generation).
    if (eventDraft.recurrence !== 'none') {
      const clamped = Math.max(2, Math.min(52, Math.round(eventDraft.recurrence_count || 2)));
      if (clamped !== eventDraft.recurrence_count) updateDraft({ recurrence_count: clamped });
    }

    // Password protection: a weak/blank code is a footgun (an empty code makes
    // the event permanently unpurchasable server-side, a short one is
    // brute-forceable). Require a code on create and enforce a length floor.
    if (eventDraft.is_password_protected) {
      const code = eventDraft.access_code.trim();
      if (!isEditMode && !code) {
        errs.access_code = t('organizerCreateEventFlow.canvas.accessCodeRequired');
      } else if (code && code.length < 6) {
        errs.access_code = t('organizerCreateEventFlow.canvas.accessCodeTooShort');
      }
    }

    setErrors(errs);
    setErrorCount(Object.keys(errs).length);
    return Object.keys(errs).length === 0;
  };

  // Save: validate, then confirm-to-publish (create) or submit directly (edit).
  const handleSave = () => {
    if (!validateForSubmit()) {
      // Off-screen errors made Create feel broken: scroll back to the top so the
      // "Fix N field(s)" banner and the first required fields are visible.
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    if (isEditMode) {
      // Propagate to siblings only when the event is in a series and opted in.
      handleSubmit({ applyToSeries: !!seriesId && applyToSeries });
    } else {
      setConfirmVisible(true);
    }
  };

  // Normalize the draft into the CreateEventData shape. RSVP events collapse to
  // a single free tier sized by the attendance cap.
  // Unlimited tiers have no real cap; store a large sentinel so downstream
  // availability logic (tickets_available, sold-out checks) keeps working.
  const UNLIMITED_SENTINEL = '1000000';
  const buildEventData = () => {
    if (eventDraft.is_rsvp) {
      return {
        ...eventDraft,
        currency: eventDraft.currency || 'HTG',
        ticket_tiers: [
          { name: 'RSVP', price: '0', quantity: eventDraft.capacity || '0', description: '', unlimited: false },
        ],
      };
    }
    return {
      ...eventDraft,
      ticket_tiers: eventDraft.ticket_tiers.map((tier) => ({
        ...tier,
        quantity: tier.unlimited ? UNLIMITED_SENTINEL : tier.quantity,
      })),
    };
  };

  const handleSubmit = async (options: SaveEventOptions) => {
    if (!userProfile?.id) {
      showAlert(t('common.error'), t('organizerCreateEventFlow.authRequired'));
      return;
    }

    const eventData = buildEventData();

    // Paid events in Stripe Connect markets need a payout account that can
    // actually accept a charge. Ask the server rather than deciding here: this
    // used to read the payout profile from Firestore and pass as long as SOME
    // stripeAccountId was present, which a client cannot improve on — it cannot
    // see charges_enabled, so an id left over from a previous platform account
    // looked healthy and the organizer published tickets nobody could buy. It
    // also only covered US/CA and silently let paid FR events through.
    const draftCountry = String((eventDraft as any).country || 'HT').toUpperCase();
    const hasPaidTickets = !eventDraft.is_rsvp && (eventData.ticket_tiers || []).some((tier) => {
      const price = parseFloat(String((tier as any).price ?? '0'));
      return Number.isFinite(price) && price > 0;
    });
    // `publish` is undefined on the edit-mode save (handleSubmit({ applyToSeries }))
    // and on that path updateEvent() leaves is_published untouched — so an edit
    // only needs the gate when it explicitly asks to publish. createEvent()
    // instead treats undefined as publish (`options.publish !== false`), so a
    // create does need checking unless it explicitly asks for a draft.
    const wantsPublish = isEditMode ? options.publish === true : options.publish !== false;

    // Haiti and other non-Stripe markets are ungated at publish by design (KYC
    // lands at withdrawal), so skip the round trip entirely — that is the common
    // case, and it keeps event creation working offline for the main market.
    // The server re-decides this anyway; this only avoids asking when the answer
    // cannot be "no".
    const needsStripeGate = countrySupport(draftCountry)?.requiredProfile === 'stripe_connect';

    if (hasPaidTickets && wantsPublish && needsStripeGate) {
      let eligibility: { allowed?: boolean; reason?: string; retryable?: boolean } | null = null;
      try {
        eligibility = await backendJson(
          `/api/organizer/publish-eligibility?country=${encodeURIComponent(draftCountry)}`
        );
      } catch (err: any) {
        // Preflight itself failed (offline, server error). Don't strand the
        // organizer's work: saving a draft is always allowed, so fall back to
        // that rather than blocking, and say why.
        setConfirmVisible(false);
        showAlert(
          t('organizerCreateEventFlow.publishCheckFailed.title', { defaultValue: 'Could not check payout setup' }),
          err?.message ||
            t('organizerCreateEventFlow.publishCheckFailed.body', {
              defaultValue: "We couldn't confirm your payout account. Save as a draft and publish once you're back online.",
            })
        );
        return;
      }

      if (eligibility && eligibility.allowed === false) {
        setConfirmVisible(false);
        showAlert(
          t('organizerEarnings.stripeConnectRequired.title'),
          eligibility.reason || t('organizerEarnings.stripeConnectRequired.body'),
          [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('organizerEarnings.openPayoutSettings'),
              onPress: () => (navigation as any).navigate('OrganizerPayoutSettings'),
            },
          ]
        );
        return;
      }
    }

    setSaving(true);
    try {
      if (isEditMode && eventId) {
        // Update existing event
        await updateEvent(eventId, userProfile.id, eventData, options);
        console.log('Event updated with ID:', eventId);

        setConfirmVisible(false);
        showAlert(
          t('common.success'),
          t('organizerCreateEventFlow.updateSuccessBody'),
          [{ text: t('common.ok'), onPress: () => navigation.goBack() }]
        );
      } else {
        // Create new event
        const newEventId = await createEvent(userProfile.id, eventData, options);
        console.log('Event created with ID:', newEventId);

        setConfirmVisible(false);
        showAlert(
          t('common.success'),
          options.publish === false
            ? t('organizerCreateEventFlow.draftSuccessBody')
            : t('organizerCreateEventFlow.createSuccessBody'),
          [{ text: t('common.ok'), onPress: () => navigation.goBack() }]
        );
      }
    } catch (error: any) {
      console.error('Event save error:', error);
      setConfirmVisible(false);
      showAlert(
        t('common.error'),
        error.message || (isEditMode ? t('organizerCreateEventFlow.saveFailedUpdate') : t('organizerCreateEventFlow.saveFailedCreate'))
      );
    } finally {
      setSaving(false);
    }
  };

  if (loadingEvent) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>{t('organizerCreateEventFlow.loadingEvent')}</Text>
      </View>
    );
  }

  const confirmExit = () => {
    showAlert(t('organizerCreateEventFlow.discardTitle'), t('organizerCreateEventFlow.discardBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('organizerCreateEventFlow.leave'), style: 'destructive', onPress: () => navigation.goBack() },
    ]);
  };

  // ── Two-tile entry chooser (create mode only, POSH IMG_1843) ─────────────
  if (!entryChosen) {
    return (
      <SafeAreaView style={styles.safeArea}>
        {/* Premium backdrop: a dark concert photo (bundled, 130KB) drifting
            slowly under a heavy canvas scrim, so the serif title stays crisp
            and the motion reads as atmosphere rather than content. */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Animated.Image
            source={require('../../assets/create-entry-bg.jpg')}
            style={[
              StyleSheet.absoluteFill,
              {
                width: undefined,
                height: undefined,
                transform: [
                  { scale: entryDrift.interpolate({ inputRange: [0, 1], outputRange: [1.08, 1.16] }) },
                  { translateY: entryDrift.interpolate({ inputRange: [0, 1], outputRange: [0, -14] }) },
                ],
              },
            ]}
            resizeMode="cover"
          />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background, opacity: 0.78 }]} />
          <LinearGradient
            colors={[withAlpha(colors.background, 0.2), withAlpha(colors.background, 0.9), colors.background]}
            locations={[0, 0.62, 1]}
            style={StyleSheet.absoluteFill}
          />
        </View>
        <View style={styles.wrapper}>
          <View style={styles.entryHeader}>
            <TouchableOpacity
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              onPress={() => navigation.goBack()}
            >
              <Ionicons name="chevron-back" size={26} color={colors.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.entryBody}>
            <View style={styles.entryIntro}>
              <Text style={styles.entryKicker}>{t('organizerCreateEventFlow.entry.kicker')}</Text>
              <Text style={styles.entryTitle}>{t('organizerCreateEventFlow.entry.title')}</Text>
              <Text style={styles.entryLead}>{t('organizerCreateEventFlow.entry.lead')}</Text>
            </View>

            <View style={styles.entryTiles}>
              <TouchableOpacity
                style={styles.entryTile}
                activeOpacity={0.85}
                onPress={() => chooseMode(false)}
              >
                <View style={styles.entryTileIcon}>
                  <Ionicons name="pricetags-outline" size={24} color={colors.text} />
                </View>
                <View style={styles.entryTileText}>
                  <Text style={styles.entryTileLabel}>{t('organizerCreateEventFlow.entry.sellTitle')}</Text>
                  <Text style={styles.entryTileDesc}>{t('organizerCreateEventFlow.entry.sellDesc')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.entryTile}
                activeOpacity={0.85}
                onPress={() => chooseMode(true)}
              >
                <View style={styles.entryTileIcon}>
                  <Ionicons name="people-outline" size={24} color={colors.text} />
                </View>
                <View style={styles.entryTileText}>
                  <Text style={styles.entryTileLabel}>{t('organizerCreateEventFlow.entry.rsvpTitle')}</Text>
                  <Text style={styles.entryTileDesc}>{t('organizerCreateEventFlow.entry.rsvpDesc')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.entrySubtitle}>{t('organizerCreateEventFlow.entry.subtitle')}</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    // Plain View, deliberately NOT a KeyboardAvoidingView. The canvas used to be
    // wrapped in <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={-50}>
    // while the ScrollView below ALSO ran automaticallyAdjustKeyboardInsets. Two
    // keyboard-avoidance mechanisms fought over the same layout: the ScrollView
    // added a keyboard-sized contentInset.bottom (measured against the full-height
    // frame) at the same moment the KAV shrank that frame by keyboardHeight - 50.
    // On dismissal the inset was recomputed against the still-shrunken frame, so it
    // resolved to 0 overlap and the shrink/inset from the show pass survived —
    // leaving a scrollable void far past the end of the form that grew with every
    // focus/blur cycle ("scroll up infinitely" into empty black). iOS avoidance now
    // comes only from automaticallyAdjustKeyboardInsets, the same single-mechanism
    // pattern LoginScreen/SignupScreen settled on; Android keeps relying on the
    // window resize (the old KAV was already a no-op there, behavior={undefined}).
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.wrapper}>
          {/* Header — floats over the canvas so the form scrolls under the
              app's blurred chrome. It sits INSIDE the SafeAreaView, which has
              already paid the notch inset, so `styles.header` keeps its own
              paddingTop and deliberately overrides OverlayHeader's. */}
          <OverlayHeader style={styles.header} onHeight={onHeight}>
            <TouchableOpacity
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              onPress={confirmExit}
            >
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {isEditMode ? t('organizerCreateEventFlow.headerEdit') : t('organizerCreateEventFlow.headerCreate')}
            </Text>
            <View style={{ width: 24 }} />
          </OverlayHeader>

          {/* Single scrolling canvas */}
          <ScrollView
            ref={scrollRef}
            style={styles.content}
            // Bottom padding is exactly the pinned footer's measured height (plus a
            // small gap) so the last field clears the footer and nothing more. The
            // footer unmounts while the keyboard is up, so the pad drops with it —
            // no leftover empty band. automaticallyAdjustKeyboardInsets is the ONLY
            // keyboard-avoidance mechanism on this screen (see the wrapper comment):
            // it insets the bottom by the real keyboard overlap and undoes it on
            // dismiss, which keeps the scrollable area bounded by the form itself.
            contentContainerStyle={{
              // Reserve the overlay header's measured height so the first row
              // (the validation banner / flyer hero) doesn't start life hidden.
              paddingTop: headerH,
              paddingBottom: isKeyboardVisible ? keyboardHeight + 24 : footerHeight + 24,
            }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            automaticallyAdjustKeyboardInsets={false}
          >
            {/* Validation banner — surfaces the count of failed fields when Save
                is blocked, so errors below the fold don't read as a dead button. */}
            {errorCount > 0 && (
              <View style={styles.errorBanner}>
                <Ionicons name="alert-circle" size={18} color={colors.error} />
                <Text style={styles.errorBannerText}>
                  {t('organizerCreateEventFlow.validation.fixErrors').replace('{n}', String(errorCount))}
                </Text>
              </View>
            )}

            {/* Flyer hero (POSH IMG_1847) */}
            <TouchableOpacity
              style={[
                styles.flyerHero,
                // Once the poster's real dimensions are known, size the panel to
                // its true aspect so the image fills edge-to-edge (no letterbox).
                !!eventDraft.banner_image_url && posterAspect
                  ? { aspectRatio: posterAspect }
                  : null,
              ]}
              activeOpacity={0.9}
              onPress={() => setShowFlyerLibrary(true)}
            >
              {eventDraft.banner_image_url ? (
                <>
                  {/* Contained (never cropped) on the plain canvas — the earlier
                      blurred-cover backdrop made the poster hard to read
                      (tester: "remove the overlay background behind the poster"). */}
                  <Image
                    source={{ uri: eventDraft.banner_image_url }}
                    style={StyleSheet.absoluteFill}
                    contentFit="contain"
                    onLoad={(e) => {
                      const { width, height } = e.source ?? {};
                      if (width && height) {
                        // Clamp to [0.5, 1.6] so an extreme panorama/strip can't
                        // flatten or blow up the hero panel.
                        setPosterAspect(Math.min(1.6, Math.max(0.5, width / height)));
                      }
                    }}
                  />
                  {/* Top-only scrim keeps the Change-flyer pill readable without
                      dimming the whole poster. */}
                  <LinearGradient
                    colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0)']}
                    style={styles.flyerOverlay}
                  />
                  <View style={styles.changeFlyerPill}>
                    <Ionicons name="camera-outline" size={16} color={colors.white} />
                    <Text style={styles.changeFlyerText}>{t('organizerCreateEventFlow.canvas.changeFlyer')}</Text>
                  </View>
                </>
              ) : (
                <View style={styles.flyerEmpty}>
                  {/* A design-canvas base: a light-GREY slab (the elevation
                      ladder's top steps) + a faint graph-paper grid (Posh-style)
                      so the empty poster reads as a workspace to fill. It used
                      to run down to the canvas colour itself, which made the
                      dropzone near-black and indistinguishable from the page. */}
                  {/* VERTICAL fade only. The old diagonal ran darker toward the
                      bottom-right, so the panel's right edge dissolved into the
                      canvas and the whole dropzone read as off-centre with a
                      slanted top ("this poster is not centered"). Keeping the
                      light even left-to-right keeps the edges honest. */}
                  <LinearGradient
                    colors={[colors.surfaceRaised, colors.surface]}
                    start={{ x: 0.5, y: 0 }}
                    end={{ x: 0.5, y: 1 }}
                    style={StyleSheet.absoluteFill}
                  />
                  <GridCanvas lineColor="rgba(255,255,255,0.05)" />

                  <View style={styles.flyerContent}>
                    <Ionicons name="image-outline" size={28} color={colors.textSecondary} />
                    <Text style={styles.flyerTitle}>{t('organizerCreateEventFlow.canvas.flyerTitle')}</Text>
                    <Text style={styles.flyerSubtitle}>{t('organizerCreateEvent.basics.aspectRatio')}</Text>
                    <View style={styles.uploadPill}>
                      <Ionicons name="arrow-up-circle" size={18} color="#000000" />
                      <Text style={styles.uploadPillText}>{t('organizerCreateEventFlow.canvas.uploadFlyer')}</Text>
                    </View>
                  </View>
                </View>
              )}
            </TouchableOpacity>

            {/* Core inline fields */}
            <View style={styles.canvasPad}>
              <InlineTextRow
                colors={colors}
                placeholder={t('organizerCreateEventFlow.canvas.titlePlaceholder') + ' *'}
                value={eventDraft.title}
                onChangeText={(text) => updateDraft({ title: text })}
                error={!!errors.title}
                maxLength={100}
              />

              <InlineDateTimeRow
                colors={colors}
                label={t('organizerCreateEventFlow.canvas.start') + ' *'}
                dateText={eventDraft.start_date}
                timeText={eventDraft.start_time}
                timePlaceholder={t('organizerCreateEvent.schedule.selectTime')}
                onPressDate={() => { closeAllPickers(); Keyboard.dismiss(); setShowStartDate(true); }}
                onPressTime={() => { closeAllPickers(); Keyboard.dismiss(); setShowStartTime(true); }}
                error={!!errors.start}
              />
              <InlineDateTimeRow
                colors={colors}
                label={t('organizerCreateEventFlow.canvas.end') + ' *'}
                dateText={eventDraft.end_date}
                timeText={eventDraft.end_time}
                timePlaceholder={t('organizerCreateEvent.schedule.selectTime')}
                onPressDate={() => { closeAllPickers(); Keyboard.dismiss(); setShowEndDate(true); }}
                onPressTime={() => { closeAllPickers(); Keyboard.dismiss(); setShowEndTime(true); }}
                error={!!errors.end}
              />
              {scheduleErrorKey && (
                <View style={styles.scheduleError}>
                  <Ionicons name="alert-circle" size={16} color={colors.error} />
                  <Text style={styles.scheduleErrorText}>{t(scheduleErrorKey)}</Text>
                </View>
              )}

              <InlineTextRow
                colors={colors}
                placeholder={t('organizerCreateEvent.location.venueName') + ' *'}
                value={eventDraft.venue_name}
                onChangeText={(text) => updateDraft({ venue_name: text })}
                error={!!errors.venue_name}
              />
              <InlineTextRow
                colors={colors}
                placeholder={t('organizerCreateEvent.location.streetAddress')}
                value={eventDraft.address}
                onChangeText={(text) => updateDraft({ address: text })}
              />

              {/* Country + City — kept minimal for Haiti (POSH omits them). */}
              <View style={styles.chipBlock}>
                <Text style={styles.chipLabel}>{t('organizerCreateEvent.location.country')}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll}>
                  {orderedCountries.map((country: { code: string; name: string }) => (
                    <TouchableOpacity
                      key={country.code}
                      style={[styles.chip, selectedCountry === country.code && styles.chipActive]}
                      onPress={() => handleCountryChange(country.code)}
                    >
                      <Text style={[styles.chipText, selectedCountry === country.code && styles.chipTextActive]}>
                        {country.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                {/* Which payout regime this country implies, said at the moment
                    of choice. The rule is enforced server-side at publish
                    (getRequiredPayoutProfileIdForEventCountry), so an organizer
                    who only holds the other region's profile would otherwise
                    build a whole event before discovering it can't be paid. */}
                <Text style={styles.payoutRegimeNote}>
                  {isHaiti
                    ? t('organizerCreateEventFlow.payoutRegime.haiti')
                    : t('organizerCreateEventFlow.payoutRegime.international')}
                </Text>
                {/* One connected account, one fixed country: an event abroad
                    still pays, but converts into that account's currency. */}
                {payoutCountryMismatch ? (
                  <Text style={styles.payoutMismatchNote}>
                    {t('organizerCreateEventFlow.payoutRegime.countryMismatch')
                      .replace('{event}', countryName(selectedCountry))
                      .replace('{account}', countryName(payoutCountryMismatch))}
                  </Text>
                ) : null}
              </View>

              {isHaiti ? (
                <>
                  {/* Département → City (arrondissement) → Commune cascade (Haiti) */}
                  <View style={styles.chipBlock}>
                    <Text style={styles.chipLabel}>{t('organizerCreateEvent.location.department')}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll}>
                      {HAITI_DEPARTMENTS.map((dep) => (
                        <TouchableOpacity
                          key={dep}
                          style={[styles.chip, department === dep && styles.chipActive]}
                          onPress={() => handleDepartmentChange(dep)}
                        >
                          <Text style={[styles.chipText, department === dep && styles.chipTextActive]}>
                            {dep}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>

                  <View style={styles.chipBlock}>
                    <Text style={styles.chipLabel}>{t('organizerCreateEvent.location.city')}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll}>
                      {haitiCities.map((c) => (
                        <TouchableOpacity
                          key={c.name}
                          style={[styles.chip, eventDraft.city === c.name && styles.chipActive]}
                          onPress={() => updateDraft({ city: c.name, commune: '' })}
                        >
                          <Text style={[styles.chipText, eventDraft.city === c.name && styles.chipTextActive]}>
                            {c.name}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>

                  {/* Searchable commune — type to filter, tap a match, or free-text */}
                  <InlineTextRow
                    colors={colors}
                    placeholder={t('organizerCreateEvent.location.communeSearchPlaceholder')}
                    value={eventDraft.commune}
                    onChangeText={(text) => {
                      updateDraft({ commune: text });
                      setCommuneListOpen(true);
                    }}
                    onFocus={() => setCommuneListOpen(true)}
                  />
                  {communeListOpen && communeSuggestions.length > 0 && (
                    <View style={styles.communeList}>
                      {communeSuggestions.map((c) => (
                        <TouchableOpacity
                          key={c}
                          style={styles.communeItem}
                          onPress={() => selectCommune(c)}
                        >
                          <Ionicons name="location-outline" size={15} color={colors.textSecondary} />
                          <Text style={styles.communeItemText}>{c}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </>
              ) : (
                <>
                  {/* Non-Haiti: flat city chips + free-text commune */}
                  <View style={styles.chipBlock}>
                    <Text style={styles.chipLabel}>{t('organizerCreateEvent.location.city')}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll}>
                      {cities.map((city) => (
                        <TouchableOpacity
                          key={city}
                          style={[styles.chip, eventDraft.city === city && styles.chipActive]}
                          onPress={() => updateDraft({ city })}
                        >
                          <Text style={[styles.chipText, eventDraft.city === city && styles.chipTextActive]}>
                            {city}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>

                  <InlineTextRow
                    colors={colors}
                    placeholder={t('organizerCreateEvent.location.communeOptional')}
                    value={eventDraft.commune}
                    onChangeText={(text) => updateDraft({ commune: text })}
                  />
                </>
              )}

              {/* Category */}
              <View style={styles.chipBlock}>
                <Text style={styles.chipLabel}>{t('organizerCreateEvent.basics.category')}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll}>
                  {CATEGORIES.map((cat) => (
                    <TouchableOpacity
                      key={cat}
                      style={[styles.chip, eventDraft.category === cat && styles.chipActive]}
                      onPress={() => updateDraft({ category: cat })}
                    >
                      <Text style={[styles.chipText, eventDraft.category === cat && styles.chipTextActive]}>
                        {getCategoryLabel(cat)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </View>

            {/* Additional Details */}
            <View style={styles.canvasPad}>
              <Text style={styles.sectionHeader}>{t('organizerCreateEventFlow.canvas.additionalDetails')}</Text>
              <InlineTextRow
                colors={colors}
                placeholder={t('organizerCreateEventFlow.canvas.eventSummary')}
                value={eventDraft.description}
                onChangeText={(text) => updateDraft({ description: text })}
                multiline
                maxLength={2000}
              />
            </View>

            {/* Tickets */}
            <View style={styles.canvasPad}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionHeader}>{t('organizerCreateEventFlow.canvas.ticketsHeader')}</Text>
                {!eventDraft.is_rsvp && !countryComingSoon && (
                  <TouchableOpacity onPress={addTier} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="add-circle" size={26} color={colors.text} />
                  </TouchableOpacity>
                )}
              </View>

              {countryComingSoon && (
                <View style={styles.comingSoonNotice}>
                  <Ionicons name="time-outline" size={16} color={colors.textSecondary} />
                  <Text style={styles.comingSoonNoticeText}>
                    {t('organizerCreateEventFlow.canvas.paidComingSoon').replace(
                      '{country}',
                      countryName(selectedCountry)
                    )}
                  </Text>
                </View>
              )}

              {showStripePayoutNotice && (
                <View style={styles.stripeNotice}>
                  <Ionicons name="card-outline" size={18} color={colors.text} />
                  <View style={styles.stripeNoticeBody}>
                    <Text style={styles.stripeNoticeText}>
                      {t(
                        eventUsesStripeRail
                          ? 'organizerCreateEventFlow.canvas.stripePayoutNotice'
                          : 'organizerCreateEventFlow.canvas.haitiPayoutNotice'
                      )}
                    </Text>
                    <TouchableOpacity
                      onPress={() => (navigation as any).navigate('OrganizerPayoutSettings')}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Text style={styles.stripeNoticeCta}>
                        {t('organizerCreateEventFlow.canvas.stripePayoutCta')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {(eventDraft.is_rsvp || countryComingSoon) ? (
                <>
                  <InlineTextRow
                    colors={colors}
                    placeholder={t('organizerCreateEvent.rsvp.capLabel') + ' *'}
                    value={eventDraft.capacity}
                    onChangeText={(text) => updateDraft({ capacity: text })}
                    error={!!errors.capacity}
                    keyboardType="numeric"
                  />
                  <View style={styles.infoRow}>
                    <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
                    <Text style={styles.infoText}>{t('organizerCreateEvent.rsvp.infoText')}</Text>
                  </View>
                </>
              ) : (
                <>
                  {/* Currency control — derives from the selected country.
                      Multi-currency markets (HT → HTG/USD) get a chooser; single-
                      currency markets (US→USD, CA→CAD, FR→EUR) show a fixed label. */}
                  {(() => {
                    const allowed = currenciesForCountry(selectedCountry);
                    const options = allowed.length
                      ? allowed
                      : [defaultCurrencyForCountry(selectedCountry)];
                    if (options.length <= 1) {
                      return (
                        <View style={styles.currencyRow}>
                          <View style={[styles.currencyButton, styles.currencyButtonActive]}>
                            <Text style={[styles.currencyText, styles.currencyTextActive]}>
                              {options[0]}
                            </Text>
                          </View>
                        </View>
                      );
                    }
                    return (
                      <View style={styles.currencyRow}>
                        {options.map((cur) => (
                          <TouchableOpacity
                            key={cur}
                            style={[styles.currencyButton, eventDraft.currency === cur && styles.currencyButtonActive]}
                            onPress={() => updateDraft({ currency: cur })}
                          >
                            <Text style={[styles.currencyText, eventDraft.currency === cur && styles.currencyTextActive]}>
                              {cur}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    );
                  })()}

                  {eventDraft.ticket_tiers.map((tier, index) => {
                    // Free = price parses to exactly 0 (blank price is "not set").
                    const isFree = parseFloat(tier.price) === 0;
                    return (
                    <View key={index} style={styles.tierCard}>
                      <View style={styles.tierHeader}>
                        <Text style={styles.tierTitle}>
                          {t('organizerCreateEvent.tickets.tier')} {index + 1}
                        </Text>
                        {eventDraft.ticket_tiers.length > 1 && (
                          <TouchableOpacity
                            onPress={() => removeTier(index)}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Ionicons name="trash-outline" size={18} color={colors.error} />
                          </TouchableOpacity>
                        )}
                      </View>

                      <InlineTextRow
                        colors={colors}
                        placeholder={t('organizerCreateEvent.tickets.tierName') + ' *'}
                        value={tier.name}
                        onChangeText={(text) => updateTier(index, 'name', text)}
                        error={!!errors[`tier_${index}_name`]}
                      />

                      {/* Free-ticket toggle — teal on-state (semantic) */}
                      <View style={styles.tierToggleRow}>
                        <Text style={styles.tierToggleLabel}>{t('organizerCreateEventFlow.canvas.freeTicket')}</Text>
                        <Switch
                          value={isFree}
                          onValueChange={(v) => toggleFreeTier(index, v)}
                          trackColor={{ false: colors.border, true: colors.primary }}
                          thumbColor={colors.white}
                          ios_backgroundColor={colors.border}
                        />
                      </View>

                      <View style={styles.tierSplit}>
                        {/* Price hidden while free; shows a static "Free" chip instead. */}
                        <View style={styles.tierSplitCell}>
                          {isFree ? (
                            <View style={styles.tierStaticRow}>
                              <Text style={styles.tierStaticText}>
                                {getCurrencySymbol()} 0
                              </Text>
                            </View>
                          ) : (
                            <InlineTextRow
                              colors={colors}
                              placeholder={`${t('organizerCreateEvent.tickets.price')} (${getCurrencySymbol()}) *`}
                              value={tier.price}
                              onChangeText={(text) => updateTier(index, 'price', text)}
                              error={!!errors[`tier_${index}_price`]}
                              keyboardType="numeric"
                            />
                          )}
                        </View>
                        {/* Quantity hidden while unlimited; shows "Unlimited" instead. */}
                        <View style={styles.tierSplitCell}>
                          {tier.unlimited ? (
                            <View style={styles.tierStaticRow}>
                              <Text style={styles.tierStaticText}>
                                {t('organizerCreateEventFlow.canvas.unlimitedLabel')}
                              </Text>
                            </View>
                          ) : (
                            <InlineTextRow
                              colors={colors}
                              placeholder={t('organizerCreateEvent.tickets.quantity') + ' *'}
                              value={tier.quantity}
                              onChangeText={(text) => updateTier(index, 'quantity', text)}
                              error={!!errors[`tier_${index}_quantity`]}
                              keyboardType="numeric"
                            />
                          )}
                        </View>
                      </View>

                      {/* Unlimited-quantity toggle — teal on-state (semantic) */}
                      <View style={styles.tierToggleRow}>
                        <Text style={styles.tierToggleLabel}>{t('organizerCreateEventFlow.canvas.unlimitedQty')}</Text>
                        <Switch
                          value={tier.unlimited}
                          onValueChange={(v) => toggleUnlimitedTier(index, v)}
                          trackColor={{ false: colors.border, true: colors.primary }}
                          thumbColor={colors.white}
                          ios_backgroundColor={colors.border}
                        />
                      </View>

                      <InlineTextRow
                        colors={colors}
                        placeholder={t('organizerCreateEventFlow.canvas.ticketDescription')}
                        value={tier.description}
                        onChangeText={(text) => updateTier(index, 'description', text)}
                        multiline
                        maxLength={500}
                      />

                      {/* Sale period — optional per-tier on-sale window (teal on-state) */}
                      <View style={styles.tierToggleRow}>
                        <Text style={styles.tierToggleLabel}>{t('organizerCreateEventFlow.canvas.salePeriod')}</Text>
                        <Switch
                          value={isSalePeriodOpen(index, tier)}
                          onValueChange={(v) => toggleSalePeriod(index, v)}
                          trackColor={{ false: colors.border, true: colors.primary }}
                          thumbColor={colors.white}
                          ios_backgroundColor={colors.border}
                        />
                      </View>

                      {isSalePeriodOpen(index, tier) && (
                        <>
                          <InlineDateTimeRow
                            colors={colors}
                            label={t('organizerCreateEventFlow.canvas.salesStart')}
                            dateText={formatSaleDate(tier.sale_start)}
                            timeText={formatSaleTime(tier.sale_start)}
                            timePlaceholder={t('organizerCreateEvent.schedule.selectTime')}
                            onPressDate={() => openSalePicker(index, 'start', 'date')}
                            onPressTime={() => openSalePicker(index, 'start', 'time')}
                            error={!!errors[`tier_${index}_sale`]}
                          />
                          <InlineDateTimeRow
                            colors={colors}
                            label={t('organizerCreateEventFlow.canvas.salesEnd')}
                            dateText={formatSaleDate(tier.sale_end)}
                            timeText={formatSaleTime(tier.sale_end)}
                            timePlaceholder={t('organizerCreateEvent.schedule.selectTime')}
                            onPressDate={() => openSalePicker(index, 'end', 'date')}
                            onPressTime={() => openSalePicker(index, 'end', 'time')}
                            error={!!errors[`tier_${index}_sale`]}
                          />
                          {!!errors[`tier_${index}_sale`] && (
                            <View style={styles.scheduleError}>
                              <Ionicons name="alert-circle" size={16} color={colors.error} />
                              <Text style={styles.scheduleErrorText}>{errors[`tier_${index}_sale`]}</Text>
                            </View>
                          )}
                        </>
                      )}

                      {/* Validity period — optional per-tier entry-admission window
                          (distinct from the sale window; teal on-state) */}
                      <View style={styles.tierToggleRow}>
                        <Text style={styles.tierToggleLabel}>{t('organizerCreateEventFlow.canvas.validityPeriod')}</Text>
                        <Switch
                          value={isValidityPeriodOpen(index, tier)}
                          onValueChange={(v) => toggleValidityPeriod(index, v)}
                          trackColor={{ false: colors.border, true: colors.primary }}
                          thumbColor={colors.white}
                          ios_backgroundColor={colors.border}
                        />
                      </View>

                      {isValidityPeriodOpen(index, tier) && (
                        <>
                          <InlineDateTimeRow
                            colors={colors}
                            label={t('organizerCreateEventFlow.canvas.validFrom')}
                            dateText={formatSaleDate(tier.valid_from)}
                            timeText={formatSaleTime(tier.valid_from)}
                            timePlaceholder={t('organizerCreateEvent.schedule.selectTime')}
                            onPressDate={() => openSalePicker(index, 'validStart', 'date')}
                            onPressTime={() => openSalePicker(index, 'validStart', 'time')}
                            error={!!errors[`tier_${index}_validity`]}
                          />
                          <InlineDateTimeRow
                            colors={colors}
                            label={t('organizerCreateEventFlow.canvas.validUntil')}
                            dateText={formatSaleDate(tier.valid_until)}
                            timeText={formatSaleTime(tier.valid_until)}
                            timePlaceholder={t('organizerCreateEvent.schedule.selectTime')}
                            onPressDate={() => openSalePicker(index, 'validEnd', 'date')}
                            onPressTime={() => openSalePicker(index, 'validEnd', 'time')}
                            error={!!errors[`tier_${index}_validity`]}
                          />
                          {!!errors[`tier_${index}_validity`] && (
                            <View style={styles.scheduleError}>
                              <Ionicons name="alert-circle" size={16} color={colors.error} />
                              <Text style={styles.scheduleErrorText}>{errors[`tier_${index}_validity`]}</Text>
                            </View>
                          )}
                        </>
                      )}
                    </View>
                    );
                  })}

                  <TouchableOpacity style={styles.addTierRow} onPress={addTier}>
                    <Ionicons name="add" size={20} color={colors.text} />
                    <Text style={styles.addTierText}>{t('organizerCreateEventFlow.canvas.addTicketType')}</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>

            {/* ── Advanced settings disclosure (POSH Show/Hide advanced settings) ── */}
            <View style={styles.canvasPad}>
              <TouchableOpacity
                style={styles.advancedToggle}
                activeOpacity={0.7}
                onPress={() => setAdvancedOpen((v) => !v)}
              >
                <Text style={styles.advancedToggleText}>
                  {advancedOpen
                    ? t('organizerCreateEventFlow.canvas.advancedHide')
                    : t('organizerCreateEventFlow.canvas.advancedShow')}
                </Text>
                <Ionicons
                  name={advancedOpen ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>

              {advancedOpen && (
                <>
                  {/* Repeats — recurring-event generator (create-only; hidden in edit) */}
                  {!isEditMode && (
                    <View style={styles.repeatBlock}>
                      <Text style={styles.chipLabel}>{t('organizerCreateEventFlow.canvas.repeats')}</Text>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.chipScroll}
                      >
                        {RECURRENCE_OPTIONS.map((opt) => (
                          <TouchableOpacity
                            key={opt.value}
                            style={[styles.chip, eventDraft.recurrence === opt.value && styles.chipActive]}
                            onPress={() => updateDraft({ recurrence: opt.value })}
                          >
                            <Text style={[styles.chipText, eventDraft.recurrence === opt.value && styles.chipTextActive]}>
                              {t(opt.labelKey)}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>

                      {eventDraft.recurrence !== 'none' && (
                        <>
                          {/* Repeat mode: by Count vs Until a date (only one active) */}
                          <View style={styles.currencyRow}>
                            <TouchableOpacity
                              style={[styles.currencyButton, recurrenceMode === 'count' && styles.currencyButtonActive]}
                              onPress={() => { setRecurrenceMode('count'); updateDraft({ recurrence_end_date: '' }); }}
                            >
                              <Text style={[styles.currencyText, recurrenceMode === 'count' && styles.currencyTextActive]}>
                                {t('organizerCreateEventFlow.canvas.repeatByCount')}
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.currencyButton, recurrenceMode === 'until' && styles.currencyButtonActive]}
                              onPress={() => setRecurrenceMode('until')}
                            >
                              <Text style={[styles.currencyText, recurrenceMode === 'until' && styles.currencyTextActive]}>
                                {t('organizerCreateEventFlow.canvas.repeatUntil')}
                              </Text>
                            </TouchableOpacity>
                          </View>

                          {recurrenceMode === 'count' ? (
                            <>
                              {/* Number of dates stepper (clamped 2–52) */}
                              <View style={styles.stepperRow}>
                                <Text style={styles.stepperLabel}>{t('organizerCreateEventFlow.canvas.repeatCount')}</Text>
                                <View style={styles.stepper}>
                                  <TouchableOpacity
                                    style={styles.stepperBtn}
                                    onPress={() => updateDraft({ recurrence_count: Math.max(2, eventDraft.recurrence_count - 1) })}
                                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                  >
                                    <Ionicons name="remove" size={20} color={colors.text} />
                                  </TouchableOpacity>
                                  <Text style={styles.stepperValue}>{eventDraft.recurrence_count}</Text>
                                  <TouchableOpacity
                                    style={styles.stepperBtn}
                                    onPress={() => updateDraft({ recurrence_count: Math.min(52, eventDraft.recurrence_count + 1) })}
                                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                  >
                                    <Ionicons name="add" size={20} color={colors.text} />
                                  </TouchableOpacity>
                                </View>
                              </View>
                              <View style={styles.infoRow}>
                                <Ionicons name="repeat-outline" size={16} color={colors.textSecondary} />
                                <Text style={styles.infoText}>
                                  {t('organizerCreateEventFlow.canvas.repeatHint').replace('{n}', String(eventDraft.recurrence_count))}
                                </Text>
                              </View>
                            </>
                          ) : (
                            <>
                              {/* Until-date picker → recurrence_end_date */}
                              <InlineDateTimeRow
                                colors={colors}
                                label={t('organizerCreateEventFlow.canvas.repeatUntil')}
                                dateText={eventDraft.recurrence_end_date}
                                timeText=""
                                timePlaceholder=""
                                onPressDate={() => { closeAllPickers(); Keyboard.dismiss(); setShowRecurrenceEndDate(true); }}
                                onPressTime={() => { closeAllPickers(); Keyboard.dismiss(); setShowRecurrenceEndDate(true); }}
                              />
                              <View style={styles.infoRow}>
                                <Ionicons name="repeat-outline" size={16} color={colors.textSecondary} />
                                <Text style={styles.infoText}>
                                  {t('organizerCreateEventFlow.canvas.repeatUntilHint')}
                                </Text>
                              </View>
                            </>
                          )}
                        </>
                      )}
                    </View>
                  )}

                  {/* Apply-to-series — edit mode only, shown when the event is
                      part of a recurring series (has a series_id). */}
                  {isEditMode && !!seriesId && (
                    <View style={styles.settingRow}>
                      <View style={styles.settingTextCol}>
                        <Text style={styles.settingLabel}>{t('organizerCreateEventFlow.canvas.applyToSeries')}</Text>
                      </View>
                      <Switch
                        value={applyToSeries}
                        onValueChange={setApplyToSeries}
                        trackColor={{ false: colors.border, true: colors.primary }}
                        thumbColor={colors.white}
                        ios_backgroundColor={colors.border}
                      />
                    </View>
                  )}

                  {/* Visibility — Show on Explore */}
                  <View style={styles.settingRow}>
                    <View style={styles.settingTextCol}>
                      <Text style={styles.settingLabel}>{t('organizerCreateEventFlow.canvas.visibility')}</Text>
                      <Text style={styles.settingHint}>{t('organizerCreateEventFlow.canvas.visibilityHint')}</Text>
                    </View>
                    <Switch
                      value={eventDraft.show_on_explore}
                      onValueChange={(v) => updateDraft({ show_on_explore: v })}
                      trackColor={{ false: colors.border, true: colors.primary }}
                      thumbColor={colors.white}
                      ios_backgroundColor={colors.border}
                    />
                  </View>

                  {/* Promo video link */}
                  <InlineTextRow
                    colors={colors}
                    placeholder={t('organizerCreateEventFlow.canvas.promoVideo')}
                    value={eventDraft.video_url}
                    onChangeText={(text) => updateDraft({ video_url: text })}
                    keyboardType="url"
                    autoCapitalize="none"
                  />

                  {/* Song — a real Spotify search; degrades to pasting a link
                      when /api/spotify/search has no credentials. */}
                  <SpotifySongPicker
                    colors={colors}
                    value={eventDraft.spotify_url}
                    onChange={(url) => updateDraft({ spotify_url: url })}
                  />

                  {/* Guest list visibility */}
                  <View style={styles.settingRow}>
                    <View style={styles.settingTextCol}>
                      <Text style={styles.settingLabel}>{t('organizerCreateEventFlow.canvas.showGuestlist')}</Text>
                      <Text style={styles.settingHint}>{t('organizerCreateEventFlow.canvas.showGuestlistHint')}</Text>
                    </View>
                    <Switch
                      value={eventDraft.show_guestlist}
                      onValueChange={(v) => updateDraft({ show_guestlist: v })}
                      trackColor={{ false: colors.border, true: colors.primary }}
                      thumbColor={colors.white}
                      ios_backgroundColor={colors.border}
                    />
                  </View>

                  {/* Password protection — gate ticketing behind an access code.
                      The code is hashed on save (never stored in plaintext). */}
                  <View style={styles.settingRow}>
                    <View style={styles.settingTextCol}>
                      <Text style={styles.settingLabel}>{t('organizerCreateEventFlow.canvas.passwordProtect')}</Text>
                      <Text style={styles.settingHint}>{t('organizerCreateEventFlow.canvas.accessCodeHint')}</Text>
                    </View>
                    <Switch
                      value={eventDraft.is_password_protected}
                      onValueChange={(v) => updateDraft({ is_password_protected: v })}
                      trackColor={{ false: colors.border, true: colors.primary }}
                      thumbColor={colors.white}
                      ios_backgroundColor={colors.border}
                    />
                  </View>

                  {eventDraft.is_password_protected && (
                    <>
                      <InlineTextRow
                        colors={colors}
                        placeholder={
                          isEditMode
                            ? t('organizerCreateEventFlow.canvas.accessCodeEditPlaceholder')
                            : t('organizerCreateEventFlow.canvas.accessCode')
                        }
                        value={eventDraft.access_code}
                        onChangeText={(text) => updateDraft({ access_code: text })}
                        error={!!errors.access_code}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      {!!errors.access_code && (
                        <Text style={styles.scheduleErrorText}>{errors.access_code}</Text>
                      )}
                    </>
                  )}

                  {/* Poster theme — override the auto-picked gradient. Auto (default)
                      clears the override; a swatch pins that theme everywhere the
                      event's poster is rendered. */}
                  <View style={styles.chipBlock}>
                    <Text style={styles.chipLabel}>{t('organizerCreateEventFlow.canvas.posterTheme')}</Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.chipScroll}
                    >
                      {/* Auto chip — selected when no override is set */}
                      <TouchableOpacity
                        style={[styles.chip, eventDraft.theme_key === '' && styles.chipActive]}
                        onPress={() => updateDraft({ theme_key: '' })}
                      >
                        <Text style={[styles.chipText, eventDraft.theme_key === '' && styles.chipTextActive]}>
                          {t('organizerCreateEventFlow.canvas.posterThemeAuto')}
                        </Text>
                      </TouchableOpacity>

                      {/* One swatch per theme, rendered in that theme's gradient */}
                      {POSTER_THEME_KEYS.map((key) => {
                        const selected = eventDraft.theme_key === key;
                        const theme = resolvePosterTheme({ theme_key: key });
                        return (
                          <TouchableOpacity
                            key={key}
                            style={[styles.themeSwatch, selected && styles.themeSwatchSelected]}
                            activeOpacity={0.8}
                            onPress={() => updateDraft({ theme_key: key })}
                          >
                            <LinearGradient
                              colors={theme.colors}
                              start={{ x: 0, y: 0 }}
                              end={{ x: 1, y: 1 }}
                              style={StyleSheet.absoluteFill}
                            />
                            {selected && (
                              <View style={styles.themeSwatchCheck}>
                                <Ionicons name="checkmark" size={16} color={colors.white} />
                              </View>
                            )}
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>
                </>
              )}
            </View>
          </ScrollView>

          {/* Footer — persistent, hidden when keyboard is visible (POSH IMG_1848) */}
          {!isKeyboardVisible && (
            <View
              style={styles.footer}
              onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)}
            >
              <TouchableOpacity style={styles.backButton} onPress={confirmExit}>
                <Text style={styles.backButtonText}>{t('common.back')}</Text>
              </TouchableOpacity>
              <WhitePillCTA
                label={isEditMode ? t('organizerCreateEventFlow.updateEvent') : t('organizerCreateEventFlow.createEvent')}
                onPress={handleSave}
                disabled={saving}
                style={styles.footerCta}
              />
            </View>
          )}
        </View>
      </SafeAreaView>

      {/* iOS date/time picker modals (Android uses inline native dialogs below) */}
      {renderPickerModal(
        showStartDate,
        t('organizerCreateEvent.schedule.modalStartDate'),
        getDateValue(eventDraft.start_date),
        'date',
        handleStartDateChange,
        () => setShowStartDate(false),
        undefined
      )}
      {renderPickerModal(
        showEndDate,
        t('organizerCreateEvent.schedule.modalEndDate'),
        getDateValue(eventDraft.end_date),
        'date',
        handleEndDateChange,
        () => setShowEndDate(false),
        eventDraft.start_date ? new Date(eventDraft.start_date) : undefined
      )}
      {renderPickerModal(
        showStartTime,
        t('organizerCreateEvent.schedule.modalStartTime'),
        getTimeValue(eventDraft.start_time),
        'time',
        handleStartTimeChange,
        () => setShowStartTime(false)
      )}
      {renderPickerModal(
        showEndTime,
        t('organizerCreateEvent.schedule.modalEndTime'),
        getTimeValue(eventDraft.end_time),
        'time',
        handleEndTimeChange,
        () => setShowEndTime(false)
      )}

      {/* Android inline pickers (auto-dismiss native dialogs) */}
      {Platform.OS === 'android' && showStartDate && (
        <DateTimePicker value={getDateValue(eventDraft.start_date)} mode="date" display="default" onChange={handleStartDateChange} />
      )}
      {Platform.OS === 'android' && showStartTime && (
        <DateTimePicker value={getTimeValue(eventDraft.start_time)} mode="time" is24Hour={false} display="default" onChange={handleStartTimeChange} />
      )}
      {Platform.OS === 'android' && showEndDate && (
        <DateTimePicker value={getDateValue(eventDraft.end_date)} mode="date" display="default" onChange={handleEndDateChange} minimumDate={eventDraft.start_date ? new Date(eventDraft.start_date) : undefined} />
      )}
      {Platform.OS === 'android' && showEndTime && (
        <DateTimePicker value={getTimeValue(eventDraft.end_time)} mode="time" is24Hour={false} display="default" onChange={handleEndTimeChange} />
      )}

      {/* Shared per-tier sale/validity-window picker (iOS modal). One modal serves
          every tier — salePicker holds which tier/bound/mode is being edited. */}
      {renderPickerModal(
        salePicker !== null,
        salePicker?.field === 'end'
          ? t('organizerCreateEventFlow.canvas.salesEnd')
          : salePicker?.field === 'validStart'
          ? t('organizerCreateEventFlow.canvas.validFrom')
          : salePicker?.field === 'validEnd'
          ? t('organizerCreateEventFlow.canvas.validUntil')
          : t('organizerCreateEventFlow.canvas.salesStart'),
        getSalePickerValue(),
        salePicker?.mode || 'date',
        handleSalePickerChange,
        () => setSalePicker(null)
      )}
      {/* Android inline sale-window picker (auto-dismissing native dialog) */}
      {Platform.OS === 'android' && salePicker && (
        <DateTimePicker
          value={getSalePickerValue()}
          mode={salePicker.mode}
          is24Hour={false}
          display="default"
          onChange={handleSalePickerChange}
        />
      )}

      {/* Recurring "until date" picker → recurrence_end_date (create-only). */}
      {renderPickerModal(
        showRecurrenceEndDate,
        t('organizerCreateEventFlow.canvas.repeatUntil'),
        getDateValue(eventDraft.recurrence_end_date),
        'date',
        handleRecurrenceEndDateChange,
        () => setShowRecurrenceEndDate(false),
        eventDraft.start_date ? new Date(eventDraft.start_date) : undefined
      )}
      {Platform.OS === 'android' && showRecurrenceEndDate && (
        <DateTimePicker
          value={getDateValue(eventDraft.recurrence_end_date)}
          mode="date"
          display="default"
          onChange={handleRecurrenceEndDateChange}
          minimumDate={eventDraft.start_date ? new Date(eventDraft.start_date) : undefined}
        />
      )}

      {/* Confirmation-before-publish sheet with save-as-draft escape hatch */}
      <Modal
        visible={confirmVisible}
        transparent
        animationType="slide"
        onRequestClose={() => !saving && setConfirmVisible(false)}
      >
        <View style={styles.sheetBackdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => !saving && setConfirmVisible(false)}
          />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{t('organizerCreateEventFlow.confirm.title')}</Text>
            <Text style={styles.sheetBody}>
              {eventDraft.recurrence !== 'none'
                ? t('organizerCreateEventFlow.canvas.repeatHint').replace('{n}', String(eventDraft.recurrence_count))
                : t('organizerCreateEventFlow.confirm.body')}
            </Text>

            <WhitePillCTA
              label={t('organizerCreateEventFlow.confirm.publish')}
              variant="paid"
              onPress={() => handleSubmit({ publish: true })}
              loading={saving}
              disabled={saving}
              style={styles.sheetPublish}
            />

            <TouchableOpacity
              style={styles.sheetDraft}
              disabled={saving}
              onPress={() => handleSubmit({ publish: false })}
            >
              <Text style={styles.sheetDraftText}>
                {t('organizerCreateEventFlow.confirm.saveDraft')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      <FlyerLibrarySheet
        visible={showFlyerLibrary}
        onClose={() => setShowFlyerLibrary(false)}
        onSelect={(f: SelectedFlyer) => updateDraft({ banner_image_url: f.url })}
        onUpload={() => {
          setShowFlyerLibrary(false);
          pickImage();
        }}
      />
    </View>
  );
}

/**
 * Corner radius of the flyer panel — `radius.sm`, the poster-preview rounding
 * posh uses: the flyer reads as near-full-bleed artwork with a whisper of
 * rounding, not a soft capsule slab (the old 40 made the poster read as a
 * decorative blob instead of the event's actual artwork).
 */
const FLYER_RADIUS = radius.sm;

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: colors.textSecondary,
  },
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  wrapper: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  headerTitle: {
    // Serif screen title — the flow's screens speak in the same editorial
    // voice as the rest of the organizer surface (OrganizerScreenHeader).
    fontFamily: font.serif,
    fontSize: 20,
    lineHeight: 24,
    color: colors.text,
  },

  // ── Entry chooser (two big square tiles) ──
  entryHeader: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  entryBody: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 28,
  },
  entryIntro: {
    gap: 12,
  },
  entryKicker: {
    fontSize: 12,
    letterSpacing: 2,
    color: colors.textTertiary,
  },
  entryTitle: {
    fontFamily: font.serif,
    fontSize: 40,
    lineHeight: 44,
    color: colors.text,
  },
  entryLead: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    maxWidth: 320,
  },
  entryTiles: {
    gap: 12,
  },
  entryTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    borderRadius: RADIUS.xl,
    // Elevation is the brightness step alone — no box outline (tokens §canvas).
    backgroundColor: colors.surfaceRaised,
    paddingVertical: 18,
    paddingHorizontal: 18,
  },
  entryTileIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  entryTileText: {
    flex: 1,
    gap: 3,
  },
  entryTileLabel: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  entryTileDesc: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  entrySubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },

  content: {
    flex: 1,
  },
  canvasPad: {
    // 16 — the same gutter the flyer hero, error banner and footer use, so
    // every hairline row starts on one shared left edge.
    paddingHorizontal: 16,
    paddingTop: 8,
  },

  // ── Flyer hero ──
  flyerHero: {
    // 2:3 portrait dropzone by default; once a poster loads, the container
    // takes the image's TRUE aspect (see posterAspect) so nothing letterboxes.
    aspectRatio: 2 / 3,
    borderRadius: FLYER_RADIUS,
    marginHorizontal: 16,
    marginBottom: 12,
    overflow: 'hidden',
    // Pure canvas black so a contained (non-2:3) poster letterboxes invisibly
    // instead of sitting in a gray box.
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flyerEmpty: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flyerContent: {
    // Stretch so the upload pill can run full-width like posh's
    // "Upload an image" CTA.
    alignSelf: 'stretch',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 24,
  },
  flyerTitle: {
    fontFamily: font.serif,
    fontSize: 30,
    lineHeight: 34,
    color: colors.text,
    textAlign: 'center',
  },
  flyerSubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: -6,
  },
  // Full-width solid-white pill, 56pt — reads exactly like posh's
  // "Upload an image" CTA (and matches WhitePillCTA's primary geometry).
  uploadPill: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 56,
    paddingHorizontal: 22,
    borderRadius: radius.button,
    backgroundColor: colors.white,
    marginTop: 4,
  },
  uploadPillText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000000',
  },
  flyerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 90,
  },
  changeFlyerPill: {
    position: 'absolute',
    top: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.button,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  changeFlyerText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.white,
  },

  // ── Section headers ──
  // Quiet sentence-case eyebrow (tokens type.sectionEyebrow / posh's muted
  // "Additional Details" / "Tickets" labels) — not a shouting uppercase band.
  sectionHeader: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.3,
    color: colors.textSecondary,
    marginTop: 20,
    marginBottom: 4,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  // ── Chips (country / city / category) ──
  chipBlock: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 10,
  },
  chipLabel: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  chipScroll: {
    gap: 8,
    paddingVertical: 2,
  },
  payoutRegimeNote: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
    marginTop: 8,
  },
  // Advisory, not an error: it warns about an FX conversion, it never blocks.
  payoutMismatchNote: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.warning ?? '#F5A524',
    marginTop: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.chip,
    backgroundColor: colors.surfaceRaised,
  },
  chipActive: {
    // Teal = the selected-state marker (semantic, POSH §1).
    backgroundColor: colors.primary,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  chipTextActive: {
    color: colors.onPrimary,
  },

  // ── Poster-theme swatches ──
  themeSwatch: {
    width: 56,
    height: 40,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  themeSwatchSelected: {
    // Teal ring = the selected-state marker (semantic, matches chipActive).
    borderColor: colors.primary,
  },
  themeSwatchCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Commune search dropdown (Haiti) ──
  communeList: {
    marginTop: 4,
    marginBottom: 4,
    borderRadius: RADIUS.md,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  communeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  communeItemText: {
    fontSize: 15,
    color: colors.text,
  },

  // ── Schedule inline error ──
  scheduleError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  scheduleErrorText: {
    flex: 1,
    fontSize: 13,
    color: colors.error,
    fontWeight: '500',
  },

  // ── Info row (RSVP) ──
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  infoText: {
    flex: 1,
    fontSize: 13,
    color: colors.textSecondary,
  },
  comingSoonNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginTop: 10,
    borderRadius: RADIUS.md,
    // Brightness step, no outline (tokens: borders are dividers, not boxes).
    backgroundColor: colors.surface,
  },
  comingSoonNoticeText: {
    flex: 1,
    fontSize: 13,
    color: colors.textSecondary,
  },
  // Inline US/CA paid-payout guidance at the top of the tickets section.
  stripeNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginTop: 10,
    borderRadius: RADIUS.md,
    // Brightness step, no outline (tokens: borders are dividers, not boxes).
    backgroundColor: colors.surface,
  },
  stripeNoticeBody: {
    flex: 1,
    gap: 6,
  },
  stripeNoticeText: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  stripeNoticeCta: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
  },
  // Save-blocked validation banner (top of canvas).
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: RADIUS.md,
    // Tinted fill alone carries the state — no outline around the banner.
    backgroundColor: colors.error + '15',
  },
  errorBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: colors.error,
  },

  // ── Tickets ──
  currencyRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    marginBottom: 4,
  },
  currencyButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: RADIUS.md,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  currencyButtonActive: {
    backgroundColor: colors.primary,
  },
  currencyText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  currencyTextActive: {
    color: colors.onPrimary,
  },
  tierCard: {
    backgroundColor: colors.surface,
    borderRadius: RADIUS.lg,
    paddingHorizontal: 14,
    paddingBottom: 4,
    marginTop: 14,
  },
  tierHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
  },
  tierTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  tierSplit: {
    flexDirection: 'row',
    gap: 16,
  },
  tierSplitCell: {
    flex: 1,
  },
  // Quiet outlined secondary (44pt tertiary-action height).
  addTierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 44,
    marginTop: 12,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.border,
  },
  addTierText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  // Row for the per-tier Free / Unlimited switches.
  tierToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  tierToggleLabel: {
    fontSize: 15,
    color: colors.text,
  },
  // Static replacement shown when Free (price) or Unlimited (qty) hides an input.
  tierStaticRow: {
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  tierStaticText: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
  },

  // ── Advanced settings disclosure ──
  advancedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 18,
    marginTop: 12,
  },
  advancedToggleText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  settingTextCol: {
    flex: 1,
    gap: 4,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  settingHint: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },

  // ── Repeats (recurring events) ──
  repeatBlock: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 10,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 6,
  },
  stepperLabel: {
    fontSize: 15,
    color: colors.text,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  stepperBtn: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  stepperValue: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    minWidth: 28,
    textAlign: 'center',
  },

  // ── Footer ──
  // Footer sits on the canvas itself — the old colors.surface band + boxed Back
  // button read as a "weird background" strip (beta feedback).
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
    backgroundColor: colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
  },
  // Quiet outlined secondary — 56pt to pair with the 56pt white primary pill,
  // outline instead of a fill so it never competes with the CTA.
  backButton: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 56,
    paddingHorizontal: 22,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.border,
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  footerCta: {
    flex: 1,
  },

  // ── iOS picker modal (ported from Step3) ──
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalSafeArea: {},
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
  },
  modalButton: {
    fontSize: 17,
    color: colors.textSecondary,
  },
  modalButtonDone: {
    color: colors.primary,
    fontWeight: '600',
  },
  // CRITICAL: fixed height for picker — without this, picker has 0 height.
  pickerContainer: {
    height: 240,
    backgroundColor: colors.surface,
    paddingBottom: Platform.OS === 'ios' ? 20 : 0,
    // Centre the wheel. The iOS spinner lays out at its intrinsic width, so
    // without these it sits hard against the left edge of the sheet with dead
    // space to its right ("can it be centered").
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerSpinner: {
    width: '100%',
    alignSelf: 'center',
  },

  // ── Confirm sheet ──
  sheetBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: 20,
  },
  sheetTitle: {
    fontFamily: font.serif,
    fontSize: 30,
    lineHeight: 34,
    color: colors.text,
  },
  sheetBody: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 8,
    marginBottom: 24,
    lineHeight: 20,
  },
  sheetPublish: {
    width: '100%',
  },
  sheetDraft: {
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 4,
  },
  sheetDraftText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
    textDecorationLine: 'underline',
  },
});
