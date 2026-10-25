import React, { useCallback, useMemo, useState } from 'react'
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { Users, ClipboardList } from 'lucide-react-native'

import { useAppAlert } from '../../components/AppAlert'
import { useTheme } from '../../contexts/ThemeContext'
import { useAuth } from '../../contexts/AuthContext'
import { useI18n } from '../../contexts/I18nContext'
import { backendJson } from '../../lib/api/backend'
import { useActiveOrg } from '../../lib/activeOrg'
import { TEAM_ROLES, type TeamRole } from '../../lib/orgTeamRoles'
import { colors as T, radius, spacing } from '../../theme/tokens'
import { Skeleton } from '../../components/Skeleton'
import EmptyState from '../../components/EmptyState'
import SectionHeader from '../../components/SectionHeader'
import StatusChip from '../../components/StatusChip'
import OrganizerScreenHeader from '../../components/organizer/OrganizerScreenHeader'
import { useOverlayHeaderInset } from '../../components/OverlayHeader'
import SegmentedTabs from '../../components/organizer/SegmentedTabs'
import SelectField from '../../components/organizer/SelectField'
import FormSheet, { SheetInput, SheetLabel } from '../../components/organizer/FormSheet'
import WhitePillCTA from '../../components/WhitePillCTA'
import { useOrgLabel } from '../../components/organizer/OrgSwitcher'

type MemberStatus = 'active' | 'invited'
type TaskStatus = 'todo' | 'in_progress' | 'done'

/** A row from GET /api/organizer/team. Invites carry ids like "invite:<id>". */
type TeamMember = {
  id: string
  uid?: string | null
  email: string
  name?: string | null
  role: TeamRole
  status: MemberStatus
  joined_at?: string | null
}

type OrgTask = {
  id: string
  title: string
  notes?: string | null
  assignee_id?: string | null
  assignee_name?: string | null
  status: TaskStatus
  due?: string | null
  created_at?: string | null
}

const TASK_STATUS_KEYS: TaskStatus[] = ['todo', 'in_progress', 'done']

// Task status → semantic StatusChip (dot + label): todo neutral, in progress amber, done emerald.
const taskChipStatus = (status: TaskStatus): string =>
  status === 'done' ? 'success' : status === 'in_progress' ? 'pending' : 'neutral'

/**
 * The org's team (docs/specs/org-teams.md): who runs it with you, and as what.
 *
 *   admin    everything but money out, payout details and deleting the org; manages the team
 *   manager  runs events
 *   staff    nothing org-wide; door access per event
 *
 * Invites go out by email with an accept link (7 days); a Google or Apple
 * account with that email joins on its next visit without the link. Reached
 * only by the owner and admins (withOrgAccess 'manage_team' in AppNavigator).
 */
export default function OrganizerOrgTeamScreen() {
  const { colors } = useTheme()
  const styles = getStyles(colors)
  const navigation = useNavigation<any>()
  const insets = useSafeAreaInsets()
  const { height: headerH, onHeight } = useOverlayHeaderInset()
  const { t } = useI18n()
  const showAlert = useAppAlert()
  const { user, userProfile } = useAuth()
  const activeOrg = useActiveOrg()
  const { orgLabel } = useOrgLabel()

  const [tab, setTab] = useState<'team' | 'tasks'>('team')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [members, setMembers] = useState<TeamMember[]>([])
  const [tasks, setTasks] = useState<OrgTask[]>([])

  // Invite sheet.
  const [showInvite, setShowInvite] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState<TeamRole>('manager')

  // Member sheet.
  const [activeMember, setActiveMember] = useState<TeamMember | null>(null)
  const [memberRole, setMemberRole] = useState<TeamRole>('manager')

  // Task sheets.
  const [showNewTask, setShowNewTask] = useState(false)
  const [taskTitle, setTaskTitle] = useState('')
  const [taskNotes, setTaskNotes] = useState('')
  const [taskAssigneeId, setTaskAssigneeId] = useState<string>('')
  const [taskDue, setTaskDue] = useState('')
  const [activeTask, setActiveTask] = useState<OrgTask | null>(null)

  const [submitting, setSubmitting] = useState(false)

  const roleLabel = useCallback((role: string) => t(`orgTeam.roles.${role}` as any), [t])
  const roleBlurb = useCallback((role: TeamRole) => t(`orgTeam.roleBlurbs.${role}` as any), [t])
  const taskStatusLabel = useCallback(
    (status: TaskStatus) =>
      t(`organizerOrgTeam.status.${status === 'in_progress' ? 'inProgress' : status}` as any),
    [t]
  )

  /** Server errors are English; show our own words, keyed off the status. */
  const errorText = useCallback(
    (e: any, fallbackKey: string) => {
      const msg = String(e?.payload?.error || '')
      if (e?.status === 429) return t('orgTeam.team.errors.tooMany')
      if (e?.status === 403) return t('orgTeam.gate.teamBody')
      if (/already runs/i.test(msg)) return t('orgTeam.team.errors.alreadyOwner')
      if (/valid email/i.test(msg)) return t('orgTeam.team.errors.invalidEmail')
      return t(fallbackKey as any)
    },
    [t]
  )

  const refresh = useCallback(async () => {
    try {
      const [teamRes, tasksRes] = await Promise.all([
        backendJson<{ members: TeamMember[] }>(`/api/organizer/team`),
        backendJson<{ tasks: OrgTask[] }>(`/api/organizer/tasks`).catch(() => ({ tasks: [] as OrgTask[] })),
      ])
      setMembers(Array.isArray(teamRes?.members) ? teamRes.members : [])
      setTasks(Array.isArray(tasksRes?.tasks) ? tasksRes.tasks : [])
    } catch (e: any) {
      showAlert(t('common.error'), errorText(e, 'organizerOrgTeam.errors.loadFailed'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [t, showAlert, errorText])

  // Loads on focus, and again whenever the acting org changes.
  useFocusEffect(
    useCallback(() => {
      refresh()
    }, [refresh, activeOrg.orgId])
  )

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    refresh()
  }, [refresh])

  const memberDisplay = useCallback((m: TeamMember) => (m.name && m.name.trim()) || m.email || m.id, [])

  const currentEmail = (userProfile?.email || user?.email || '').toLowerCase()
  const isSelf = useCallback(
    (m: TeamMember) =>
      (!!m.uid && m.uid === user?.uid) || (!!currentEmail && m.email?.toLowerCase() === currentEmail),
    [currentEmail, user?.uid]
  )

  const openInvite = () => {
    setNewEmail('')
    setNewName('')
    setNewRole('manager')
    setShowInvite(true)
  }

  const submitInvite = async () => {
    const email = newEmail.trim()
    if (!email) return
    setSubmitting(true)
    try {
      const res = await backendJson<{ member?: TeamMember }>(`/api/organizer/team`, {
        method: 'POST',
        body: JSON.stringify({ email, name: newName.trim() || undefined, role: newRole }),
      })
      setShowInvite(false)
      await refresh()
      if (res?.member?.status === 'active') {
        showAlert(t('orgTeam.team.roleUpdatedTitle'), t('orgTeam.team.roleUpdatedBody', { email }))
      } else {
        showAlert(t('orgTeam.team.inviteSentTitle'), t('orgTeam.team.inviteSentBody', { email }))
      }
    } catch (e: any) {
      showAlert(t('common.error'), errorText(e, 'organizerOrgTeam.errors.addMemberFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  const openMember = (m: TeamMember) => {
    setMemberRole(m.role)
    setActiveMember(m)
  }

  const saveMemberRole = async () => {
    const member = activeMember
    if (!member || memberRole === member.role) {
      setActiveMember(null)
      return
    }
    setSubmitting(true)
    try {
      await backendJson(`/api/organizer/team`, {
        method: 'PATCH',
        body: JSON.stringify({ memberId: member.id, role: memberRole }),
      })
      setActiveMember(null)
      await refresh()
    } catch (e: any) {
      showAlert(t('common.error'), errorText(e, 'organizerOrgTeam.errors.updateMemberFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  const removeMember = (member: TeamMember) => {
    const invite = member.status === 'invited'
    showAlert(
      invite ? t('orgTeam.team.cancelInvite') : t('organizerOrgTeam.removeMember'),
      invite ? t('orgTeam.team.cancelInviteConfirm') : t('orgTeam.team.removeConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: invite ? t('orgTeam.team.cancelInvite') : t('common.remove'),
          style: 'destructive',
          onPress: async () => {
            try {
              await backendJson(`/api/organizer/team?memberId=${encodeURIComponent(member.id)}`, {
                method: 'DELETE',
              })
              setActiveMember(null)
              await refresh()
            } catch (e: any) {
              showAlert(t('common.error'), errorText(e, 'organizerOrgTeam.errors.removeMemberFailed'))
            }
          },
        },
      ]
    )
  }

  const openNewTask = () => {
    setTaskTitle('')
    setTaskNotes('')
    setTaskAssigneeId('')
    setTaskDue('')
    setShowNewTask(true)
  }

  const submitNewTask = async () => {
    const title = taskTitle.trim()
    if (!title) return
    const assignee = members.find((m) => m.id === taskAssigneeId)
    setSubmitting(true)
    try {
      await backendJson(`/api/organizer/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          title,
          notes: taskNotes.trim() || undefined,
          assignee_id: assignee?.id || undefined,
          assignee_name: assignee ? memberDisplay(assignee) : undefined,
          due: taskDue.trim() || undefined,
          status: 'todo',
        }),
      })
      setShowNewTask(false)
      await refresh()
    } catch (e: any) {
      showAlert(t('common.error'), errorText(e, 'organizerOrgTeam.errors.addTaskFailed'))
    } finally {
      setSubmitting(false)
    }
  }

  const changeTaskStatus = async (task: OrgTask, status: TaskStatus) => {
    if (status === task.status) return
    const previous = task.status
    setTasks((prev) => prev.map((x) => (x.id === task.id ? { ...x, status } : x)))
    setActiveTask((prev) => (prev && prev.id === task.id ? { ...prev, status } : prev))
    try {
      await backendJson(`/api/organizer/tasks`, {
        method: 'PATCH',
        body: JSON.stringify({ taskId: task.id, status }),
      })
    } catch (e: any) {
      setTasks((prev) => prev.map((x) => (x.id === task.id ? { ...x, status: previous } : x)))
      setActiveTask((prev) => (prev && prev.id === task.id ? { ...prev, status: previous } : prev))
      showAlert(t('common.error'), errorText(e, 'organizerOrgTeam.errors.updateTaskFailed'))
    }
  }

  const removeTask = (task: OrgTask) => {
    showAlert(t('organizerOrgTeam.removeTask'), t('organizerOrgTeam.removeTaskConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.remove'),
        style: 'destructive',
        onPress: async () => {
          try {
            await backendJson(`/api/organizer/tasks?taskId=${encodeURIComponent(task.id)}`, { method: 'DELETE' })
            setActiveTask(null)
            await refresh()
          } catch (e: any) {
            showAlert(t('common.error'), errorText(e, 'organizerOrgTeam.errors.removeTaskFailed'))
          }
        },
      },
    ])
  }

  const tabs = useMemo(
    () => [
      { key: 'team', label: t('organizerOrgTeam.tabs.team'), count: members.length },
      { key: 'tasks', label: t('organizerOrgTeam.tabs.tasks'), count: tasks.length },
    ],
    [t, members.length, tasks.length]
  )

  const addButton = (
    <TouchableOpacity
      style={styles.addButton}
      onPress={tab === 'team' ? openInvite : openNewTask}
      accessibilityRole="button"
      accessibilityLabel={tab === 'team' ? t('orgTeam.team.invite') : t('organizerOrgTeam.newTask')}
    >
      <Ionicons name="add" size={18} color={colors.text} />
      <Text style={styles.addButtonText}>
        {tab === 'team' ? t('orgTeam.team.invite') : t('organizerOrgTeam.newTask')}
      </Text>
    </TouchableOpacity>
  )

  const title = orgLabel({ orgName: activeOrg.orgName, role: activeOrg.role || 'owner' })
  const header = (
    <OrganizerScreenHeader
      title={t('orgTeam.team.title')}
      subtitle={activeOrg.isOwner ? undefined : title}
      onBack={() => navigation.goBack()}
      right={loading ? undefined : addButton}
      overlay
      onHeight={onHeight}
    />
  )

  if (loading) {
    return (
      <View style={styles.container}>
        {header}
        <View style={[styles.content, { marginTop: headerH }]}>
          <Skeleton width="100%" height={44} radius={radius.md} style={{ marginBottom: 20 }} />
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} width="100%" height={68} radius={radius.md} style={{ marginBottom: 8 }} />
          ))}
        </View>
      </View>
    )
  }

  const ownerName = activeOrg.isOwner
    ? (userProfile?.full_name || userProfile?.email || '').trim()
    : orgLabel({ orgName: activeOrg.orgName, role: 'owner' })

  const renderPerson = (opts: {
    key: string
    name: string
    email?: string
    roleText: string
    you?: boolean
    status?: MemberStatus
    onPress?: () => void
  }) => (
    <TouchableOpacity
      key={opts.key}
      style={styles.personRow}
      onPress={opts.onPress}
      disabled={!opts.onPress}
      activeOpacity={0.75}
      accessibilityRole={opts.onPress ? 'button' : 'text'}
    >
      <View style={styles.monogram}>
        <Text style={styles.monogramText}>{(opts.name || '?').trim().charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.personBody}>
        <Text style={styles.personName} numberOfLines={1}>
          {opts.name}
          {opts.you ? <Text style={styles.personYou}>{`  ${t('organizerOrgTeam.you')}`}</Text> : null}
        </Text>
        <Text style={styles.personMeta} numberOfLines={1}>
          {[opts.roleText, opts.email && opts.email !== opts.name ? opts.email : null].filter(Boolean).join(' · ')}
        </Text>
      </View>
      {opts.status ? (
        <StatusChip
          status={opts.status === 'active' ? 'active' : 'pending'}
          label={opts.status === 'active' ? t('orgTeam.status.active') : t('orgTeam.status.invited')}
        />
      ) : null}
      {opts.onPress ? <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} /> : null}
    </TouchableOpacity>
  )

  return (
    <View style={styles.container}>
      {header}
      <View style={[styles.tabsWrap, { marginTop: headerH }]}>
        <SegmentedTabs tabs={tabs} value={tab} onChange={(k) => setTab(k as 'team' | 'tasks')} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {tab === 'team' ? (
          <>
            {renderPerson({
              key: 'owner',
              name: ownerName || t('orgTeam.roles.owner'),
              roleText: t('orgTeam.roles.owner'),
              you: activeOrg.isOwner,
            })}
            {members.map((m) =>
              renderPerson({
                key: m.id,
                name: memberDisplay(m),
                email: m.email,
                roleText: roleLabel(m.role),
                you: isSelf(m),
                status: m.status,
                onPress: isSelf(m) ? undefined : () => openMember(m),
              })
            )}

            {members.length === 0 ? (
              <View style={styles.emptyWrap}>
                <EmptyState
                  icon={Users}
                  title={t('organizerOrgTeam.emptyTeamTitle')}
                  subtitle={t('orgTeam.team.emptyBody')}
                  actionLabel={t('orgTeam.team.invite')}
                  onAction={openInvite}
                  compact
                />
              </View>
            ) : null}

            <View style={styles.rolesBlock}>
              <SectionHeader title={t('orgTeam.team.rolesTitle')} />
              {TEAM_ROLES.map((r) => (
                <View key={r} style={styles.roleExplain}>
                  <Text style={styles.roleExplainName}>{roleLabel(r)}</Text>
                  <Text style={styles.roleExplainBody}>{roleBlurb(r)}</Text>
                </View>
              ))}
            </View>
          </>
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title={t('organizerOrgTeam.emptyTasksTitle')}
            subtitle={t('organizerOrgTeam.emptyTasksSubtitle')}
            actionLabel={t('organizerOrgTeam.newTask')}
            onAction={openNewTask}
          />
        ) : (
          tasks.map((task) => (
            <TouchableOpacity
              key={task.id}
              style={styles.personRow}
              onPress={() => setActiveTask(task)}
              activeOpacity={0.75}
              accessibilityRole="button"
            >
              <View style={styles.personBody}>
                <Text style={styles.personName} numberOfLines={2}>
                  {task.title}
                </Text>
                <Text style={styles.personMeta} numberOfLines={1}>
                  {[
                    task.assignee_name || t('organizerOrgTeam.unassigned'),
                    task.due ? `${t('organizerOrgTeam.due')}: ${task.due}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
              <StatusChip status={taskChipStatus(task.status)} label={taskStatusLabel(task.status)} />
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      {/* Invite */}
      <FormSheet
        visible={showInvite}
        title={t('orgTeam.team.inviteTitle')}
        onClose={() => setShowInvite(false)}
        closeLabel={t('common.close')}
        busy={submitting}
        footer={
          <WhitePillCTA
            label={t('orgTeam.team.sendInvite')}
            onPress={submitInvite}
            disabled={!newEmail.trim() || submitting}
            loading={submitting}
          />
        }
      >
        <SheetLabel>{t('organizerOrgTeam.memberEmail')}</SheetLabel>
        <SheetInput
          value={newEmail}
          onChangeText={setNewEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder={t('organizerOrgTeam.memberEmailPlaceholder')}
        />
        <SheetLabel>{t('organizerOrgTeam.memberName')}</SheetLabel>
        <SheetInput value={newName} onChangeText={setNewName} placeholder={t('organizerOrgTeam.memberNamePlaceholder')} />
        <SheetLabel>{t('organizerOrgTeam.role')}</SheetLabel>
        <RolePicker value={newRole} onChange={setNewRole} label={roleLabel} blurb={roleBlurb} />
        <Text style={styles.sheetNote}>{t('orgTeam.team.inviteNote')}</Text>
      </FormSheet>

      {/* One member: change role, remove / cancel the invite */}
      <FormSheet
        visible={!!activeMember}
        title={activeMember ? memberDisplay(activeMember) : ''}
        onClose={() => setActiveMember(null)}
        closeLabel={t('common.close')}
        busy={submitting}
        footer={
          <>
            <WhitePillCTA
              label={t('orgTeam.save')}
              onPress={saveMemberRole}
              disabled={submitting || !activeMember || memberRole === activeMember.role}
              loading={submitting}
            />
            <TouchableOpacity
              style={styles.textAction}
              onPress={() => activeMember && removeMember(activeMember)}
              accessibilityRole="button"
            >
              <Text style={styles.textActionDanger}>
                {activeMember?.status === 'invited' ? t('orgTeam.team.cancelInvite') : t('organizerOrgTeam.removeMember')}
              </Text>
            </TouchableOpacity>
          </>
        }
      >
        {activeMember ? (
          <View style={styles.memberHead}>
            <Text style={styles.personMeta} numberOfLines={1}>
              {activeMember.email}
            </Text>
            <StatusChip
              status={activeMember.status === 'active' ? 'active' : 'pending'}
              label={activeMember.status === 'active' ? t('orgTeam.status.active') : t('orgTeam.status.invited')}
            />
          </View>
        ) : null}
        <SheetLabel>{t('organizerOrgTeam.role')}</SheetLabel>
        <RolePicker value={memberRole} onChange={setMemberRole} label={roleLabel} blurb={roleBlurb} />
      </FormSheet>

      {/* New task */}
      <FormSheet
        visible={showNewTask}
        title={t('organizerOrgTeam.newTask')}
        onClose={() => setShowNewTask(false)}
        closeLabel={t('common.close')}
        busy={submitting}
        footer={
          <WhitePillCTA
            label={t('organizerOrgTeam.newTask')}
            onPress={submitNewTask}
            disabled={!taskTitle.trim() || submitting}
            loading={submitting}
          />
        }
      >
        <SheetLabel>{t('organizerOrgTeam.taskTitle')}</SheetLabel>
        <SheetInput value={taskTitle} onChangeText={setTaskTitle} placeholder={t('organizerOrgTeam.taskTitlePlaceholder')} />
        <SheetLabel>{t('organizerOrgTeam.taskNotes')}</SheetLabel>
        <SheetInput
          value={taskNotes}
          onChangeText={setTaskNotes}
          multiline
          style={styles.multiline}
          placeholder={t('organizerOrgTeam.taskNotesPlaceholder')}
        />
        <SelectField
          label={t('organizerOrgTeam.assignee')}
          labelStyle={styles.selectLabel}
          fieldStyle={styles.selectField}
          value={
            members.find((m) => m.id === taskAssigneeId)
              ? memberDisplay(members.find((m) => m.id === taskAssigneeId)!)
              : t('organizerOrgTeam.unassigned')
          }
          options={[t('organizerOrgTeam.unassigned'), ...members.map(memberDisplay)]}
          onSelect={(label) => setTaskAssigneeId(members.find((m) => memberDisplay(m) === label)?.id || '')}
          sheetTitle={t('organizerOrgTeam.assignee')}
        />
        <SheetLabel>{t('organizerOrgTeam.due')}</SheetLabel>
        <SheetInput value={taskDue} onChangeText={setTaskDue} placeholder={t('organizerOrgTeam.duePlaceholder')} />
      </FormSheet>

      {/* One task */}
      <FormSheet
        visible={!!activeTask}
        title={activeTask?.title || ''}
        onClose={() => setActiveTask(null)}
        closeLabel={t('common.close')}
        footer={
          <TouchableOpacity
            style={styles.textAction}
            onPress={() => activeTask && removeTask(activeTask)}
            accessibilityRole="button"
          >
            <Text style={styles.textActionDanger}>{t('organizerOrgTeam.removeTask')}</Text>
          </TouchableOpacity>
        }
      >
        {activeTask?.assignee_name ? <Text style={styles.personMeta}>{activeTask.assignee_name}</Text> : null}
        <SheetLabel>{t('organizerOrgTeam.taskStatusLabel')}</SheetLabel>
        <View style={styles.statusTabs}>
          <SegmentedTabs
            tabs={TASK_STATUS_KEYS.map((s) => ({ key: s, label: taskStatusLabel(s) }))}
            value={activeTask?.status || 'todo'}
            onChange={(k) => activeTask && changeTaskStatus(activeTask, k as TaskStatus)}
          />
        </View>
      </FormSheet>
    </View>
  )
}

/** Admin / Manager / Staff, each with its one-line meaning. Radios, on a sheet. */
function RolePicker({
  value,
  onChange,
  label,
  blurb,
}: {
  value: TeamRole
  onChange: (role: TeamRole) => void
  label: (role: TeamRole) => string
  blurb: (role: TeamRole) => string
}) {
  const { colors } = useTheme()
  const styles = getStyles(colors)
  return (
    <View style={styles.rolePicker}>
      {TEAM_ROLES.map((r) => {
        const on = r === value
        return (
          <TouchableOpacity
            key={r}
            style={styles.roleOption}
            onPress={() => onChange(r)}
            activeOpacity={0.8}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${label(r)}. ${blurb(r)}`}
          >
            <View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.radioDot} /> : null}</View>
            <View style={styles.roleOptionBody}>
              <Text style={styles.roleOptionName}>{label(r)}</Text>
              <Text style={styles.roleOptionBlurb}>{blurb(r)}</Text>
            </View>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

const getStyles = (colors: ReturnType<typeof useTheme>['colors']) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16 },
    tabsWrap: { marginHorizontal: -16, paddingTop: 8, paddingBottom: 2 },

    addButton: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: T.surfaceRaised,
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: radius.md,
      gap: 6,
    },
    addButtonText: { color: colors.text, fontWeight: '700', fontSize: 13 },

    personRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: 8,
      borderRadius: radius.md,
      backgroundColor: T.surface,
    },
    monogram: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: T.surfaceRaised,
      alignItems: 'center',
      justifyContent: 'center',
    },
    monogramText: { color: colors.text, fontWeight: '700', fontSize: 14 },
    personBody: { flex: 1, minWidth: 0 },
    personName: { fontSize: 15, fontWeight: '700', color: colors.text },
    personYou: { fontSize: 12, fontWeight: '600', color: colors.textTertiary },
    personMeta: { marginTop: 2, fontSize: 12, color: colors.textSecondary },

    emptyWrap: { marginTop: spacing.lg },

    rolesBlock: { marginTop: 28 },
    roleExplain: { marginBottom: 14 },
    roleExplainName: { fontSize: 14, fontWeight: '700', color: colors.text },
    roleExplainBody: { marginTop: 2, fontSize: 13, lineHeight: 18, color: colors.textSecondary },

    rolePicker: { gap: 8 },
    roleOption: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
      padding: 14,
      borderRadius: radius.md,
      backgroundColor: T.surfaceRaised,
    },
    roleOptionBody: { flex: 1 },
    roleOptionName: { fontSize: 15, fontWeight: '700', color: colors.text },
    roleOptionBlurb: { marginTop: 2, fontSize: 12, lineHeight: 17, color: colors.textSecondary },
    radio: {
      marginTop: 1,
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: 'rgba(255,255,255,0.14)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioOn: { backgroundColor: T.white },
    radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: T.onWhite },

    sheetNote: { marginTop: 14, fontSize: 12, lineHeight: 17, color: colors.textTertiary },
    memberHead: { marginTop: 6, gap: 8 },
    multiline: { minHeight: 72, textAlignVertical: 'top' },
    selectLabel: {
      marginTop: 18,
      marginBottom: 8,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      color: colors.textTertiary,
    },
    selectField: { backgroundColor: T.surfaceRaised, borderWidth: 0 },
    statusTabs: { marginHorizontal: -16 },

    textAction: { alignItems: 'center', paddingVertical: 10 },
    textActionDanger: { color: colors.error, fontWeight: '700', fontSize: 14 },
  })
