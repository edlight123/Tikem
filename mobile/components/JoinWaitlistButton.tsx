import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { backendFetch } from '../lib/api/backend';
import { useAppAlert } from './AppAlert';
import { radius } from '../theme/tokens';

interface JoinWaitlistButtonProps {
  eventId: string;
  eventTitle: string;
  isSoldOut: boolean;
  style?: any;
  onJoined?: (position: number) => void;
}

export default function JoinWaitlistButton({ 
  eventId, 
  eventTitle, 
  isSoldOut, 
  style,
  onJoined 
}: JoinWaitlistButtonProps) {
  const { colors } = useTheme();
  const showAlert = useAppAlert();
  const styles = getStyles(colors);
  const { user } = useAuth();
  const { t } = useI18n();
  const [isOnWaitlist, setIsOnWaitlist] = useState(false);
  const [position, setPosition] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);

  useEffect(() => {
    checkWaitlistStatus();
  }, [user?.uid, eventId]);

  const checkWaitlistStatus = async () => {
    if (!user?.uid || !eventId) {
      setLoading(false);
      return;
    }

    try {
      // Server read: client rules do not expose event_waitlist, so the old
      // direct Firestore query always failed and the button never knew you
      // had joined.
      const response = await backendFetch(`/api/waitlist/join?eventId=${encodeURIComponent(eventId)}`);
      const data = await response.json().catch(() => null);
      if (response.ok && data?.onWaitlist) {
        setIsOnWaitlist(true);
        setPosition(data.position || null);
      }
    } catch (error) {
      console.error('Error checking waitlist status:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleJoinWaitlist = async () => {
    if (!user) {
      showAlert(
        t('auth.loginRequiredTitle') || 'Login Required',
        t('waitlist.loginBody') || 'Please log in to join the waitlist'
      );
      return;
    }

    setJoining(true);
    try {
      const response = await backendFetch('/api/waitlist/join', {
        method: 'POST',
        body: JSON.stringify({ eventId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to join waitlist');
      }

      setIsOnWaitlist(true);
      setPosition(data.position);
      onJoined?.(data.position);

      showAlert(
        t('common.success'),
        `${t('waitlist.joined') || "You've been added to the waitlist!"}\n${t('waitlist.position') || 'Your position'}: #${data.position}`,
      );
    } catch (error: any) {
      console.error('Error joining waitlist:', error);
      showAlert(t('common.error'), error.message || 'Failed to join waitlist');
    } finally {
      setJoining(false);
    }
  };

  // Only show for sold-out events
  if (!isSoldOut) {
    return null;
  }

  if (loading) {
    return (
      <TouchableOpacity style={[styles.button, styles.loadingButton, style]} disabled>
        <ActivityIndicator size="small" color={colors.primary} />
      </TouchableOpacity>
    );
  }

  if (isOnWaitlist) {
    return (
      <>
        <TouchableOpacity
          style={[styles.button, styles.onWaitlistButton, style]}
          onPress={() => setShowInfoModal(true)}
        >
          <Ionicons name="hourglass-outline" size={18} color={colors.primary} />
          <Text style={styles.onWaitlistText}>
            {t('waitlist.onWaitlist') || 'On Waitlist'} #{position}
          </Text>
          <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
        </TouchableOpacity>

        <Modal
          visible={showInfoModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowInfoModal(false)}
        >
          <TouchableOpacity 
            style={styles.modalOverlay} 
            activeOpacity={1}
            onPress={() => setShowInfoModal(false)}
          >
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Ionicons name="hourglass" size={32} color={colors.primary} />
                <Text style={styles.modalTitle}>{t('waitlist.yourPosition') || 'Your Position'}</Text>
              </View>

              <View style={styles.positionBadge}>
                <Text style={styles.positionNumber}>#{position}</Text>
              </View>

              <Text style={styles.modalText}>
                {t('waitlist.infoText') || "You'll be notified by email if tickets become available. Keep an eye on your inbox!"}
              </Text>

              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => setShowInfoModal(false)}
              >
                <Text style={styles.closeButtonText}>{t('common.gotIt') || 'Got it'}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      </>
    );
  }

  return (
    <TouchableOpacity
      style={[styles.button, styles.joinButton, style]}
      onPress={handleJoinWaitlist}
      disabled={joining}
    >
      {joining ? (
        <ActivityIndicator size="small" color="#FFF" />
      ) : (
        <>
          <Ionicons name="notifications-outline" size={18} color="#FFF" />
          <Text style={styles.joinButtonText}>
            {t('waitlist.joinWaitlist') || 'Join Waitlist'}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: radius.md,
    gap: 8,
  },
  loadingButton: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  joinButton: {
    backgroundColor: colors.primary,
  },
  joinButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
  },
  onWaitlistButton: {
    backgroundColor: colors.primary + '15',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  onWaitlistText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 24,
    alignItems: 'center',
    width: '100%',
    maxWidth: 320,
  },
  modalHeader: {
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    marginTop: 12,
  },
  positionBadge: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: radius.lg,
    marginBottom: 20,
  },
  positionNumber: {
    fontSize: 32,
    fontWeight: '800',
    color: '#FFF',
  },
  modalText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  closeButton: {
    backgroundColor: colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: radius.md,
  },
  closeButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
  },
});
