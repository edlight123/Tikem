/**
 * @jest-environment node
 *
 * Expo push (lib/push/expo-messages + lib/push/expo): Android message pushes
 * go out at high priority, failures Expo only reports in the RECEIPTS are
 * read and pruned, and no log line carries a whole push token.
 */
import {
  buildExpoMessages,
  explainExpoPushError,
  failureLog,
  readExpoReceipts,
  readExpoTickets,
  redactToken,
  scrubForLog,
  scrubTokens,
} from '@/lib/push/expo-messages'

const A = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]'
const B = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]'

describe('buildExpoMessages', () => {
  it('high priority, default sound, no channelId, url + userId in data; non-Expo tokens dropped', () => {
    const m = buildExpoMessages({ tokens: [A, 'fcm:xyz'], title: 'New message', body: 'Hi', url: '/messages/1', data: { type: 'message' }, userId: 'u1' })
    expect(m).toEqual([
      { to: A, title: 'New message', body: 'Hi', sound: 'default', priority: 'high', data: { type: 'message', url: '/messages/1', userId: 'u1' } },
    ])
    expect((m[0] as any).channelId).toBeUndefined()
  })
})

describe('reading Expo tickets and receipts', () => {
  it('tickets: accepted ones are kept for the receipt check; DeviceNotRegistered is pruned', () => {
    const sent = buildExpoMessages({ tokens: [A, B], title: 't', body: 'b', userId: 'u' })
    const out = readExpoTickets(sent, [
      { status: 'ok', id: 'r1' },
      { status: 'error', message: `"${B}" is not a registered push notification recipient`, details: { error: 'DeviceNotRegistered' } },
    ])
    expect(out.receipts).toEqual([{ id: 'r1', token: A }])
    expect(out.prune).toEqual([B])
    expect(out.errors).toHaveLength(1)
  })

  it('receipts: credential failures are surfaced, dead devices pruned', () => {
    const r = readExpoReceipts(
      {
        r1: { status: 'error', message: 'creds', details: { error: 'InvalidCredentials' } },
        r2: { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
        r3: { status: 'ok' },
      },
      [
        { id: 'r1', token: A },
        { id: 'r2', token: B },
        { id: 'r3', token: A },
      ]
    )
    expect(r.errors.map((e) => e.code)).toEqual(['InvalidCredentials', 'DeviceNotRegistered'])
    expect(r.prune).toEqual([B])
    expect(explainExpoPushError('InvalidCredentials')).toMatch(/FCM V1/)
    expect(explainExpoPushError('MismatchSenderId')).toMatch(/google-services/)
  })
})

describe('no full token in a log line', () => {
  it('redacts the token itself and any token quoted in Expo text or bodies', () => {
    expect(redactToken(A)).toBe('ExponentPushToken[aaaaaa…]')
    expect(scrubTokens(`"${A}" and ExpoPushToken[cccccccccccc] failed`)).toBe('"ExponentPushToken[aaaaaa…]" and ExponentPushToken[cccccc…] failed')
    const body = scrubForLog({ errors: [{ code: 'PUSH_TOO_MANY_EXPERIENCE_IDS', details: { '@a/x': [A], '@b/y': [B] } }] })
    expect(JSON.stringify(body)).not.toContain('aaaaaaaaaaaa')
    expect(JSON.stringify(body)).not.toContain('bbbbbbbbbbbb')
    const line = failureLog('u1', { token: A, code: 'DeviceNotRegistered', message: `"${A}" is not registered` })
    expect(JSON.stringify(line)).not.toContain('aaaaaaaaaaaa')
  })
})

// ---- sendExpoPushNotificationToUser against a mocked Expo and Firestore ----

const userDocs: Record<string, any> = {}
jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => ({
      doc: (id: string) => ({
        get: async () => ({ exists: !!userDocs[id], data: () => userDocs[id] }),
        set: async (v: any) => {
          // FieldValue.arrayRemove sentinel: record the removal.
          ;(userDocs[id].__removed ||= []).push(v.expo_push_tokens)
        },
      }),
    }),
  },
}))
let afterCallbacks: Array<() => Promise<void>> = []
jest.mock('next/server', () => ({ after: (fn: () => Promise<void>) => afterCallbacks.push(fn) }))

import { sendExpoPushNotificationToUser } from '@/lib/push/expo'

describe('sendExpoPushNotificationToUser', () => {
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
    jest.useRealTimers()
  })

  it('sends high priority, then reads the receipts once and logs without the token', async () => {
    jest.useFakeTimers()
    afterCallbacks = []
    userDocs.u1 = { expo_push_tokens: [A, B] }
    const calls: Array<{ url: string; body: any }> = []
    global.fetch = (async (url: string, init: any) => {
      calls.push({ url, body: JSON.parse(init.body) })
      if (url.endsWith('/push/send')) {
        return { ok: true, status: 200, json: async () => ({ data: [{ status: 'ok', id: 'r1' }, { status: 'ok', id: 'r2' }] }) }
      }
      return { ok: true, status: 200, json: async () => ({ data: { r1: { status: 'ok' }, r2: { status: 'error', message: `"${B}" gone`, details: { error: 'DeviceNotRegistered' } } } }) }
    }) as any
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {})

    await sendExpoPushNotificationToUser('u1', 'New message', 'Hi', '/messages/1')
    expect(calls[0].body.every((m: any) => m.priority === 'high')).toBe(true)
    expect(afterCallbacks).toHaveLength(1)

    const run = afterCallbacks[0]()
    await jest.advanceTimersByTimeAsync(5000)
    await run
    expect(calls[1]).toEqual({ url: 'https://exp.host/--/api/v2/push/getReceipts', body: { ids: ['r1', 'r2'] } })
    expect(userDocs.u1.__removed).toHaveLength(1)
    const logged = JSON.stringify(errors.mock.calls)
    expect(logged).toContain('DeviceNotRegistered')
    expect(logged).not.toContain('bbbbbbbbbbbb')
    errors.mockRestore()
  })
})
