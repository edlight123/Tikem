import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { radius } from '../../theme/tokens'
import { useAppAlert } from '../../components/AppAlert'
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../contexts/ThemeContext';
import { backendJson } from '../../lib/api/backend'
import { useI18n } from '../../contexts/I18nContext'
import { SPACING, RADIUS } from '../../config/brand'
import { Skeleton } from '../../components/Skeleton'
import EmptyState from '../../components/EmptyState'
import { Users, Mail } from 'lucide-react-native'
import { useAuth } from '../../contexts/AuthContext'
import OrganizerScreenHeader from '../../components/organizer/OrganizerScreenHeader'
import { useOverlayHeaderInset } from '../../components/OverlayHeader'
import StaffEventCard from '../../components/organizer/StaffEventCard'
import StatusChip from '../../components/StatusChip'
import InfoNotice from '../../components/organizer/InfoNotice'
import SegmentedTabs from '../../components/organizer/SegmentedTabs'
import WhitePillCTA from '../../components/WhitePillCTA'
import { SecondaryPill } from '../../components/auth/SecondaryPill'

type RouteParams = {
  OrganizerEventStaff: {
    eventId: string
  }
}

type InviteMethod = 'link' | 'email' | 'phone'

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
  profile: { email: string | null; full_name: string | null }
}

export default function OrganizerEventStaffScreen() {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const route = useRoute<RouteProp<RouteParams, 'OrganizerEventStaff'>>()
  const navigation = useNavigation<any>()
  const insets = useSafeAreaInsets()
  const { height: headerH, onHeight } = useOverlayHeaderInset()
  const { eventId } = route.params

  const { t } = useI18n()
  const showAlert = useAppAlert();
  const { loading: authLoading, user } = useAuth()

  const [loading, setLoading] = useState(true)
  const [invites, setInvites] = useState<ApiInvite[]>([])
  const [members, setMembers] = useState<ApiMember[]>([])
  const [permBusy, setPermBusy] = useState<string[]>([])

  const [showInviteModal, setShowInviteModal] = useState(false)
  const [method, setMethod] = useState<InviteMethod>('link')
  const [targetEmail, setTargetEmail] = useState('')
  const [targetPhone, setTargetPhone] = useState('')
  const [viewAttendees, setViewAttendees] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Single header only: use the in-body OrganizerScreenHeader (serif) and hide
  // the native navigation header to avoid a duplicate title bar.
  useEffect(() => {
    navigation.setOptions({ headerShown: false })
  }, [navigation])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      // H4: staff invites + members (including each staffer's EMAIL, which is
      // PII that only the event owner may see) come from the server endpoint
      // (Admin SDK, organizer-gated) instead of a cross-user client Firestore
      // read of users/{uid}. This keeps working after the users-read rule is
      // locked down, and email no longer leaks via a client doc read.
      const data = await backendJson<{ invites: ApiInvite[]; members: ApiMember[] }>(
        `/api/organizer/events/${eventId}/staff`,
      )
      setInvites(Array.isArray(data?.invites) ? data.invites : [])
      setMembers(Array.isArray(data?.members) ? data.members : [])
    } catch (e: any) {
      showAlert(t('common.error'), e?.message || t('organizerStaff.errors.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [eventId, t])

  useEffect(() => {
    refresh()
  }, [refresh])

  useFocusEffect(
    useCallback(() => {
      refresh()
    }, [refresh])
  )

  const canSubmit = useMemo(() => {
    if (method === 'email') return Boolean(targetEmail.trim())
    if (method === 'phone') return Boolean(targetPhone.trim())
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
    if (authLoading || !user) return
    if (!canSubmit) return

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

      setShowInviteModal(false)
      setTargetEmail('')
      setTargetPhone('')
      setViewAttendees(false)
      setMethod('link')

      if (res?.inviteUrl) {
        showAlert(t('organizerStaff.inviteCreatedTitle'), res.inviteUrl)
      } else {
        showAlert(t('organizerStaff.inviteCreatedTitle'), t('organizerStaff.inviteCreatedBody'))
      }

      refresh()
    } catch (e: any) {
      showAlert(t('common.error'), e?.message || t('organizerStaff.errors.inviteFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  const revokeInvite = async (inviteId: string) => {
    if (authLoading || !user) return
    showAlert(t('organizerStaff.revoke.title'), t('organizerStaff.revoke.body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('organizerStaff.revoke.confirm'),
        style: 'destructive',
        onPress: async () => {
          try {
            await backendJson(`/api/staff/invites/revoke`, {
              method: 'POST',
              body: JSON.stringify({ eventId, inviteId }),
            })
            refresh()
          } catch (e: any) {
            showAlert(t('common.error'), e?.message || t('organizerStaff.errors.revokeFailed'))
          }
        },
      },
    ])
  }

  const removeMember = async (memberId: string) => {
    if (authLoading || !user) return
    showAlert(t('organizerStaff.removeMember.title'), t('organizerStaff.removeMember.body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('organizerStaff.removeMember.confirm'),
        style: 'destructive',
        onPress: async () => {
          try {
            await backendJson(`/api/staff/members/remove`, {
              method: 'POST',
              body: JSON.stringify({ eventId, memberId }),
            })
            refresh()
          } catch (e: any) {
            showAlert(t('common.error'), e?.message || t('organizerStaff.errors.removeFailed'))
          }
        },
      },
    ])
  }

  // Toggle a member's view-attendees permission. Optimistic update with revert
  // on failure; the per-member id sits in `permBusy` while the write is in flight.
  const toggleMemberPermission = async (memberId: string, nextValue: boolean) => {
    if (authLoading || !user || permBusy.includes(memberId)) return
    setPermBusy((prev) => [...prev, memberId])
    setMembers((prev) =>
      prev.map((m) =>
        m.id === memberId
          ? { ...m, permissions: { ...m.permissions, viewAttendees: nextValue } }
          : m
      )
    )
    try {
      await backendJson(`/api/staff/members/permissions`, {
        method: 'POST',
        body: JSON.stringify({ eventId, memberId, permissions: { viewAttendees: nextValue } }),
      })
    } catch (e: any) {
      // Revert on failure.
      setMembers((prev) =>
        prev.map((m) =>
          m.id === memberId
            ? { ...m, permissions: { ...m.permissions, viewAttendees: !nextValue } }
            : m
        )
      )
      showAlert(t('common.error'), e?.message || t('organizerStaff.errors.permissionUpdateFailed'))
    } finally {
      setPermBusy((prev) => prev.filter((id) => id !== memberId))
    }
  }

  // Presentational: map an invite to a semantic StatusChip status + label.
  //   revoked → error · used → neutral · email/phone awaiting acceptance →
  //   pending (action needed) · link ready to share → live/active.
  const inviteState = (invite: ApiInvite): { key: string; label: string } => {
    if (invite.revokedAt) return { key: 'error', label: t('organizerStaff.inviteStatus.revoked') }
    if (invite.usedAt) return { key: 'neutral', label: t('organizerStaff.inviteStatus.used') }
    if (invite.method === 'email' || invite.method === 'phone') {
      return { key: 'pending', label: t('organizerStaff.inviteStatus.pending') }
    }
    return { key: 'live', label: t('organizerStaff.inviteStatus.active') }
  }

  const inviteButton = (
    <TouchableOpacity
      style={[styles.inviteButton, authLoading ? styles.buttonDisabled : null]}
      onPress={openInviteModal}
      disabled={authLoading}
      accessibilityRole="button"
      accessibilityLabel={t('organizerStaff.inviteButton')}
    >
      <Ionicons name="add" size={18} color={colors.text} />
      <Text style={styles.inviteButtonText}>{t('organizerStaff.inviteButton')}</Text>
    </TouchableOpacity>
  )

  if (loading) {
    return (
      <View style={styles.container}>
        {/* Identical header to the loaded branch — no in-flow -> overlay flash. */}
        <OrganizerScreenHeader
          onBack={() => navigation.goBack()}
          title={t('organizerStaff.headerTitle')}
          right={<Skeleton width={96} height={36} radius={RADIUS.md} />}
          overlay
          onHeight={onHeight}
        />
        <View style={[styles.content, { paddingTop: headerH }]}>
          <Skeleton width="100%" height={56} radius={RADIUS.md} style={{ marginBottom: 20 }} />
          {[0, 1].map((section) => (
            <View key={section} style={{ marginBottom: 12 }}>
              <Skeleton width={140} height={18} radius={4} style={{ marginBottom: 12 }} />
              {[0, 1].map((i) => (
                <Skeleton key={i} width="100%" height={72} radius={RADIUS.lg} style={{ marginBottom: 12 }} />
              ))}
            </View>
          ))}
        </View>
      </View>
    )
  }

  const isEmpty = members.length === 0 && invites.length === 0

  return (
    <View style={styles.container}>
      <OrganizerScreenHeader
        title={t('organizerStaff.headerTitle')}
        right={inviteButton}
        overlay
        onHeight={onHeight}
      />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: headerH, paddingBottom: 32 + insets.bottom },
        ]}
      >
        <View style={styles.notice}>
          <InfoNotice icon="people-outline" text={t('organizerStaff.staffInfo')} />
        </View>

        {isEmpty ? (
          <EmptyState
            icon={Users}
            title={t('organizerStaff.emptyAllTitle')}
            subtitle={t('organizerStaff.emptyAllSubtitle')}
            actionLabel={t('organizerStaff.inviteButton')}
            onAction={openInviteModal}
          />
        ) : (
          <>
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{t('organizerStaff.membersTitle')}</Text>
                {members.length > 0 ? <Text style={styles.sectionCount}>{members.length}</Text> : null}
              </View>
              {members.length === 0 ? (
                <EmptyState icon={Users} title={t('organizerStaff.emptyMembers')} compact />
              ) : (
                members.map((m) => {
                  const name = m.profile?.full_name || m.profile?.email || m.id
                  const email = m.profile?.email || ''
                  const subtitle = email && email !== name ? email : undefined
                  const isOwner = m.role === 'owner'
                  const busy = permBusy.includes(m.id)

                  return (
                    <View key={m.id} style={styles.cardWrap}>
                      <StaffEventCard
                        title={name}
                        subtitle={subtitle}
                        meta={isOwner ? t('organizerStaff.roleOwner') : undefined}
                        right={
                          <View style={styles.rightCol}>
                            <StatusChip status="live" label={t('organizerStaff.inviteStatus.active')} />
                            {!isOwner && (
                              <TouchableOpacity
                                onPress={() => removeMember(m.id)}
                                style={[styles.dangerButton, authLoading ? styles.buttonDisabled : null]}
                                disabled={authLoading}
                                accessibilityRole="button"
                                accessibilityLabel={t('organizerStaff.remove')}
                              >
                                <Text style={styles.dangerButtonText}>{t('organizerStaff.remove')}</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        }
                      />
                      {/* Permissions: check-in is always on; view-attendee-list is
                          editable for non-owner members. */}
                      <View style={styles.permRow}>
                        <View style={styles.permTextCol}>
                          <Text style={styles.permTitle}>{t('organizerStaff.canCheckIn')}</Text>
                          <Text style={styles.permHelp}>{t('organizerStaff.canCheckInHelp')}</Text>
                        </View>
                        <Text style={styles.permAlways}>{t('common.yes')}</Text>
                      </View>
                      {!isOwner && (
                        <View style={styles.permRow}>
                          <View style={styles.permTextCol}>
                            <Text style={styles.permTitle}>{t('organizerStaff.canViewAttendees')}</Text>
                            <Text style={styles.permHelp}>{t('organizerStaff.viewAttendeesHelp')}</Text>
                          </View>
                          <Switch
                            value={!!m.permissions?.viewAttendees}
                            onValueChange={(v) => toggleMemberPermission(m.id, v)}
                            disabled={busy || authLoading}
                            trackColor={{ false: colors.surfaceMuted, true: colors.primary }}
                            thumbColor={colors.white}
                          />
                        </View>
                      )}
                    </View>
                  )
                })
              )}
            </View>

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{t('organizerStaff.invitesTitle')}</Text>
                {invites.length > 0 ? <Text style={styles.sectionCount}>{invites.length}</Text> : null}
              </View>
              {invites.length === 0 ? (
                <EmptyState icon={Mail} title={t('organizerStaff.emptyInvites')} compact />
              ) : (
                invites.map((inv) => {
                  const target = inv.method === 'email' ? inv.targetEmail : inv.method === 'phone' ? inv.targetPhone : null
                  const label = target || t('organizerStaff.linkInvite')
                  const state = inviteState(inv)
                  const canRevoke = !inv.revokedAt && !inv.usedAt

                  return (
                    <View key={inv.id} style={styles.cardWrap}>
                      <StaffEventCard
                        title={label}
                        meta={t(`organizerStaff.methods.${inv.method}` as any)}
                        right={
                          <View style={styles.rightCol}>
                            <StatusChip status={state.key} label={state.label} />
                            {canRevoke ? (
                              <TouchableOpacity
                                onPress={() => revokeInvite(inv.id)}
                                style={[styles.dangerButton, authLoading ? styles.buttonDisabled : null]}
                                disabled={authLoading}
                                accessibilityRole="button"
                                accessibilityLabel={t('organizerStaff.revokeShort')}
                              >
                                <Text style={styles.dangerButtonText}>{t('organizerStaff.revokeShort')}</Text>
                              </TouchableOpacity>
                            ) : null}
                          </View>
                        }
                      />
                    </View>
                  )
                })
              )}
            </View>
          </>
        )}
      </ScrollView>

      <Modal visible={showInviteModal} animationType="slide" transparent onRequestClose={() => setShowInviteModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('organizerStaff.createInviteTitle')}</Text>
              <TouchableOpacity
                onPress={() => setShowInviteModal(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={t('common.cancel')}
              >
                <Ionicons name="close" size={22} color={colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>{t('organizerStaff.methodLabel')}</Text>
            <View style={styles.methodTabs}>
              <SegmentedTabs
                tabs={(['link', 'email', 'phone'] as InviteMethod[]).map((m) => ({
                  key: m,
                  label: t(`organizerStaff.methods.${m}` as any),
                }))}
                value={method}
                onChange={(key: string) => setMethod(key as InviteMethod)}
              />
            </View>

            {method === 'email' ? (
              <>
                <Text style={styles.label}>{t('organizerStaff.emailLabel')}</Text>
                <TextInput
                  style={styles.input}
                  value={targetEmail}
                  onChangeText={setTargetEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  placeholder={t('organizerStaff.emailPlaceholder')}
                  placeholderTextColor={colors.textTertiary}
                  selectionColor={colors.primary}
                />
              </>
            ) : null}

            {method === 'phone' ? (
              <>
                <Text style={styles.label}>{t('organizerStaff.phoneLabel')}</Text>
                <TextInput
                  style={styles.input}
                  value={targetPhone}
                  onChangeText={setTargetPhone}
                  keyboardType="phone-pad"
                  placeholder={t('organizerStaff.phonePlaceholder')}
                  placeholderTextColor={colors.textTertiary}
                  selectionColor={colors.primary}
                />
              </>
            ) : null}

            <View style={styles.toggleCard}>
              <View style={styles.toggleText}>
                <Text style={styles.toggleTitle}>{t('organizerStaff.viewAttendees')}</Text>
                <Text style={styles.toggleHelp}>{t('organizerStaff.viewAttendeesHelp')}</Text>
              </View>
              <Switch
                value={viewAttendees}
                onValueChange={setViewAttendees}
                trackColor={{ false: colors.border, true: colors.text }}
                thumbColor={colors.white}
                ios_backgroundColor={colors.border}
              />
            </View>

            <View style={styles.modalActions}>
              <WhitePillCTA
                label={t('organizerStaff.create')}
                onPress={createInvite}
                disabled={!canSubmit || submitting || authLoading}
                loading={submitting}
              />
              <SecondaryPill label={t('common.cancel')} onPress={() => setShowInviteModal(false)} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 32 },

  inviteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: RADIUS.md,
    gap: 6,
  },
  inviteButtonText: { color: colors.text, fontWeight: '700' },

  buttonDisabled: { opacity: 0.6 },

  notice: { marginBottom: 4 },

  section: { marginTop: 16 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  sectionCount: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    backgroundColor: colors.surfaceRaised,
    minWidth: 22,
    textAlign: 'center',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.chip,
    overflow: 'hidden',
  },

  cardWrap: { marginBottom: SPACING.md },
  rightCol: { alignItems: 'flex-end', gap: 8 },
  permRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 4,
    paddingTop: 10,
  },
  permTextCol: { flex: 1 },
  permTitle: { color: colors.text, fontWeight: '600', fontSize: 13 },
  permHelp: { color: colors.textSecondary, fontSize: 12, lineHeight: 16, marginTop: 2 },
  permAlways: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },

  dangerButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: RADIUS.sm,
    backgroundColor: colors.errorLight,
  },
  dangerButtonText: { color: colors.error, fontWeight: '700', fontSize: 12 },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: colors.surface,
    borderRadius: RADIUS.xl,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: 16, fontWeight: '700', color: colors.text },

  label: { marginTop: 12, marginBottom: 6, fontWeight: '700', color: colors.text },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: colors.text,
    backgroundColor: colors.surfaceMuted,
  },

  // SegmentedTabs pads itself horizontally; pull it back to the card edge.
  methodTabs: { marginHorizontal: -16, marginTop: 2 },

  toggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 16,
    backgroundColor: colors.surfaceRaised,
    borderRadius: RADIUS.md,
    padding: 14,
  },
  toggleText: { flex: 1 },
  toggleTitle: { color: colors.text, fontWeight: '700', fontSize: 14 },
  toggleHelp: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 3 },

  modalActions: { gap: 10, marginTop: 16 },
})
