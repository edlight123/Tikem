import React, { useEffect, useState } from 'react';
import {
  View,
  KeyboardAvoidingView,
  Platform,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
  Share,
  Animated,
} from 'react-native';
import { useSwipeToClose } from '../hooks/useSwipeToClose';
import { X, Share2, Check } from 'lucide-react-native';
import { useTheme } from '../contexts/ThemeContext';
import { backendFetch } from '../lib/api/backend';
import { fetchConnections } from '../lib/api/social';
import type { PublicUserSummary } from '../types/social';
import PersonAvatar from './PersonAvatar';
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
  const styles = getStyles(colors);
  const [toEmail, setToEmail] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [transferLink, setTransferLink] = useState('');
  const [showLink, setShowLink] = useState(false);
  const [emailError, setEmailError] = useState('');
  // Friends already on Tikèm: one tap sends to them, no email to type
  // (owner, 2026-11-17: "if you're already friends w someone in the app it
  // should be smart"). Their email stays server-side.
  const [friends, setFriends] = useState<PublicUserSummary[]>([]);
  const [friend, setFriend] = useState<PublicUserSummary | null>(null);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    fetchConnections()
      .then((o) => {
        if (!alive) return;
        // Faces first: a row of photos reads better than a row of silhouettes.
        const list = [...o.friends].sort(
          (a, b) => Number(!!b.photoURL) - Number(!!a.photoURL) || a.displayName.localeCompare(b.displayName)
        );
        setFriends(list);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [visible]);

  const firstName = (p: PublicUserSummary) => (p.displayName || '').trim().split(/\s+/)[0] || p.displayName;

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
    if (!friend) {
      if (!toEmail.trim()) {
        setError(t('transferTicket.emailRequired'));
        return;
      }
      if (!validateEmail(toEmail)) {
        setError(t('transferTicket.invalidEmail'));
        return;
      }
    }

    setError('');
    setLoading(true);

    try {
      // Authenticated helper so the Firebase token + session cookie are
      // attached (a plain fetch is unauthenticated and 401s).
      const res = await backendFetch('/api/tickets/transfer/request', {
        method: 'POST',
        body: JSON.stringify({
          ticketId,
          ...(friend ? { toUserId: friend.uid } : { toEmail: toEmail.trim() }),
          message: message.trim(),
        }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data?.code === 'friend_no_email' && friend) {
          setError(t('transferTicket.friendNoEmail').replace('{name}', firstName(friend)));
        } else {
          setError(data?.error || t('transferTicket.failed'));
        }
        return;
      }

      if (data.transfer?.transferToken) {
        setTransferLink(`https://www.tikem.co/tickets/transfer/${data.transfer.transferToken}`);
      }
      setShowLink(true);
    } catch (err: any) {
      setError(err?.message || t('transferTicket.failed'));
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setToEmail('');
    setMessage('');
    setFriend(null);
    setError('');
    setEmailError('');
    setShowLink(false);
    setTransferLink('');
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

  // Closing after a send refreshes the parent (which may also close us);
  // before a send it just dismisses.
  const close = () => {
    const sent = showLink;
    reset();
    onClose();
    if (sent) onTransferSuccess?.();
  };
  const swipe = useSwipeToClose(close, visible);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      {/* The sheet rides above the keyboard: the email field used to sit
          under it (owner, 2026-11-17: "fix this"). */}
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={close} accessible={false} />
        <Animated.View style={[styles.modalContainer, swipe.sheetStyle]}>
          <View {...swipe.panHandlers}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.sheetTitle}>{(showLink ? t('transferTicket.sentTitle') : t('transferTicket.title')).toLowerCase()}</Text>
            <TouchableOpacity
              onPress={close}
              style={styles.closeButton}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
            >
              <X size={18} color={colors.text} />
            </TouchableOpacity>
          </View>
          </View>

          <ScrollView
            style={styles.content}
            contentContainerStyle={styles.contentInner}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {!showLink ? (
              <>
                <Text style={[styles.note, !canTransfer && { color: T.red }]}>
                  {!canTransfer
                    ? t('transferTicket.maxReached')
                    : transferCount > 0
                      ? t('transferTicket.noteCount').replace('{count}', String(transferCount))
                      : t('transferTicket.note')}
                </Text>

                {friends.length > 0 && canTransfer && (
                  <>
                    <Text style={styles.kicker}>{t('transferTicket.friends')}</Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.friendRow}
                      keyboardShouldPersistTaps="handled"
                    >
                      {friends.map((f) => {
                        const on = friend?.uid === f.uid;
                        return (
                          <TouchableOpacity
                            key={f.uid}
                            style={styles.friend}
                            onPress={() => {
                              setFriend(on ? null : f);
                              setError('');
                              setEmailError('');
                            }}
                            activeOpacity={0.8}
                            accessibilityRole="button"
                            accessibilityState={{ selected: on }}
                            accessibilityLabel={f.displayName}
                          >
                            <View style={[styles.friendAvatar, on && styles.friendAvatarOn]}>
                              <PersonAvatar user={f} size={56} />
                              {on && (
                                <View style={styles.friendCheck}>
                                  <Check size={12} color="#000" strokeWidth={3} />
                                </View>
                              )}
                            </View>
                            <Text style={[styles.friendName, on && styles.friendNameOn]} numberOfLines={1}>
                              {firstName(f)}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </>
                )}

                {!friend && (
                  <>
                    <Text style={styles.kicker}>
                      {friends.length > 0 && canTransfer ? t('transferTicket.orEmail') : t('transferTicket.email')}
                    </Text>
                    <TextInput
                      style={[styles.input, !!emailError && styles.inputError]}
                      placeholder="friend@example.com"
                      placeholderTextColor={colors.textTertiary}
                      selectionColor={colors.primary}
                      value={toEmail}
                      onChangeText={(text) => {
                        setToEmail(text);
                        if (emailError) validateEmail(text);
                      }}
                      onBlur={() => validateEmail(toEmail)}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      textContentType="emailAddress"
                      returnKeyType="next"
                      editable={canTransfer}
                    />
                    {!!emailError && <Text style={styles.inputErrorText}>{emailError}</Text>}
                  </>
                )}

                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder={t('transferTicket.messagePlaceholder')}
                  placeholderTextColor={colors.textTertiary}
                  selectionColor={colors.primary}
                  value={message}
                  onChangeText={setMessage}
                  multiline
                  maxLength={500}
                  textAlignVertical="top"
                  editable={canTransfer}
                  accessibilityLabel={t('transferTicket.message')}
                />

                {!!error && <Text style={styles.inputErrorText}>{error}</Text>}

                <WhitePillCTA
                  label={
                    friend
                      ? t('transferTicket.sendTo').replace('{name}', firstName(friend))
                      : t('transferTicket.send')
                  }
                  onPress={handleTransfer}
                  loading={loading}
                  disabled={!canTransfer || loading || (!friend && !toEmail.trim())}
                  style={styles.primaryAction}
                />
              </>
            ) : (
              <>
                {friend && (
                  <View style={styles.sentFriend}>
                    <PersonAvatar user={friend} size={64} />
                  </View>
                )}
                <Text style={styles.note}>
                  {friend
                    ? t('transferTicket.sentBodyFriend').replace('{name}', firstName(friend))
                    : t('transferTicket.sentBody').replace('{email}', toEmail)}
                </Text>

                {!!transferLink && (
                  <TouchableOpacity style={styles.linkRow} onPress={handleCopyLink} accessibilityRole="button">
                    <Text style={styles.linkText} numberOfLines={1}>
                      {transferLink}
                    </Text>
                    <Share2 size={18} color={colors.text} />
                  </TouchableOpacity>
                )}

                {!!transferLink && (
                  <WhitePillCTA label={t('transferTicket.shareLink')} onPress={handleShare} style={styles.primaryAction} />
                )}

                <TouchableOpacity style={styles.doneLink} onPress={close} accessibilityRole="button">
                  <Text style={styles.doneLinkText}>{t('common.done')}</Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
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
    paddingTop: 10,
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
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 4,
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
    paddingHorizontal: 20,
    paddingTop: 8,
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
  // The sheet is `surface`; fields one step up so they read as fields
  // (they were the sheet's own colour, i.e. invisible).
  input: {
    backgroundColor: colors.surfaceRaised,
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
    height: 76,
    paddingTop: 12,
    marginTop: 12,
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
  note: { fontSize: 14, lineHeight: 20, color: colors.textSecondary, marginBottom: 6 },
  contentInner: { paddingBottom: 28 },
  kicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: colors.textTertiary,
    marginTop: 18,
    marginBottom: 10,
  },
  friendRow: { gap: 14, paddingRight: 8 },
  friend: { width: 64, alignItems: 'center' },
  friendAvatar: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  friendAvatarOn: { borderColor: T.accent },
  friendCheck: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: T.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
  },
  friendName: { marginTop: 6, fontSize: 12, color: colors.textSecondary, maxWidth: 64 },
  friendNameOn: { color: colors.text, fontWeight: '600' },
  sentFriend: { alignItems: 'center', marginTop: 4, marginBottom: 14 },
  primaryAction: { marginTop: 20 },
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
