import React, { useContext, useRef, useState, useEffect } from 'react';
import { AppState, View, TouchableOpacity, Text, StyleSheet, Platform, Animated, LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ExpoLinking from 'expo-linking';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator, BottomTabBarHeightCallbackContext } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useAuth } from '../contexts/AuthContext';
import { useAppMode } from '../contexts/AppModeContext';
import { ThemeProvider, useTheme } from '../contexts/ThemeContext';
import { COLORS } from '../config/brand';
import { LINKING_CONFIG, WEB_LINK_PREFIXES } from './linkingConfig';
import { withAlpha } from '../theme/tokens';
import { getVerificationRequest } from '../lib/verification';
import BootScreen from '../components/BootScreen';
import { useAppAlert } from '../components/AppAlert';
import { hideSplash } from '../lib/splash';
import { getPendingInvite } from '../lib/pendingInvite';
import { clearPendingPayment, getPendingPayment } from '../lib/pendingPayment';
import { addPushNotificationListeners, registerForPushNotificationsIfPossible } from '../lib/pushNotifications';

// Auth Screens
import LoginScreen from '../screens/auth/LoginScreen';
import SignupScreen from '../screens/auth/SignupScreen';

// Attendee Screens
import HomeScreen from '../screens/HomeScreen';
import DiscoverScreen from '../screens/DiscoverScreen';
import SearchScreen from '../screens/SearchScreen';
import SubscriptionsScreen from '../screens/SubscriptionsScreen';
import NotificationSettingsScreen from '../screens/NotificationSettingsScreen';
import ContentPageScreen from '../screens/ContentPageScreen';
import FavoritesScreen from '../screens/FavoritesScreen';
import TicketsScreen from '../screens/TicketsScreen';
import ProfileScreen from '../screens/ProfileScreen';

// Organizer Screens
import OrganizerDashboardScreen from '../screens/organizer/OrganizerDashboardScreen';
import OrganizerEventsScreen from '../screens/organizer/OrganizerEventsScreen';
import OrganizerScanScreen from '../screens/organizer/OrganizerScanScreen';
import OrganizerEventManagementScreen from '../screens/organizer/OrganizerEventManagementScreen';
import OrganizerEventEarningsScreen from '../screens/organizer/OrganizerEventEarningsScreen';
import OrganizerEarningsHubScreen from '../screens/organizer/OrganizerEarningsHubScreen';
import OrganizerEventStaffScreen from '../screens/organizer/OrganizerEventStaffScreen';
import OrganizerTeamHubScreen from '../screens/organizer/OrganizerTeamHubScreen';
import OrganizerOrgTeamScreen from '../screens/organizer/OrganizerOrgTeamScreen';
import OrganizerPayoutSettingsScreen from '../screens/organizer/OrganizerPayoutSettingsScreenV2';
import OrganizerPromoCodesScreen from '../screens/organizer/OrganizerPromoCodesScreen';
import OrganizerCompsScreen from '../screens/organizer/OrganizerCompsScreen';
import OrganizerPromotersScreen from '../screens/organizer/OrganizerPromotersScreen';
import OrganizerGuestListScreen from '../screens/organizer/OrganizerGuestListScreen';
import OrganizerTrackingLinksScreen from '../screens/organizer/OrganizerTrackingLinksScreen';
import OrganizerMessagesScreen from '../screens/organizer/OrganizerMessagesScreen';
import CreateEventFlowRefactored from '../screens/organizer/CreateEventFlowRefactored';
import TicketScannerScreen from '../screens/organizer/TicketScannerScreen';
import EventAttendeesScreen from '../screens/organizer/EventAttendeesScreen';
import EventOrdersScreen from '../screens/organizer/EventOrdersScreen';
import EventOrderDetailScreen from '../screens/organizer/EventOrderDetailScreen';
import EventAnalyticsScreen from '../screens/organizer/EventAnalyticsScreen';
import SendEventUpdateScreen from '../screens/organizer/SendEventUpdateScreen';

// Staff Screens
import StaffEventsScreen from '../screens/staff/StaffEventsScreen';
import StaffScanScreen from '../screens/staff/StaffScanScreen';

// Invite Screen
import InviteRedeemScreen from '../screens/InviteRedeemScreen';

// Detail Screens
import EventDetailScreen from '../screens/EventDetailScreen';
import CategoryEventsScreen from '../screens/CategoryEventsScreen';
import EventTicketsScreen from '../screens/EventTicketsScreen';
import TicketDetailScreen from '../screens/TicketDetailScreen';
import OrganizerProfileScreen from '../screens/OrganizerProfileScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import ConnectionsScreen from '../screens/ConnectionsScreen';
import PaymentWebViewScreen from '../screens/PaymentWebViewScreen';
import StripeConnectWebViewScreen from '../screens/StripeConnectWebViewScreen';
import StripeOnboardingScreen from '../screens/organizer/StripeOnboardingScreen';
import InAppWebViewScreen from '../screens/InAppWebViewScreen';
import FirstRunWelcome from '../components/FirstRunWelcome';
import { useI18n } from '../contexts/I18nContext';

// New Feature Screens
import RefundRequestScreen from '../screens/RefundRequestScreen';
import ReviewScreen from '../screens/ReviewScreen';
import OrganizerAnalyticsScreen from '../screens/organizer/OrganizerAnalyticsScreen';
import OrganizerRefundsScreen from '../screens/organizer/OrganizerRefundsScreen';

// Verification Screens
import OrganizerVerificationScreen from '../screens/verification/OrganizerVerificationScreen';
import OrganizerInfoFormScreen from '../screens/verification/OrganizerInfoFormScreen';
import GovernmentIDUploadScreen from '../screens/verification/GovernmentIDUploadScreen';
import SelfieUploadScreen from '../screens/verification/SelfieUploadScreen';
import type { OrganizerEvent } from '../lib/api/organizer';

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
  InviteRedeem: { eventId?: string; token?: string };
  Search: undefined;
  Subscriptions: undefined;
  NotificationSettings: { organizer?: boolean } | undefined;
  ContentPage: { slug: string; title?: string };
  PaymentWebView: { url: string; title?: string; authToken?: string | null; eventId?: string };
  StripeConnectWebView: { url: string; authToken?: string | null };
  StripeOnboarding: { accountLocation?: 'united_states' | 'canada' | 'france'; hostedOnly?: boolean } | undefined;
  InAppWebView: { url: string; title?: string };
  // `ref` arrives from a promoter's universal link (tikem.co/events/{id}?ref=CODE);
  // React Navigation merges the query string into params. EventDetailScreen
  // captures and persists it for purchase attribution.
  EventDetail: { eventId: string; ref?: string };
  // Either `category` (per-category listing) or `feed` (one of Home's curated
  // rails opened as its own page) — never both.
  CategoryEvents: {
    category?: string;
    feed?: import('../lib/homeFeeds').HomeFeed;
    city?: string;
    title?: string;
    subtitle?: string;
    world?: string;
    // A national day key (lib/nationalDays): the events tagged for it. Also
    // reached from the national-day push via tikem://national-day/<key>.
    nationalDay?: string;
  };
  EventTickets: { eventId: string };
  TicketDetail: { ticketId: string };
  OrganizerProfile: { organizerId: string };
  Notifications: { userId: string };
  Connections: { initialTab?: 'friends' | 'requests' | 'find'; autoSync?: boolean } | undefined;
  // `event` seeds the Manage Event screen with the list's already-loaded fields
  // for an instant first paint; it then refreshes the fuller data in the background.
  OrganizerEventManagement: { eventId: string; event?: OrganizerEvent };
  OrganizerEventEarnings: { eventId: string; autoWithdraw?: boolean };
  OrganizerEarningsHub: undefined;
  OrganizerPayoutSettings: undefined;
  OrganizerEventStaff: { eventId: string };
  OrganizerTeamHub: undefined;
  OrganizerOrgTeam: undefined;
  OrganizerPromoCodes: { eventId: string };
  OrganizerPromoters: { eventId: string };
  OrganizerGuestList: { eventId: string };
  OrganizerTrackingLinks: { eventId: string };
  OrganizerComps: { eventId: string };
  // Attendee questions. No params = the organizer's whole inbox; an eventId
  // scopes it to one event (how the "new message" notification arrives).
  OrganizerMessages: { eventId?: string; eventTitle?: string } | undefined;
  OrganizerVerification: undefined;
  OrganizerInfoForm: { onComplete?: () => void };
  GovernmentIDUpload: { onComplete?: () => void };
  SelfieUpload: { onComplete?: () => void };
  CreateEvent: undefined;
  TicketScanner: { eventId: string; openLookup?: boolean; doorMode?: boolean };
  EventAttendees: { eventId: string };
  // Per-event orders (web: organizer/events/[id]/orders) and one order's detail.
  EventOrders: { eventId: string; eventTitle?: string };
  EventOrderDetail: { eventId: string; orderId: string };
  // Per-event analytics (web: organizer/events/[id]/analytics).
  EventAnalytics: { eventId: string; eventTitle?: string };
  SendEventUpdate: { eventId: string; eventTitle: string };
  EditEvent: { eventId: string };
  // New screens
  RefundRequest: { ticketId: string };
  Review: { ticketId: string; eventId: string; eventTitle: string };
  OrganizerAnalytics: undefined;
  OrganizerRefunds: undefined;
  Favorites: undefined;
};

export type AuthStackParamList = {
  Login: undefined;
  Signup: undefined;
};

export type AttendeeTabParamList = {
  Home: undefined;
  Discover: undefined;
  Tickets: undefined;
  Profile: undefined;
};

export type OrganizerTabParamList = {
  Dashboard: undefined;
  MyEvents: undefined;
  Scan: undefined;
  Profile: undefined;
};

export type StaffTabParamList = {
  Events: undefined;
  Scan: undefined;
  Profile: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const AttendeeTab = createBottomTabNavigator<AttendeeTabParamList>();
const OrganizerTab = createBottomTabNavigator<OrganizerTabParamList>();
const StaffTab = createBottomTabNavigator<StaffTabParamList>();

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Signup" component={SignupScreen} />
    </AuthStack.Navigator>
  );
}

// ─── Custom Animated Tab Bar ───────────────────────────────────────────────

interface TabBarProps {
  state: any;
  descriptors: any;
  navigation: any;
  tabs: Array<{ name: string; label: string; icon: string; activeIcon: string; isCreate?: boolean }>;
}

// Whether the signed-in account can use organizer mode. Computed once in
// AppNavigator (role/verification) and provided here so CustomTabBar can gate
// the double-tap-Profile-to-switch gesture without re-running that query.
const OrganizerAccessContext = React.createContext(false);

function CustomTabBar({ state, descriptors, navigation, tabs }: TabBarProps) {
  const { colors, isDark } = useTheme();
  const { mode, setMode } = useAppMode();
  const canSwitchMode = React.useContext(OrganizerAccessContext);
  const anims = useRef(tabs.map(() => new Animated.Value(0))).current;
  // Tracks the last Profile-tab tap so a quick second tap toggles mode.
  const lastProfileTapRef = useRef(0);

  // Focus is resolved by ROUTE NAME (not index), because the `tabs` list can
  // include a non-route action (Create) that has no entry in state.routes.
  const activeRouteName = state.routes[state.index]?.name;

  useEffect(() => {
    tabs.forEach((tab, i) => {
      Animated.spring(anims[i], {
        toValue: tab.name === activeRouteName ? 1 : 0,
        tension: 80,
        friction: 10,
        useNativeDriver: true,
      }).start();
    });
  }, [activeRouteName]);

  const insets = useSafeAreaInsets();
  // BottomTabView owns the tab-bar height that screens read through
  // `useTabBarSpace()`. Because this bar is now an overlay (see below) that
  // height is the ONLY thing keeping the last feed row clear of it, so report
  // the real measured value instead of leaving the navigator's default guess.
  const setTabBarHeight = useContext(BottomTabBarHeightCallbackContext);

  // Scrim stops, derived from the canvas colour so nothing is hardcoded.
  const scrim = React.useMemo(() => ({
    clear: withAlpha(colors.background, 0),
    fadeEarly: withAlpha(colors.background, 0.1),
    fadeLate: withAlpha(colors.background, 0.34),
    seam: withAlpha(colors.background, TAB_BAR_SCRIM_SEAM_ALPHA),
    barMid: withAlpha(colors.background, 0.88),
    barBottom: withAlpha(colors.background, 0.94),
  }), [colors.background]);

  return (
    <View
      style={[tabBarStyles.container, {
        paddingBottom: Math.max(insets.bottom, Platform.OS === 'ios' ? 20 : 8),
      }]}
      onLayout={(e: LayoutChangeEvent) => setTabBarHeight?.(e.nativeEvent.layout.height)}
    >
      {/* ── Bottom scrim (two continuous halves) ───────────────────────────
          A translucent bar takes on whatever is behind it, so a poster under
          one half of the bar and black canvas under the other made it read as
          two different tones across its width (tester feedback, build 13). The
          fix is not a more opaque bar — it's darkening the BACKDROP with a
          bottom-anchored gradient so whatever scrolls under the bar arrives at
          roughly the same value across the full width.

          It is split into two elements only so each has device-independent
          geometry: the first (`topScrim`) covers the fixed
          TAB_BAR_SCRIM_EXTRA band above the bar; the second fills the bar
          itself, whose height varies with the home-indicator inset. The first
          ends and the second starts at TAB_BAR_SCRIM_SEAM_ALPHA, so together
          they read as one continuous ramp on any device.

          Both sit BEFORE the BlurView, i.e. behind it: the blur then samples
          the already-darkened backdrop, and the canvas tint still goes on top.
          The bar keeps its translucency — over the black canvas the scrim is
          the canvas colour and changes nothing at all. */}
      <LinearGradient
        colors={[scrim.clear, scrim.fadeEarly, scrim.fadeLate, scrim.seam]}
        locations={[0, 0.35, 0.7, 1]}
        style={tabBarStyles.topScrim}
        pointerEvents="none"
      />
      <LinearGradient
        colors={[scrim.seam, scrim.barMid, scrim.barBottom]}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {/* Translucent chrome, iOS-idiomatic: a dark blur layer plus a near-solid
          canvas tint on top. Feed content passing underneath reads as a soft
          glow rather than a hard black band, while TAB_BAR_TINT_OPACITY keeps
          enough of the canvas that 10.5pt labels stay legible even when a
          near-white poster is scrolling through. */}
      <BlurView
        intensity={TAB_BAR_BLUR_INTENSITY}
        tint="dark"
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: colors.background, opacity: TAB_BAR_TINT_OPACITY },
        ]}
        pointerEvents="none"
      />
      {tabs.map((tab, index) => {
        // Emphasized center Create action — launches the create flow on the
        // root stack rather than switching tabs. Rendered as a white FAB
        // (primary-action convention), not a plain tab icon.
        if (tab.isCreate) {
          return (
            <TouchableOpacity
              key={tab.name}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                (navigation as any).navigate('CreateEvent');
              }}
              style={tabBarStyles.tab}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={tab.label}
            >
              <View style={[tabBarStyles.createFab, { backgroundColor: colors.white }]}>
                <Ionicons name="add" size={30} color="#000000" />
              </View>
            </TouchableOpacity>
          );
        }

        const isFocused = tab.name === activeRouteName;
        const a = anims[index];
        const scale = a.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
        const lift = a.interpolate({ inputRange: [0, 1], outputRange: [0, -1] });
        const iconColor = isFocused ? colors.primary : colors.textTertiary;

        const onPress = () => {
          const route = state.routes.find((r: { name: string; key: string }) => r.name === tab.name);
          if (!route) return;

          // Double-tap the Profile tab (organizer-capable accounts only) to
          // switch between attendee and organizer mode. A single tap keeps its
          // normal navigate / scroll-to-top behavior; other tabs are unaffected.
          if (tab.name === 'Profile' && canSwitchMode) {
            const now = Date.now();
            if (now - lastProfileTapRef.current < 300) {
              lastProfileTapRef.current = 0;
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setMode(mode === 'organizer' ? 'attendee' : 'organizer');
              return;
            }
            lastProfileTapRef.current = now;
          }

          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!isFocused && !event.defaultPrevented) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            navigation.navigate(tab.name);
          } else if (isFocused) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }
        };

        return (
          <TouchableOpacity
            key={tab.name}
            onPress={onPress}
            style={tabBarStyles.tab}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ selected: isFocused }}
            accessibilityLabel={tab.label}
          >
            {/* Icon-only bar (owner call, 2026-08-29, reversing the earlier
                labels-for-first-timers decision). accessibilityLabel above
                keeps every tab named for screen readers; teal active tint
                stays semantic. */}
            <Animated.View style={[tabBarStyles.iconWrap, { transform: [{ scale }, { translateY: lift }] }]}>
              <Ionicons
                name={(isFocused ? tab.activeIcon : tab.icon) as any}
                size={26}
                color={iconColor}
              />
            </Animated.View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// How see-through the bar is. The canvas tint sits on top of the blur, so the
// visible amount of feed content is ~(1 - TAB_BAR_TINT_OPACITY) BEFORE the
// blur's own dark tint is counted — i.e. this is the legibility floor even on
// Android, where the blur may degrade to a plain overlay.
//
// The binding constraint is the dim inactive label (textTertiary #6B6B6B),
// which only manages 3.7:1 on the pure black canvas to begin with. Contrast of
// that label against the bar, tint alone, worst case = a near-white poster
// (#F0F0F0) scrolling directly underneath:
//     0.80 → 2.20:1 (washed out)   0.86 → 2.69:1   0.90 → 3.02:1
// 0.90 is the lightest value that holds the label at/above 3:1 in that worst
// case while still letting bright content glow through. Active teal (5.8:1+)
// and the white Create FAB are never the limiting factor.
//
// The backdrop scrim below pre-darkens that near-white poster before the tint
// sees it, which bought headroom the old 0.90 spent on EXTRA contrast rather
// than on translucency. Measured on a build-17 screenshot, the bar came out at
// luminance 10/255 — indistinguishable from the black canvas, i.e. a solid
// band. A tester reported exactly that: "the bottom bar bg is no longer
// blurry". The bar was never meant to be opaque; the blur has nothing to show
// if the tint hides everything.
//
// Re-derived against the same binding constraint (dim inactive label #6B6B6B
// under a near-white #F0F0F0 poster, scrim seam 0.72 → backdrop 74.4):
//     0.90 → 3.56:1 (10% through)   0.75 → 3.26:1 (25%)
//     0.65 → 3.04:1 (35%)           0.60 → 2.92:1 FAILS 3:1
// Asked to go more transparent still, the way out is NOT to keep lowering this
// — 0.62 already drops under 3:1 at the old scrim. Strengthening the BACKDROP
// scrim instead buys the headroom, because the tint then sits over a darker
// starting value:
//     scrim 0.72 / tint 0.65 -> 3.04:1, bar passes 35% of the backdrop
//     scrim 0.80 / tint 0.55 -> 3.10:1, bar passes 45%
// So the bar reads as MORE see-through while contrast slightly improves.
const TAB_BAR_TINT_OPACITY = 0.55;
const TAB_BAR_BLUR_INTENSITY = 55;

// How far the backdrop scrim reaches ABOVE the bar. Ending the ramp at the
// bar's own top edge would just relocate the seam, so the fade needs room to
// run out: 64pt is 8× the bar's 8pt rhythm, ~2.7× the 24pt fade it replaces and
// roughly 3/4 of the bar's own height (~84pt with a home indicator), which is
// long enough that the eye reads a vignette rather than an edge — while still
// dimming under 8% of an 844pt screen, so feed content stays browsable.
const TAB_BAR_SCRIM_EXTRA = 64;

// Where the two scrim halves meet — the bar's top edge, and therefore the
// weakest point of the scrim anywhere behind the bar (it only strengthens
// downward). That makes it the legibility worst case: see the contrast note on
// TAB_BAR_TINT_OPACITY, which this does not change.
const TAB_BAR_SCRIM_SEAM_ALPHA = 0.8;

const tabBarStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    paddingTop: 0,
    // Overlay, not a band in the layout flow: content scrolls UNDER the bar so
    // it can show through the blur. Screens reserve room for it with
    // `useTabBarSpace()` (fed by the onLayout above) — without that padding the
    // last row would sit behind the bar instead of clearing it.
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    // No seam: no top border and no shadow, so it reads as an integrated
    // floating strip rather than a box. Separation from scrolling content is
    // handled by the top half of the backdrop scrim.
    borderTopWidth: 0,
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
  },
  // Upper half of the backdrop scrim. `bottom: '100%'` pins it directly on top
  // of the bar (the container's overflow is visible), so its bottom stop meets
  // the bar-height gradient's top stop exactly — one continuous ramp, no seam.
  topScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: '100%',
    height: TAB_BAR_SCRIM_EXTRA,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 8,
  },
  topAccent: {
    width: 26,
    height: 3,
    borderRadius: 999,
    marginBottom: 5,
  },
  iconWrap: {
    width: 56,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createFab: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -10, // lift above the bar for emphasis
  },
  label: {
    fontSize: 10.5,
    marginTop: 3,
    letterSpacing: 0.1,
    fontWeight: '600',
    textAlign: 'center',
  },
});

// ─── Tab Navigators ────────────────────────────────────────────────────────

function AttendeeTabNavigator() {
  const { t } = useI18n();
  // Center "Create" is an emphasized action (not a tab screen) that launches
  // the event-create flow — makes hosting one tap away for any user
  // (publish-first). Favorites moved into Profile.
  const attendeeTabs = [
    { name: 'Home', label: t('tabs.home'), icon: 'home-outline', activeIcon: 'home' },
    { name: 'Discover', label: t('tabs.discover'), icon: 'search-outline', activeIcon: 'search' },
    { name: 'Create', label: t('tabs.create'), icon: 'add', activeIcon: 'add', isCreate: true },
    { name: 'Tickets', label: t('tabs.tickets'), icon: 'ticket-outline', activeIcon: 'ticket' },
    { name: 'Profile', label: t('tabs.profile'), icon: 'person-outline', activeIcon: 'person' },
  ];
  return (
    <AttendeeTab.Navigator
      tabBar={(props) => <CustomTabBar {...props} tabs={attendeeTabs} />}
      screenOptions={{ headerShown: false }}
    >
      <AttendeeTab.Screen name="Home" component={HomeScreen} />
      <AttendeeTab.Screen name="Discover" component={DiscoverScreen} />
      <AttendeeTab.Screen name="Tickets" component={TicketsScreen} />
      <AttendeeTab.Screen name="Profile" component={ProfileScreen} />
    </AttendeeTab.Navigator>
  );
}

function OrganizerTabNavigator() {
  const { t } = useI18n();
  const organizerTabs = [
    { name: 'Dashboard', label: t('tabs.dashboard'), icon: 'stats-chart-outline', activeIcon: 'stats-chart' },
    { name: 'MyEvents', label: t('tabs.myEvents'), icon: 'calendar-outline', activeIcon: 'calendar' },
    { name: 'Scan', label: t('tabs.scan'), icon: 'qr-code-outline', activeIcon: 'qr-code' },
    { name: 'Profile', label: t('tabs.profile'), icon: 'person-outline', activeIcon: 'person' },
  ];
  return (
    <OrganizerTab.Navigator
      tabBar={(props) => <CustomTabBar {...props} tabs={organizerTabs} />}
      screenOptions={{ headerShown: false }}
    >
      <OrganizerTab.Screen name="Dashboard" component={OrganizerDashboardScreen} />
      <OrganizerTab.Screen name="MyEvents" component={OrganizerEventsScreen} options={{ title: t('tabs.myEvents') }} />
      <OrganizerTab.Screen name="Scan" component={OrganizerScanScreen} />
      <OrganizerTab.Screen name="Profile" component={ProfileScreen} />
    </OrganizerTab.Navigator>
  );
}

function StaffTabNavigator() {
  const { t } = useI18n();
  const staffTabs = [
    { name: 'Events', label: t('tabs.events'), icon: 'calendar-outline', activeIcon: 'calendar' },
    { name: 'Scan', label: t('tabs.scan'), icon: 'qr-code-outline', activeIcon: 'qr-code' },
    { name: 'Profile', label: t('tabs.profile'), icon: 'person-outline', activeIcon: 'person' },
  ];
  return (
    <StaffTab.Navigator
      tabBar={(props) => <CustomTabBar {...props} tabs={staffTabs} />}
      screenOptions={{ headerShown: false }}
    >
      <StaffTab.Screen name="Events" component={StaffEventsScreen} />
      <StaffTab.Screen name="Scan" component={StaffScanScreen} />
      <StaffTab.Screen name="Profile" component={ProfileScreen} />
    </StaffTab.Navigator>
  );
}

export default function AppNavigator() {
  const { user, loading, userProfile } = useAuth();
  const { mode, isLoading: modeLoading } = useAppMode();
  const { t } = useI18n();
  // In-app sheet for the pending-payment resume prompt — the last surviving
  // native Alert after the app-wide migration. Referentially stable, so the
  // effect below does not need it in its dependency array.
  const showAlert = useAppAlert();
  const [isVerified, setIsVerified] = useState(false);
  const navigationRef = useNavigationContainerRef<RootStackParamList>();
  const prevModeRef = useRef<string | null>(null);

  // Handle notification taps (deep links / URLs).
  useEffect(() => {
    const unsubscribe = addPushNotificationListeners((url) => {
      // Only open URLs we trust: our own app scheme, or an https link on a Tikèm
      // host. A malicious push payload must not be able to drive openURL to an
      // arbitrary (e.g. phishing or app-scheme-hijacking) destination.
      const isAllowedNotificationUrl = (raw: string): boolean => {
        if (raw.startsWith('tikem://')) return true;
        try {
          const parsed = new URL(raw);
          if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
          const host = parsed.host.toLowerCase();
          return (
            host === 'tikem.co' ||
            host.endsWith('.tikem.co') ||
            host === 'eventhaiti.vercel.app'
          );
        } catch {
          return false;
        }
      };

      if (!isAllowedNotificationUrl(url)) {
        console.warn('Ignoring untrusted notification URL', url);
        return;
      }

      try {
        ExpoLinking.openURL(url);
      } catch (e) {
        console.warn('Failed to open notification URL', e);
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    checkVerificationStatus();
  }, [userProfile?.id]);

  useEffect(() => {
    // If a staff invite link was opened while logged out, resume it after login.
    const maybeResumeInvite = async () => {
      if (!user) return;
      try {
        const pending = await getPendingInvite();
        if (pending?.eventId && pending?.token) {
          navigationRef.navigate('InviteRedeem', pending);
        }
      } catch {
        // ignore
      }
    };

    maybeResumeInvite();
  }, [user, navigationRef]);

  // Register for push notifications once user is signed in.
  useEffect(() => {
    if (!user?.uid) return;
    registerForPushNotificationsIfPossible().catch((e) => console.warn('Push registration failed', e));
  }, [user?.uid]);

  useEffect(() => {
    if (!user) return;

    let lastPromptAt = 0;
    const maybePromptPendingPayment = async () => {
      const now = Date.now();
      // Debounce prompts so we don't annoy users.
      if (now - lastPromptAt < 10_000) return;
      lastPromptAt = now;

      const pending = await getPendingPayment().catch(() => null);
      if (!pending?.url) return;

      showAlert(t('screens.payment.pendingTitle'), t('screens.payment.pendingBody'), [
        {
          text: t('screens.payment.continue'),
          onPress: () => {
            navigationRef.navigate('PaymentWebView', {
              url: pending.url,
              title: pending.title || t('screens.payment.complete'),
              eventId: pending.eventId,
            });
          },
        },
        {
          text: t('screens.payment.checkTickets'),
          onPress: async () => {
            await clearPendingPayment().catch(() => {});
            navigationRef.reset({
              index: 0,
              routes: [{ name: 'Main' as any, params: { screen: 'Tickets' } } as any],
            });
          },
        },
        {
          text: t('screens.payment.discard'),
          style: 'destructive',
          onPress: async () => {
            await clearPendingPayment().catch(() => {});
          },
        },
      ]);
    };

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        maybePromptPendingPayment().catch(() => {});
      }
    });

    // Also check once shortly after login.
    const promptTimeout = setTimeout(() => {
      maybePromptPendingPayment().catch(() => {});
    }, 800);

    return () => {
      clearTimeout(promptTimeout);
      sub.remove();
    };
  }, [navigationRef, user]);

  const checkVerificationStatus = async () => {
    if (!userProfile?.id) {
      setIsVerified(false);
      return;
    }

    try {
      const verification = await getVerificationRequest(userProfile.id);
      setIsVerified(verification?.status === 'approved');
    } catch (error) {
      setIsVerified(false);
    }
  };

  // Determine which tab navigator to show based on mode and user role/verification
  const canUseOrganizerMode =
    userProfile?.role === 'organizer' ||
    userProfile?.role === 'admin' ||
    isVerified;

  // When the mode changes (via Account actions), always jump to the first tab.
  useEffect(() => {
    if (loading || modeLoading) return;
    if (!user) return;

    // Reset ONLY when the mode itself changed. The old guard skipped just the
    // first run — but this effect also depends on canUseOrganizerMode, which is
    // derived from the PROFILE. On a cold start the profile loads ~1-2s after
    // the navigator mounts, the dep flipped, and reset() replaced Main with
    // Main — the whole Home screen (skeletons and all) visibly slid off to the
    // left mid-load, which a tester caught on a screen recording.
    const prevMode = prevModeRef.current;
    prevModeRef.current = mode;
    if (prevMode === null || prevMode === mode) return;

    const initialTab =
      mode === 'staff'
        ? 'Events'
        : mode === 'organizer' && canUseOrganizerMode
          ? 'Dashboard'
          : 'Home';

    navigationRef.reset({
      index: 0,
      routes: [{ name: 'Main' as any, params: { screen: initialTab } } as any],
    });
  }, [canUseOrganizerMode, loading, mode, modeLoading, navigationRef, user]);

  if (loading || modeLoading) {
    // Normally still hidden behind the held native splash; drawn to match it
    // so the fallback path (slow/offline boot) has no visible seam either.
    return <BootScreen />;
  }

  const MainTabNavigator = 
    mode === 'staff'
      ? StaffTabNavigator
      : mode === 'organizer' && canUseOrganizerMode
        ? OrganizerTabNavigator
        : AttendeeTabNavigator;

  const linking = {
    prefixes: [ExpoLinking.createURL('/'), ...WEB_LINK_PREFIXES],
    // Seeds `Main` beneath any deep-linked screen so back always has somewhere
    // to go — see navigation/linkingConfig.ts.
    config: LINKING_CONFIG,
  };

  return (
    <ThemeProvider>
    <OrganizerAccessContext.Provider value={canUseOrganizerMode}>
    {/* Drop the native splash only once the first real screen is mounted, so
        the launch is splash -> app rather than splash -> boot screen -> app. */}
    <NavigationContainer ref={navigationRef} linking={linking as any} onReady={hideSplash}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          // Dark, consistent headers for the few screens that use the default
          // native header (PaymentWebView, InAppWebView, Notifications,
          // OrganizerEventManagement, OrganizerEventStaff, OrganizerPromoCodes).
          // Screens with their own in-screen headers set headerShown:false and
          // are unaffected.
          headerStyle: { backgroundColor: '#0A0A0A' },
          headerTintColor: '#FFFFFF',
          headerTitleStyle: { color: '#FFFFFF', fontWeight: '700' },
          headerShadowVisible: false,
        }}
      >
        {!user ? (
          <>
            <Stack.Screen name="Auth" component={AuthNavigator} />
            <Stack.Screen name="InviteRedeem" component={InviteRedeemScreen} options={{ headerShown: false }} />
          </>
        ) : (
          <>
            <Stack.Screen name="Main" component={MainTabNavigator} />
            <Stack.Screen name="InviteRedeem" component={InviteRedeemScreen} options={{ headerShown: false }} />
            <Stack.Screen
              name="PaymentWebView"
              component={PaymentWebViewScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen name="StripeConnectWebView" component={StripeConnectWebViewScreen} options={{ headerShown: false }} />
            <Stack.Screen name="StripeOnboarding" component={StripeOnboardingScreen} options={{ headerShown: false }} />
            <Stack.Screen
              name="InAppWebView"
              component={InAppWebViewScreen}
              options={({ route }) => ({
                headerShown: true,
                headerTitle: (route as any)?.params?.title || '',
              })}
            />
            <Stack.Screen name="EventDetail" component={EventDetailScreen} />
            <Stack.Screen name="Search" component={SearchScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Subscriptions" component={SubscriptionsScreen} options={{ headerShown: false }} />
            <Stack.Screen name="NotificationSettings" component={NotificationSettingsScreen} options={{ headerShown: false }} />
            <Stack.Screen name="ContentPage" component={ContentPageScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Favorites" component={FavoritesScreen} options={{ headerShown: false }} />
            <Stack.Screen name="CategoryEvents" component={CategoryEventsScreen} />
            <Stack.Screen name="EventTickets" component={EventTicketsScreen} />
            <Stack.Screen name="TicketDetail" component={TicketDetailScreen} />
            <Stack.Screen name="OrganizerProfile" component={OrganizerProfileScreen} />
            <Stack.Screen name="Connections" component={ConnectionsScreen} />
            <Stack.Screen
              name="Notifications"
              component={NotificationsScreen}
              options={{ headerShown: true, headerTitle: t('screens.notifications.title') }}
            />
            <Stack.Screen 
              name="OrganizerVerification" 
              component={OrganizerVerificationScreen} 
              options={{ headerShown: false }} 
            />
            <Stack.Screen 
              name="OrganizerInfoForm" 
              component={OrganizerInfoFormScreen} 
              options={{ headerShown: false }} 
            />
            <Stack.Screen 
              name="GovernmentIDUpload" 
              component={GovernmentIDUploadScreen} 
              options={{ headerShown: false }} 
            />
            <Stack.Screen 
              name="SelfieUpload" 
              component={SelfieUploadScreen} 
              options={{ headerShown: false }} 
            />
            <Stack.Screen name="OrganizerEventManagement" component={OrganizerEventManagementScreen} options={{ headerShown: true, headerTitle: 'Manage Event' }} />
            <Stack.Screen name="OrganizerEventEarnings" component={OrganizerEventEarningsScreen} options={{ headerShown: false }} />
            <Stack.Screen name="OrganizerEarningsHub" component={OrganizerEarningsHubScreen} options={{ headerShown: false }} />
            <Stack.Screen name="OrganizerPayoutSettings" component={OrganizerPayoutSettingsScreen} options={{ headerShown: false }} />
            <Stack.Screen name="OrganizerEventStaff" component={OrganizerEventStaffScreen} options={{ headerShown: true }} />
            <Stack.Screen name="OrganizerTeamHub" component={OrganizerTeamHubScreen} options={{ headerShown: false }} />
            <Stack.Screen name="OrganizerOrgTeam" component={OrganizerOrgTeamScreen} options={{ headerShown: false }} />
            <Stack.Screen
              name="OrganizerPromoCodes"
              component={OrganizerPromoCodesScreen}
              options={{ headerShown: true, headerTitle: t('organizerPromoCodes.title') }}
            />
            <Stack.Screen
              name="OrganizerComps"
              component={OrganizerCompsScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="OrganizerPromoters"
              component={OrganizerPromotersScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="OrganizerGuestList"
              component={OrganizerGuestListScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="OrganizerTrackingLinks"
              component={OrganizerTrackingLinksScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="OrganizerMessages"
              component={OrganizerMessagesScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen name="CreateEvent" component={CreateEventFlowRefactored} options={{ headerShown: false }} />
            <Stack.Screen name="TicketScanner" component={TicketScannerScreen} options={{ headerShown: false }} />
            <Stack.Screen name="EventAttendees" component={EventAttendeesScreen} options={{ headerShown: false }} />
            <Stack.Screen name="EventOrders" component={EventOrdersScreen} options={{ headerShown: false }} />
            <Stack.Screen name="EventOrderDetail" component={EventOrderDetailScreen} options={{ headerShown: false }} />
            <Stack.Screen name="EventAnalytics" component={EventAnalyticsScreen} options={{ headerShown: false }} />
            <Stack.Screen name="SendEventUpdate" component={SendEventUpdateScreen} options={{ headerShown: false }} />
            <Stack.Screen name="EditEvent" component={CreateEventFlowRefactored} options={{ headerShown: false }} />
            <Stack.Screen name="RefundRequest" component={RefundRequestScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Review" component={ReviewScreen} options={{ headerShown: false }} />
            <Stack.Screen name="OrganizerAnalytics" component={OrganizerAnalyticsScreen} options={{ headerShown: false }} />
            <Stack.Screen name="OrganizerRefunds" component={OrganizerRefundsScreen} options={{ headerShown: false }} />
          </>
        )}
      </Stack.Navigator>
      {/* One-time welcome (mounts outside the navigator tree; navigates via ref). */}
      {user ? (
        <FirstRunWelcome onCreateEvent={() => navigationRef.navigate('CreateEvent' as any)} />
      ) : null}
    </NavigationContainer>
    </OrganizerAccessContext.Provider>
    </ThemeProvider>
  );
}
