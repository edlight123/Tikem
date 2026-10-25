'use client'

import { useEffect, useState } from 'react'
import { ConsoleButton, ConsoleInput, ConsolePanel, ConsoleState } from '@/components/admin/console'
import type { PrefundingLetterSettings } from '@/lib/payouts/prefunding-config'

/**
 * The letterhead + Digicel fields the prefunding letter is built from, saved to
 * config/payouts.prefundingPlan.digicel via PUT /api/admin/moncash-funding/settings
 * (validated server-side; nothing is saved unless every field is valid).
 */

type FormState = Record<keyof PrefundingLetterSettings, string>

const LIST_FIELDS = ['companyIds', 'to', 'cc'] as const

function toForm(s: PrefundingLetterSettings): FormState {
  return {
    ...s,
    companyIds: s.companyIds.join(', '),
    to: s.to.join(', '),
    cc: s.cc.join(', '),
  } as FormState
}

function fromForm(f: FormState): Record<string, unknown> {
  const out: Record<string, unknown> = { ...f }
  for (const k of LIST_FIELDS) out[k] = f[k].split(/[,;\n]/).map((v) => v.trim()).filter(Boolean)
  return out
}

const GROUPS: Array<{ title: string; fields: Array<{ key: keyof PrefundingLetterSettings; label: string; hint?: string; wide?: boolean }> }> = [
  {
    title: 'Letterhead',
    fields: [
      { key: 'companyName', label: 'Company name' },
      { key: 'companyIds', label: 'Patente / identification numbers', hint: 'Comma-separated. Company numbers only, never a national ID.' },
      { key: 'companyAddress', label: 'Registered address', wide: true },
      { key: 'logoUrl', label: 'Logo URL (optional)', hint: 'https PNG or JPEG. Empty = text letterhead.', wide: true },
    ],
  },
  {
    title: 'Accounts',
    fields: [
      { key: 'merchantAccountNumber', label: 'MonCash merchant account No.', hint: 'Unknown? Leave empty: the letter prints a blank line.' },
      { key: 'prefundedAccountNumber', label: 'Prefunded account No.' },
    ],
  },
  {
    title: 'Signatory',
    fields: [
      { key: 'signatoryName', label: 'Name' },
      { key: 'signatoryTitle', label: 'Title', hint: 'Printed under the name.' },
    ],
  },
  {
    title: 'Email',
    fields: [
      { key: 'fromEmail', label: 'From', hint: 'The address Digicel recognises.' },
      { key: 'to', label: 'To' },
      { key: 'cc', label: 'Cc', hint: 'Comma-separated.', wide: true },
    ],
  },
]

export function LetterSettingsForm({
  initial,
  defaults,
  onSaved,
}: {
  initial: PrefundingLetterSettings
  defaults: PrefundingLetterSettings
  onSaved: () => void
}) {
  const [form, setForm] = useState<FormState>(() => toForm(initial))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)

  useEffect(() => {
    setForm(toForm(initial))
  }, [initial])

  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(initial))

  async function save() {
    setSaving(true)
    setMessage(null)
    setErrors({})
    try {
      const res = await fetch('/api/admin/moncash-funding/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fromForm(form)),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.ok) {
        if (json?.errors) setErrors(json.errors)
        throw new Error(json?.error || `HTTP ${res.status}`)
      }
      setMessage({ tone: 'good', text: json.changed?.length ? `Saved (${json.changed.length} changed).` : 'Saved, nothing changed.' })
      onSaved()
    } catch (e: any) {
      setMessage({ tone: 'bad', text: String(e?.message || e) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <ConsolePanel className="px-5 py-4">
      {!initial.merchantAccountNumber && (
        <p className="mb-4 text-[12px] text-console-amber">
          The MonCash merchant account number is not set. Merchant-transfer letters print a blank line in its place.
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        {GROUPS.map((g) => (
          <fieldset key={g.title}>
            <legend className="label-mono mb-2 text-[10px] uppercase tracking-[0.18em] text-console-faint">{g.title}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {g.fields.map((f) => (
                <label key={f.key} className={`block text-[12px] text-console-mut ${f.wide ? 'sm:col-span-2' : ''}`}>
                  {f.label}
                  <ConsoleInput
                    className="mt-1"
                    value={form[f.key]}
                    onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                    aria-invalid={!!errors[f.key]}
                    placeholder={f.key === 'merchantAccountNumber' ? 'Not set' : undefined}
                  />
                  {errors[f.key] ? (
                    <span className="mt-1 block text-[11.5px] text-console-red">{errors[f.key]}</span>
                  ) : f.hint ? (
                    <span className="mt-1 block text-[11.5px] text-console-faint">{f.hint}</span>
                  ) : null}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <ConsoleButton variant="primary" onClick={save} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save settings'}
        </ConsoleButton>
        <ConsoleButton
          onClick={() => setForm(toForm({ ...defaults, merchantAccountNumber: form.merchantAccountNumber } as PrefundingLetterSettings))}
          disabled={saving}
        >
          Restore contract defaults
        </ConsoleButton>
        {dirty && !saving && <span className="text-[12px] text-console-faint">Unsaved changes</span>}
        {message && <ConsoleState tone={message.tone}>{message.text}</ConsoleState>}
      </div>
    </ConsolePanel>
  )
}
