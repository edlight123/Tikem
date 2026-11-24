import { Fragment, type ReactNode } from 'react'
import { parseRichText, type RichSpan } from '@/lib/richText'

/**
 * An event description with its light formatting (**bold**, *italic*, "- "
 * bullets, "1. " numbers; lib/richText). Everything renders as React text
 * nodes, never HTML, so organizer text cannot inject markup.
 */
function Spans({ spans }: { spans: RichSpan[] }) {
  return (
    <>
      {spans.map((s, i) => {
        let node: ReactNode = s.text
        if (s.italic) node = <em>{node}</em>
        if (s.bold) node = <strong className="font-semibold">{node}</strong>
        return <Fragment key={i}>{node}</Fragment>
      })}
    </>
  )
}

export default function RichText({ text, className }: { text: unknown; className?: string }) {
  const blocks = parseRichText(text)
  if (!blocks.length) return null
  return (
    <div className={className} dir="auto">
      {blocks.map((b, i) => {
        const gap = i === 0 ? '' : 'mt-3'
        if (b.type === 'paragraph') {
          return (
            <p key={i} className={gap}>
              {b.lines.map((line, j) => (
                <Fragment key={j}>
                  {j > 0 && <br />}
                  <Spans spans={line} />
                </Fragment>
              ))}
            </p>
          )
        }
        if (b.type === 'bullets') {
          return (
            <ul key={i} className={`${gap} list-disc space-y-1 ps-5`}>
              {b.items.map((it, j) => (
                <li key={j}>
                  <Spans spans={it} />
                </li>
              ))}
            </ul>
          )
        }
        return (
          <ol key={i} start={b.start} className={`${gap} list-decimal space-y-1 ps-5`}>
            {b.items.map((it, j) => (
              <li key={j}>
                <Spans spans={it} />
              </li>
            ))}
          </ol>
        )
      })}
    </div>
  )
}
