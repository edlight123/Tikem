'use client'

import Link from 'next/link'

interface BreadcrumbItem {
  label: string
  href?: string
}

interface AdminBreadcrumbsProps {
  items: BreadcrumbItem[]
}

export function AdminBreadcrumbs({ items }: AdminBreadcrumbsProps) {
  return (
    <nav className="label-mono mb-6 flex items-center gap-1.5 text-eyebrow text-console-faint">
      <Link href="/admin" className="transition-colors hover:text-console-mut">
        Admin
      </Link>

      {items.map((item, index) => (
        <div key={index} className="flex items-center gap-1.5">
          <span aria-hidden="true">/</span>
          {item.href && index < items.length - 1 ? (
            <Link href={item.href} className="transition-colors hover:text-console-mut">
              {item.label}
            </Link>
          ) : (
            <span className="text-console-mut">{item.label}</span>
          )}
        </div>
      ))}
    </nav>
  )
}
