import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { auth } from '../../config/firebase';
import { useI18n } from '../../contexts/I18nContext';
import { useAuth } from '../../contexts/AuthContext';
import { colors, radius, spacing, type } from '../../theme/tokens';
import { PhoneCodeFlow } from './PhoneCodeFlow';
import { requestLinkCode, verifyLinkCode } from '../../lib/phoneAuth';

interface Props {
  visible: boolean;
  onClose: () => void;
  onLinked?: (phoneNumber: string) => void;
}

/**
 * Profile > "Add phone number" (behind the phone-auth flag). Verifies the
 * number with a WhatsApp code, then the server adds it to the signed-in
 * account, so next time the person can sign in with it.
 */
export default function PhoneLinkSheet({ visible, onClose, onLinked }: Props) {
  const { t, language } = useI18n();
  const { refreshUserProfile } = useAuth();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const close = () => {
    if (busy) return;
    setDone(false);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.avoid} pointerEvents="box-none">
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.header}>
            <Text style={styles.title}>{t('auth.phone.link.title')}</Text>
            <Pressable onPress={close} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('auth.phone.link.close')}>
              <X size={22} color={colors.textSecondary} />
            </Pressable>
          </View>
          {done ? (
            <Text style={styles.sub}>{t('auth.phone.link.success')}</Text>
          ) : (
            <>
              <Text style={styles.sub}>{t('auth.phone.link.subtitle')}</Text>
              <PhoneCodeFlow
                ctaLabel={t('auth.phone.link.cta')}
                onBusyChange={setBusy}
                onRequestCode={(phone, iso) => requestLinkCode(phone, iso, language)}
                onVerify={async (phone, iso, code) => {
                  const linked = await verifyLinkCode(phone, iso, code);
                  // Pick up the new phoneNumber on the Firebase user and the profile.
                  await auth.currentUser?.reload().catch(() => {});
                  await refreshUserProfile();
                  setDone(true);
                  onLinked?.(linked);
                }}
              />
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  avoid: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    ...type.title,
    color: colors.textPrimary,
  },
  sub: {
    ...type.body,
    color: colors.textSecondary,
  },
});
