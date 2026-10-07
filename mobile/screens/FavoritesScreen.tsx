import React, { useState, useEffect, useRef } from 'react';
import {
  Animated,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  StatusBar,
  Dimensions
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Heart, Share2, ArrowLeft } from 'lucide-react-native';
import { collection, query, where, getDocs, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { useTheme } from '../contexts/ThemeContext';
import EmptyState from '../components/EmptyState';
import { artByKey } from '../lib/artLibrary';
import OverlayHeader, { useOverlayHeaderInset } from '../components/OverlayHeader';
import PosterEventCard from '../components/PosterEventCard';
import { GridSkeleton } from '../components/Skeleton';
import { useAppAlert } from '../components/AppAlert';
import { shareEvent } from '../lib/share';
import { useOpenAttendeeTab } from '../hooks/useOpenAttendeeTab';

const { width } = Dimensions.get('window');
const FAV_COLUMN_WIDTH = (width - 32 - 12) / 2;

export default function FavoritesScreen({ navigation }: any) {
  const openAttendeeTab = useOpenAttendeeTab();
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const { user } = useAuth();
  const { t, language } = useI18n();
  const insets = useSafeAreaInsets();
  // Blurred overlay title bar — the grid scrolls under it, so reserve its height.
  const { height: headerH, onHeight: onHeaderHeight } = useOverlayHeaderInset();
  const showAlert = useAppAlert();
  const [favoriteEvents, setFavoriteEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Scroll offset for the header chrome: solid canvas at rest, translucent
  // only once the grid has actually scrolled underneath (see OverlayHeader).
  const scrollY = useRef(new Animated.Value(0)).current;

  const fetchFavorites = async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      // Get favorite event IDs
      const favoritesRef = collection(db, 'event_favorites');
      const favoritesQuery = query(favoritesRef, where('user_id', '==', user.uid));
      const favoritesSnapshot = await getDocs(favoritesQuery);
      
      if (favoritesSnapshot.empty) {
        setFavoriteEvents([]);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const eventIds = favoritesSnapshot.docs.map(doc => doc.data().event_id);

      // Get events (batch by 10 for Firestore 'in' query limit)
      const allEvents: any[] = [];
      for (let i = 0; i < eventIds.length; i += 10) {
        const batch = eventIds.slice(i, i + 10);
        const eventsQuery = query(
          collection(db, 'events'),
          where('__name__', 'in', batch)
        );
        const eventsSnapshot = await getDocs(eventsQuery);
        eventsSnapshot.docs.forEach(doc => {
          const data = doc.data();
          allEvents.push({
            id: doc.id,
            ...data,
            start_datetime: data.start_datetime?.toDate ? data.start_datetime.toDate() : data.start_datetime ? new Date(data.start_datetime) : null,
            end_datetime: data.end_datetime?.toDate ? data.end_datetime.toDate() : data.end_datetime ? new Date(data.end_datetime) : null
          });
        });
      }

      setFavoriteEvents(allEvents);
    } catch (error) {
      console.error('Error fetching favorites:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchFavorites();
  }, [user]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchFavorites();
  };

  const removeFavorite = async (eventId: string) => {
    showAlert(
      t('favorites.removeTitle'),
      t('favorites.removeBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.remove'),
          style: 'destructive',
          onPress: async () => {
            try {
              const favoritesRef = collection(db, 'event_favorites');
              const q = query(
                favoritesRef,
                where('user_id', '==', user?.uid),
                where('event_id', '==', eventId)
              );
              const snapshot = await getDocs(q);
              
              snapshot.docs.forEach(async (docSnapshot) => {
                await deleteDoc(doc(db, 'event_favorites', docSnapshot.id));
              });

              // Update local state
              setFavoriteEvents(prev => prev.filter(event => event.id !== eventId));
              
              showAlert(t('common.success'), t('favorites.removeSuccess'));
            } catch (error) {
              console.error('Error removing favorite:', error);
              showAlert(t('common.error'), t('favorites.removeError'));
            }
          }
        }
      ]
    );
  };

  const handleShare = (event: any) => shareEvent(event, language);

  if (!user) {
    return (
      <View style={styles.emptyContainer}>
        <EmptyState
          icon={Heart}
          title={t('auth.loginRequiredTitle')}
          subtitle={t('favorites.loginRequiredBody')}
        />
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={colors.background} />
        <OverlayHeader onHeight={onHeaderHeight} style={styles.header} scrollY={scrollY}>
          <Text style={styles.headerTitle}>{t('favorites.title')}</Text>
        </OverlayHeader>
        {/* No scroll container here — pad the placeholder grid by hand. */}
        <View style={{ paddingTop: headerH }}>
          <GridSkeleton />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      <OverlayHeader onHeight={onHeaderHeight} style={styles.header} scrollY={scrollY}>
        {navigation.canGoBack() && (
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} hitSlop={8}>
            <ArrowLeft size={24} color={colors.text} />
          </TouchableOpacity>
        )}
        <Text style={styles.headerTitle}>{t('favorites.title')}</Text>
      </OverlayHeader>

      <Animated.ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingTop: headerH, paddingBottom: insets.bottom + 24 }}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: true,
        })}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {favoriteEvents.length === 0 ? (
          <EmptyState
            icon={Heart}
            art={artByKey('tekemab')}
            title={t('favorites.emptyTitle')}
            subtitle={t('favorites.emptyBody')}
            actionLabel={t('favorites.explore')}
            onAction={() => openAttendeeTab('Discover')}
          />
        ) : (
          <View style={styles.eventsGrid}>
            {favoriteEvents.map(event => (
              <PosterEventCard
                key={event.id}
                event={event}
                width={FAV_COLUMN_WIDTH}
                onPress={() => navigation.navigate('EventDetail', { eventId: event.id })}
                overlay={
                  <View style={styles.cardActions}>
                    <TouchableOpacity
                      style={styles.cardActionBtn}
                      onPress={() => handleShare(event)}
                      hitSlop={8}
                    >
                      <Share2 size={15} color={colors.text} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.cardActionBtn}
                      onPress={() => removeFavorite(event.id)}
                      hitSlop={8}
                    >
                      <Heart size={15} color={colors.error} fill={colors.error} />
                    </TouchableOpacity>
                  </View>
                }
              />
            ))}
          </View>
        )}
      </Animated.ScrollView>
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  // Only what OverlayHeader does NOT already provide. It owns the safe-area
  // paddingTop, the horizontal padding and the ChromeBlur backdrop; the old
  // `padding: 20` / `paddingTop: 16` here would have overridden the safe-area
  // inset and pushed the title under the status bar, and the backgroundColor
  // would have painted an opaque slab straight over the blur.
  header: {
    paddingBottom: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    marginBottom: 8,
  },
  headerTitle: {
    fontFamily: 'InstrumentSerif_400Regular',
    fontSize: 40,
    fontWeight: '700',
    letterSpacing: -0.5,
    color: colors.text,
  },
  content: {
    flex: 1,
  },
  eventsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 6,
  },
  cardActionBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
});