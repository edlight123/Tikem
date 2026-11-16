import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Banknote, UserPlus } from 'lucide-react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { useI18n } from '../../contexts/I18nContext';
import { backendJson } from '../../lib/api/backend';
import { formatPrice } from '../../lib/currency';
import { safeFormatForLanguage } from '../../lib/dates';
import { useActiveOrg } from '../../lib/activeOrg';
import { colors as T, radius } from '../../theme/tokens';
import OrganizerScreenHeader from '../../components/organizer/OrganizerScreenHeader';
import { useOverlayHeaderInset } from '../../components/OverlayHeader';
import SectionHeader from '../../components/SectionHeader';
import StatTriplet from '../../components/StatTriplet';
import { ListGroup, ListRow } from '../../components/ui/ListRow';
import { Skeleton } from '../../components/Skeleton';
import { faceIcon } from '../../components/FeedbackFace';

/**
 * The morning-after recap for one event: sold vs came, when people arrived,
 * ticket revenue (Earnings has the payout detail), new followers since the
 * event, and the attendees' private ratings and comments.
 */

type Recap = {
  eventId: string;
  title: string;
  ended: boolean;
  currency: string;
  sold: number;
  checkedIn: number;
  revenue: number;
  arrivals: Array<{ at: string; count: number }>;
  peakArrival: string | null;
  newFollowers: number;
  feedback: {
    total: number;
    counts: { 1: number; 2: number; 3: number };
    comments: Array<{ name: string; rating: number; text: string; at: string | null }>;
  };
};


const recapCache = new Map<string, Recap>();

export default function OrganizerEventRecapScreen() {
  const navigation: any = useNavigation();
  const route: any = useRoute();
  const eventId: string = String(route.params?.eventId || '');
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t, language } = useI18n();
  const styles = getStyles(colors);
  const { height: headerH, onHeight } = useOverlayHeaderInset();
  const activeOrg = useActiveOrg();

  const cacheKey = `${activeOrg.orgId || ''}:${eventId}`;
  const [recap, setRecap] = useState<Recap | null>(() => recapCache.get(cacheKey) || null);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await backendJson<Recap>(`/api/organizer/events/${encodeURIComponent(eventId)}/recap`);
      recapCache.set(cacheKey, r);
      setRecap(r);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setRefreshing(false);
    }
  }, [eventId, cacheKey]);

  useEffect(() => {
    load();
  }, [load]);

  const pct = recap && recap.sold > 0 ? Math.round((recap.checkedIn / recap.sold) * 100) : null;
  const maxArrival = useMemo(() => Math.max(1, ...(recap?.arrivals || []).map((a) => a.count)), [recap]);
  const time = (iso: string | null) => (iso ? safeFormatForLanguage(iso, 'h:mm a', language) : '');

  return (
    <View style={styles.container}>
      <OrganizerScreenHeader
        title={t('eventRecap.title')}
        subtitle={recap?.title || undefined}
        onBack={() => navigation.goBack()}
        overlay
        onHeight={onHeight}
      />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: headerH + 8, paddingBottom: 40 + insets.bottom }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.textSecondary}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {!recap ? (
          failed ? (
            <Text style={styles.muted}>{t('eventRecap.loadFailed')}</Text>
          ) : (
            <>
              <Skeleton width="100%" height={72} radius={radius.button} style={{ marginBottom: 16 }} />
              <Skeleton width="100%" height={140} radius={radius.button} />
            </>
          )
        ) : (
          <>
            <StatTriplet
              items={[
                { label: t('eventRecap.sold'), value: recap.sold },
                { label: t('eventRecap.came'), value: recap.checkedIn },
                { label: t('eventRecap.turnout'), value: pct === null ? '–' : `${pct}%` },
              ]}
            />

            {recap.arrivals.length > 0 && (
              <View style={styles.section}>
                <SectionHeader
                  title={t('eventRecap.arrivals')}
                  subtitle={recap.peakArrival ? `${t('eventRecap.peak')} ${time(recap.peakArrival)}` : undefined}
                />
                <View style={styles.chart}>
                  {recap.arrivals.map((a) => (
                    <View key={a.at} style={styles.barCol}>
                      <View style={styles.barTrack}>
                        <View
                          style={[
                            styles.bar,
                            {
                              height: `${Math.max(4, (a.count / maxArrival) * 100)}%`,
                              backgroundColor: a.at === recap.peakArrival ? colors.primary : T.surfaceRaised,
                            },
                          ]}
                        />
                      </View>
                    </View>
                  ))}
                </View>
                {recap.arrivals.length > 1 ? (
                  <View style={styles.chartAxis}>
                    <Text style={styles.axisText}>{time(recap.arrivals[0].at)}</Text>
                    <Text style={styles.axisText}>{time(recap.arrivals[recap.arrivals.length - 1].at)}</Text>
                  </View>
                ) : null}
              </View>
            )}

            <View style={styles.section}>
              <ListGroup>
                {recap.revenue > 0 && activeOrg.financeView ? (
                  <ListRow
                    icon={Banknote}
                    title={t('eventRecap.revenue')}
                    value={formatPrice(recap.revenue, recap.currency)}
                    onPress={() => navigation.navigate('OrganizerEventEarnings', { eventId })}
                  />
                ) : null}
                <ListRow icon={UserPlus} title={t('eventRecap.newFollowers')} value={String(recap.newFollowers)} />
              </ListGroup>
            </View>

            <View style={styles.section}>
              <SectionHeader title={t('eventRecap.ratings')} />
              {recap.feedback.total === 0 ? (
                <Text style={styles.mutedLeft}>{t('eventRecap.noRatings')}</Text>
              ) : (
                <>
                  <View style={styles.faces}>
                    {([3, 2, 1] as const).map((r) => {
                      const Icon = faceIcon(r)!;
                      return (
                        <View key={r} style={styles.face}>
                          <Icon size={24} strokeWidth={1.5} color={colors.text} />
                          <Text style={styles.faceCount}>{recap.feedback.counts[r]}</Text>
                        </View>
                      );
                    })}
                  </View>
                  {recap.feedback.comments.map((c, i) => {
                    const Icon = faceIcon(c.rating);
                    return (
                      <View key={`${c.at}-${i}`} style={styles.comment}>
                        <Text style={styles.commentText}>{c.text}</Text>
                        <View style={styles.commentMeta}>
                          {Icon ? <Icon size={14} strokeWidth={1.75} color={colors.textSecondary} /> : null}
                          {c.name ? <Text style={styles.commentName}>{c.name}</Text> : null}
                        </View>
                      </View>
                    );
                  })}
                </>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { paddingHorizontal: 20 },
    section: { marginTop: 28 },
    chart: { flexDirection: 'row', alignItems: 'flex-end', height: 120, gap: 3, marginTop: 4 },
    // Slim columns: one busy half hour must not become a full-width block.
    barCol: { flex: 1, maxWidth: 22, height: '100%' },
    barTrack: { flex: 1, justifyContent: 'flex-end' },
    bar: { width: '100%', borderRadius: 2 },
    chartAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
    axisText: { fontSize: 12, color: colors.textTertiary },
    faces: { flexDirection: 'row', gap: 10 },
    face: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 14,
      borderRadius: radius.button,
      backgroundColor: T.surface,
    },
    faceCount: { marginTop: 6, fontSize: 20, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
    comment: {
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: T.surfaceRaised,
    },
    commentText: { fontSize: 15, color: colors.text, lineHeight: 21 },
    commentMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
    commentName: { fontSize: 13, color: colors.textSecondary },
    muted: { marginTop: 40, fontSize: 15, color: colors.textSecondary, textAlign: 'center' },
    mutedLeft: { fontSize: 15, color: colors.textSecondary },
  });
