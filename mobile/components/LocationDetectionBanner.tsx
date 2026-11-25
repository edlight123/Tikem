/**
 * Location Detection Banner for Mobile
 * Shows when device region differs from saved profile country
 * Offers to update user's location preferences
 *
 * Design (TestFlight 2026-11-23: "can't read full thing, make more premium"):
 * one quiet line, short enough to never truncate at 375pt in any language.
 * The flag, a short question ("Vous êtes aux États-Unis ?"), one action
 * ("Voir") and a small ×. No headline, no Yes/Change pair: the header's place
 * picker already changes the place. A faint fill, no shadow, 4px corners;
 * teal stays out of it (POSH: the chrome is black, white and grey).
 */

import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Animated } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useFilters } from '../contexts/FiltersContext';
import { useI18n } from '../contexts/I18nContext';
import { getDeviceLocationInfo, DEFAULT_CITIES } from '../utils/deviceLocation';
import { locationLabel } from '../data/metros';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Flag from './Flag';
import { NoticeStrip } from './ui/NoticeStrip';

const BANNER_DISMISSED_KEY = 'location_banner_dismissed';
const BANNER_DISMISSED_EXPIRY = 7 * 24 * 60 * 60 * 1000; // 7 days
const BANNER_ACCEPTED_KEY = 'location_banner_accepted';
// Written by FiltersContext; the country the user last browsed.
const RESOLVED_COUNTRY_KEY = 'resolved_user_country';

export default function LocationDetectionBanner() {
  const { t } = useI18n();
  const { user, userProfile, loading: authLoading, updateUserProfile } = useAuth();
  const { setUserCountry, setActiveCity } = useFilters();

  const [visible, setVisible] = useState(false);
  const visibleRef = useRef(false);
  visibleRef.current = visible;
  const [detectedCountry, setDetectedCountry] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  // 0 = hidden above the screen, 1 = resting in place.
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Wait for auth to settle: before the profile loads, a signed-in user who
    // already said "Yes" would read as the HT default and get asked again.
    // A signed-in user's profile arrives after auth settles; wait for it too.
    if (authLoading || (user && !userProfile)) return;
    checkLocationMismatch();
  }, [authLoading, user, userProfile?.default_country]);

  const checkLocationMismatch = async () => {
    try {
      const deviceInfo = getDeviceLocationInfo();
      const deviceCountry = deviceInfo.country;

      // The user already confirmed this country ("Yes"). Remembered on the
      // device, so it also holds for guests and if the profile write failed.
      const accepted = await AsyncStorage.getItem(BANNER_ACCEPTED_KEY);
      if (accepted === deviceCountry) return hideIfShown();

      // Check if banner was recently dismissed for this same country
      const dismissedData = await AsyncStorage.getItem(BANNER_DISMISSED_KEY);
      if (dismissedData) {
        const { timestamp, country } = JSON.parse(dismissedData);
        if (Date.now() - timestamp < BANNER_DISMISSED_EXPIRY && deviceCountry === country) {
          return hideIfShown();
        }
      }

      // Compare with the user's saved country; guests fall back to the country
      // they last browsed (persisted by FiltersContext), then to Haiti.
      const profileCountry =
        userProfile?.default_country ||
        (await AsyncStorage.getItem(RESOLVED_COUNTRY_KEY)) ||
        'HT';

      if (deviceCountry === profileCountry || !deviceInfo.isSupported) {
        return hideIfShown();
      }

      setDetectedCountry(deviceCountry);
      setVisible(true);
      Animated.spring(progress, {
        toValue: 1,
        useNativeDriver: true,
        tension: 60,
        friction: 9,
      }).start();
    } catch (error) {
      console.error('[LocationBanner] Error checking location:', error);
    }
  };

  const hideIfShown = () => {
    if (visibleRef.current) hideBanner();
  };

  const handleAccept = async () => {
    if (!detectedCountry) return;

    setUpdating(true);
    const defaultCity = DEFAULT_CITIES[detectedCountry] || '';
    // Remember the answer on the device first, so "Yes" sticks even for a
    // guest or when the profile write below fails.
    await AsyncStorage.setItem(BANNER_ACCEPTED_KEY, detectedCountry).catch(() => {});

    // Move the ONE active location to the detected country. setUserCountry
    // owns this: it drops the old town (its metro does not exist here) and
    // forgets the persisted one, so the next launch cannot restore a
    // Port-au-Prince scope under a US country.
    setUserCountry(detectedCountry);
    setActiveCity(defaultCity);

    if (user) {
      try {
        await updateUserProfile({
          default_country: detectedCountry,
          default_city: defaultCity,
        });
      } catch (error) {
        console.error('[LocationBanner] Error updating location:', error);
      }
    }

    setUpdating(false);
    hideBanner();
  };

  const rememberDismissal = async () => {
    if (detectedCountry) {
      await AsyncStorage.setItem(BANNER_DISMISSED_KEY, JSON.stringify({
        timestamp: Date.now(),
        country: detectedCountry,
      }));
    }
  };

  const handleDismiss = async () => {
    await rememberDismissal();
    hideBanner();
  };

  const hideBanner = () => {
    Animated.timing(progress, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start(() => {
      setVisible(false);
    });
  };

  if (!visible || !detectedCountry) return null;

  const city = locationLabel(DEFAULT_CITIES[detectedCountry] || '', detectedCountry);
  // A short per-country question; a country without one falls back to the
  // longer "Looks like you're in …".
  const askKey = `locationBanner.ask.${detectedCountry}`;
  const asked = t(askKey);
  const question = asked !== askKey ? asked : t('locationBanner.title', { inCountry: t(`locationBanner.inCountry.${detectedCountry}`) });
  // An in-flow row at the top of the feed (it scrolls away with it), so it
  // only nudges in a few points rather than dropping from above the notch.
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-8, 0],
  });

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.container,
        { opacity: progress, transform: [{ translateY }] },
      ]}
    >
      <NoticeStrip
        leading={<Flag code={detectedCountry} size={18} />}
        text={question}
        action={{
          label: updating ? '…' : t('locationBanner.show'),
          onPress: () => {
            if (!updating) handleAccept();
          },
          accessibilityLabel: city ? t('locationBanner.subtitle', { city }) : t('locationBanner.show'),
        }}
        onDismiss={() => {
          if (!updating) handleDismiss();
        }}
        dismissLabel={t('locationBanner.notNow')}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Part of the scroll content, not pinned over it: a pinned banner covered
  // the feed while scrolling (simulator audit 2026-11-16).
  container: {
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 8,
  },
});
