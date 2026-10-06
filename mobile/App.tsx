// Side-effect import: arms the native splash hold. Must come before anything
// that can render, so keep it first.
import './lib/splash';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, InstrumentSerif_400Regular, InstrumentSerif_400Regular_Italic } from '@expo-google-fonts/instrument-serif';
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';
import { AuthProvider } from './contexts/AuthContext';
import { AppModeProvider } from './contexts/AppModeContext';
import { FiltersProvider } from './contexts/FiltersContext';
import { I18nProvider } from './contexts/I18nContext';
import { AppAlertProvider } from './components/AppAlert';
import AppNavigator from './navigation/AppNavigator';
import BootScreen from './components/BootScreen';
import PhonePromptHost from './components/PhonePromptHost';
import { refreshFeeConfig } from './lib/feeConfigSync';

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    InstrumentSerif_400Regular,
    InstrumentSerif_400Regular_Italic,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
  });

  // Adopt the fee rates and caps the server is actually charging, so an advertised
  // total never quotes terms an admin has since changed. Deliberately not awaited:
  // prices fall back to the cached (then build-time) terms until it lands, and
  // nothing here is worth delaying the first screen for.
  useEffect(() => {
    refreshFeeConfig();
  }, []);

  if (!fontsLoaded && !fontError) {
    return <BootScreen />;
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <I18nProvider>
          <AppModeProvider>
            <FiltersProvider>
              {/* Wraps the navigator so any screen can call useAppAlert(). Sits
                  above ThemeProvider, which is fine: ThemeContext defaults to
                  DARK_COLORS and the app ships a single dark theme. */}
              <AppAlertProvider>
                <AppNavigator />
                {/* The "add your number" sheet (lib/phonePrompt.ts). At the root
                    so it survives the navigation that follows a purchase. */}
                <PhonePromptHost />
              </AppAlertProvider>
              <StatusBar style="light" />
            </FiltersProvider>
          </AppModeProvider>
        </I18nProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
