import React, { useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  StatusBar,
} from 'react-native';
import { X } from 'lucide-react-native';
import QRCode from 'react-native-qrcode-svg';
import * as Brightness from 'expo-brightness';
import { useI18n } from '../contexts/I18nContext';

const { width } = Dimensions.get('window');

interface QRCodeModalProps {
  visible: boolean;
  onClose: () => void;
  /**
   * The resolved value to encode — MUST match what the scanner expects
   * (`ticketQrValue(ticket)` = signed `qr_code` when present, else the doc id).
   * Passing the raw doc id here would produce an unscannable QR for tickets
   * that carry a distinct `qr_code` (e.g. free tickets).
   */
  qrValue: string;
  ticketNumber: string;
}

export default function QRCodeModal({ visible, onClose, qrValue, ticketNumber }: QRCodeModalProps) {
  const { t } = useI18n();

  // Boost brightness to max while the enlarged QR is up (dim-door scanning),
  // restore the prior brightness when it closes or unmounts.
  useEffect(() => {
    if (!visible) return;
    let previous: number | null = null;
    let active = true;
    (async () => {
      try {
        previous = await Brightness.getBrightnessAsync();
        if (active) await Brightness.setBrightnessAsync(1);
      } catch {}
    })();
    return () => {
      active = false;
      (async () => {
        try {
          if (previous != null) await Brightness.setBrightnessAsync(previous);
        } catch {}
      })();
    };
  }, [visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <StatusBar barStyle="light-content" />
        
        <View style={styles.container}>
          {/* Close Button */}
          <TouchableOpacity style={styles.closeButton} onPress={onClose} activeOpacity={0.8} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <X size={28} color="#FFF" />
          </TouchableOpacity>

          {/* QR Code */}
          <View style={styles.qrContainer}>
            <Text style={styles.title}>{t('qrModal.title')}</Text>
            <Text style={styles.subtitle}>{ticketNumber}</Text>

            <View style={styles.qrWrapper}>
              <QRCode
                value={qrValue}
                size={Math.min(width - 80, 320)}
                backgroundColor="#FFF"
                logo={require('../assets/tikem_logo_color.png')}
                logoSize={60}
                logoBackgroundColor="white"
                logoBorderRadius={4}
              />
            </View>
            
            <Text style={styles.instruction}>
              {t('qrModal.instruction')}
            </Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  closeButton: {
    position: 'absolute',
    top: 60,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  qrContainer: {
    alignItems: 'center',
    marginTop: 40,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: 32,
  },
  qrWrapper: {
    backgroundColor: '#FFF',
    padding: 30,
    borderRadius: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  instruction: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
    marginTop: 32,
    maxWidth: 280,
    lineHeight: 20,
  },
});
