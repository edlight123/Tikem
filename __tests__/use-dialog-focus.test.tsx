/**
 * lib/a11y/useDialogFocus: focus moves into an open dialog, Tab and Shift+Tab
 * wrap inside it, Escape closes it, and focus returns to the opener. Also the
 * shared BottomSheet wires it up (role="dialog", Escape closes), and the skip
 * link finds the page's main content.
 */
import React, { useRef, useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { focusableIn, useDialogFocus } from '@/lib/a11y/useDialogFocus'
import BottomSheet from '@/components/ui/BottomSheet'
import { findMainContent } from '@/components/SkipLink'

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue || _k, i18n: { language: 'en' } }),
}))

const flush = () => act(() => new Promise((r) => setTimeout(r, 5)))

function Harness({ initial = false }: { initial?: boolean }) {
  const [open, setOpen] = useState(initial)
  const ref = useRef<HTMLDivElement>(null)
  useDialogFocus(ref, open, { onEscape: () => setOpen(false) })
  return (
    <div>
      <button onClick={() => setOpen(true)}>open</button>
      {open && (
        <div ref={ref} role="dialog">
          <button>first</button>
          <button disabled>disabled</button>
          <input aria-label="middle" />
          <button>last</button>
        </div>
      )}
    </div>
  )
}

describe('useDialogFocus', () => {
  it('moves focus in, wraps Tab both ways, closes on Escape and restores focus', async () => {
    render(<Harness />)
    const opener = screen.getByText('open')
    opener.focus()
    fireEvent.click(opener)
    await flush()
    expect(document.activeElement).toBe(screen.getByText('first'))

    screen.getByText('last').focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByText('first'))

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(screen.getByText('last'))

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    await flush()
    expect(document.activeElement).toBe(opener)
  })

  it('pulls focus back in when it has escaped the dialog', async () => {
    render(<Harness />)
    const opener = screen.getByText('open')
    fireEvent.click(opener)
    await flush()
    opener.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByText('first'))
  })

  it('lists only reachable controls', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <button>a</button>
      <button disabled>b</button>
      <a href="#">c</a>
      <div tabindex="-1">d</div>
      <div aria-hidden="true"><button>e</button></div>
      <input type="hidden" />
      <span tabindex="0">f</span>`
    document.body.appendChild(root)
    expect(focusableIn(root).map((el) => el.textContent)).toEqual(['a', 'c', 'f'])
    root.remove()
  })
})

describe('BottomSheet keyboard behaviour', () => {
  it('is a labelled modal dialog that closes on Escape', async () => {
    const onClose = jest.fn()
    render(
      <BottomSheet isOpen onClose={onClose} title="tickets">
        <button>buy</button>
      </BottomSheet>
    )
    await flush()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName('tickets')
    expect(dialog.contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('skip link target', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('prefers <main>', () => {
    document.body.innerHTML = '<nav></nav><div id="x"></div><main id="m"></main>'
    expect(findMainContent()?.id).toBe('m')
  })

  it('falls back to the element after the navbar', () => {
    document.body.innerHTML = '<div><div class="wrap"><nav></nav></div><section id="after"></section></div>'
    expect(findMainContent()?.id).toBe('after')
  })
})
