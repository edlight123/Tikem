/**
 * Event description formatting: the safe markdown subset (lib/richText and its
 * app copy mobile/lib/richText).
 */
import * as web from '@/lib/richText'
import * as app from '../mobile/lib/richText'
import fs from 'fs'
import path from 'path'

describe.each([
  ['web', web],
  ['app', app],
])('rich text (%s)', (_name, rt) => {
  it('parses bold, italic and bold-italic', () => {
    expect(rt.parseInline('a **b** *c* ***d***')).toEqual([
      { text: 'a ' },
      { text: 'b', bold: true },
      { text: ' ' },
      { text: 'c', italic: true },
      { text: ' ' },
      { text: 'd', bold: true, italic: true },
    ])
  })

  it('leaves lone or spaced stars as text', () => {
    expect(rt.parseInline('2 * 3 = 6')).toEqual([{ text: '2 * 3 = 6' }])
    expect(rt.parseInline('**not closed')).toEqual([{ text: '**not closed' }])
    expect(rt.parseInline('a ** b ** c')).toEqual([{ text: 'a ** b ** c' }])
    expect(rt.parseInline('\\*literal\\*')).toEqual([{ text: '*literal*' }])
  })

  it('never produces HTML: tags stay as plain text', () => {
    const blocks = rt.parseRichText('<script>alert(1)</script> **<b>x</b>**')
    expect(blocks).toEqual([
      {
        type: 'paragraph',
        lines: [[{ text: '<script>alert(1)</script> ' }, { text: '<b>x</b>', bold: true }]],
      },
    ])
  })

  it('groups paragraphs, bullets and numbered lists', () => {
    const blocks = rt.parseRichText('Intro line\nsecond\n\n- one\n* two\n• three\n3. a\n4) b\nEnd')
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'bullets', 'numbers', 'paragraph'])
    expect(blocks[0]).toEqual({ type: 'paragraph', lines: [[{ text: 'Intro line' }], [{ text: 'second' }]] })
    expect((blocks[1] as any).items).toHaveLength(3)
    expect(blocks[2]).toMatchObject({ type: 'numbers', start: 3 })
  })

  it('handles old plain descriptions and junk input', () => {
    expect(rt.parseRichText('Just text.')).toEqual([{ type: 'paragraph', lines: [[{ text: 'Just text.' }]] }])
    expect(rt.parseRichText(undefined)).toEqual([])
    expect(rt.parseRichText(42)).toEqual([])
    expect(rt.hasRichFormatting('Just text.')).toBe(false)
    expect(rt.hasRichFormatting('a **b**')).toBe(true)
    expect(rt.hasRichFormatting('- x')).toBe(true)
  })

  it('strips markers for plain-text contexts', () => {
    expect(rt.stripRichText('**Bold** and *it*\n\n- one\n- two\n1. first\n2. second')).toBe(
      'Bold and it\n\n• one\n• two\n\n1. first\n2. second',
    )
    expect(rt.stripRichText('')).toBe('')
    expect(rt.stripRichText('Price: 2 * 3')).toBe('Price: 2 * 3')
  })

  it('wraps and unwraps a selection', () => {
    expect(rt.toggleWrap('hello world', { start: 6, end: 11 }, '**')).toEqual({
      text: 'hello **world**',
      selection: { start: 8, end: 13 },
    })
    expect(rt.toggleWrap('hello **world**', { start: 8, end: 13 }, '**')).toEqual({
      text: 'hello world',
      selection: { start: 6, end: 11 },
    })
    expect(rt.toggleWrap('hello **world**', { start: 6, end: 15 }, '**').text).toBe('hello world')
    // Trailing space stays outside.
    expect(rt.toggleWrap('a word b', { start: 2, end: 7 }, '*').text).toBe('a *word* b')
    // Nothing selected: an empty pair with the cursor inside.
    expect(rt.toggleWrap('ab', { start: 1, end: 1 }, '**')).toEqual({ text: 'a****b', selection: { start: 3, end: 3 } })
    // Italic inside bold.
    expect(rt.toggleWrap('**word**', { start: 2, end: 6 }, '*').text).toBe('***word***')
    expect(rt.toggleWrap('***word***', { start: 3, end: 7 }, '*').text).toBe('**word**')
  })

  it('toggles bullets and numbers on the touched lines', () => {
    expect(rt.toggleList('one\ntwo', { start: 0, end: 7 }, 'bullet').text).toBe('- one\n- two')
    expect(rt.toggleList('- one\n- two', { start: 0, end: 11 }, 'bullet').text).toBe('one\ntwo')
    expect(rt.toggleList('- one\n- two', { start: 0, end: 11 }, 'number').text).toBe('1. one\n2. two')
    const r = rt.toggleList('a\nline', { start: 4, end: 4 }, 'bullet')
    expect(r.text).toBe('a\n- line')
    expect(r.selection).toEqual({ start: 6, end: 6 })
    expect(rt.toggleList('', { start: 0, end: 0 }, 'bullet')).toEqual({ text: '- ', selection: { start: 2, end: 2 } })
  })

  it('continues and ends lists on Enter', () => {
    expect(rt.continueList('- one', '- one\n')).toEqual({ text: '- one\n- ', selection: { start: 8, end: 8 } })
    expect(rt.continueList('1. one', '1. one\n')?.text).toBe('1. one\n2. ')
    expect(rt.continueList('- one\n- ', '- one\n- \n')).toEqual({ text: '- one\n', selection: { start: 6, end: 6 } })
    expect(rt.continueList('plain', 'plain\n')).toBeNull()
    expect(rt.continueList('- one', '- onex')).toBeNull()
  })
})

it('keeps the web and app copies identical apart from the header', () => {
  const read = (p: string) =>
    fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/^\/\*\*[\s\S]*?\*\//, '')
  expect(read('mobile/lib/richText.ts')).toBe(read('lib/richText.ts'))
})
