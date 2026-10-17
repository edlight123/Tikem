import React from 'react'

/**
 * Groups related form fields under a titled section with optional description.
 * Use inside edit forms so every section has a consistent heading + divider.
 */
export function FormSection({
  title,
  description,
  children,
  className = '',
}: {
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`space-y-5 ${className}`}>
      <div>
        <h3 className="font-semibold text-white">{title}</h3>
        {description && <p className="mt-0.5 text-sm text-white/50">{description}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  )
}

/**
 * Labeled form field row — label above, optional hint below.
 * The `required` star is screen-reader annotated via aria-required on the child input.
 */
export function FormField({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className = '',
}: {
  label: string
  htmlFor?: string
  hint?: string
  error?: string
  required?: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <label
        htmlFor={htmlFor}
        className="block text-sm font-medium text-white/80"
      >
        {label}
        {required && (
          <span aria-hidden="true" className="ml-0.5 text-white/45">
            *
          </span>
        )}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-red-400" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-white/40">{hint}</p>
      ) : null}
    </div>
  )
}
