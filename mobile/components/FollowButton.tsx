import React, { useState, useEffect } from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { backendFetch } from '../lib/api/backend';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useAppAlert } from './AppAlert';
import { radius } from '../theme/tokens';

interface FollowButtonProps {
  organizerId: string;
  style?: any;
  compact?: boolean;
  onFollowChange?: (isFollowing: boolean) => void;
}

export default function FollowButton({ organizerId, style, compact = false, onFollowChange }: FollowButtonProps) {
  const { colors } = useTheme();
  const showAlert = useAppAlert();
  const styles = getStyles(colors);
  const { user, userProfile } = useAuth();
  const { t } = useI18n();
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    checkFollowStatus();
  }, [user?.uid, organizerId]);

  const checkFollowStatus = async () => {
    if (!user?.uid || !organizerId) {
      setLoading(false);
      return;
    }

    // Don't show follow button for own profile
    if (user.uid === organizerId) {
      setLoading(false);
      return;
    }

    try {
      const followsQuery = query(
        collection(db, 'organizer_follows'),
        where('follower_id', '==', user.uid),
        where('organizer_id', '==', organizerId)
      );
      const snapshot = await getDocs(followsQuery);
      setIsFollowing(!snapshot.empty);
    } catch (error) {
      console.error('Error checking follow status:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleFollow = async () => {
    if (!user) {
      showAlert(
        t('auth.loginRequiredTitle') || 'Login Required',
        t('follow.loginBody') || 'Please log in to follow organizers'
      );
      return;
    }

    if (user.uid === organizerId) {
      return; // Can't follow yourself
    }

    setToggling(true);
    try {
      const response = await backendFetch('/api/organizers/follow', {
        method: 'POST',
        body: JSON.stringify({ organizerId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update follow status');
      }

      const newFollowingState = data.isFollowing;
      setIsFollowing(newFollowingState);
      onFollowChange?.(newFollowingState);

      // Show feedback
      showAlert(
        t('common.success'),
        newFollowingState
          ? (t('follow.followed') || 'You are now following this organizer')
          : (t('follow.unfollowed') || 'You have unfollowed this organizer')
      );
    } catch (error: any) {
      console.error('Error toggling follow:', error);
      showAlert(t('common.error'), error.message || 'Failed to update follow status');
    } finally {
      setToggling(false);
    }
  };

  // Don't show button for own profile
  if (user?.uid === organizerId) {
    return null;
  }

  if (loading) {
    return (
      <TouchableOpacity style={[styles.button, styles.loadingButton, style]} disabled>
        <ActivityIndicator size="small" color={colors.primary} />
      </TouchableOpacity>
    );
  }

  if (compact) {
    return (
      <TouchableOpacity
        style={[
          styles.compactButton,
          isFollowing && styles.compactButtonFollowing,
          style,
        ]}
        onPress={handleToggleFollow}
        disabled={toggling}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        {toggling ? (
          <ActivityIndicator size="small" color={isFollowing ? colors.text : '#000000'} />
        ) : (
          <Ionicons
            name={isFollowing ? 'checkmark' : 'add'}
            size={18}
            color={isFollowing ? colors.text : '#000000'}
          />
        )}
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      style={[
        styles.button,
        isFollowing ? styles.buttonFollowing : styles.buttonNotFollowing,
        style,
      ]}
      onPress={handleToggleFollow}
      disabled={toggling}
    >
      {toggling ? (
        <ActivityIndicator size="small" color={isFollowing ? colors.text : '#000000'} />
      ) : (
        <>
          <Ionicons
            name={isFollowing ? 'checkmark' : 'person-add'}
            size={16}
            color={isFollowing ? colors.text : '#000000'}
          />
          <Text style={[styles.buttonText, isFollowing && styles.buttonTextFollowing]}>
            {isFollowing ? (t('follow.following') || 'Following') : (t('follow.follow') || 'Follow')}
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
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    gap: 6,
  },
  loadingButton: {
    backgroundColor: colors.surfaceRaised,
    minWidth: 100,
  },
  // POSH §2.2: primary follow = solid white (black label). "Following" is a
  // quiet dark-grey fill, no outline (fill, not a hairline). Teal never
  // carries the follow CTA.
  buttonNotFollowing: {
    backgroundColor: colors.white,
  },
  buttonFollowing: {
    backgroundColor: colors.surfaceRaised,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#000000',
  },
  buttonTextFollowing: {
    color: colors.text,
  },
  compactButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactButtonFollowing: {
    backgroundColor: colors.surfaceRaised,
  },
});
