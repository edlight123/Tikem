/**
 * Editing an event's flyer on Android (a Tikra tester, 2026-11-25): the save must
 * upload the new flyer and write it before saying "Saved" and leaving; a
 * failed upload stops the save instead of writing an event with no flyer; a
 * second tap never starts a second save; and a downloaded app update never
 * restarts the app while the photo picker has it in the background.
 */
import {
  createSingleFlight,
  PosterUploadError,
  resolvePosterForUpdate,
  saveThenLeave,
} from '../mobile/lib/eventSave'
import * as fs from 'fs'
import * as path from 'path'
import en from '../mobile/locales/en'
import fr from '../mobile/locales/fr'
import ht from '../mobile/locales/ht'

const HOSTED = 'https://firebasestorage.googleapis.com/v0/b/x/o/event-images%2Fu_1.jpg?alt=media&token=t'

describe('resolvePosterForUpdate', () => {
  it('keeps a hosted flyer without uploading', async () => {
    const upload = jest.fn()
    await expect(resolvePosterForUpdate(HOSTED, upload)).resolves.toBe(HOSTED)
    expect(upload).not.toHaveBeenCalled()
  })

  it('keeps an empty flyer empty', async () => {
    const upload = jest.fn()
    await expect(resolvePosterForUpdate('', upload)).resolves.toBe('')
    await expect(resolvePosterForUpdate(null, upload)).resolves.toBe('')
    expect(upload).not.toHaveBeenCalled()
  })

  it('uploads a picked (file://, content://) flyer and returns the new URL', async () => {
    const upload = jest.fn(async () => HOSTED)
    await expect(resolvePosterForUpdate('file:///cache/crop-1.jpg', upload)).resolves.toBe(HOSTED)
    await expect(resolvePosterForUpdate('content://media/external/images/1', upload)).resolves.toBe(HOSTED)
    expect(upload).toHaveBeenCalledTimes(2)
  })

  it('fails the save when the upload fails (never saves without the flyer)', async () => {
    const upload = jest.fn(async () => {
      throw new Error('storage/unknown')
    })
    const err = await resolvePosterForUpdate('file:///cache/crop-1.jpg', upload).catch((e) => e)
    expect(err).toBeInstanceOf(PosterUploadError)
    expect(err.code).toBe('poster-upload-failed')
  })

  it('fails when the upload hands back no URL', async () => {
    const err = await resolvePosterForUpdate('file:///a.jpg', async () => '').catch((e) => e)
    expect(err).toBeInstanceOf(PosterUploadError)
  })

  it('fails when the upload stalls past the timeout', async () => {
    jest.useFakeTimers()
    try {
      const p = resolvePosterForUpdate('file:///a.jpg', () => new Promise<string>(() => {}), 1000)
      const caught = p.catch((e) => e)
      jest.advanceTimersByTime(1001)
      expect(await caught).toBeInstanceOf(PosterUploadError)
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('saveThenLeave', () => {
  it('reports success only after the save has finished', async () => {
    const order: string[] = []
    let finish!: () => void
    const save = () =>
      new Promise<void>((resolve) => {
        finish = () => {
          order.push('written')
          resolve()
        }
      })
    const run = saveThenLeave({ save, onSaved: () => order.push('saved+leave'), onFailed: () => order.push('failed') })
    await Promise.resolve()
    expect(order).toEqual([])
    finish()
    await expect(run).resolves.toBe('saved')
    expect(order).toEqual(['written', 'saved+leave'])
  })

  it('on failure reports it and never leaves', async () => {
    const onSaved = jest.fn()
    const onFailed = jest.fn()
    const out = await saveThenLeave({
      save: async () => {
        throw new PosterUploadError()
      },
      onSaved,
      onFailed,
    })
    expect(out).toBe('failed')
    expect(onSaved).not.toHaveBeenCalled()
    expect(onFailed.mock.calls[0][0].code).toBe('poster-upload-failed')
  })

  it('gives up on a save that never answers, with a timeout code the screen explains', async () => {
    jest.useFakeTimers()
    try {
      const onFailed = jest.fn()
      const run = saveThenLeave({ save: () => new Promise(() => {}), onSaved: jest.fn(), onFailed, timeoutMs: 500 })
      jest.advanceTimersByTime(501)
      await expect(run).resolves.toBe('failed')
      expect(onFailed.mock.calls[0][0].code).toBe('deadline-exceeded')
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('createSingleFlight', () => {
  it('ignores a second tap while the first save runs, then allows the next one', async () => {
    const flight = createSingleFlight()
    let release!: () => void
    const save = jest.fn(() => new Promise<void>((r) => (release = r)))
    const first = flight.run(save)
    expect(flight.busy).toBe(true)
    await expect(flight.run(save)).resolves.toBeUndefined()
    expect(save).toHaveBeenCalledTimes(1)
    release()
    await first
    expect(flight.busy).toBe(false)
    const again = flight.run(async () => 'ok')
    await expect(again).resolves.toBe('ok')
  })

  it('frees itself after a failed save', async () => {
    const flight = createSingleFlight()
    await expect(
      flight.run(async () => {
        throw new Error('x')
      }),
    ).rejects.toThrow('x')
    expect(flight.busy).toBe(false)
  })
})

describe('OTA reload policy (mobile/lib/otaUpdates)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../mobile/lib/otaUpdates.ts'), 'utf8')
  it('never reloads from the background on Android (the green screen)', () => {
    expect(src).toMatch(/next === 'background' && pendingReload && holds === 0 && Platform\.OS !== 'android'/)
  })
  it('reloads behind the splash only when the app is on screen', () => {
    expect(src).toMatch(/AppState\.currentState === 'active'\)\s*\{\s*await Updates\.reloadAsync\(\)/)
  })
  it('lets the event editor hold reloads', () => {
    expect(src).toMatch(/export function holdUpdateReload/)
    expect(src).toMatch(/export function useHoldUpdateReload/)
  })
})

describe('copy', () => {
  it('has the poster upload and timeout messages in EN, FR and HT', () => {
    for (const d of [en, fr, ht] as any[]) {
      expect(d.organizerCreateEventFlow.posterUploadFailed).toBeTruthy()
      expect(d.organizerCreateEventFlow.saveTimedOut).toBeTruthy()
    }
  })
})
