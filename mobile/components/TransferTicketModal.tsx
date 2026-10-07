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
import { X, Send, Copy, AlertCircle } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { backendJson } from '../lib/api/backend';
import { useAppAlert } from './AppAlert';
import { radius } from '../theme/tokens';

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
      setEmailError('Please enter a valid email address');
      return false;
    }
    setEmailError('');
    return true;
  };

  const handleTransfer = async () => {
    if (!toEmail.trim()) {
      setError('Please enter recipient email');
      return;
    }

    if (!validateEmail(toEmail)) {
      setError('Please enter a valid email address');
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
      setError(err.message || 'Failed to transfer ticket');
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
        message: `I'm transferring my ticket for ${eventTitle} to you! Click here to accept: ${transferLink}\n\n⏰ This link expires in 24 hours.`,
        title: `Ticket Transfer: ${eventTitle}`,
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
            <Text style={styles.title}>Transfer Ticket</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <X size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
            {!showLink ? (
              <>
                {/* Warning Box */}
                {transferCount > 0 && (
                  <View style={styles.warningBox}>
                    <AlertCircle size={16} color="#F59E0B" />
                    <Text style={styles.warningText}>
                      This ticket has been transferred {transferCount} time(s). Maximum: 3 transfers
                    </Text>
                  </View>
                )}

                {!canTransfer && (
                  <View style={[styles.warningBox, { backgroundColor: 'rgba(248, 113, 113, 0.12)', borderColor: 'rgba(248, 113, 113, 0.4)' }]}>
                    <AlertCircle size={16} color="#F87171" />
                    <Text style={[styles.warningText, { color: '#F87171' }]}>
                      This ticket has reached the maximum transfer limit
                    </Text>
                  </View>
                )}

                <Text style={styles.description}>
                  Transfer your ticket for <Text style={styles.bold}>{eventTitle}</Text> to another person.
                </Text>

                <View style={styles.infoBox}>
                  <Text style={styles.infoText}>
                    ⏰ Transfer links expire in 24 hours{'\n'}
                    🔒 Once transferred, you will lose access to this ticket
                  </Text>
                </View>

                {/* Email Input */}
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Recipient Email *</Text>
                  <TextInput
                    style={[
                      styles.input,
                      emailError && styles.inputError
                    ]}
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
                  {emailError && (
                    <Text style={styles.inputErrorText}>{emailError}</Text>
                  )}
                </View>

                {/* Message Input */}
                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Message (Optional)</Text>
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    placeholder="Add a personal message..."
                    placeholderTextColor={colors.textTertiary}
                    selectionColor={colors.primary}
                    value={message}
                    onChangeText={setMessage}
                    multiline
                    numberOfLines={3}
                    textAlignVertical="top"
                    editable={canTransfer}
                  />
                </View>

                {/* Error Message */}
                {error && (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                )}

                {/* Action Buttons */}
                <View style={styles.actions}>
                  <TouchableOpacity
                    style={[styles.button, styles.cancelButton]}
                    onPress={onClose}
                    disabled={loading}
                  >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.button,
                      styles.transferButton,
                      (!canTransfer || loading) && styles.buttonDisabled,
                    ]}
                    onPress={handleTransfer}
                    disabled={!canTransfer || loading}
                  >
                    {loading ? (
                      <ActivityIndicator color="#FFF" />
                    ) : (
                      <>
                        <Send size={18} color="#FFF" />
                        <Text style={styles.transferButtonText}>Send Transfer</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                {/* Transfer Success - Show Link */}
                <View style={styles.successBox}>
                  <Text style={styles.successIcon}>✅</Text>
                  <Text style={styles.successTitle}>Transfer Initiated!</Text>
                  <Text style={styles.successText}>
                    Email sent to {toEmail}. You can also share this link:
                  </Text>
                </View>

                <View style={styles.linkBox}>
                  <Text style={styles.linkText} numberOfLines={2}>
                    {transferLink}
                  </Text>
                  <TouchableOpacity onPress={handleCopyLink} style={styles.copyButton} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Copy size={20} color={colors.primary} />
                  </TouchableOpacity>
                </View>

                <View style={styles.infoBox}>
                  <Text style={styles.infoText}>
                    ⏰ This link expires in 24 hours
                  </Text>
                </View>

                <TouchableOpacity style={styles.shareButton} onPress={handleShare}>
                  <Text style={styles.shareButtonText}>Share via WhatsApp / SMS</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.button, styles.doneButton]}
                  onPress={() => {
                    onClose();
                    setToEmail('');
                    setMessage('');
                    setShowLink(false);
                    setTransferLink('');
                    
                    // Notify parent to refresh
                    if (onTransferSuccess) {
                      onTransferSuccess();
                    }
                  }}
                >
                  <Text style={styles.doneButtonText}>Done</Text>
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
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
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
  description: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 16,
    lineHeight: 20,
  },
  bold: {
    fontWeight: '600',
    color: colors.text,
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
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
  },
  inputError: {
    borderColor: '#F87171',
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
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  transferButton: {
    backgroundColor: colors.primary,
  },
  transferButtonText: {
    fontSize: 16,
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
    fontSize: 14,
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
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
  },
  doneButton: {
    backgroundColor: colors.primary,
  },
  doneButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
  },
});
