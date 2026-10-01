import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  Linking,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
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
// The MOBILE push module (Expo token → /api/push/register-expo). Not to be
// confused with the web's two server-side notification modules.
import { registerForPushNotificationsIfPossible } from '../lib/pushNotifications';
import { colors, font, radius, spacing } from '../theme/tokens';

/**
 * Notification preferences.
 *
 * Only DISCRETIONARY notifications can be switched off here. Tickets,
 * receipts, reminders, event changes, refunds and payouts are transactional
 * (lib/notifications/policy.ts on the server) and are listed as "always on"
 * rather than offered as switches.
 *
 * Buyer switches write the users/{uid} fields the server's policy reads
 * (notify_discovery, notify_filling_fast). Organizer switches write the same
 * organizers/{uid}/notificationPreferences/main document as the web's
 * NotificationsForm, through the same PUT /api/organizer/settings/notifications,
 * plus the two organizer-side discretionary fields on users/{uid}
 * (notify_organizer_milestones, notify_organizer_nudges).
 */

// users/{uid} fields — absent means opted in (policy.ts isCategoryEnabled).
type UserPrefKey =
  | 'notify_discovery'
  | 'notify_filling_fast'
  | 'notify_organizer_milestones'
  | 'notify_organizer_nudges';

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
};

type PushState = 'granted' | 'denied' | 'undetermined' | 'unknown';

export default function NotificationSettingsScreen({ navigation, route }: any) {
  const { user } = useAuth();
  const { t } = useI18n();
  const showAlert = useAppAlert();
  const insets = useSafeAreaInsets();
  const { height: headerH, onHeight: onHeaderHeight } = useOverlayHeaderInset();
  const scrollY = useRef(new Animated.Value(0)).current;
  const isOrganizer = Boolean(route?.params?.organizer);

  const [loading, setLoading] = useState(true);
  const [userPrefs, setUserPrefs] = useState<Record<UserPrefKey, boolean>>({
    notify_discovery: true,
    notify_filling_fast: true,
    notify_organizer_milestones: true,
    notify_organizer_nudges: true,
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
            notify_discovery: data.notify_discovery ?? true,
            notify_filling_fast: data.notify_filling_fast ?? true,
            notify_organizer_milestones: data.notify_organizer_milestones ?? true,
            notify_organizer_nudges: data.notify_organizer_nudges ?? true,
          });
        }
      } catch {
        // Defaults (all on) match what the server assumes for a missing field.
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
      await registerForPushNotificationsIfPossible();
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
    { title: t('notificationSettings.alwaysOn.tickets'), body: t('notificationSettings.alwaysOn.ticketsBody') },
    { title: t('notificationSettings.alwaysOn.reminders'), body: t('notificationSettings.alwaysOn.remindersBody') },
    { title: t('notificationSettings.alwaysOn.changes'), body: t('notificationSettings.alwaysOn.changesBody') },
    { title: t('notificationSettings.alwaysOn.refunds'), body: t('notificationSettings.alwaysOn.refundsBody') },
    ...(isOrganizer
      ? [{ title: t('notificationSettings.alwaysOn.payouts'), body: t('notificationSettings.alwaysOn.payoutsBody') }]
      : []),
  ];

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <OverlayHeader onHeight={onHeaderHeight} style={styles.header} scrollY={scrollY}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <ArrowLeft size={24} color={colors.textPrimary} />
        </TouchableOpacity>
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
          title={t('notificationSettings.push.section')}
          subtitle={t('notificationSettings.push.sectionBody')}
          subtitleLines={3}
        />
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{t('notificationSettings.push.title')}</Text>
              <View style={styles.chipLine}>
                <StatusChip status={pushChip.status} label={pushChip.label} />
              </View>
            </View>
            {pushState !== 'granted' && (
              <TouchableOpacity style={styles.inlineAction} onPress={enablePush} accessibilityRole="button">
                <Text style={styles.inlineActionText}>
                  {pushState === 'denied'
                    ? t('notificationSettings.push.openSettings')
                    : t('notificationSettings.push.turnOn')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Transactional — never a switch. */}
        <View style={styles.section}>
          <SectionHeader
            title={t('notificationSettings.alwaysOn.section')}
            subtitle={t('notificationSettings.alwaysOn.sectionBody')}
            subtitleLines={3}
          />
          <View style={styles.card}>
            {alwaysOn.map((r, i) => (
              <View key={r.title} style={[styles.row, i > 0 && styles.rowDivided]}>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{r.title}</Text>
                  <Text style={styles.rowBody}>{r.body}</Text>
                </View>
                <StatusChip status="active" label={t('notificationSettings.alwaysOn.label')} />
              </View>
            ))}
          </View>
        </View>

        {/* Buyer discretionary */}
        <View style={styles.section}>
          <SectionHeader
            title={t('notificationSettings.fromTikem.section')}
            subtitle={t('notificationSettings.fromTikem.sectionBody')}
            subtitleLines={3}
          />
          {loading ? (
            <Skeleton width="100%" height={136} radius={radius.lg} />
          ) : (
            <View style={styles.card}>
              <PrefRow
                title={t('notificationSettings.fromTikem.discovery')}
                body={t('notificationSettings.fromTikem.discoveryBody')}
                value={userPrefs.notify_discovery}
                onChange={(v) => toggleUserPref('notify_discovery', v)}
              />
              <PrefRow
                divided
                title={t('notificationSettings.fromTikem.fillingFast')}
                body={t('notificationSettings.fromTikem.fillingFastBody')}
                value={userPrefs.notify_filling_fast}
                onChange={(v) => toggleUserPref('notify_filling_fast', v)}
              />
            </View>
          )}
        </View>

        {isOrganizer && (
          <>
            <View style={styles.section}>
              <SectionHeader
                title={t('notificationSettings.organizer.section')}
                subtitle={t('notificationSettings.organizer.sectionBody')}
                subtitleLines={3}
              />
              {loading ? (
                <Skeleton width="100%" height={220} radius={radius.lg} />
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
                  <Text style={styles.groupLabel}>{t('notificationSettings.organizer.email')}</Text>
                  <View style={styles.card}>
                    <PrefRow
                      title={t('notificationSettings.organizer.ticketSales')}
                      body={t('notificationSettings.organizer.ticketSalesEmail')}
                      value={orgPrefs.email_ticket_sales}
                      onChange={(v) => toggleOrgPref('email_ticket_sales', v)}
                    />
                    <PrefRow
                      divided
                      title={t('notificationSettings.organizer.reviews')}
                      body={t('notificationSettings.organizer.reviewsEmail')}
                      value={orgPrefs.email_new_reviews}
                      onChange={(v) => toggleOrgPref('email_new_reviews', v)}
                    />
                    <PrefRow
                      divided
                      title={t('notificationSettings.organizer.marketing')}
                      body={t('notificationSettings.organizer.marketingBody')}
                      value={orgPrefs.email_marketing}
                      onChange={(v) => toggleOrgPref('email_marketing', v)}
                    />
                  </View>

                  <Text style={styles.groupLabel}>{t('notificationSettings.organizer.sms')}</Text>
                  <View style={styles.card}>
                    <PrefRow
                      title={t('notificationSettings.organizer.ticketSales')}
                      body={t('notificationSettings.organizer.ticketSalesSms')}
                      value={orgPrefs.sms_ticket_sales}
                      onChange={(v) => toggleOrgPref('sms_ticket_sales', v)}
                    />
                  </View>
                  <Text style={styles.footnote}>{t('notificationSettings.organizer.smsNote')}</Text>

                  <Text style={styles.groupLabel}>{t('notificationSettings.organizer.push')}</Text>
                  <View style={styles.card}>
                    <PrefRow
                      title={t('notificationSettings.organizer.ticketSales')}
                      body={t('notificationSettings.organizer.ticketSalesPush')}
                      value={orgPrefs.push_ticket_sales}
                      onChange={(v) => toggleOrgPref('push_ticket_sales', v)}
                    />
                    <PrefRow
                      divided
                      title={t('notificationSettings.organizer.reviews')}
                      body={t('notificationSettings.organizer.reviewsPush')}
                      value={orgPrefs.push_new_reviews}
                      onChange={(v) => toggleOrgPref('push_new_reviews', v)}
                    />
                    <PrefRow
                      divided
                      title={t('notificationSettings.organizer.milestones')}
                      body={t('notificationSettings.organizer.milestonesBody')}
                      value={userPrefs.notify_organizer_milestones}
                      onChange={(v) => toggleUserPref('notify_organizer_milestones', v)}
                    />
                    <PrefRow
                      divided
                      title={t('notificationSettings.organizer.nudges')}
                      body={t('notificationSettings.organizer.nudgesBody')}
                      value={userPrefs.notify_organizer_nudges}
                      onChange={(v) => toggleUserPref('notify_organizer_nudges', v)}
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
  body,
  value,
  onChange,
  divided,
}: {
  title: string;
  body: string;
  value: boolean;
  onChange: (v: boolean) => void;
  divided?: boolean;
}) {
  return (
    <View style={[styles.row, divided && styles.rowDivided]}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowBody}>{body}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.border, true: colors.accent }}
        thumbColor={colors.white}
        ios_backgroundColor={colors.border}
        accessibilityLabel={title}
      />
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
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 14 },
  rowDivided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  rowBody: { marginTop: 3, fontSize: 13, lineHeight: 18, color: colors.textSecondary },
  chipLine: { marginTop: 6 },
  inlineAction: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.chip,
    backgroundColor: colors.surfaceRaised,
  },
  inlineActionText: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  groupLabel: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textSecondary,
  },
  footnote: { marginTop: spacing.sm, fontSize: 12, lineHeight: 17, color: colors.textTertiary },
});
