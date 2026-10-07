import { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import { useAppMode } from '../contexts/AppModeContext';

/**
 * Open the Tickets or Discover tab from anywhere. Those tabs only exist in the
 * attendee tab bar, so from organizer or staff mode a plain navigate() did
 * nothing; switch to attendee mode and let the navigator land on the tab.
 */
export function useOpenAttendeeTab() {
  const navigation = useNavigation<any>();
  const { mode, setMode } = useAppMode();

  return useCallback(
    (screen: 'Tickets' | 'Discover') => {
      if (mode === 'attendee') {
        navigation.navigate('Main', { screen });
        return;
      }
      setMode('attendee', { landingTab: screen });
    },
    [mode, navigation, setMode]
  );
}
