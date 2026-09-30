import React, { useState, useCallback } from 'react';
import { useBlockedOrganizers } from '../lib/blockedOrganizers';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Bell, Check, CheckCheck, ExternalLink } from 'lucide-react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../contexts/ThemeContext';
import { radius } from '../theme/tokens';
import { useAuth } from '../contexts/AuthContext';
import { useAppMode } from '../contexts/AppModeContext';
import { useI18n } from '../contexts/I18nContext';
import {
  getUserNotifications,
  markAsRead,
  markAllAsRead,
  getUnreadCount,
  clearAllNotifications,
  deleteNotification,
} from '../lib/notifications';
import { addStaffEventId } from '../lib/staffAssignments';
import { backendJson } from '../lib/api/backend';
import EmptyState from '../components/EmptyState';
import { NotificationsSkeleton } from '../components/Skeleton';
import { useAppAlert } from '../components/AppAlert';
import type { Notification } from '../types/notifications';

export default function NotificationsScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const navigation = useNavigation();
  const { user } = useAuth();
  const { setMode } = useAppMode();
  const { t, language } = useI18n();
  const locale = language === 'fr' ? 'fr-FR' : language === 'ht' ? 'fr-HT' : 'en-US';
  const showAlert = useAppAlert();
  const [allNotifications, setNotifications] = useState<Notification[]>([]);
  // Notifications about a blocked organizer (e.g. "new event from …") are
  // hidden, not deleted — unblocking brings them back (App Store 1.2).
  const blockedOrganizers = useBlockedOrganizers();
  const notifications = allNotifications.filter((n: any) => {
    const organizerId = n?.metadata?.organizerId || n?.organizerId;
    return !(organizerId && blockedOrganizers.has(String(organizerId)));
  });
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const getTransferToken = (notification: Notification): string | null => {
    const metadata: any = (notification as any)?.metadata || {};
    const direct = typeof metadata?.transferToken === 'string' ? metadata.transferToken : '';
    if (direct) return direct;

    const actionUrl = String((notification as any)?.actionUrl || '');
    if (!actionUrl) return null;

    try {
      const full = actionUrl.startsWith('http')
        ? actionUrl
        : `https://tikem.co${actionUrl.startsWith('/') ? '' : '/'}${actionUrl}`;
      const url = new URL(full);
      const parts = url.pathname.split('/').filter(Boolean);
      const idx = parts.findIndex((p) => p === 'transfer');
      if (idx !== -1 && parts[idx + 1]) return parts[idx + 1];
    } catch {
      // ignore
    }

    return null;
  };

  const getInviteDetails = (notification: Notification): { eventId: string; token: string } | null => {
    const metadata: any = (notification as any)?.metadata || {};
    const eventId = String(metadata?.eventId || notification.eventId || '');
    const token = String(metadata?.token || metadata?.inviteToken || '');
    if (eventId && token) return { eventId, token };

    const metadataUrl = String(metadata?.url || '');
    if (metadataUrl) {
      try {
        const url = new URL(metadataUrl);
        const parsedEventId = url.searchParams.get('eventId') || '';
        const parsedToken = url.searchParams.get('token') || '';
        if (parsedEventId && parsedToken) return { eventId: parsedEventId, token: parsedToken };
      } catch {
        // ignore
      }
    }

    const actionUrl = String((notification as any)?.actionUrl || '');
    if (actionUrl) {
      try {
        const full = actionUrl.startsWith('http')
          ? actionUrl
          : `https://tikem.co${actionUrl.startsWith('/') ? '' : '/'}${actionUrl}`;
        const url = new URL(full);
        const parsedEventId = url.searchParams.get('eventId') || '';
        const parsedToken = url.searchParams.get('token') || '';
        if (parsedEventId && parsedToken) {
          return { eventId: parsedEventId, token: parsedToken };
        }
      } catch {
        // ignore
      }
    }

    return null;
  };

  const acceptStaffInvite = async (notification: Notification) => {
    const details = getInviteDetails(notification);
    if (!details) {
      showAlert(t('notifications.missingInviteTitle'), t('notifications.missingInviteBody'));
      return;
    }

    try {
      await backendJson('/api/staff/invites/redeem', {
        method: 'POST',
        body: JSON.stringify(details),
      });

      // Persist so Staff tabs can show it immediately.
      addStaffEventId(details.eventId).catch(() => {});

      // Auto-clear the invite notification once redeemed.
      if (user?.uid) {
        try {
          await deleteNotification(user.uid, notification.id);
        } catch {
          // Fallback: at least mark it read if delete fails.
          if (!notification.isRead) {
            await handleMarkAsRead(notification.id);
          }
        }

        setNotifications((prev) => prev.filter((n) => n.id !== notification.id));
        if (!notification.isRead) {
          setUnreadCount((prev) => Math.max(0, prev - 1));
        }
      }

      await setMode('staff');
      // @ts-ignore
      navigation.navigate('Main');
      // @ts-ignore
      navigation.navigate('TicketScanner', { eventId: details.eventId });
    } catch (error: any) {
      const msg = error?.message ? String(error.message) : t('notifications.acceptInviteFailedBody');
      showAlert(t('notifications.acceptInviteFailedTitle'), msg);
    }
  };

  const declineStaffInvite = async (notification: Notification) => {
    const details = getInviteDetails(notification);
    if (!details) {
      showAlert(t('notifications.missingInviteTitle'), t('notifications.missingInviteBody'));
      return;
    }

    try {
      await backendJson('/api/staff/invites/decline', {
        method: 'POST',
        body: JSON.stringify(details),
      });

      if (user?.uid && !notification.isRead) {
        await handleMarkAsRead(notification.id);
      }

      setNotifications((prev) => prev.filter((n) => n.id !== notification.id));
    } catch (error: any) {
      const msg = error?.message ? String(error.message) : t('notifications.declineInviteFailedBody');
      showAlert(t('notifications.declineInviteFailedTitle'), msg);
    }
  };

  const acceptTicketTransfer = async (notification: Notification) => {
    const transferToken = getTransferToken(notification);
    if (!transferToken) {
      showAlert(t('notifications.missingTransferTitle'), t('notifications.missingTransferBody'));
      return;
    }

    try {
      const res = await backendJson<{ ticketId?: string }>('/api/tickets/transfer/respond', {
        method: 'POST',
        body: JSON.stringify({ transferToken, action: 'accept' }),
      });

      if (user?.uid && !notification.isRead) {
        await handleMarkAsRead(notification.id);
      }

      // Refresh list so the user sees updated notifications.
      loadNotifications(false);

      if (res?.ticketId) {
        // @ts-ignore
        navigation.navigate('TicketDetail', { ticketId: res.ticketId });
      }
    } catch (error: any) {
      const msg = error?.message ? String(error.message) : t('notifications.acceptTransferFailedBody');
      showAlert(t('notifications.acceptTransferFailedTitle'), msg);
    }
  };

  const declineTicketTransfer = async (notification: Notification) => {
    const transferToken = getTransferToken(notification);
    if (!transferToken) {
      showAlert(t('notifications.missingTransferTitle'), t('notifications.missingTransferBody'));
      return;
    }

    try {
      await backendJson('/api/tickets/transfer/respond', {
        method: 'POST',
        body: JSON.stringify({ transferToken, action: 'reject' }),
      });

      if (user?.uid && !notification.isRead) {
        await handleMarkAsRead(notification.id);
      }

      setNotifications((prev) => prev.filter((n) => n.id !== notification.id));
    } catch (error: any) {
      const msg = error?.message ? String(error.message) : t('notifications.declineTransferFailedBody');
      showAlert(t('notifications.declineTransferFailedTitle'), msg);
    }
  };

  const loadNotifications = async (showLoader = true) => {
    if (!user?.uid) return;
    
    if (showLoader) setIsLoading(true);
    try {
      const [notificationsData, unreadCountData] = await Promise.all([
        getUserNotifications(user.uid, 50),
        getUnreadCount(user.uid),
      ]);
      setNotifications(notificationsData);
      setUnreadCount(unreadCountData);
    } catch (error) {
      console.error('Error loading notifications:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadNotifications();
    }, [user?.uid])
  );

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadNotifications(false);
  };

  const handleMarkAsRead = async (notificationId: string) => {
    if (!user?.uid) return;
    
    try {
      await markAsRead(user.uid, notificationId);

      setNotifications((prev) =>
        prev.map((n) =>
          n.id === notificationId
            ? { ...n, isRead: true, readAt: new Date().toISOString() }
            : n
        )
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  const handleMarkAllAsRead = async () => {
    if (!user?.uid) return;
    
    try {
      await markAllAsRead(user.uid);

      setNotifications((prev) =>
        prev.map((n) => ({ ...n, isRead: true, readAt: new Date().toISOString() }))
      );
      setUnreadCount(0);
    } catch (error) {
      console.error('Error marking all as read:', error);
    }
  };

  const handleClearAll = async () => {
    const uid = user?.uid;
    if (!uid) return;

    showAlert(
      t('notifications.clearAllTitle'),
      t('notifications.clearAllBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('notifications.clearAllConfirm'),
          style: 'destructive',
          onPress: async () => {
            setIsClearing(true);
            try {
              await clearAllNotifications(uid);

              setNotifications([]);
              setUnreadCount(0);
            } catch (error) {
              console.error('Error clearing notifications:', error);
              showAlert(t('common.error'), t('notifications.clearAllErrorBody'));
            } finally {
              setIsClearing(false);
            }
          },
        },
      ]
    );
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'ticket_purchased':
        return '🎫';
      case 'event_updated':
        return '📢';
      case 'event_reminder_24h':
      case 'event_reminder_3h':
      case 'event_reminder_30min':
        return '⏰';
      case 'event_cancelled':
        return '❌';
      case 'staff_invite':
        return '👥';
      case 'organizer_message':
      case 'organizer_reply':
        return '💬';
      default:
        return '🔔';
    }
  };

  const getNotificationLink = (notification: Notification): { screen: string; params?: any } | null => {
    if (notification.type === 'staff_invite') {
      const details = getInviteDetails(notification);
      if (details) {
        return { screen: 'InviteRedeem', params: details };
      }
    }
    // A new attendee question belongs in the organizer's inbox, not on the
    // public event page — the answer is what the notification is asking for.
    if (notification.type === 'organizer_message') {
      const eventId = notification.eventId || (notification.metadata as any)?.eventId;
      return { screen: 'OrganizerMessages', params: eventId ? { eventId } : undefined };
    }
    if (notification.ticketId) {
      return { screen: 'TicketDetail', params: { ticketId: notification.ticketId } };
    }
    if (notification.eventId) {
      return { screen: 'EventDetail', params: { eventId: notification.eventId } };
    }
    return null;
  };

  const handleNotificationClick = async (notification: Notification) => {
    if (!notification.isRead) {
      await handleMarkAsRead(notification.id);
    }

    const link = getNotificationLink(notification);
    if (link) {
      // @ts-ignore
      navigation.navigate(link.screen, link.params);
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <NotificationsSkeleton />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header actions: Mark all read (left) + Clear all (right) */}
      {notifications.length > 0 && (
        <View style={styles.header}>
          {unreadCount > 0 ? (
            <TouchableOpacity
              onPress={handleMarkAllAsRead}
              style={styles.markAllButton}
              activeOpacity={0.7}
              hitSlop={8}
            >
              <CheckCheck size={16} color={colors.primary} />
              <Text style={styles.markAllText}>
                {t('notifications.markAllRead')} ({unreadCount})
              </Text>
            </TouchableOpacity>
          ) : (
            <View />
          )}
          <TouchableOpacity
            onPress={handleClearAll}
            disabled={isClearing}
            style={styles.clearAllButton}
            activeOpacity={0.7}
            hitSlop={8}
          >
            {isClearing ? (
              <ActivityIndicator size="small" color={colors.error} />
            ) : (
              <Text style={styles.clearAllText}>{t('notifications.clearAllButton')}</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Notifications List - minimal top spacing */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
        }
      >
        {notifications.length === 0 ? (
          <View style={styles.emptyContainer}>
            <EmptyState
              icon={Bell}
              title={t('notifications.emptyTitle')}
              subtitle={t('notifications.emptyBody')}
            />
          </View>
        ) : (
          <View style={styles.notificationsList}>
            {notifications.map((notification) => (
              <TouchableOpacity
                key={notification.id}
                onPress={() => handleNotificationClick(notification)}
                style={[
                  styles.notificationCard,
                  !notification.isRead && styles.notificationCardUnread,
                ]}
                activeOpacity={0.7}
              >
                {/* Icon */}
                <View style={styles.iconContainer}>
                  <Text style={styles.notificationIcon}>
                    {getNotificationIcon(notification.type)}
                  </Text>
                </View>

                {/* Content */}
                <View style={styles.notificationContent}>
                  <View style={styles.notificationHeader}>
                    <Text
                      style={[
                        styles.notificationTitle,
                        !notification.isRead && styles.notificationTitleUnread,
                      ]}
                      numberOfLines={2}
                    >
                      {notification.title}
                    </Text>
                    {!notification.isRead && <View style={styles.unreadDot} />}
                  </View>

                  {/* An organizer's reply is the whole point of its
                      notification — the attendee asked a question and this is
                      the answer, so it is shown in full instead of clipped to
                      three lines with nowhere to go and read the rest. */}
                  {notification.type === 'organizer_reply' ? (
                    <Text style={styles.notificationMessage}>
                      {(notification.metadata as any)?.replyBody || notification.message}
                    </Text>
                  ) : (
                    <Text style={styles.notificationMessage} numberOfLines={3}>
                      {notification.message}
                    </Text>
                  )}

                  {notification.type === 'staff_invite' && (
                    <View style={styles.staffInviteActions}>
                      <TouchableOpacity
                        onPress={(e) => {
                          e.stopPropagation();
                          acceptStaffInvite(notification);
                        }}
                        style={styles.staffInviteAcceptButton}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.staffInviteAcceptText}>{t('common.accept')}</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={(e) => {
                          e.stopPropagation();
                          declineStaffInvite(notification);
                        }}
                        style={styles.staffInviteDeclineButton}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.staffInviteDeclineText}>{t('common.decline')}</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {notification.type === 'ticket_transfer' && getTransferToken(notification) && (
                    <View style={styles.staffInviteActions}>
                      <TouchableOpacity
                        onPress={(e) => {
                          e.stopPropagation();
                          acceptTicketTransfer(notification);
                        }}
                        style={styles.staffInviteAcceptButton}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.staffInviteAcceptText}>{t('common.accept')}</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={(e) => {
                          e.stopPropagation();
                          declineTicketTransfer(notification);
                        }}
                        style={styles.staffInviteDeclineButton}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.staffInviteDeclineText}>{t('common.decline')}</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  <View style={styles.notificationFooter}>
                    <Text style={styles.notificationTime}>
                      {new Date(notification.createdAt).toLocaleDateString(locale, {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </Text>
                    {getNotificationLink(notification) && (
                      <View style={styles.viewDetailsContainer}>
                        <Text style={styles.viewDetailsText}>{t('notifications.viewDetails')}</Text>
                        <ExternalLink size={12} color={colors.primary} />
                      </View>
                    )}
                  </View>
                </View>

                {/* Mark as read button */}
                {!notification.isRead && (
                  <TouchableOpacity
                    onPress={(e) => {
                      e.stopPropagation();
                      handleMarkAsRead(notification.id);
                    }}
                    style={styles.markReadButton}
                    activeOpacity={0.7}
                    hitSlop={8}
                  >
                    <Check size={20} color={colors.textSecondary} />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between', // Mark all read (left) + Clear all (right)
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12, // Reduced from 16 for minimal spacing
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  markAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: 'transparent',
  },
  markAllText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
  clearAllButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: 'transparent',
  },
  clearAllText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.error,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 64,
  },
  notificationsList: {
    paddingHorizontal: 16,
    paddingTop: 16, // 16px gap below header
    paddingBottom: 32,
    gap: 8,
  },
  // Elevation, not borders (POSH §1): a clean raised surface with soft shadow —
  // no colored strips or 1px box. Unread state is signalled only by the small
  // teal dot next to the title (a sparing accent).
  notificationCard: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.lg,
    padding: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 2,
  },
  notificationCardUnread: {
    shadowOpacity: 0.2,
    elevation: 3,
  },
  iconContainer: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  notificationIcon: {
    fontSize: 24,
  },
  notificationContent: {
    flex: 1,
    gap: 6,
  },
  notificationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  notificationTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  notificationTitleUnread: {
    color: colors.text,
  },
  notificationMessage: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  notificationFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  staffInviteActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
    marginBottom: 2,
  },
  staffInviteAcceptButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.chip,
    backgroundColor: colors.primary,
  },
  staffInviteAcceptText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '700',
  },
  staffInviteDeclineButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.chip,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  staffInviteDeclineText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  notificationTime: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  viewDetailsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  viewDetailsText: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '500',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginTop: 4,
  },
  markReadButton: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
