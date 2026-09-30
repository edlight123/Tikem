import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  StatusBar,
} from 'react-native';
import { useAppAlert } from '../../components/AppAlert';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTabBarSpace } from '../../hooks/useTabBarSpace';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Calendar } from 'lucide-react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import { getTodayEvents, TodayEvent } from '../../lib/api/organizer';
import { RADIUS } from '../../config/brand';
import InfoNotice from '../../components/organizer/InfoNotice';
import EventSelectorSheet from '../../components/organizer/EventSelectorSheet';
import StatTriplet from '../../components/StatTriplet';
import EmptyState from '../../components/EmptyState';
import WhitePillCTA from '../../components/WhitePillCTA';
import { Skeleton } from '../../components/Skeleton';

export default function OrganizerScanScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const navigation = useNavigation<any>();
  const { userProfile } = useAuth();
  const { t, language } = useI18n();
  const showAlert = useAppAlert();
  const locale = language === 'fr' ? 'fr-FR' : language === 'ht' ? 'fr-HT' : 'en-US';
  const insets = useSafeAreaInsets();
  // The tab bar is a translucent overlay, so reserve its height here or the
  // last row ends up sitting behind it.
  const tabBarSpace = useTabBarSpace();
  const [todayEvents, setTodayEvents] = useState<TodayEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<TodayEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [showEventSelector, setShowEventSelector] = useState(false);

  useEffect(() => {
    loadEvents();
  }, [userProfile?.id]);

  const loadEvents = async () => {
    if (!userProfile?.id) return;

    try {
      const events = await getTodayEvents(userProfile.id);
      setTodayEvents(events);

      // Auto-select first event
      if (events.length > 0) {
        setSelectedEvent(events[0]);
      }
    } catch (error) {
      console.error('Error loading events:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStartScanning = () => {
    if (!selectedEvent) {
      showAlert(
        t('organizerScan.noEventTitle'),
        t('organizerScan.noEventBody'),
        [{ text: t('common.ok') }]
      );
      return;
    }

    navigation.navigate('TicketScanner', { eventId: selectedEvent.id });
  };

  // Drop the location half when the event has none, instead of "7:00 PM • ".
  const eventSubtitle = (e: TodayEvent) =>
    [
      new Date(e.start_datetime).toLocaleTimeString(locale, {
        hour: 'numeric',
        minute: '2-digit',
      }),
      e.location,
    ]
      .filter(Boolean)
      .join(' • ');

  if (loading) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={colors.background} />
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <Text style={styles.headerTitle}>{t('organizerScan.title')}</Text>
          <Text style={styles.headerSubtitle}>{t('organizerScan.subtitle')}</Text>
        </View>
        <View style={styles.content}>
          <Skeleton width="100%" height={96} radius={RADIUS.md} style={{ marginBottom: 24 }} />
          <Skeleton width={120} height={16} radius={6} style={{ marginBottom: 8 }} />
          <Skeleton width="100%" height={60} radius={RADIUS.lg} style={{ marginBottom: 24 }} />
          <Skeleton width="100%" height={80} radius={RADIUS.lg} style={{ marginBottom: 32 }} />
          <Skeleton width="100%" height={56} radius={RADIUS.full} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <Text style={styles.headerTitle}>{t('organizerScan.title')}</Text>
        <Text style={styles.headerSubtitle}>{t('organizerScan.subtitle')}</Text>
      </View>

      <View style={[styles.content, { paddingBottom: tabBarSpace }]}>
        <View style={styles.instructions}>
          <InfoNotice>
            {`${t('organizerScan.howTitle')}\n1. ${t('organizerScan.howStep1')}\n2. ${t('organizerScan.howStep2')}\n3. ${t('organizerScan.howStep3')}\n4. ${t('organizerScan.howStep4')}`}
          </InfoNotice>
        </View>

        {/* Event Selector */}
        <View style={styles.eventSelector}>
          <Text style={styles.selectorLabel}>{t('organizerScan.selectEvent')}</Text>
          {todayEvents.length === 0 ? (
            <EmptyState icon={Calendar} title={t('organizerScan.noEventsToday')} compact />
          ) : (
            <TouchableOpacity
              style={styles.selectorButton}
              onPress={() => setShowEventSelector(true)}
            >
              <View style={styles.selectorContent}>
                {selectedEvent ? (
                  <View style={styles.selectorTextWrap}>
                    <Text style={styles.selectorTitle} numberOfLines={1}>{selectedEvent.title}</Text>
                    <Text style={styles.selectorSubtitle} numberOfLines={1}>
                      {eventSubtitle(selectedEvent)}
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.selectorPlaceholder}>{t('organizerScan.selectEventPlaceholder')}</Text>
                )}
                <Ionicons name="chevron-down" size={24} color={colors.textSecondary} />
              </View>
            </TouchableOpacity>
          )}
        </View>

        {/* Stats */}
        {selectedEvent && (
          <View style={styles.statsWrap}>
            <StatTriplet
              columns={2}
              items={[
                { label: t('organizerScan.totalTickets'), value: selectedEvent.ticketsSold },
                { label: t('organizerScan.checkedIn'), value: selectedEvent.ticketsCheckedIn, tone: 'emerald' },
              ]}
            />
          </View>
        )}

        {/* Start Button */}
        <WhitePillCTA
          label={t('organizerScan.startScanning')}
          onPress={handleStartScanning}
          disabled={!selectedEvent}
          icon={<Ionicons name="qr-code-outline" size={20} color="#000" />}
        />
      </View>

      {/* Event Selector Sheet */}
      <EventSelectorSheet
        visible={showEventSelector}
        title={t('organizerScan.selectEvent')}
        events={todayEvents.map((e) => ({
          id: e.id,
          title: e.title,
          subtitle: eventSubtitle(e),
        }))}
        selectedId={selectedEvent?.id}
        onSelect={(picked) => {
          const match = todayEvents.find((e) => e.id === picked.id) || null;
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
  header: {
    padding: 20,
    paddingTop: 16,
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: 32,
    fontFamily: 'InstrumentSerif_400Regular',
    letterSpacing: 0,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  content: {
    flex: 1,
    padding: 20,
  },
  instructions: {
    marginBottom: 24,
  },
  eventSelector: {
    marginBottom: 24,
  },
  selectorLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  selectorButton: {
    backgroundColor: colors.surface,
    borderRadius: RADIUS.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  selectorContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  selectorTextWrap: {
    flex: 1,
    marginRight: 12,
  },
  selectorTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  selectorSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  selectorPlaceholder: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  statsWrap: {
    marginBottom: 32,
  },
});
