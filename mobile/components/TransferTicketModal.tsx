import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
  Share,
} from 'react-native';
import { X, Share2 } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { backendJson } from '../lib/api/backend';
import { useAppAlert } from './AppAlert';
import { radius, colors as T, font } from '../theme/tokens';
import { useI18n } from '../contexts/I18nContext';
import WhitePillCTA from './WhitePillCTA';

interface TransferTicketModalProps {
  visible: boolean;
  onClose: () => void;
  ticketId: string;
  eventTitle: string;
  transferCount?: number;
  onTransferSuccess?: () => void;
}

export default function TransferTicketModal({
  visible,
  onClose,
  ticketId,
  eventTitle,
  transferCount = 0,
  onTransferSuccess,
}: TransferTicketModalProps) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const showAlert = useAppAlert();
  const styles = getStyles(colors);
  const [toEmail, setToEmail] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [transferLink, setTransferLink] = useState('');
  const [showLink, setShowLink] = useState(false);
  const [emailError, setEmailError] = useState('');

  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email) {
      setEmailError('');
      return false;
    }
    if (!emailRegex.test(email)) {
      setEmailError(t('transferTicket.invalidEmail'));
      return false;
    }
    setEmailError('');
    return true;
  };

  const handleTransfer = async () => {
    if (!toEmail.trim()) {
      setError(t('transferTicket.emailRequired'));
      return;
    }

    if (!validateEmail(toEmail)) {
      setError(t('transferTicket.invalidEmail'));
      return;
    }

    setError('');
    setLoading(true);

    try {
      // Use the authenticated backend helper so the Firebase token + session
      // cookie are attached (a plain fetch is unauthenticated and 401s).
      const data = await backendJson<any>('/api/tickets/transfer/request', {
        method: 'POST',
        body: JSON.stringify({
          ticketId,
          toEmail: toEmail.trim(),
          message: message.trim(),
        }),
      });

      // Show transfer link if available
      if (data.transfer?.transferToken) {
        const link = `https://www.tikem.co/tickets/transfer/${data.transfer.transferToken}`;
        setTransferLink(link);
        setShowLink(true);
        
        // Notify parent to refresh
        if (onTransferSuccess) {
          onTransferSuccess();
        }
      } else {
        showAlert(
          'Transfer Sent!',
          `Transfer request sent to ${toEmail}. They have 24 hours to accept.`,
          [
            {
              text: 'OK',
              onPress: () => {
                onClose();
                setToEmail('');
                setMessage('');
                
                // Notify parent to refresh
                if (onTransferSuccess) {
                  onTransferSuccess();
                }
              },
            },
          ]
        );
      }
    } catch (err: any) {
      setError(err.message || t('transferTicket.failed'));
    } finally {
      setLoading(false);
    }
  };

  // No clipboard module ships in the binary yet, so this used to claim "copied"
  // while copying nothing. The share sheet with just the link has a real Copy.
  const handleCopyLink = async () => {
    try {
      await Share.share({ message: transferLink });
    } catch (error) {
      console.error('Error sharing transfer link:', error);
    }
  };

  const handleShare = async () => {
    try {
      await Share.share({
        message: t('transferTicket.shareMessage').replace('{event}', eventTitle).replace('{link}', transferLink),
        title: eventTitle,
      });
    } catch (error) {
      console.error('Error sharing:', error);
    }
  };

  const canTransfer = transferCount < 3;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.modalContainer}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.sheetTitle}>{(showLink ? t('transferTicket.sentTitle') : t('transferTicket.title')).toLowerCase()}</Text>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeButton}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
            >
              <X size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {!showLink ? (
              <>
                {/* One quiet line with what matters, no emoji info box. */}
                <Text style={[styles.note, !canTransfer && { color: T.red }]}>
                  {!canTransfer
                    ? t('transferTicket.maxReached')
                    : transferCount > 0
                      ? t('transferTicket.noteCount').replace('{count}', String(transferCount))
                      : t('transferTicket.note')}
                </Text>

                <Text style={styles.label}>{t('transferTicket.email')}</Text>
                <TextInput
                  style={[styles.input, !!emailError && styles.inputError]}
                  placeholder="friend@example.com"
                  placeholderTextColor={colors.textTertiary}
                  selectionColor={colors.primary}
                  value={toEmail}
                  onChangeText={(text) => {
                    setToEmail(text);
                    validateEmail(text);
                  }}
                  onBlur={() => validateEmail(toEmail)}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  editable={canTransfer}
                />
                {!!emailError && <Text style={styles.inputErrorText}>{emailError}</Text>}

                <Text style={styles.label}>{t('transferTicket.message')}</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder={t('transferTicket.messagePlaceholder')}
                  placeholderTextColor={colors.textTertiary}
                  selectionColor={colors.primary}
                  value={message}
                  onChangeText={setMessage}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                  editable={canTransfer}
                />

                {!!error && <Text style={styles.inputErrorText}>{error}</Text>}

                <WhitePillCTA
                  label={t('transferTicket.send')}
                  onPress={handleTransfer}
                  loading={loading}
                  disabled={!canTransfer || loading}
                  style={styles.primaryAction}
                />
              </>
            ) : (
              <>
                <Text style={styles.note}>{t('transferTicket.sentBody').replace('{email}', toEmail)}</Text>

                <TouchableOpacity style={styles.linkRow} onPress={handleCopyLink} accessibilityRole="button">
                  <Text style={styles.linkText} numberOfLines={1}>
                    {transferLink}
                  </Text>
                  <Share2 size={18} color={colors.text} />
                </TouchableOpacity>

                <WhitePillCTA label={t('transferTicket.shareLink')} onPress={handleShare} style={styles.primaryAction} />

                <TouchableOpacity
                  style={styles.doneLink}
                  onPress={() => {
                    onClose();
                    setToEmail('');
                    setMessage('');
                    setShowLink(false);
                    setTransferLink('');
                    if (onTransferSuccess) onTransferSuccess();
                  }}
                  accessibilityRole="button"
                >
                  <Text style={styles.doneLinkText}>{t('common.done')}</Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingTop: 12,
    maxHeight: '90%',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  closeButton: {
    padding: 4,
  },
  content: {
    padding: 20,
  },
  infoBox: {
    backgroundColor: 'rgba(20,184,166,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(20,184,166,0.35)',
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 16,
  },
  infoText: {
    fontSize: 13,
    color: colors.text,
    lineHeight: 18,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(252, 211, 77, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(252, 211, 77, 0.4)',
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 16,
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    color: '#FCD34D',
    lineHeight: 18,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: 14,
    marginBottom: 8,
  },
  input: {
    backgroundColor: T.surface,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: colors.text,
  },
  inputError: {
    borderWidth: 1,
    borderColor: T.red,
  },
  inputErrorText: {
    fontSize: 12,
    color: '#F87171',
    marginTop: 6,
  },
  textArea: {
    height: 80,
    paddingTop: 12,
  },
  errorBox: {
    backgroundColor: 'rgba(248, 113, 113, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.4)',
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 13,
    color: '#F87171',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: radius.md,
  },
  cancelButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  transferButton: {
    backgroundColor: colors.primary,
  },
  transferButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFF',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  successBox: {
    alignItems: 'center',
    padding: 24,
    marginBottom: 16,
  },
  successIcon: {
    fontSize: 48,
    marginBottom: 8,
  },
  successTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 8,
  },
  successText: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  linkBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
    marginBottom: 16,
    gap: 12,
  },
  linkText: {
    flex: 1,
    fontSize: 13,
    color: colors.textSecondary,
  },
  copyButton: {
    padding: 8,
  },
  shareButton: {
    backgroundColor: '#10B981',
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: 'center',
    marginBottom: 12,
  },
  shareButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFF',
  },
  doneButton: {
    backgroundColor: colors.primary,
  },
  doneButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFF',
  },
  // POSH pass (owner: "this is not polished"): serif title, one quiet line,
  // filled fields, one white action.
  sheetTitle: { fontFamily: font.serif, fontSize: 28, lineHeight: 32, color: colors.text },
  note: { fontSize: 14, lineHeight: 20, color: colors.textSecondary, marginBottom: 18 },
  primaryAction: { marginTop: 22 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: radius.button,
    backgroundColor: T.surface,
  },
  doneLink: { alignSelf: 'center', paddingVertical: 16 },
  doneLinkText: { fontSize: 15, fontWeight: '600', color: colors.textSecondary },
});
