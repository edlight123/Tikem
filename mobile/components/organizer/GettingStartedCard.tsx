import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import { getVerificationRequest } from '../../lib/verification';
import { backendFetch, backendJson } from '../../lib/api/backend';
import { getOrganizerEvents } from '../../lib/api/organizer';
import { Touchable } from '../ui/Touchable';
import { Text as UIText } from '../ui/Text';

const hideKey = (uid: string) => `tikem_org_checklist_hidden_${uid}`;
const cacheKey = (uid: string) => `tikem_org_checklist_${uid}`;

type Steps = {
  create: boolean;
  publish: boolean;
  /** Identity submitted (pending review) or approved. Needed before a payout, never before publishing. */
  verify: boolean;
  payouts: boolean;
  team: boolean;
};

// Activation funnel telemetry: mirror the snapshot to Firestore, but only when
// it differs from what we last stored (the AsyncStorage cache doubles as the
// dedupe key) — a focus-driven recheck must not spam writes. Fire-and-forget.
function logActivation(uid: string, steps: Steps) {
  const completed = steps.create && steps.publish && steps.verify && steps.payouts && steps.team;
  setDoc(
    doc(db, 'organizer_activation', uid),
    {
      ...steps,
      completed,
      updated_at: serverTimestamp(),
      ...(completed ? { completed_at: serverTimestamp() } : {}),
    },
    { merge: true }
  ).catch((e) => console.warn('[GettingStarted] activation log failed:', e));
}

/**
 * Activation checklist for new organizers (dashboard): create → publish →
 * payouts → door team, each row computed from real account state and linking
 * straight to the screen that completes it. Auto-hides forever once every step
 * is done (or when dismissed via Hide). Cached per-user so it paints instantly;
 * refreshes in the background on focus.
 */
export default function GettingStartedCard() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const navigation = useNavigation<any>();
  const { userProfile } = useAuth();
  const { t } = useI18n();

  const [steps, setSteps] = useState<Steps | null>(null);
  const [hidden, setHidden] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      const uid = userProfile?.id;
      if (!uid) return;

      (async () => {
        try {
          const hiddenFlag = await AsyncStorage.getItem(hideKey(uid));
          if (hiddenFlag) return; // stays hidden forever once done/dismissed

          // Instant paint from cache while the live check runs. Also the
          // telemetry dedupe key — we only log when the snapshot changes.
          const cached = await AsyncStorage.getItem(cacheKey(uid));
          if (alive && cached) {
            setSteps(JSON.parse(cached));
            setHidden(false);
          }

          const [eventsRes, bankRes, haitiRes, stripeRes, teamRes, verifyRes] = await Promise.allSettled([
            getOrganizerEvents(uid, 5),
            backendFetch('/api/organizer/payout-destinations/bank').then((r) => (r.ok ? r.json() : null)),
            backendFetch('/api/organizer/payout-profiles/haiti').then((r) => (r.ok ? r.json() : null)),
            backendFetch('/api/organizer/stripe/status').then((r) => (r.ok ? r.json() : null)),
            backendJson<{ members?: any[] }>('/api/organizer/team'),
            getVerificationRequest(uid),
          ]);

          const events = eventsRes.status === 'fulfilled' ? eventsRes.value || [] : [];
          const bank = bankRes.status === 'fulfilled' ? bankRes.value : null;
          const haiti = haitiRes.status === 'fulfilled' ? haitiRes.value : null;
          const stripe = stripeRes.status === 'fulfilled' ? stripeRes.value : null;
          const team = teamRes.status === 'fulfilled' ? teamRes.value : null;
          const verification = verifyRes.status === 'fulfilled' ? (verifyRes.value as any) : null;
          const verifyStatus = String(verification?.status || '');

          const mm = haiti?.profile?.mobileMoneyDetails;
          const next: Steps = {
            create: events.length > 0,
            publish: events.some((e) => e.is_published),
            verify:
              verifyStatus === 'approved' ||
              verifyStatus === 'pending' ||
              verifyStatus === 'in_review' ||
              Boolean((userProfile as any)?.is_verified),
            payouts:
              (bank?.destinations || []).length > 0 ||
              Boolean(mm && (mm.phoneNumber || mm.accountName)) ||
              Boolean(stripe?.connected),
            team: (team?.members || []).length > 0,
          };

          if (!alive) return;

          if (next.create && next.publish && next.verify && next.payouts && next.team) {
            // Fully activated — log the completion, retire the card permanently.
            logActivation(uid, next);
            setHidden(true);
            await AsyncStorage.setItem(hideKey(uid), 'done');
            await AsyncStorage.removeItem(cacheKey(uid));
            return;
          }

          setSteps(next);
          setHidden(false);
          const serialized = JSON.stringify(next);
          if (serialized !== cached) {
            logActivation(uid, next);
            await AsyncStorage.setItem(cacheKey(uid), serialized);
          }
        } catch (e) {
          console.warn('[GettingStarted] check failed:', e);
        }
      })();

      return () => {
        alive = false;
      };
    }, [userProfile?.id])
  );

  const dismiss = useCallback(() => {
    setHidden(true);
    if (userProfile?.id) AsyncStorage.setItem(hideKey(userProfile.id), 'dismissed').catch(() => {});
  }, [userProfile?.id]);

  if (hidden || !steps) return null;

  const rows = [
    {
      key: 'create',
      done: steps.create,
      label: t('gettingStarted.create'),
      onPress: () => navigation.navigate('CreateEvent'),
    },
    {
      key: 'publish',
      done: steps.publish,
      label: t('gettingStarted.publish'),
      onPress: () => navigation.navigate('Main', { screen: 'MyEvents' }),
    },
    {
      // Not a gate: publishing never waits on it. It is what the first
      // payout needs, so new organizers hear about it here, early.
      key: 'verify',
      done: !!steps.verify,
      label: t('gettingStarted.verify'),
      onPress: () => navigation.navigate('OrganizerVerification'),
    },
    {
      key: 'payouts',
      done: steps.payouts,
      label: t('gettingStarted.payouts'),
      onPress: () => navigation.navigate('OrganizerPayoutSettings'),
    },
    {
      key: 'team',
      done: steps.team,
      label: t('gettingStarted.team'),
      onPress: () => navigation.navigate('OrganizerTeamHub'),
    },
  ];
  const doneCount = rows.filter((r) => r.done).length;

  return (
    <View style={styles.section}>
      <View style={styles.titleRow}>
        <UIText variant="eyebrow" style={styles.title}>{t('gettingStarted.title')}</UIText>
        <Text style={styles.progress}>
          {doneCount}/{rows.length}
        </Text>
        <Touchable
          onPress={dismiss}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={t('gettingStarted.hide')}
        >
          <Text style={styles.hide}>{t('gettingStarted.hide')}</Text>
        </Touchable>
      </View>

      {rows.map((row, i) => (
        <Touchable
          key={row.key}
          scale={false}
          pressedColor={colors.surface}
          style={[styles.row, i > 0 && styles.rowDivider]}
          onPress={row.onPress}
          disabled={row.done}
          accessibilityRole="button"
          accessibilityState={{ checked: row.done }}
        >
          <Ionicons
            name={row.done ? 'checkmark-circle' : 'ellipse-outline'}
            size={20}
            color={row.done ? colors.primary : colors.textTertiary}
          />
          <Text style={[styles.rowLabel, row.done && styles.rowLabelDone]} numberOfLines={1}>
            {row.label}
          </Text>
          {!row.done && <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />}
        </Touchable>
      ))}
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    // De-boxed (platform rule): rows on the canvas, hairline dividers only.
    section: {
      paddingHorizontal: 20,
      paddingTop: 14,
      paddingBottom: 6,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginBottom: 4,
    },
    title: {
      flex: 1,
    },
    progress: {
      fontSize: 12,
      color: colors.textSecondary,
      fontVariant: ['tabular-nums'],
    },
    hide: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textTertiary,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 11,
    },
    rowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    rowLabel: {
      flex: 1,
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
    },
    rowLabelDone: {
      color: colors.textTertiary,
      textDecorationLine: 'line-through',
    },
  });
