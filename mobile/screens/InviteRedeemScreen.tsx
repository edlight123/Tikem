import React, { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { NativeStackScreenProps } from '@react-navigation/native-stack'

import { RootStackParamList } from '../navigation/AppNavigator'
import { useAuth } from '../contexts/AuthContext'
import { useAppMode } from '../contexts/AppModeContext'
import { clearPendingInvite, setPendingInvite } from '../lib/pendingInvite'
import { deleteStaffInviteNotificationsByEvent, deleteStaffInviteNotificationsByToken } from '../lib/notifications'
import { addStaffEventId } from '../lib/staffAssignments'
import { backendJson } from '../lib/api/backend'
import { useTheme } from '../contexts/ThemeContext';
import { useI18n } from '../contexts/I18nContext';
import { radius } from '../theme/tokens';

type Props = NativeStackScreenProps<RootStackParamList, 'InviteRedeem'>

function getFriendlyError(message: string, t: (key: string) => string) {
  const lower = message.toLowerCase()
  if (lower.includes('invite expired')) return t('inviteRedeem.errors.expired')
  if (lower.includes('already claimed')) return t('inviteRedeem.errors.alreadyClaimed')
  if (lower.includes('invite was revoked')) return t('inviteRedeem.errors.revoked')
  if (lower.includes('authentication required')) return t('inviteRedeem.errors.authRequired')
  if (lower.includes('restricted to a different email')) return t('inviteRedeem.errors.emailMismatch')
  if (lower.includes('restricted to a different phone')) return t('inviteRedeem.errors.phoneMismatch')
  if (lower.includes('invite email mismatch')) return t('inviteRedeem.errors.emailMismatch')
  if (lower.includes('invite phone mismatch')) return t('inviteRedeem.errors.phoneMismatch')
  return message
}

export default function InviteRedeemScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const { t } = useI18n()
  const { user } = useAuth()
  const { setMode } = useAppMode()

  const eventId = useMemo(() => String((route.params as any)?.eventId || ''), [route.params])
  const token = useMemo(() => String((route.params as any)?.token || ''), [route.params])

  const [status, setStatus] = useState<'idle' | 'working' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState<string>('')

  useEffect(() => {
    // If we arrived via deep link, persist it so a login roundtrip can continue.
    if (eventId && token) {
      setPendingInvite({ eventId, token }).catch(() => {})
    }
  }, [eventId, token])

  useEffect(() => {
    const redeem = async () => {
      if (!eventId || !token) {
        setStatus('error')
        setMessage(t('inviteRedeem.invalidLink'))
        return
      }

      if (!user) {
        setStatus('idle')
        setMessage(t('inviteRedeem.loginToAccept'))
        return
      }

      setStatus('working')
      setMessage(t('inviteRedeem.accepting'))

      try {
        await backendJson('/api/staff/invites/redeem', {
          method: 'POST',
          body: JSON.stringify({ eventId, token }),
        })

        // Persist so Staff tabs can show it immediately.
        addStaffEventId(eventId).catch(() => {})

        // Auto-clear any matching notification that led to this invite.
        if (user?.uid) {
          deleteStaffInviteNotificationsByToken(user.uid, { eventId, token }).catch(() => {})
          // Some notifications don't store the token; clear by eventId too.
          deleteStaffInviteNotificationsByEvent(user.uid, { eventId }).catch(() => {})
        }

        await clearPendingInvite()
        await setMode('staff')

        setStatus('success')
        setMessage(t('inviteRedeem.accepted'))

        // Jump straight into the scanner for this event.
        navigation.navigate('Main' as any)
        navigation.navigate('TicketScanner' as any, { eventId })
      } catch (e: any) {
        const raw = e?.message ? String(e.message) : t('inviteRedeem.failed')

        // If the invite is already claimed, the notification is stale — clear it.
        if (user?.uid && raw.toLowerCase().includes('already claimed')) {
          deleteStaffInviteNotificationsByToken(user.uid, { eventId, token }).catch(() => {})
          deleteStaffInviteNotificationsByEvent(user.uid, { eventId }).catch(() => {})
        }

        setStatus('error')
        setMessage(getFriendlyError(raw, t))
      }
    }

    redeem()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, eventId, token])

  const goToLogin = () => {
    navigation.navigate('Auth' as any)
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background || '#fff' }}>
      <View style={{ flex: 1, padding: 20, justifyContent: 'center' }}>
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: 20, borderWidth: 1, borderColor: colors.border }}>
          <Text style={{ fontSize: 22, fontWeight: '700', color: colors.text, marginBottom: 16 }}>
            {t('inviteRedeem.title')}
          </Text>

          {status === 'working' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <ActivityIndicator color={colors.primary} />
              <Text style={{ color: colors.textSecondary }}>{message}</Text>
            </View>
          ) : (
            <Text style={{ color: status === 'error' ? colors.error : colors.textSecondary, marginBottom: 16 }}>{message}</Text>
          )}

          {!user && (
            <TouchableOpacity
              onPress={goToLogin}
              style={{ backgroundColor: colors.primary, paddingVertical: 12, borderRadius: radius.md, alignItems: 'center' }}
            >
              <Text style={{ color: colors.white, fontWeight: '700' }}>{t('inviteRedeem.login')}</Text>
            </TouchableOpacity>
          )}

          {status === 'error' && user ? (
            <TouchableOpacity
              onPress={() => {
                // A deep-linked cold start has no back stack, so clearing the
                // message would strand the user. Reset to Main so there's
                // always a forward path home.
                navigation.reset({ index: 0, routes: [{ name: 'Main' as any }] })
              }}
              style={{ marginTop: 10, paddingVertical: 10, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border }}
            >
              <Text style={{ color: colors.text, fontWeight: '600' }}>{t('inviteRedeem.goHome')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  )
}
