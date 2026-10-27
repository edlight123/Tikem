import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Linking,
} from 'react-native';
import { Wallet, Download } from 'lucide-react-native';
import QRCode from 'react-native-qrcode-svg';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { backendFetch } from '../lib/api/backend';
import { useAppAlert } from './AppAlert';
import { radius } from '../theme/tokens';

// A crisp, plain QR on white for the saved file — no center logo, so any scanner
// reads it. Rendered off-screen only to rasterize; never shown.
const DOWNLOAD_QR_SIZE = 600;

interface AddToWalletButtonProps {
  ticketId: string;
  qrCodeData: string;
  eventTitle: string;
  eventDate: string;
  venueName: string;
  ticketNumber: number;
  totalTickets: number;
}

/**
 * Dictionary keys for the "wallet passes aren't set up yet" copy. `t()` echoes
 * an unknown key straight back, so every use goes through `label()` below and
 * falls back to English until the keys land in mobile/locales/*.
 * (Same guard as EventDetailScreen's STARTS_IN_KEY.)
 */
const UNAVAILABLE_TITLE_KEY = 'addToWallet.unavailableTitle';
const UNAVAILABLE_BODY_KEY = 'addToWallet.unavailableBody';

/**
 * Server error codes that mean "this will never work here, don't tell the user
 * to retry" (app/api/wallet/generate/route.ts). Anything else is treated as a
 * transient failure.
 */
const NOT_CONFIGURED_CODES = ['apple_wallet_not_configured', 'google_wallet_not_configured'];


export default function AddToWalletButton({
  ticketId,
  qrCodeData,
  eventTitle,
  eventDate,
  venueName,
  ticketNumber,
  totalTickets,
}: AddToWalletButtonProps) {
  const { colors } = useTheme();
  const showAlert = useAppAlert();
  const { t } = useI18n();
  const styles = getStyles(colors);
  const [isGenerating, setIsGenerating] = useState(false);
  /**
   * Whether THIS platform's wallet is available on the server.
   * `null` = not known yet: keep showing the button, because a failed probe must
   * not hide a feature that actually works. `false` hides it outright, so the
   * user is never offered a tap that cannot succeed.
   */
  // Google Wallet (Android) stays hidden until the server's capability probe
  // says it is offered: a live switch flipped when Google approves the issuer
  // (lib/wallet/config.ts isGoogleWalletOffered), no app update needed.
  const [walletAvailable, setWalletAvailable] = useState<boolean | null>(Platform.OS === 'android' ? false : null);
  const mounted = useRef(true);
  const [isDownloading, setIsDownloading] = useState(false);
  // Ref to the off-screen QR — react-native-qrcode-svg hands back an instance
  // with toDataURL(cb) that rasterizes the SVG to base64 PNG.
  const qrRef = useRef<{ toDataURL: (cb: (data: string) => void) => void } | null>(null);

  /** `t()` with an English fallback for keys that may not exist yet. */
  const label = useCallback(
    (key: string, fallback: string) => (t(key) === key ? fallback : t(key)),
    [t]
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Cheap capability probe: booleans only, no ticket involved. Lets us hide the
  // button on a deployment that has no wallet certificates instead of failing
  // on tap.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await backendFetch('/api/wallet/generate', { method: 'GET' });
        if (!response.ok) return;
        const capability = await response.json();
        if (cancelled || !mounted.current) return;
        const supported = Platform.OS === 'ios' ? capability?.apple : capability?.google;
        setWalletAvailable(Boolean(supported));
      } catch {
        // Leave it unknown — the button stays visible and any real failure is
        // explained on tap.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const showUnavailable = useCallback(() => {
    setWalletAvailable(false);
    showAlert(
      label(UNAVAILABLE_TITLE_KEY, 'Wallet passes aren’t available yet'),
      label(
        UNAVAILABLE_BODY_KEY,
        'Adding tickets to your phone’s wallet isn’t set up yet. Use “Save Image” to keep your QR code handy.'
      ),
      [{ text: t('common.ok') }]
    );
  }, [label, t]);

  const handleAddToWallet = async () => {
    setIsGenerating(true);

    try {
      // Route through backendFetch so the request hits the real (absolute) API
      // host WITH auth headers — a bare relative fetch was unauthenticated and
      // never reached the backend.
      const response = await backendFetch('/api/wallet/generate', {
        method: 'POST',
        body: JSON.stringify({
          ticketId,
          // Sent for logging/compat only: the server re-reads the ticket's own
          // QR payload from Firestore and ignores anything supplied here.
          qrCodeData,
          eventTitle,
          eventDate,
          venueName,
          ticketNumber,
          totalTickets,
          platform: Platform.OS, // 'ios' or 'android'
        }),
      });

      const data = await response.json().catch(() => ({} as any));

      if (!response.ok) {
        if (NOT_CONFIGURED_CODES.includes(String(data?.code))) {
          showUnavailable();
          return;
        }
        throw new Error(String(data?.code || `wallet_request_failed_${response.status}`));
      }

      const url = Platform.OS === 'ios' ? data?.passUrl : data?.saveUrl;
      if (!url) {
        // A 200 with no link is a server bug, not something a retry fixes.
        showUnavailable();
        return;
      }

      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) {
        throw new Error('cannot_open_wallet_url');
      }
      await Linking.openURL(url);

      // The OS takes over from here; the pass is added in Wallet, not in-app.
      showAlert(t('common.success'), t('addToWallet.successBody'), [{ text: t('common.ok') }]);
    } catch (error) {
      console.error('Error adding to wallet:', error);
      showAlert(t('common.error'), t('addToWallet.errorBody'), [{ text: t('common.ok') }]);
    } finally {
      if (mounted.current) setIsGenerating(false);
    }
  };

  // Rasterize the off-screen QR to a base64 PNG.
  const qrToBase64 = () =>
    new Promise<string>((resolve, reject) => {
      const ref = qrRef.current;
      if (!ref || typeof ref.toDataURL !== 'function') {
        reject(new Error('qr_not_ready'));
        return;
      }
      try {
        ref.toDataURL((data: string) => {
          if (data) resolve(data);
          else reject(new Error('qr_empty'));
        });
      } catch (e) {
        reject(e as Error);
      }
    });

  // Save the QR as an image. Writes a PNG to the cache and opens the system
  // share sheet, where the user can pick "Save Image" (→ Photos), Files, or any
  // other app. Uses only modules already in the binary, so it ships over the air
  // with no new build.
  const handleDownloadQR = async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      const base64 = await qrToBase64();
      const fileUri = `${FileSystem.cacheDirectory}tikem-ticket-${ticketId}.png`;
      await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: 'base64' });

      if (!(await Sharing.isAvailableAsync())) {
        throw new Error('sharing_unavailable');
      }
      await Sharing.shareAsync(fileUri, {
        mimeType: 'image/png',
        UTI: 'public.png',
        dialogTitle: t('addToWallet.downloadTitle'),
      });
    } catch (error) {
      console.error('Error saving QR image:', error);
      showAlert(t('common.error'), t('addToWallet.errorBody'), [{ text: t('common.ok') }]);
    } finally {
      if (mounted.current) setIsDownloading(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Add to Wallet Button — hidden entirely when the server cannot issue
          passes for this platform, so we never offer a tap that must fail. */}
      {walletAvailable !== false && (
        <TouchableOpacity
          style={styles.walletButton}
          onPress={handleAddToWallet}
          disabled={isGenerating}
          activeOpacity={0.7}
        >
          {isGenerating ? (
            <View style={styles.buttonContent}>
              <ActivityIndicator size="small" color={colors.background} />
              <Text style={styles.walletButtonText}>{t('addToWallet.generating')}</Text>
            </View>
          ) : (
            <View style={styles.buttonContent}>
              <Wallet size={20} color={colors.background} />
              <Text style={styles.walletButtonText}>
                {Platform.OS === 'ios' ? t('addToWallet.appleWallet') : t('addToWallet.googleWallet')}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      )}

      {/* Download QR Button — saves the QR as an image via the share sheet */}
      <TouchableOpacity
        style={styles.downloadButton}
        onPress={handleDownloadQR}
        disabled={isDownloading}
        activeOpacity={0.7}
      >
        <View style={styles.buttonContent}>
          {isDownloading ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            <Download size={18} color={colors.text} />
          )}
          <Text style={styles.downloadButtonText}>{t('addToWallet.saveImage')}</Text>
        </View>
      </TouchableOpacity>

      {/* Off-screen QR, rendered only so we can rasterize it to a PNG on tap.
          Kept out of layout and hidden from a11y / screen readers. */}
      <View style={styles.offscreen} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <QRCode
          value={qrCodeData || ticketId}
          size={DOWNLOAD_QR_SIZE}
          quietZone={24}
          color="#000000"
          backgroundColor="#FFFFFF"
          getRef={(c: any) => {
            qrRef.current = c;
          }}
        />
      </View>
    </View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    gap: 12,
  },
  walletButton: {
    backgroundColor: colors.text,
    borderRadius: radius.md,
    padding: 16,
  },
  downloadButton: {
    backgroundColor: 'transparent',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  // Pushed far off-screen; present in the tree so its ref can rasterize, but
  // never visible and zero layout impact.
  offscreen: {
    position: 'absolute',
    left: -10000,
    top: -10000,
    width: DOWNLOAD_QR_SIZE,
    height: DOWNLOAD_QR_SIZE,
    opacity: 0,
  },
  walletButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.background,
  },
  downloadButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
});
