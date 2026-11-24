import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useBlockedOrganizers } from '../lib/blockedOrganizers';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Animated,
  PanResponder,
  Dimensions,
} from 'react-native';
import { ArrowLeft, Bell, CheckCheck } from 'lucide-react-native';
import OverlayHeader, { useOverlayHeaderInset } from '../components/OverlayHeader';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../contexts/ThemeContext';
import { colors as T, font, radius } from '../theme/tokens';
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
import { setInviteMute } from '../lib/api/invites';
import EmptyState from '../components/EmptyState';
import { artByKey } from '../lib/artLibrary';
import { NotificationsSkeleton } from '../components/Skeleton';
import { useAppAlert } from '../components/AppAlert';
import type { Notification } from '../types/notifications';
import { Touchable } from '../components/ui/Touchable';

export default function NotificationsScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const navigation = useNavigation();
  const { user } = useAuth();
  const { setMode } = useAppMode();
  const { t, language } = useI18n();
  const locale = language === 'fr' ? 'fr-FR' : language === 'ht' ? 'fr-HT' : 'en-US';
  const showAlert = useAppAlert();
  const { height: headerH, onHeight: onHeaderHeight } = useOverlayHeaderInset();
  // "4:40 PM" today, "Nov 12" otherwise: one short token beside the title.
  const shortTime = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const now = new Date();
    return d.toDateString() === now.toDateString()
      ? d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
      : d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  };
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
  // Swipe-to-delete with Undo: the row leaves the list at once, the delete is
  // committed after UNDO_MS unless Undo is tapped (TestFlight 2026-11-14).
  const [pendingDelete, setPendingDelete] = useState<Notification | null>(null);
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commitDelete = useCallback(
    (n: Notification) => {
      if (user?.uid) deleteNotification(user.uid, n.id).catch(() => {});
    },
    [user?.uid],
  );

  // Leaving the screen commits whatever is still waiting on Undo.
  useEffect(
    () => () => {
      if (deleteTimer.current) clearTimeout(deleteTimer.current);
    },
    [],
  );

  const handleSwipeDelete = (n: Notification) => {
    // A second swipe commits the first one right away.
    if (deleteTimer.current) clearTimeout(deleteTimer.current);
    if (pendingDelete) commitDelete(pendingDelete);
    setNotifications((prev) => prev.filter((x) => x.id !== n.id));
    if (!n.isRead) setUnreadCount((c) => Math.max(0, c - 1));
    setPendingDelete(n);
    deleteTimer.current = setTimeout(() => {
      commitDelete(n);
      setPendingDelete(null);
      deleteTimer.current = null;
    }, UNDO_MS);
  };

  const handleUndo = () => {
    if (!pendingDelete) return;
    if (deleteTimer.current) clearTimeout(deleteTimer.current);
    deleteTimer.current = null;
    const n = pendingDelete;
    setPendingDelete(null);
    setNotifications((prev) =>
      [...prev, n].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    );
    if (!n.isRead) setUnreadCount((c) => c + 1);
  };

  const getTransferToken = (notification: Notification): string | null => {
    const metadata: any = (notification as any)?.metadata || {};
    const direct = typeof metadata?.transferToken === 'string' ? metadata.transferToken : '';
    if (direct) return direct;

    const actionUrl = String((notification as any)?.actionUrl || '');
    if (!actionUrl) return null;

    try {
      const full = actionUrl.startsWith('http')
        ? actionUrl
        : `https://www.tikem.co${actionUrl.startsWith('/') ? '' : '/'}${actionUrl}`;
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
          : `https://www.tikem.co${actionUrl.startsWith('/') ? '' : '/'}${actionUrl}`;
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
      const thread = (notification.metadata as any)?.messageId;
      return {
        screen: 'OrganizerMessages',
        params: eventId ? { eventId, ...(thread ? { thread } : {}) } : undefined,
      };
    }
    // The organizer answered: open the conversation itself, where the
    // attendee can read the whole thread and write back.
    // The morning after an event (lib/postEvent on the server).
    if ((notification.type as string) === 'event_feedback') {
      const eventId = notification.eventId || (notification.metadata as any)?.eventId;
      if (eventId) return { screen: 'EventFeedback', params: { eventId } };
    }
    if ((notification.type as string) === 'organizer_recap') {
      const eventId = notification.eventId || (notification.metadata as any)?.eventId;
      if (eventId) return { screen: 'OrganizerEventRecap', params: { eventId } };
    }
    if (notification.type === 'organizer_reply') {
      const threadId = (notification.metadata as any)?.messageId;
      if (typeof threadId === 'string' && threadId) return { screen: 'MessageThread', params: { threadId } };
    }
    // "X joined Tikèm from your invite" opens their profile.
    if ((notification.type as string) === 'invite_joined') {
      const actorId = (notification.metadata as any)?.actorId;
      if (typeof actorId === 'string' && actorId) return { screen: 'OrganizerProfile', params: { organizerId: actorId, view: 'person' } };
    }
    // The national-day note opens the day's themed event list.
    if ((notification.type as string) === 'national_day') {
      const key = (notification.metadata as any)?.nationalDay;
      if (typeof key === 'string' && key) return { screen: 'CategoryEvents', params: { nationalDay: key } };
    }
    if (notification.ticketId) {
      return { screen: 'TicketDetail', params: { ticketId: notification.ticketId } };
    }
    if (notification.eventId) {
      return { screen: 'EventDetail', params: { eventId: notification.eventId } };
    }
    return null;
  };

  // "Mute invites from {name}" on a friend's event invite (lib/invites). The
  // inviter is never told; their picker just shows "can't invite".
  const muteInvitesFrom = (notification: Notification) => {
    const meta: any = notification.metadata || {};
    const inviterId = typeof meta.inviterId === 'string' ? meta.inviterId : '';
    const name = String(meta.inviterName || '');
    if (!inviterId) return;
    showAlert(t('invites.muteConfirmTitle'), t('invites.muteConfirmBody', { name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('invites.muteConfirm'),
        style: 'destructive',
        onPress: async () => {
          const ok = await setInviteMute(inviterId, true);
          if (ok) showAlert(t('invites.mutedTitle'), t('invites.mutedBody', { name }));
          else showAlert(t('invites.errorTitle'), t('common.error'));
        },
      },
    ]);
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

  const pageHeader = (
    <OverlayHeader onHeight={onHeaderHeight} style={styles.pageHeader}>
      {navigation.canGoBack() ? (
        <Touchable
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
        >
          <ArrowLeft size={24} color={colors.text} />
        </Touchable>
      ) : (
        <View style={styles.backButton} />
      )}
      <Text style={styles.pageTitle} numberOfLines={1}>
        {t('screens.notifications.title')}
      </Text>
      <View style={styles.backButton} />
    </OverlayHeader>
  );

  if (isLoading) {
    return (
      <View style={styles.container}>
        {pageHeader}
        <View style={{ paddingTop: headerH }}>
          <NotificationsSkeleton />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: headerH }]}>
      {pageHeader}
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
              <CheckCheck size={16} color={colors.text} />
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
              art={artByKey('photo-haiti-coast')}
              title={t('notifications.emptyTitle')}
            />
          </View>
        ) : (
          <View style={styles.notificationsList}>
            {notifications.map((notification) => (
              <SwipeRow key={notification.id} onDelete={() => handleSwipeDelete(notification)}>
              <Touchable
                onPress={() => handleNotificationClick(notification)}
                style={styles.row}
                scale={false}
                pressedColor={colors.surface}
                accessibilityRole="button"
              >
                {/* Unread: a small teal dot in the gutter; read rows keep the space. */}
                <View style={[styles.unreadDot, notification.isRead && styles.unreadDotHidden]} />

                <View style={styles.notificationContent}>
                  <View style={styles.notificationHeader}>
                    <Text
                      style={[styles.notificationTitle, !notification.isRead && styles.notificationTitleUnread]}
                      numberOfLines={1}
                    >
                      {notification.title}
                    </Text>
                    <Text style={styles.notificationTime}>{shortTime(notification.createdAt)}</Text>
                  </View>

                  {/* An organizer's reply is the whole point of its
                      notification, so it is shown in full. */}
                  {notification.type === 'organizer_reply' ? (
                    <Text style={styles.notificationMessage}>
                      {(notification.metadata as any)?.replyBody || notification.message}
                    </Text>
                  ) : (
                    <Text style={styles.notificationMessage} numberOfLines={2}>
                      {notification.message}
                    </Text>
                  )}

                  {notification.type === 'staff_invite' && (
                    <View style={styles.staffInviteActions}>
                      <Touchable
                        onPress={(e) => {
                          e.stopPropagation();
                          acceptStaffInvite(notification);
                        }}
                        style={styles.staffInviteAcceptButton}
                        accessibilityRole="button"
                      >
                        <Text style={styles.staffInviteAcceptText}>{t('common.accept')}</Text>
                      </Touchable>

                      <Touchable
                        onPress={(e) => {
                          e.stopPropagation();
                          declineStaffInvite(notification);
                        }}
                        style={styles.staffInviteDeclineButton}
                        accessibilityRole="button"
                      >
                        <Text style={styles.staffInviteDeclineText}>{t('common.decline')}</Text>
                      </Touchable>
                    </View>
                  )}

                  {(notification.type as string) === 'friend_invite' &&
                    typeof (notification.metadata as any)?.inviterId === 'string' && (
                      <TouchableOpacity
                        onPress={(e) => {
                          e.stopPropagation();
                          muteInvitesFrom(notification);
                        }}
                        style={styles.muteInvitesButton}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                      >
                        <Text style={styles.muteInvitesText}>
                          {t('invites.muteAction', { name: String((notification.metadata as any)?.inviterName || '') })}
                        </Text>
                      </TouchableOpacity>
                    )}

                  {notification.type === 'ticket_transfer' && getTransferToken(notification) && (
                    <View style={styles.staffInviteActions}>
                      <Touchable
                        onPress={(e) => {
                          e.stopPropagation();
                          acceptTicketTransfer(notification);
                        }}
                        style={styles.staffInviteAcceptButton}
                        accessibilityRole="button"
                      >
                        <Text style={styles.staffInviteAcceptText}>{t('common.accept')}</Text>
                      </Touchable>

                      <Touchable
                        onPress={(e) => {
                          e.stopPropagation();
                          declineTicketTransfer(notification);
                        }}
                        style={styles.staffInviteDeclineButton}
                        accessibilityRole="button"
                      >
                        <Text style={styles.staffInviteDeclineText}>{t('common.decline')}</Text>
                      </Touchable>
                    </View>
                  )}

                </View>
              </Touchable>
              </SwipeRow>
            ))}
          </View>
        )}
      </ScrollView>

      {pendingDelete ? (
        <View style={styles.undoBar} accessibilityLiveRegion="polite">
          <Text style={styles.undoText}>{t('notifications.deleted')}</Text>
          <TouchableOpacity onPress={handleUndo} hitSlop={10} accessibilityRole="button">
            <Text style={styles.undoAction}>{t('notifications.undo')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const UNDO_MS = 4000;
const SWIPE_THRESHOLD = 90;

/**
 * Swipe left or right past SWIPE_THRESHOLD to remove a row; a shorter drag
 * springs back. Built on PanResponder + Animated (core RN): the app has no
 * GestureHandlerRootView, so RNGH's Swipeable is not an option here. Only a
 * clearly horizontal drag is claimed, so vertical scrolling stays untouched.
 */
function SwipeRow({ children, onDelete }: { children: React.ReactNode; onDelete: () => void }) {
  const x = useRef(new Animated.Value(0)).current;
  const width = Dimensions.get('window').width;
  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: Animated.event([null, { dx: x }], { useNativeDriver: false }),
      onPanResponderRelease: (_e, g) => {
        if (Math.abs(g.dx) > SWIPE_THRESHOLD || Math.abs(g.vx) > 0.8) {
          Animated.timing(x, { toValue: g.dx > 0 ? width : -width, duration: 180, useNativeDriver: false }).start(
            () => onDelete(),
          );
        } else {
          Animated.spring(x, { toValue: 0, useNativeDriver: false, bounciness: 4 }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(x, { toValue: 0, useNativeDriver: false }).start();
      },
    }),
  ).current;
  const opacity = x.interpolate({ inputRange: [-width, 0, width], outputRange: [0, 1, 0] });
  return (
    <Animated.View style={{ transform: [{ translateX: x }], opacity }} {...responder.panHandlers}>
      {children}
    </Animated.View>
  );
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  // A quiet text action under a friend's invite (fill-free, not a pill).
  muteInvitesButton: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingVertical: 4,
  },
  muteInvitesText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  // Same chrome as Subscriptions/Favorites: back arrow + centred serif title.
  pageHeader: {
    paddingHorizontal: 8,
  },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  pageTitle: { flex: 1, textAlign: 'center', fontFamily: font.serif, fontSize: 22, color: colors.text },
  // Quiet text actions, no filled bar or rule under them.
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 4,
  },
  markAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: 'transparent',
  },
  markAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  clearAllButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: 'transparent',
  },
  clearAllText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
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
    paddingTop: 4,
    paddingBottom: 96,
  },
  // A plain row on the page (no card, no emoji tile): compact, one line of
  // title, two of detail (TestFlight 2026-11-14: "cards way too big").
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 10,
    backgroundColor: colors.background,
  },
  unreadDotHidden: { backgroundColor: 'transparent' },
  undoBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceRaised,
  },
  undoText: { fontSize: 15, color: colors.text },
  undoAction: { fontSize: 15, fontWeight: '700', color: colors.text },
  notificationContent: {
    flex: 1,
    gap: 3,
  },
  notificationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
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
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  staffInviteActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
    marginBottom: 2,
  },
  staffInviteAcceptButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.chip,
    backgroundColor: colors.white,
  },
  staffInviteAcceptText: {
    color: T.onWhite,
    fontSize: 13,
    fontWeight: '700',
  },
  staffInviteDeclineButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.chip,
    backgroundColor: colors.surfaceRaised,
  },
  staffInviteDeclineText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  notificationTime: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: colors.primary,
    marginTop: 6,
  },
});
