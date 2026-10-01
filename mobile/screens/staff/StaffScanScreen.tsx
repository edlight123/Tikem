import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTabBarSpace } from '../../hooks/useTabBarSpace';
import { Ticket } from 'lucide-react-native';
import { auth } from '../../config/firebase';
import { useTheme } from '../../contexts/ThemeContext';
import { useI18n } from '../../contexts/I18nContext';
import { RADIUS } from '../../config/brand';
import { useStaffEvents, StaffEventSummary } from '../../hooks/useStaffEvents';
import OrganizerScreenHeader from '../../components/organizer/OrganizerScreenHeader';
import InfoNotice from '../../components/organizer/InfoNotice';
import EventSelectorSheet from '../../components/organizer/EventSelectorSheet';
import EmptyState from '../../components/EmptyState';
import WhitePillCTA from '../../components/WhitePillCTA';
import { Skeleton } from '../../components/Skeleton';
import { useAppAlert } from '../../components/AppAlert';
import { radius } from '../../theme/tokens';
import { flushCheckInQueue } from '../../lib/doorCheckIn';

export default function StaffScanScreen() {
  const { colors } = useTheme();
  const showAlert = useAppAlert();
  const styles = getStyles(colors);
  const navigation = useNavigation();
  const uid = auth.currentUser?.uid || null;
  const { t } = useI18n();
  // The tab bar is a translucent overlay, so reserve its height here or the
  // last row ends up sitting behind it.
  const tabBarSpace = useTabBarSpace();

  const { events, loading, refreshing, refresh } = useStaffEvents();

  // Check-ins a door-only phone queued while offline are replayed whenever
  // staff come back here, not only while the scanner is open.
  useFocusEffect(
    useCallback(() => {
      if (uid) flushCheckInQueue(uid).catch(() => {});
    }, [uid]),
  );
  const [selectedEvent, setSelectedEvent] = useState<StaffEventSummary | null>(null);
  const [showEventSelector, setShowEventSelector] = useState(false);

  // Keep the selection in sync with the loaded events: preserve a still-valid
  // selection, otherwise fall back to the first event (mirrors prior behavior).
  useEffect(() => {
    setSelectedEvent((prev) => {
      if (prev && events.some((e) => e.id === prev.id)) return prev;
      return events.length > 0 ? events[0] : null;
    });
  }, [events]);

  const emptyText = useMemo(() => {
    if (!uid) return t('staffEvents.signIn');
    return t('staffEvents.noAssigned');
  }, [uid, t]);

  const eventSubtitle = (e: StaffEventSummary) =>
    `${e.venue_name ? e.venue_name : t('common.venue')}${e.city ? ` • ${e.city}` : ''}`;

  const handleStartScanning = () => {
    if (!selectedEvent) {
      showAlert(t('staffScan.noEventTitle'), t('staffScan.noEventBody'), [{ text: t('common.ok') }]);
      return;
    }

    (navigation as any).navigate('TicketScanner', { eventId: selectedEvent.id });
  };

  return (
    <View style={styles.container}>
      <OrganizerScreenHeader title={t('staffScan.title')} subtitle={t('staffScan.subtitle')} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 24 + tabBarSpace }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />
        }
      >
        <View style={styles.notice}>
          <InfoNotice text={t('staffScan.readySubtitle')} />
        </View>

        {loading ? (
          <View style={styles.content}>
            <Skeleton width={120} height={16} radius={6} style={{ marginBottom: 8 }} />
            <Skeleton width="100%" height={60} radius={RADIUS.lg} style={{ marginBottom: 16 }} />
            <Skeleton width="100%" height={56} radius={RADIUS.full} />
          </View>
        ) : events.length === 0 ? (
          <EmptyState icon={Ticket} title={emptyText} />
        ) : (
          <View style={styles.content}>
            <Text style={styles.selectorLabel}>{t('staffScan.selectEvent')}</Text>
            <TouchableOpacity style={styles.selectorButton} onPress={() => setShowEventSelector(true)}>
              <View style={styles.selectorContent}>
                {selectedEvent ? (
                  <View style={styles.selectorTextCol}>
                    <Text style={styles.selectorTitle} numberOfLines={1}>{selectedEvent.title}</Text>
                    <Text style={styles.selectorSubtitle} numberOfLines={1}>
                      {eventSubtitle(selectedEvent)}
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.selectorPlaceholder}>{t('staffScan.selectEventPlaceholder')}</Text>
                )}
                <Ionicons name="chevron-down" size={22} color={colors.textSecondary} />
              </View>
            </TouchableOpacity>

            <View style={styles.ctaWrap}>
              <WhitePillCTA
                label={t('staffScan.startScanning')}
                onPress={handleStartScanning}
                disabled={!selectedEvent}
                icon={<Ionicons name="camera-outline" size={20} color="#000" />}
              />
            </View>
          </View>
        )}
      </ScrollView>

      <EventSelectorSheet
        visible={showEventSelector}
        title={t('staffScan.selectEvent')}
        events={events.map((e) => ({ id: e.id, title: e.title, subtitle: eventSubtitle(e) }))}
        selectedId={selectedEvent?.id}
        onSelect={(picked) => {
          const match = events.find((e) => e.id === picked.id) || null;
          setSelectedEvent(match);
          setShowEventSelector(false);
        }}
        onClose={() => setShowEventSelector(false)}
      />
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 24,
  },
  notice: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  selectorLabel: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  selectorButton: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  selectorContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectorTextCol: {
    flex: 1,
    paddingRight: 12,
  },
  selectorTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  selectorSubtitle: {
    marginTop: 6,
    fontSize: 13,
    color: colors.textSecondary,
  },
  selectorPlaceholder: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  ctaWrap: {
    marginTop: 16,
  },
});
