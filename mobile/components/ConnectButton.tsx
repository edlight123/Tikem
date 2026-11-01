import React, { useState } from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import {
  sendConnectionRequest,
  respondToConnectionRequest,
  removeConnection,
} from '../lib/api/social';
import type { FriendshipState } from '../types/social';
import { useAppAlert } from './AppAlert';
import { useI18n } from '../contexts/I18nContext';
import { radius } from '../theme/tokens';

interface ConnectButtonProps {
  targetUserId: string;
  initialState: FriendshipState;
  size?: 'sm' | 'md';
  /**
   * 'primary' (default) renders the "Add friend" CTA as a solid white pill.
   * 'secondary' renders it as a muted outline pill — for surfaces where the
   * connect action should sit quietly next to a more important CTA.
   */
  variant?: 'primary' | 'secondary';
  onChange?: (state: FriendshipState) => void;
  onRequireAuth?: () => void;
}

export default function ConnectButton({
  targetUserId,
  initialState,
  size = 'md',
  variant = 'primary',
  onChange,
  onRequireAuth,
}: ConnectButtonProps) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const showAlert = useAppAlert();
  const styles = getStyles(colors, size);
  const secondary = variant === 'secondary';
  const { user } = useAuth();
  const [state, setState] = useState<FriendshipState>(initialState);
  const [loading, setLoading] = useState(false);

  if (state === 'self') return null;

  const update = (next: FriendshipState) => {
    setState(next);
    onChange?.(next);
  };

  const guarded = (fn: () => Promise<void>) => async () => {
    if (!user) {
      onRequireAuth?.();
      return;
    }
    setLoading(true);
    try {
      await fn();
    } catch (e: any) {
      showAlert(t('connectButton.errorTitle'), e?.message || t('connectButton.errorBody'));
    } finally {
      setLoading(false);
    }
  };

  const onSend = guarded(async () => update(await sendConnectionRequest(targetUserId)));
  const onAccept = guarded(async () => update(await respondToConnectionRequest(targetUserId, 'accept')));
  const onDecline = guarded(async () => update(await respondToConnectionRequest(targetUserId, 'decline')));
  const onRemove = guarded(async () => {
    await removeConnection(targetUserId);
    update('none');
  });

  if (loading) {
    return (
      <View style={[styles.btn, styles.neutral]}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    );
  }

  if (state === 'friends') {
    return (
      <TouchableOpacity style={[styles.btn, styles.neutral]} onPress={onRemove} activeOpacity={0.8} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
        <Ionicons name="checkmark" size={size === 'sm' ? 14 : 16} color={colors.text} />
        <Text style={[styles.text, { color: colors.text }]}>{t('connectButton.friends')}</Text>
      </TouchableOpacity>
    );
  }

  if (state === 'request_sent') {
    return (
      <TouchableOpacity style={[styles.btn, styles.neutral]} onPress={onRemove} activeOpacity={0.8} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
        <Ionicons name="time-outline" size={size === 'sm' ? 14 : 16} color={colors.textSecondary} />
        <Text style={[styles.text, { color: colors.textSecondary }]}>{t('connectButton.requested')}</Text>
      </TouchableOpacity>
    );
  }

  if (state === 'request_received') {
    return (
      <View style={styles.row}>
        <TouchableOpacity style={[styles.btn, styles.primary]} onPress={onAccept} activeOpacity={0.8}>
          <Ionicons name="checkmark" size={size === 'sm' ? 14 : 16} color="#000000" />
          <Text style={[styles.text, styles.primaryText]}>{t('connectButton.accept')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.neutral]} onPress={onDecline} activeOpacity={0.8}>
          <Text style={[styles.text, { color: colors.textSecondary }]}>{t('connectButton.decline')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // none
  return (
    <TouchableOpacity
      style={[styles.btn, secondary ? styles.neutral : styles.primary]}
      onPress={onSend}
      activeOpacity={0.8}
    >
      <Ionicons
        name="person-add-outline"
        size={size === 'sm' ? 14 : 16}
        color={secondary ? colors.text : '#000000'}
      />
      <Text style={[styles.text, secondary ? { color: colors.text } : styles.primaryText]}>{t('connectButton.addFriend')}</Text>
    </TouchableOpacity>
  );
}

const getStyles = (colors: any, size: 'sm' | 'md') =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      gap: 8,
    },
    btn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: size === 'sm' ? 7 : 10,
      paddingHorizontal: size === 'sm' ? 12 : 18,
      borderRadius: radius.md,
    },
    // POSH §2.2: the primary connect action is a solid white pill with black
    // text — teal is reserved for semantic marks, never the primary CTA.
    primary: {
      backgroundColor: colors.white,
    },
    primaryText: {
      color: '#000000',
    },
    neutral: {
      backgroundColor: colors.surfaceRaised,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    text: {
      fontSize: size === 'sm' ? 13 : 14,
      fontWeight: '700',
    },
  });
