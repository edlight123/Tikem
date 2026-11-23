import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { EventFilters, DEFAULT_FILTERS } from '../types/filters';
import { useAuth } from './AuthContext';
import { getDeviceLocationInfo, getSupportedCountry, isSupportedCountry } from '../utils/deviceLocation';
import { findMetro, locationLabel, type Metro } from '../data/metros';

// Last country the app actually resolved to (profile or explicit user choice).
// Hydrated on launch so the header/fetch never start from a locale guess the
// user has already corrected.
const RESOLVED_COUNTRY_KEY = 'resolved_user_country';
// The town the user is browsing. Persisted separately from the country because
// it survives filter resets: the location is the browsing SCOPE, not a filter.
const BROWSE_CITY_KEY = 'browse_city';

interface FiltersContextType {
  // Current applied filters
  appliedFilters: EventFilters;
  
  // Draft filters (being edited in modal)
  draftFilters: EventFilters;
  
  // Modal state
  isModalOpen: boolean;
  
  // User's default country (persisted > profile > device locale > HT)
  userCountry: string;

  // False until the country has been hydrated (persisted value / profile /
  // device locale). Consumers should hold their first country-filtered fetch
  // until this is true, or they will query with a placeholder country.
  countryResolved: boolean;

  // ---- The ONE active browse location -------------------------------------
  // Every browsing surface (home, discover, categories, search) scopes to this
  // and NEVER widens on its own. Seeing another market requires changing it.

  /** The chosen town ('' = the whole country, no metro scoping). */
  activeCity: string;
  /** The metro `activeCity` belongs to, or null when it is not one we know. */
  activeMetro: Metro | null;
  /** What to call the active location on screen ("Miami", "Port-au-Prince"). */
  activeLocationLabel: string;
  /** Change the browse location. Explicit, persisted, never automatic. */
  setActiveCity: (city: string) => void;

  // Actions
  setDraftFilters: (filters: EventFilters) => void;
  openFiltersModal: () => void;
  closeFiltersModal: () => void;
  applyFilters: () => void;
  applyFiltersDirectly: (filters: EventFilters) => void; // Apply filters directly without draft
  resetFilters: () => void;
  setUserCountry: (country: string) => void;
  
  // Utilities
  hasActiveFilters: () => boolean;
  countActiveFilters: () => number;
}

const FiltersContext = createContext<FiltersContextType | undefined>(undefined);

export function FiltersProvider({ children }: { children: ReactNode }) {
  const { userProfile } = useAuth();
  
  // Start from the product's home market, NOT the device locale. A phone that
  // is physically in Haiti but set to English (US) reports region "US", which
  // painted "UNITED STATES" in the Home header and ran the first events fetch
  // with the wrong country. The real value is hydrated asynchronously below
  // (persisted > profile > device locale > HT) before consumers fetch.
  const [userCountry, setUserCountryState] = useState<string>('HT');
  const [countryResolved, setCountryResolved] = useState(false);
  // Once the profile (authoritative) or an explicit user choice has set the
  // country, a slower hydration read must not overwrite it.
  const explicitCountryRef = useRef(false);
  const [appliedFilters, setAppliedFilters] = useState<EventFilters>({
    ...DEFAULT_FILTERS,
    country: 'HT',
  });
  const [draftFilters, setDraftFilters] = useState<EventFilters>({
    ...DEFAULT_FILTERS,
    country: 'HT',
  });
  const [isModalOpen, setIsModalOpen] = useState(false);
  // Once the user has picked a town themselves, no hydration (profile, storage)
  // may quietly move them somewhere else.
  const explicitCityRef = useRef(false);

  const applyCountry = (country: string) => {
    setUserCountryState(country);
    setAppliedFilters(prev => ({ ...prev, country }));
    setDraftFilters(prev => ({ ...prev, country }));
  };

  // The browse city lives on the filters object (that is what every screen
  // already reads), but it is treated as the SCOPE: reset keeps it, and it is
  // not counted as an "active filter".
  const applyCity = (city: string) => {
    setAppliedFilters(prev => ({ ...prev, city }));
    setDraftFilters(prev => ({ ...prev, city }));
  };

  // Hydrate the last-resolved country before the first fetch. The persisted
  // value wins for first paint; the profile effect below refines it when the
  // profile loads (and re-persists it).
  useEffect(() => {
    (async () => {
      try {
        const persisted = await AsyncStorage.getItem(RESOLVED_COUNTRY_KEY);
        if (!explicitCountryRef.current) {
          if (persisted && isSupportedCountry(persisted)) {
            applyCountry(persisted);
          } else {
            // First-ever launch (or post sign-out storage clear): fall back to
            // the device locale as a guess. Deliberately NOT persisted — only a
            // profile or an explicit user choice makes a country stick, because
            // the locale guess is exactly what can be wrong (US-locale phones
            // in Haiti). LocationDetectionBanner offers the correction.
            applyCountry(getDeviceLocationInfo().country);
          }
        }
        // The last town the user browsed, restored before the first fetch so
        // the feed never paints one market and then jumps to another.
        const persistedCity = await AsyncStorage.getItem(BROWSE_CITY_KEY);
        if (persistedCity && !explicitCityRef.current) applyCity(persistedCity);
      } catch (error) {
        console.error('[FiltersContext] Country hydration failed:', error);
      } finally {
        setCountryResolved(true);
      }
    })();
  }, []);

  // The profile's default city seeds the browse location on a fresh install —
  // but only when the user has not chosen one, and never a town that belongs to
  // a different country than the one being browsed.
  useEffect(() => {
    const profileCity = userProfile?.default_city;
    if (!profileCity || explicitCityRef.current) return;
    const metro = findMetro(profileCity);
    if (metro && metro.country !== userCountry) return;
    setAppliedFilters(prev => (prev.city ? prev : { ...prev, city: profileCity }));
    setDraftFilters(prev => (prev.city ? prev : { ...prev, city: profileCity }));
  }, [userProfile?.default_city, userCountry]);

  // Safety rail, not a fallback: a town belonging to ANOTHER country can only
  // ever match zero events (a persisted "Miami, FL" after switching to Haiti).
  // Drop it so browsing falls back to the country the user is actually in —
  // still an explicit location, never a widening triggered by an empty feed.
  useEffect(() => {
    const city = appliedFilters.city;
    if (!city) return;
    const metro = findMetro(city);
    if (!metro || metro.country === userCountry) return;
    applyCity('');
    AsyncStorage.removeItem(BROWSE_CITY_KEY).catch(() => {});
  }, [userCountry, appliedFilters.city]);

  // Update filters when user profile loads (profile country takes precedence)
  useEffect(() => {
    if (userProfile?.default_country) {
      const profileCountry = getSupportedCountry(userProfile.default_country);
      console.log('[FiltersContext] Setting country from profile:', profileCountry);
      explicitCountryRef.current = true;
      applyCountry(profileCountry);
      setCountryResolved(true);
      AsyncStorage.setItem(RESOLVED_COUNTRY_KEY, profileCountry).catch(() => {});
    }
  }, [userProfile?.default_country]);

  // Exposed setter (location banner, settings): an explicit choice, so it
  // sticks across launches.
  const setUserCountry = (country: string) => {
    const supported = getSupportedCountry(country);
    explicitCountryRef.current = true;
    setUserCountryState(supported);
    if (supported !== userCountry) {
      // A new country has entirely different towns; keeping the old one would
      // scope the feed to a metro that cannot exist here.
      explicitCityRef.current = false;
      applyCity('');
      AsyncStorage.removeItem(BROWSE_CITY_KEY).catch(() => {});
    }
    setAppliedFilters(prev => ({ ...prev, country: supported }));
    setDraftFilters(prev => ({ ...prev, country: supported }));
    AsyncStorage.setItem(RESOLVED_COUNTRY_KEY, supported).catch(() => {});
  };

  // Changing where you are browsing. The ONLY way another market appears.
  const setActiveCity = (city: string) => {
    explicitCityRef.current = true;
    applyCity(city);
    if (city) AsyncStorage.setItem(BROWSE_CITY_KEY, city).catch(() => {});
    else AsyncStorage.removeItem(BROWSE_CITY_KEY).catch(() => {});
  };

  const openFiltersModal = () => {
    // Copy current applied filters to draft when opening
    setDraftFilters({ ...appliedFilters });
    setIsModalOpen(true);
  };

  const closeFiltersModal = () => {
    // Revert draft to applied filters when closing without applying
    setDraftFilters({ ...appliedFilters });
    setIsModalOpen(false);
  };

  const applyFilters = () => {
    // Apply draft filters and close modal. A city change made inside the
    // filters sheet is still a LOCATION change — same one active location — so
    // it takes the explicit path: remembered across launches, and never
    // overwritten later by profile hydration.
    if ((draftFilters.city || '') !== (appliedFilters.city || '')) {
      explicitCityRef.current = true;
      const nextCity = draftFilters.city || '';
      if (nextCity) AsyncStorage.setItem(BROWSE_CITY_KEY, nextCity).catch(() => {});
      else AsyncStorage.removeItem(BROWSE_CITY_KEY).catch(() => {});
    }
    setAppliedFilters({ ...draftFilters });
    setIsModalOpen(false);
  };

  const applyFiltersDirectly = (filters: EventFilters) => {
    // Apply filters directly, bypassing draft state
    // Useful for programmatic filter application (e.g., category navigation)
    setAppliedFilters(filters);
    setDraftFilters(filters);
  };

  const resetFilters = () => {
    // Reset to defaults but keep the LOCATION — country and town. Clearing the
    // city here used to silently widen browsing to the whole country (and the
    // Discover tab does this on every tab press), which is exactly the
    // "why am I seeing Haiti events from Miami" behaviour. Changing location is
    // a deliberate act; resetting filters is not.
    const resetWithLocation = { ...DEFAULT_FILTERS, country: userCountry, city: appliedFilters.city };
    setAppliedFilters(resetWithLocation);
    setDraftFilters(resetWithLocation);
    setIsModalOpen(false);
  };

  const hasActiveFilters = (): boolean => {
    return countActiveFilters() > 0;
  };

  const countActiveFilters = (): number => {
    let count = 0;
    
    if (appliedFilters.date !== DEFAULT_FILTERS.date) count++;
    // Neither country nor city counts: together they are the browse LOCATION,
    // not a filter. Counting the city made "clear filters" look like the way to
    // see more events, and clearing it widened the feed to the whole country.
    if (appliedFilters.categories.length > 0) count++;
    if (appliedFilters.price !== DEFAULT_FILTERS.price) count++;
    if (appliedFilters.eventType !== DEFAULT_FILTERS.eventType) count++;
    if (appliedFilters.stepFree) count++;
    
    return count;
  };

  const activeCity = appliedFilters.city || '';
  const activeMetro = findMetro(activeCity, userCountry);
  const activeLocationLabel = activeCity ? locationLabel(activeCity, userCountry) : '';

  return (
    <FiltersContext.Provider
      value={{
        appliedFilters,
        draftFilters,
        isModalOpen,
        userCountry,
        countryResolved,
        activeCity,
        activeMetro,
        activeLocationLabel,
        setActiveCity,
        setDraftFilters,
        openFiltersModal,
        closeFiltersModal,
        applyFilters,
        applyFiltersDirectly,
        resetFilters,
        setUserCountry,
        hasActiveFilters,
        countActiveFilters
      }}
    >
      {children}
    </FiltersContext.Provider>
  );
}

export function useFilters() {
  const context = useContext(FiltersContext);
  if (context === undefined) {
    throw new Error('useFilters must be used within a FiltersProvider');
  }
  return context;
}
