import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSocialFlags } from '../lib/socialFlags';
import {
  Animated,
  AppState,
  Linking,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';
import * as Notifications from 'expo-notifications';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import OverlayHeader, { useOverlayHeaderInset } from '../components/OverlayHeader';
import SectionHeader from '../components/SectionHeader';
import StatusChip from '../components/StatusChip';
import { Skeleton } from '../components/Skeleton';
import { useAppAlert } from '../components/AppAlert';
import { backendJson } from '../lib/api/backend';
import { inConsentMarket, readNotifyPref } from '../lib/notifyDefaults';
// The MOBILE push module (Expo token → /api/push/register-expo). Not to be
// confused with the web's two server-side notification modules.
import { registerForPushNotificationsIfPossible } from '../lib/pushNotifications';
import { colors, font, radius, spacing } from '../theme/tokens';
import { Touchable } from '../components/ui/Touchable';
import { Text as UIText } from '../components/ui/Text';
import { Switch as UISwitch } from '../components/ui/Switch';

/**
 * Notification preferences.
 *
 * Only DISCRETIONARY notifications can be switched off here. Tickets,
 * receipts, reminders, event changes, refunds and payouts are transactional
 * (lib/notifications/policy.ts on the server) and are listed as "always on"
 * rather than offered as switches.
 *
 * Buyer switches write the users/{uid} fields the server's policy reads
 * (notify_discovery, notify_weekend_digest, notify_filling_fast,
 * notify_national_day). Organizer
 * switches write the same
 * organizers/{uid}/notificationPreferences/main document as the web's
 * NotificationsForm, through the same PUT /api/organizer/settings/notifications,
 * plus the organizer-side discretionary fields on users/{uid}
 * (notify_organizer_milestones, notify_organizer_nudges, and
 * notify_organizer_season: "Kanaval is in 3 weeks", off by default in Canada
 * and France).
 */

// users/{uid} fields — absent means opted in (policy.ts isCategoryEnabled).
type UserPrefKey =
  | 'notify_discovery'
  | 'notify_weekend_digest'
  | 'notify_filling_fast'
  | 'notify_national_day'
  | 'notify_friend_invites'
  // An organizer you follow published an event (server: organizer_follow).
  | 'notify_followed_organizers'
  // An organizer's update to your tickets' events (server: organizer_broadcast).
  | 'notify_organizer_messages'
  // Saved-event nudges + "how was it?" (NOT ticket reminders, always on).
  | 'notify_reminders'
  | 'notify_organizer_milestones'
  | 'notify_organizer_nudges'
  | 'notify_organizer_season';

// organizers/{uid}/notificationPreferences/main — same keys and defaults as
// the web (lib/organizer/notificationPreferences.ts).
type OrganizerPrefs = {
  email_ticket_sales: boolean;
  email_new_reviews: boolean;
  email_payout_updates: boolean;
  email_event_reminders: boolean;
  email_marketing: boolean;
  sms_ticket_sales: boolean;
  sms_event_reminders: boolean;
  push_ticket_sales: boolean;
  push_new_reviews: boolean;
  // Attendee messages (server: lib/organizer-message-alerts.ts). Older servers
  // omit them; the rows treat a missing value as on, the server default.
  email_attendee_messages?: boolean;
  push_attendee_messages?: boolean;
};

type PushState = 'granted' | 'denied' | 'undetermined' | 'unknown';

export default function NotificationSettingsScreen({ navigation, route }: any) {
  const { user, userProfile } = useAuth();
  const { t } = useI18n();
  const showAlert = useAppAlert();
  const insets = useSafeAreaInsets();
  const { height: headerH, onHeight: onHeaderHeight } = useOverlayHeaderInset();
  const scrollY = useRef(new Animated.Value(0)).current;
  const isOrganizer = Boolean(route?.params?.organizer);
  const socialFlags = useSocialFlags();

  const [loading, setLoading] = useState(true);
  const [userPrefs, setUserPrefs] = useState<Record<UserPrefKey, boolean>>({
    notify_discovery: true,
    notify_weekend_digest: true,
    notify_filling_fast: true,
    notify_national_day: true,
    notify_friend_invites: true,
    notify_followed_organizers: true,
    notify_organizer_messages: true,
    notify_reminders: true,
    notify_organizer_milestones: true,
    notify_organizer_nudges: true,
    notify_organizer_season: true,
  });
  const [orgPrefs, setOrgPrefs] = useState<OrganizerPrefs | null>(null);
  const [orgUnavailable, setOrgUnavailable] = useState(false);
  const orgPrefsRef = useRef<OrganizerPrefs | null>(null);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const [pushState, setPushState] = useState<PushState>('unknown');

  const refreshPushState = useCallback(async () => {
    try {
      const p = await Notifications.getPermissionsAsync();
      setPushState(p.status === 'granted' ? 'granted' : p.status === 'denied' ? 'denied' : 'undetermined');
    } catch {
      setPushState('unknown');
    }
  }, []);

  useEffect(() => {
    refreshPushState();
    // Coming back from the system Settings app — re-read the permission.
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refreshPushState();
    });
    return () => sub.remove();
  }, [refreshPushState]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.uid) {
        setLoading(false);
        return;
      }
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        const data = (snap.exists() ? snap.data() : {}) as Record<string, any>;
        if (!cancelled) {
          setUserPrefs({
            // Off by default in Canada and France (consent law); see notifyDefaults.
            notify_discovery: readNotifyPref(data, 'notify_discovery'),
            notify_weekend_digest: readNotifyPref(data, 'notify_weekend_digest'),
            notify_filling_fast: data.notify_filling_fast ?? true,
            notify_national_day: data.notify_national_day ?? true,
            notify_friend_invites: data.notify_friend_invites ?? true,
            notify_followed_organizers: data.notify_followed_organizers ?? true,
            notify_organizer_messages: data.notify_organizer_messages ?? true,
            // The old web card's nested `notify.reminders` still counts (server readUserNotifyPref).
            notify_reminders: data.notify_reminders ?? data.notify?.reminders ?? true,
            notify_organizer_milestones: data.notify_organizer_milestones ?? true,
            notify_organizer_nudges: data.notify_organizer_nudges ?? true,
            notify_organizer_season: readNotifyPref(data, 'notify_organizer_season'),
          });
        }
      } catch {
        // Unread: fall back to the profile's country so the two discovery
        // switches show what the server assumes for a missing field.
        if (!cancelled && inConsentMarket(userProfile)) {
          setUserPrefs((p) => ({ ...p, notify_discovery: false, notify_weekend_digest: false, notify_organizer_season: false }));
        }
      }
      if (isOrganizer) {
        try {
          const res = await backendJson<{ preferences: OrganizerPrefs }>('/api/organizer/settings/notifications');
          if (!cancelled && res?.preferences) {
            orgPrefsRef.current = res.preferences;
            setOrgPrefs(res.preferences);
          }
        } catch {
          if (!cancelled) setOrgUnavailable(true);
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.uid, isOrganizer]);

  const saveFailed = () =>
    showAlert(t('notificationSettings.saveFailedTitle'), t('notificationSettings.saveFailedBody'), [
      { text: t('common.ok') },
    ]);

  const toggleUserPref = async (key: UserPrefKey, value: boolean) => {
    if (!user?.uid) return;
    setUserPrefs((p) => ({ ...p, [key]: value }));
    try {
      await setDoc(
        doc(db, 'users', user.uid),
        { [key]: value, updated_at: new Date().toISOString() },
        { merge: true },
      );
    } catch {
      setUserPrefs((p) => ({ ...p, [key]: !value }));
      saveFailed();
    }
  };

  // Each save sends the WHOLE form (as the web does) and runs after the one
  // before it, so two quick toggles can never land out of order.
  const toggleOrgPref = (key: keyof OrganizerPrefs, value: boolean) => {
    const current = orgPrefsRef.current;
    if (!current) return;
    const next = { ...current, [key]: value };
    orgPrefsRef.current = next;
    setOrgPrefs(next);
    saveChain.current = saveChain.current.then(async () => {
      try {
        await backendJson('/api/organizer/settings/notifications', {
          method: 'PUT',
          body: JSON.stringify(orgPrefsRef.current),
        });
      } catch {
        const reverted = { ...(orgPrefsRef.current as OrganizerPrefs), [key]: !value };
        orgPrefsRef.current = reverted;
        setOrgPrefs(reverted);
        saveFailed();
      }
    });
  };

  const enablePush = async () => {
    if (pushState === 'denied') {
      Linking.openSettings().catch(() => {});
      return;
    }
    try {
      await registerForPushNotificationsIfPossible({ uid: user?.uid });
    } catch {
      // permission UI already handled by the OS
    }
    refreshPushState();
  };

  const pushChip =
    pushState === 'granted'
      ? { status: 'success', label: t('notificationSettings.push.on') }
      : pushState === 'denied'
        ? { status: 'error', label: t('notificationSettings.push.off') }
        : { status: 'pending', label: t('notificationSettings.push.notSet') };

  const alwaysOn = [
    { title: t('notificationSettings.alwaysOn.tickets') },
    { title: t('notificationSettings.alwaysOn.reminders') },
    { title: t('notificationSettings.alwaysOn.changes') },
    { title: t('notificationSettings.alwaysOn.refunds') },
    ...(isOrganizer
      ? [{ title: t('notificationSettings.alwaysOn.payouts') }]
      : []),
  ];

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <OverlayHeader onHeight={onHeaderHeight} style={styles.header} scrollY={scrollY}>
        <Touchable
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <ArrowLeft size={24} color={colors.textPrimary} />
        </Touchable>
        <Text style={styles.headerTitle}>{t('notificationSettings.title')}</Text>
        <View style={styles.backButton} />
      </OverlayHeader>

      <Animated.ScrollView
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingTop: headerH + spacing.lg,
          paddingBottom: insets.bottom + spacing.xxl,
        }}
        showsVerticalScrollIndicator={false}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
        })}
        scrollEventThrottle={16}
      >
        {/* This device */}
        <SectionHeader
          title={t('notificationSettings.push.section')} />
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{t('notificationSettings.push.title')}</Text>
              <View style={styles.chipLine}>
                <StatusChip status={pushChip.status} label={pushChip.label} />
              </View>
            </View>
            {pushState !== 'granted' && (
              <Touchable style={styles.inlineAction} onPress={enablePush} accessibilityRole="button">
                <Text style={styles.inlineActionText}>
                  {pushState === 'denied'
                    ? t('notificationSettings.push.openSettings')
                    : t('notificationSettings.push.turnOn')}
                </Text>
              </Touchable>
            )}
          </View>
        </View>

        {/* Transactional — never a switch. */}
        <View style={styles.section}>
          <SectionHeader
            title={t('notificationSettings.alwaysOn.section')} />
          <View style={styles.card}>
            {alwaysOn.map((r, i) => (
              <View key={r.title} style={[styles.row, i > 0 && styles.rowDivided]}>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{r.title}</Text>
                </View>
                <StatusChip status="active" label={t('notificationSettings.alwaysOn.label')} />
              </View>
            ))}
          </View>
        </View>

        {/* Buyer discretionary */}
        <View style={styles.section}>
          <SectionHeader
            title={t('notificationSettings.fromTikem.section')} />
          {loading ? (
            <Skeleton width="100%" height={340} radius={radius.lg} style={{ marginTop: spacing.md }} />
          ) : (
            <View style={styles.card}>
              <PrefRow
                title={t('notificationSettings.fromTikem.discovery')}
                value={userPrefs.notify_discovery}
                onChange={(v) => toggleUserPref('notify_discovery', v)}
              />
              {/* Thursday: this weekend in your city (server lib/notifications/weekly-digest). */}
              <PrefRow
                divided
                title={t('notificationSettings.fromTikem.weekend')}
                value={userPrefs.notify_weekend_digest}
                onChange={(v) => toggleUserPref('notify_weekend_digest', v)}
              />
              <PrefRow
                divided
                title={t('notificationSettings.fromTikem.followedOrganizers')}
                value={userPrefs.notify_followed_organizers}
                onChange={(v) => toggleUserPref('notify_followed_organizers', v)}
              />
              <PrefRow
                divided
                title={t('notificationSettings.fromTikem.organizerMessages')}
                value={userPrefs.notify_organizer_messages}
                onChange={(v) => toggleUserPref('notify_organizer_messages', v)}
              />
              <PrefRow
                divided
                title={t('notificationSettings.fromTikem.savedEvents')}
                value={userPrefs.notify_reminders}
                onChange={(v) => toggleUserPref('notify_reminders', v)}
              />
              <PrefRow
                divided
                title={t('notificationSettings.fromTikem.fillingFast')}
                value={userPrefs.notify_filling_fast}
                onChange={(v) => toggleUserPref('notify_filling_fast', v)}
              />
              <PrefRow
                divided
                title={t('notificationSettings.fromTikem.nationalDay')}
                value={userPrefs.notify_national_day}
                onChange={(v) => toggleUserPref('notify_national_day', v)}
              />
              {socialFlags.invites ? (
                <PrefRow
                  divided
                  title={t('notificationSettings.fromTikem.friendInvites')}
                  value={userPrefs.notify_friend_invites}
                  onChange={(v) => toggleUserPref('notify_friend_invites', v)}
                />
              ) : null}
            </View>
          )}
        </View>

        {isOrganizer && (
          <>
            <View style={styles.section}>
              <SectionHeader
                title={t('notificationSettings.organizer.section')} />
              {loading ? (
                <Skeleton width="100%" height={220} radius={radius.lg} style={{ marginTop: spacing.md }} />
              ) : orgUnavailable || !orgPrefs ? (
                <View style={styles.card}>
                  <View style={styles.row}>
                    <View style={styles.rowText}>
                      <Text style={styles.rowBody}>{t('notificationSettings.organizer.unavailable')}</Text>
                    </View>
                  </View>
                </View>
              ) : (
                <>
                  {/* Only what Tikèm actually sends. There is no organizer
                      sale email, no reviews, no marketing email and no SMS
                      provider, so those switches are gone (the stored values
                      are left alone). Payouts are listed above as always on. */}
                  <UIText variant="eyebrow" style={styles.groupLabel}>{t('notificationSettings.organizer.email')}</UIText>
                  <View style={styles.card}>
                    <PrefRow
                      title={t('notificationSettings.organizer.attendeeMessages')}
                      value={orgPrefs.email_attendee_messages ?? true}
                      onChange={(v) => toggleOrgPref('email_attendee_messages', v)}
                    />
                  </View>

                  <UIText variant="eyebrow" style={styles.groupLabel}>{t('notificationSettings.organizer.push')}</UIText>
                  <View style={styles.card}>
                    <PrefRow
                      title={t('notificationSettings.organizer.ticketSales')}
                      value={orgPrefs.push_ticket_sales}
                      onChange={(v) => toggleOrgPref('push_ticket_sales', v)}
                    />
                    <PrefRow
                      divided
                      title={t('notificationSettings.organizer.attendeeMessages')}
                      value={orgPrefs.push_attendee_messages ?? true}
                      onChange={(v) => toggleOrgPref('push_attendee_messages', v)}
                    />
                    <PrefRow
                      divided
                      title={t('notificationSettings.organizer.milestones')}
                      value={userPrefs.notify_organizer_milestones}
                      onChange={(v) => toggleUserPref('notify_organizer_milestones', v)}
                    />
                    <PrefRow
                      divided
                      title={t('notificationSettings.organizer.nudges')}
                      value={userPrefs.notify_organizer_nudges}
                      onChange={(v) => toggleUserPref('notify_organizer_nudges', v)}
                    />
                    <PrefRow
                      divided
                      title={t('notificationSettings.organizer.season')}
                      value={userPrefs.notify_organizer_season}
                      onChange={(v) => toggleUserPref('notify_organizer_season', v)}
                    />
                  </View>
                </>
              )}
            </View>
          </>
        )}
      </Animated.ScrollView>
    </View>
  );
}

function PrefRow({
  title,
  value,
  onChange,
  divided,
}: {
  title: string;
  value: boolean;
  onChange: (v: boolean) => void;
  divided?: boolean;
}) {
  return (
    <View style={[styles.row, divided && styles.rowDivided]}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
      </View>
      <UISwitch value={value} onValueChange={onChange} accessibilityLabel={title} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 8 },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontFamily: font.serif, fontSize: 22, color: colors.textPrimary },
  section: { marginTop: spacing.xxl },
  // Grouped surface card — a fill one step above the canvas, never a hairline box.
  card: { marginTop: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 14 },
  rowDivided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  rowBody: { marginTop: 2, fontSize: 13, lineHeight: 18, color: colors.textSecondary },
  chipLine: { marginTop: 6 },
  inlineAction: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.chip,
    backgroundColor: colors.surfaceRaised,
  },
  inlineActionText: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  groupLabel: { marginTop: spacing.xl, marginBottom: -spacing.xs },
  footnote: { marginTop: spacing.sm, fontSize: 12, lineHeight: 17, color: colors.textTertiary },
});
