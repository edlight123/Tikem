import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Link2, Mail, Phone, Plus, X, ArrowRight } from 'lucide-react-native'
import { useAppAlert } from '../../components/AppAlert'
import { useTheme } from '../../contexts/ThemeContext'
import { backendJson } from '../../lib/api/backend'
import { useI18n } from '../../contexts/I18nContext'
import { Skeleton } from '../../components/Skeleton'
import { useAuth } from '../../contexts/AuthContext'
import OrganizerScreenHeader from '../../components/organizer/OrganizerScreenHeader'
import { useOverlayHeaderInset } from '../../components/OverlayHeader'
import PersonAvatar from '../../components/PersonAvatar'
import SectionHeader from '../../components/SectionHeader'
import { Touchable } from '../../components/ui/Touchable'
import { Switch } from '../../components/ui/Switch'
import { useActiveOrg } from '../../lib/activeOrg'
import { useSwipeToClose } from '../../hooks/useSwipeToClose'
import { AFTER_ALERT_MS } from '../../lib/moderationActions'
import { colors as T, font, radius } from '../../theme/tokens'

/**
 * Event > Team: who works the door at this event.
 *
 * Owner feedback 2026-11-18: "we already have a team, we should be able to
 * assign them to the event". Three sections:
 *   - on this event: events/{id}/members (assigned or invite-accepted staff),
 *     with the per-person guest-list toggle and Remove.
 *   - from your team: active members of the event's org team
 *     (organizers/{orgId}/team) not yet on the event. Staff get Assign
 *     (/api/staff/members/assign); admins and managers already run the door at
 *     every org event (lib/scan/doorRules), so they show "Every event".
 *   - pending invites: open link/email/phone invites for someone new.
 */

type RouteParams = {
  OrganizerEventStaff: {
    eventId: string
  }
}

type InviteMethod = 'link' | 'email' | 'phone'

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

type ApiInvite = {
  id: string
  method: InviteMethod
  targetEmail: string | null
  targetPhone: string | null
  expiresAt: string | null
  revokedAt: string | null
  usedAt: string | null
  usedBy: string | null
  createdAt: string | null
}

type ApiMember = {
  id: string
  role: string
  permissions: { checkin?: boolean; viewAttendees?: boolean }
  createdAt: string | null
  profile: { email: string | null; full_name: string | null; photo_url?: string | null }
}

type ApiTeamMember = {
  uid: string
  role: string
  name: string | null
  email?: string | null
  photo_url: string | null
}

export default function OrganizerEventStaffScreen() {
  const { colors } = useTheme()
  const styles = useMemo(() => getStyles(colors), [colors])
  const route = useRoute<RouteProp<RouteParams, 'OrganizerEventStaff'>>()
  const navigation = useNavigation<any>()
  const insets = useSafeAreaInsets()
  const { height: headerH, onHeight } = useOverlayHeaderInset()
  const { eventId } = route.params

  const { t } = useI18n()
  const showAlert = useAppAlert()
  const { loading: authLoading, user } = useAuth()
  const { can } = useActiveOrg()
  const canManageTeam = can('manage_team')

  const [loading, setLoading] = useState(true)
  const [invites, setInvites] = useState<ApiInvite[]>([])
  const [members, setMembers] = useState<ApiMember[]>([])
  const [team, setTeam] = useState<ApiTeamMember[]>([])
  const [busy, setBusy] = useState<string[]>([])

  const [showInviteModal, setShowInviteModal] = useState(false)
  const [method, setMethod] = useState<InviteMethod>('link')
  const [targetEmail, setTargetEmail] = useState('')
  const [targetPhone, setTargetPhone] = useState('')
  const [viewAttendees, setViewAttendees] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const inviteSwipe = useSwipeToClose(() => setShowInviteModal(false), showInviteModal)

  // Single header only: the in-body OrganizerScreenHeader (serif).
  useEffect(() => {
    navigation.setOptions({ headerShown: false })
  }, [navigation])

  const refresh = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true)
      try {
        // Server endpoint (Admin SDK, org-gated): staff emails are PII only the
        // event's org may see, and the org roster is server-only.
        const data = await backendJson<{ invites: ApiInvite[]; members: ApiMember[]; team?: ApiTeamMember[] }>(
          `/api/organizer/events/${eventId}/staff`,
        )
        setInvites(Array.isArray(data?.invites) ? data.invites : [])
        setMembers(Array.isArray(data?.members) ? data.members : [])
        setTeam(Array.isArray(data?.team) ? data.team : [])
      } catch (e: any) {
        showAlert(t('common.error'), e?.message || t('organizerStaff.errors.loadFailed'))
      } finally {
        setLoading(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eventId, t],
  )

  // First load shows the skeleton; focus refreshes stay quiet (no flash).
  const [loadedOnce, setLoadedOnce] = useState(false)
  useFocusEffect(
    useCallback(() => {
      refresh(loadedOnce).then(() => setLoadedOnce(true))
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refresh]),
  )

  const withBusy = async (id: string, fn: () => Promise<void>) => {
    if (busy.includes(id)) return
    setBusy((prev) => [...prev, id])
    try {
      await fn()
    } finally {
      setBusy((prev) => prev.filter((x) => x !== id))
    }
  }

  const memberIds = useMemo(() => new Set(members.map((m) => m.id)), [members])
  const teamById = useMemo(() => new Map(team.map((m) => [m.uid, m])), [team])
  // Teammates not on the event yet. Staff first (they are the ones to assign).
  const assignable = useMemo(
    () =>
      team
        .filter((m) => !memberIds.has(m.uid))
        .sort((a, b) => Number(a.role !== 'staff') - Number(b.role !== 'staff')),
    [team, memberIds],
  )
  const openInvites = useMemo(() => {
    const now = Date.now()
    return invites.filter((inv) => {
      if (inv.revokedAt || inv.usedAt) return false
      const exp = inv.expiresAt ? Date.parse(inv.expiresAt) : NaN
      return !(Number.isFinite(exp) && exp < now)
    })
  }, [invites])

  // ---------------------------------------------------------------- actions

  const assign = (m: ApiTeamMember) =>
    withBusy(m.uid, async () => {
      try {
        await backendJson(`/api/staff/members/assign`, {
          method: 'POST',
          body: JSON.stringify({ eventId, uid: m.uid, permissions: { viewAttendees: false } }),
        })
        // Show it straight away; the quiet refresh brings the server's copy.
        setMembers((prev) => [
          {
            id: m.uid,
            role: 'staff',
            permissions: { checkin: true, viewAttendees: false },
            createdAt: new Date().toISOString(),
            profile: { email: m.email ?? null, full_name: m.name, photo_url: m.photo_url },
          },
          ...prev.filter((x) => x.id !== m.uid),
        ])
        refresh(true)
      } catch (e: any) {
        showAlert(t('common.error'), e?.message || t('organizerStaff.errors.assignFailed'))
      }
    })

  const removeMember = (memberId: string) => {
    if (authLoading || !user) return
    showAlert(t('organizerStaff.removeMember.title'), t('organizerStaff.removeMember.body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('organizerStaff.removeMember.confirm'),
        style: 'destructive',
        onPress: () =>
          withBusy(memberId, async () => {
            try {
              await backendJson(`/api/staff/members/remove`, {
                method: 'POST',
                body: JSON.stringify({ eventId, memberId }),
              })
              setMembers((prev) => prev.filter((m) => m.id !== memberId))
              refresh(true)
            } catch (e: any) {
              showAlert(t('common.error'), e?.message || t('organizerStaff.errors.removeFailed'))
            }
          }),
      },
    ])
  }

  const revokeInvite = (inviteId: string) => {
    if (authLoading || !user) return
    showAlert(t('organizerStaff.revoke.title'), t('organizerStaff.revoke.body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('organizerStaff.revoke.confirm'),
        style: 'destructive',
        onPress: () =>
          withBusy(inviteId, async () => {
            try {
              await backendJson(`/api/staff/invites/revoke`, {
                method: 'POST',
                body: JSON.stringify({ eventId, inviteId }),
              })
              refresh(true)
            } catch (e: any) {
              showAlert(t('common.error'), e?.message || t('organizerStaff.errors.revokeFailed'))
            }
          }),
      },
    ])
  }

  // Guest-list permission: optimistic, reverted on failure.
  const toggleViewAttendees = (memberId: string, next: boolean) =>
    withBusy(memberId, async () => {
      const set = (v: boolean) =>
        setMembers((prev) =>
          prev.map((m) => (m.id === memberId ? { ...m, permissions: { ...m.permissions, viewAttendees: v } } : m)),
        )
      set(next)
      try {
        await backendJson(`/api/staff/members/permissions`, {
          method: 'POST',
          body: JSON.stringify({ eventId, memberId, permissions: { viewAttendees: next } }),
        })
      } catch (e: any) {
        set(!next)
        showAlert(t('common.error'), e?.message || t('organizerStaff.errors.permissionUpdateFailed'))
      }
    })

  const canSubmit = useMemo(() => {
    if (method === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail.trim())
    if (method === 'phone') return targetPhone.replace(/\D/g, '').length >= 8
    return true
  }, [method, targetEmail, targetPhone])

  const openInviteModal = () => {
    setTargetEmail('')
    setTargetPhone('')
    setViewAttendees(false)
    setMethod('link')
    setShowInviteModal(true)
  }

  const createInvite = async () => {
    if (authLoading || !user || !canSubmit || submitting) return
    setSubmitting(true)
    try {
      const res = await backendJson<{ inviteUrl?: string }>(`/api/staff/invites/create`, {
        method: 'POST',
        body: JSON.stringify({
          eventId,
          method,
          ...(method === 'email' ? { targetEmail: targetEmail.trim() } : {}),
          ...(method === 'phone' ? { targetPhone: targetPhone.trim() } : {}),
          permissions: { viewAttendees },
        }),
      })
      const sentTo = method === 'link' ? null : method === 'email' ? targetEmail.trim() : targetPhone.trim()
      setShowInviteModal(false)
      refresh(true)

      // After the sheet's slide-out: an alert opened under a closing Modal is dropped.
      setTimeout(() => {
        if (method === 'link' && res?.inviteUrl) {
          const url = res.inviteUrl
          showAlert(t('organizerStaff.inviteCreatedTitle'), t('organizerStaff.linkReadyBody'), [
            { text: t('common.done'), style: 'cancel' },
            {
              text: t('common.share'),
              // The share sheet is a modal too: open it once the alert has faded.
              onPress: () => {
                setTimeout(() => {
                  Share.share({ message: url, url }).catch(() => {})
                }, AFTER_ALERT_MS)
              },
            },
          ])
        } else {
          showAlert(t('organizerStaff.inviteSentTitle'), t('organizerStaff.inviteSentBody', { target: sentTo || '' }))
        }
      }, AFTER_ALERT_MS)
    } catch (e: any) {
      showAlert(t('common.error'), e?.message || t('organizerStaff.errors.inviteFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  // ------------------------------------------------------------------ parts

  const roleLabel = (role: string) =>
    role === 'admin' || role === 'manager' || role === 'staff' ? t(`organizerOrgTeam.roles.${role}` as any) : ''

  const inviteButton = (
    <Touchable
      style={[styles.headerBtn, authLoading && styles.disabled]}
      onPress={openInviteModal}
      disabled={authLoading}
      accessibilityRole="button"
      accessibilityLabel={t('organizerStaff.inviteButton')}
    >
      <Plus size={16} color={T.textPrimary} strokeWidth={2.25} />
      <Text style={styles.headerBtnText}>{t('organizerStaff.inviteButton')}</Text>
    </Touchable>
  )

  const Dot = ({ color, label }: { color: string; label: string }) => (
    <View style={styles.dotRow}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.dotLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  )

  if (loading && !loadedOnce) {
    return (
      <View style={styles.container}>
        <OrganizerScreenHeader
          onBack={() => navigation.goBack()}
          title={t('organizerStaff.headerTitle')}
          right={<Skeleton width={84} height={36} radius={radius.button} />}
          overlay
          onHeight={onHeight}
        />
        <View style={[styles.content, { paddingTop: headerH + 8 }]}>
          <Skeleton width="80%" height={16} radius={radius.sm} style={{ marginBottom: 28 }} />
          {[0, 1].map((section) => (
            <View key={section} style={{ marginBottom: 24 }}>
              <Skeleton width={140} height={20} radius={radius.sm} style={{ marginBottom: 14 }} />
              {[0, 1].map((i) => (
                <Skeleton key={i} width="100%" height={64} radius={radius.md} style={{ marginBottom: 8 }} />
              ))}
            </View>
          ))}
        </View>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <OrganizerScreenHeader
        onBack={() => navigation.goBack()}
        title={t('organizerStaff.headerTitle')}
        right={inviteButton}
        overlay
        onHeight={onHeight}
      />

      <ScrollView keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, { paddingTop: headerH + 8, paddingBottom: 40 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >

        {/* ---------------------------------------------- on this event */}
        <View style={styles.section}>
          <SectionHeader
            title={t('organizerStaff.onEventTitle')}
            trailing={members.length > 0 ? <Text style={styles.count}>{members.length}</Text> : undefined}
          />
          {members.length === 0 ? (
            <Text style={styles.quiet}>{t('organizerStaff.onEventEmpty')}</Text>
          ) : (
            <View style={styles.list}>
              {members.map((m) => {
                const seat = teamById.get(m.id)
                const name = m.profile?.full_name || seat?.name || m.profile?.email || t('organizerStaff.unnamed')
                const isOwner = m.role === 'owner'
                const full = isOwner || !!m.permissions?.viewAttendees
                const rowBusy = busy.includes(m.id)
                return (
                  <View key={m.id} style={styles.card}>
                    <View style={styles.row}>
                      <PersonAvatar
                        user={{ uid: m.id, displayName: name, photoURL: m.profile?.photo_url || seat?.photo_url || undefined }}
                        size={40}
                      />
                      <View style={styles.rowText}>
                        <Text style={styles.name} numberOfLines={1}>
                          {name}
                        </Text>
                        <Dot
                          color={T.accent}
                          label={
                            isOwner
                              ? t('organizerStaff.roleOwner')
                              : full
                                ? t('organizerStaff.memberPermissionFull')
                                : t('organizerStaff.memberPermissionBasic')
                          }
                        />
                      </View>
                      {!isOwner && (
                        <Touchable
                          style={[styles.ghostBtn, rowBusy && styles.disabled]}
                          onPress={() => removeMember(m.id)}
                          disabled={rowBusy || authLoading}
                          accessibilityRole="button"
                          accessibilityLabel={`${t('organizerStaff.remove')} ${name}`}
                        >
                          <Text style={styles.ghostBtnText}>{t('organizerStaff.remove')}</Text>
                        </Touchable>
                      )}
                    </View>
                    {!isOwner && (
                      <View style={styles.permRow}>
                        <Text style={styles.permLabel}>{t('organizerStaff.canViewAttendees')}</Text>
                        <Switch
                          value={!!m.permissions?.viewAttendees}
                          onValueChange={(v) => toggleViewAttendees(m.id, v)}
                          disabled={rowBusy || authLoading}
                          accessibilityLabel={`${t('organizerStaff.canViewAttendees')}, ${name}`}
                        />
                      </View>
                    )}
                  </View>
                )
              })}
            </View>
          )}
        </View>

        {/* ---------------------------------------------- from your team */}
        <View style={styles.section}>
          <SectionHeader
            title={t('organizerStaff.fromTeamTitle')}
            trailing={
              canManageTeam ? (
                <Touchable
                  style={styles.linkBtn}
                  onPress={() => navigation.navigate('OrganizerOrgTeam')}
                  hitSlop={8}
                  accessibilityRole="link"
                >
                  <Text style={styles.linkBtnText}>{t('organizerStaff.manageTeam').toLowerCase()}</Text>
                  <ArrowRight size={15} color={T.textSecondary} />
                </Touchable>
              ) : undefined
            }
          />
          {team.length === 0 ? (
            <Text style={styles.quiet}>
              {canManageTeam ? t('organizerStaff.teamEmpty') : t('organizerStaff.teamEmptyNoManage')}
            </Text>
          ) : assignable.length === 0 ? (
            <Text style={styles.quiet}>{t('organizerStaff.teamAllAssigned')}</Text>
          ) : (
            <View style={styles.list}>
              {assignable.map((m) => {
                const name = m.name || m.email || t('organizerStaff.unnamed')
                const runsEveryEvent = m.role === 'admin' || m.role === 'manager'
                const rowBusy = busy.includes(m.uid)
                return (
                  <View key={m.uid} style={[styles.card, styles.row]}>
                    <PersonAvatar user={{ uid: m.uid, displayName: name, photoURL: m.photo_url || undefined }} size={40} />
                    <View style={styles.rowText}>
                      <Text style={styles.name} numberOfLines={1}>
                        {name}
                      </Text>
                      <Text style={styles.meta} numberOfLines={1}>
                        {roleLabel(m.role)}
                        {m.uid === user?.uid ? ` · ${t('organizerOrgTeam.you')}` : ''}
                      </Text>
                    </View>
                    {runsEveryEvent ? (
                      <Text style={styles.everyEvent}>{t('organizerStaff.everyEvent')}</Text>
                    ) : (
                      <Touchable
                        style={[styles.assignBtn, (rowBusy || authLoading) && styles.disabled]}
                        onPress={() => assign(m)}
                        disabled={rowBusy || authLoading}
                        accessibilityRole="button"
                        accessibilityLabel={`${t('organizerStaff.assign')} ${name}`}
                      >
                        {rowBusy ? (
                          <ActivityIndicator size="small" color={T.onWhite} />
                        ) : (
                          <Text style={styles.assignBtnText}>{t('organizerStaff.assign')}</Text>
                        )}
                      </Touchable>
                    )}
                  </View>
                )
              })}
            </View>
          )}
        </View>

        {/* ---------------------------------------------- pending invites */}
        {openInvites.length > 0 && (
        <View style={styles.section}>
          <SectionHeader
            title={t('organizerStaff.invitesTitle')}
            trailing={openInvites.length > 0 ? <Text style={styles.count}>{openInvites.length}</Text> : undefined}
          />
          {openInvites.length > 0 && (
            <View style={[styles.list, { marginBottom: 8 }]}>
              {openInvites.map((inv) => {
                const target =
                  inv.method === 'email' ? inv.targetEmail : inv.method === 'phone' ? inv.targetPhone : null
                const Icon = inv.method === 'email' ? Mail : inv.method === 'phone' ? Phone : Link2
                const rowBusy = busy.includes(inv.id)
                return (
                  <View key={inv.id} style={[styles.card, styles.row]}>
                    <View style={styles.iconTile}>
                      <Icon size={18} color={T.textSecondary} />
                    </View>
                    <View style={styles.rowText}>
                      <Text style={styles.name} numberOfLines={1}>
                        {target || t('organizerStaff.linkInvite')}
                      </Text>
                      {inv.method === 'link' ? (
                        <Dot color={T.accent} label={t('organizerStaff.inviteStatus.linkReady')} />
                      ) : (
                        <Dot color={T.amber} label={t('organizerStaff.inviteStatus.pending')} />
                      )}
                    </View>
                    <Touchable
                      style={[styles.ghostBtn, rowBusy && styles.disabled]}
                      onPress={() => revokeInvite(inv.id)}
                      disabled={rowBusy || authLoading}
                      accessibilityRole="button"
                      accessibilityLabel={t('organizerStaff.revokeShort')}
                    >
                      <Text style={styles.ghostBtnText}>{t('organizerStaff.revokeShort')}</Text>
                    </Touchable>
                  </View>
                )
              })}
            </View>
          )}
        </View>
        )}
      </ScrollView>

      {/* ---------------------------------------------- invite sheet */}
      <Modal
        visible={showInviteModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowInviteModal(false)}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <Pressable
            style={styles.backdrop}
            onPress={() => setShowInviteModal(false)}
            accessibilityLabel={t('common.close')}
          >
            {/* Swallow taps on the sheet itself so they do not close it. */}
            <AnimatedPressable
              style={[styles.sheet, inviteSwipe.sheetStyle, { paddingBottom: insets.bottom + 16 }]}
              onPress={() => {}}
            >
              {/* Grabber + title drag the sheet down; not while an invite is being created. */}
              <View {...(submitting ? {} : inviteSwipe.panHandlers)}>
              <View style={styles.grabber} />
              <View style={styles.sheetHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sheetTitle}>{t('organizerStaff.sheetTitle')}</Text>
                  <Text style={styles.sheetSub}>{t('organizerStaff.sheetSubtitle')}</Text>
                </View>
                <Touchable
                  onPress={() => setShowInviteModal(false)}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.close')}
                >
                  <X size={20} color={T.textSecondary} />
                </Touchable>
              </View>
              </View>

              {/* Compact segmented control: a raised track, the chosen segment one step brighter. */}
              <View style={styles.segTrack} accessibilityRole="tablist">
                {/* Phone is off until SMS delivery + phone sign-in exist (owner, 2026-11-18). */}
                {(['link', 'email'] as InviteMethod[]).map((m) => {
                  const on = method === m
                  const Icon = m === 'email' ? Mail : m === 'phone' ? Phone : Link2
                  return (
                    <Touchable
                      key={m}
                      style={[styles.seg, on && styles.segOn]}
                      onPress={() => setMethod(m)}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: on }}
                    >
                      <Icon size={15} color={on ? T.textPrimary : T.textSecondary} />
                      <Text style={[styles.segText, on && styles.segTextOn]}>
                        {t(`organizerStaff.methods.${m}` as any)}
                      </Text>
                    </Touchable>
                  )
                })}
              </View>

              {method === 'link' ? (
                <Text style={styles.methodHint}>{t('organizerStaff.linkHint')}</Text>
              ) : method === 'email' ? (
                <TextInput
                  style={styles.input}
                  value={targetEmail}
                  onChangeText={setTargetEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  placeholder={t('organizerStaff.emailPlaceholder')}
                  placeholderTextColor={T.textTertiary}
                  selectionColor={T.accent}
                  accessibilityLabel={t('organizerStaff.emailLabel')}
                  returnKeyType="send"
                  onSubmitEditing={createInvite}
                />
              ) : (
                <TextInput
                  style={styles.input}
                  value={targetPhone}
                  onChangeText={setTargetPhone}
                  autoFocus
                  keyboardType="phone-pad"
                  textContentType="telephoneNumber"
                  placeholder={t('organizerStaff.phonePlaceholder')}
                  placeholderTextColor={T.textTertiary}
                  selectionColor={T.accent}
                  accessibilityLabel={t('organizerStaff.phoneLabel')}
                />
              )}

              <View style={styles.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.toggleTitle}>{t('organizerStaff.viewAttendees')}</Text>
                  <Text style={styles.toggleHelp}>{t('organizerStaff.viewAttendeesShortHelp')}</Text>
                </View>
                <Switch value={viewAttendees} onValueChange={setViewAttendees} />
              </View>

              <Touchable
                style={[styles.primaryBtn, (!canSubmit || submitting || authLoading) && styles.disabled]}
                onPress={createInvite}
                disabled={!canSubmit || submitting || authLoading}
                accessibilityRole="button"
              >
                {submitting ? (
                  <ActivityIndicator size="small" color={T.onWhite} />
                ) : (
                  <Text style={styles.primaryBtnText}>
                    {method === 'link' ? t('organizerStaff.createLink') : t('organizerStaff.sendInvite')}
                  </Text>
                )}
              </Touchable>
            </AnimatedPressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { paddingHorizontal: 16 },
    disabled: { opacity: 0.5 },

    // Header action: compact, filled one step above the canvas.
    headerBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      height: 36,
      paddingHorizontal: 12,
      borderRadius: radius.button,
      backgroundColor: T.surfaceRaised,
    },
    headerBtnText: { color: T.textPrimary, fontSize: 14, fontWeight: '600' },

    intro: { fontSize: 15, lineHeight: 22, color: T.textSecondary },

    section: { marginTop: 28 },
    count: { fontSize: 13, fontWeight: '600', color: T.textSecondary, fontVariant: ['tabular-nums'] },
    quiet: { fontSize: 14, lineHeight: 20, color: T.textTertiary },
    list: { gap: 8 },

    // Fill, not a hairline: rows sit one brightness step above the canvas.
    card: {
      backgroundColor: T.surface,
      borderRadius: radius.md,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    rowText: { flex: 1, minWidth: 0 },
    name: { fontSize: 15, fontWeight: '600', color: T.textPrimary },
    meta: { fontSize: 13, color: T.textSecondary, marginTop: 2 },

    dotRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
    dot: { width: 6, height: 6, borderRadius: 3 },
    dotLabel: { fontSize: 13, color: T.textSecondary, flexShrink: 1 },

    permRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      marginTop: 10,
      paddingTop: 10,
      paddingLeft: 52,
    },
    permLabel: { flex: 1, fontSize: 14, color: T.textSecondary },

    iconTile: {
      width: 40,
      height: 40,
      borderRadius: radius.md,
      backgroundColor: T.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },

    // Row buttons: ~36pt, 14pt semibold, like the website's small buttons.
    assignBtn: {
      height: 36,
      minWidth: 76,
      paddingHorizontal: 14,
      borderRadius: radius.button,
      backgroundColor: T.white,
      alignItems: 'center',
      justifyContent: 'center',
    },
    assignBtnText: { color: T.onWhite, fontSize: 14, fontWeight: '600' },
    ghostBtn: {
      height: 36,
      paddingHorizontal: 12,
      borderRadius: radius.button,
      backgroundColor: T.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ghostBtnText: { color: T.textPrimary, fontSize: 14, fontWeight: '600' },
    everyEvent: { fontSize: 13, color: T.textTertiary },
    linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    linkBtnText: { fontSize: 13, fontWeight: '600', color: T.textSecondary },

    // ---------------------------------------------- sheet
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: T.surface,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      paddingHorizontal: 20,
      paddingTop: 10,
    },
    grabber: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: 'rgba(255,255,255,0.18)',
    },
    sheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 14, marginBottom: 18 },
    sheetTitle: { fontFamily: font.serif, fontSize: 28, lineHeight: 34, color: T.textPrimary },
    sheetSub: { fontSize: 14, lineHeight: 20, color: T.textSecondary, marginTop: 2 },

    segTrack: {
      flexDirection: 'row',
      backgroundColor: T.bg,
      borderRadius: radius.md,
      padding: 3,
      gap: 3,
    },
    seg: {
      flex: 1,
      height: 34,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      borderRadius: radius.sm,
    },
    segOn: { backgroundColor: T.surfaceRaised },
    segText: { fontSize: 14, fontWeight: '600', color: T.textSecondary },
    segTextOn: { color: T.textPrimary },

    methodHint: { fontSize: 14, lineHeight: 20, color: T.textSecondary, marginTop: 14 },
    input: {
      marginTop: 12,
      height: 44,
      borderRadius: radius.md,
      paddingHorizontal: 12,
      fontSize: 16,
      color: T.textPrimary,
      backgroundColor: T.surfaceRaised,
    },

    toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 18 },
    toggleTitle: { fontSize: 15, fontWeight: '600', color: T.textPrimary },
    toggleHelp: { fontSize: 13, lineHeight: 18, color: T.textSecondary, marginTop: 2 },

    primaryBtn: {
      marginTop: 22,
      height: 44,
      borderRadius: radius.button,
      backgroundColor: T.white,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryBtnText: { color: T.onWhite, fontSize: 15, fontWeight: '600' },
  })
