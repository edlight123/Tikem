/**
 * DocumentUploadCard Component
 * Drag/drop + camera upload with preview
 */

'use client'

import { useTranslation } from 'react-i18next'

import { useEffect, useState, useRef, useCallback } from 'react'
import Image from 'next/image'
import { getDocumentDownloadURL, VERIFICATION_IMAGE_ACCEPT } from '@/lib/verification'

interface Props {
  title: string
  description: string
  existingFileUrl?: string
  onUpload: (file: File) => Promise<void>
  onRemove?: () => Promise<void>
  accept?: string
  maxSizeMB?: number
  required?: boolean
  disabled?: boolean
}

export default function DocumentUploadCard({
  title,
  description,
  existingFileUrl,
  onUpload,
  onRemove,
  accept = VERIFICATION_IMAGE_ACCEPT,
  maxSizeMB = 10,
  required = false,
  disabled = false
}: Props) {
  const { t } = useTranslation('organizer')

  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string>('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false

    const hydratePreview = async () => {
      if (!existingFileUrl) {
        if (!cancelled) setPreviewUrl(undefined)
        return
      }

      // If this is already a URL, use it directly.
      if (/^https?:\/\//i.test(existingFileUrl) || existingFileUrl.startsWith('data:')) {
        if (!cancelled) setPreviewUrl(existingFileUrl)
        return
      }

      // Otherwise treat it as a Firebase Storage path and resolve to a download URL.
      try {
        const url = await getDocumentDownloadURL(existingFileUrl)
        if (!cancelled) setPreviewUrl(url)
      } catch {
        // If we can't resolve it (rules, missing file, etc.), avoid broken <Image />.
        if (!cancelled) setPreviewUrl(undefined)
      }
    }

    void hydratePreview()
    return () => {
      cancelled = true
    }
  }, [existingFileUrl])

  const validateFile = (file: File): string | null => {
    // Check file type
    const validTypes = accept.split(',').map(t => t.trim())
    const isValidType = validTypes.some(type => {
      if (type === 'image/*') return file.type.startsWith('image/')
      if (type === 'application/pdf') return file.type === 'application/pdf'
      return file.type === type
    })

    if (!isValidType) {
      return 'Invalid file type. Please upload an image file.'
    }

    // Check file size
    const maxBytes = maxSizeMB * 1024 * 1024
    if (file.size > maxBytes) {
      return `File too large. Maximum size is ${maxSizeMB}MB.`
    }

    return null
  }

  const handleFileUpload = async (file: File) => {
    setError('')
    
    const validationError = validateFile(file)
    if (validationError) {
      setError(validationError)
      return
    }

    try {
      setIsUploading(true)
      
      // Create preview
      if (file.type.startsWith('image/')) {
        const reader = new FileReader()
        reader.onloadend = () => {
          setPreviewUrl(reader.result as string)
        }
        reader.readAsDataURL(file)
      }

      await onUpload(file)
    } catch (err: any) {
      setError(err.message || 'Upload failed. Please try again.')
      setPreviewUrl(undefined)
    } finally {
      setIsUploading(false)
    }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    if (disabled) return

    const files = e.dataTransfer.files
    if (files.length > 0) {
      handleFileUpload(files[0])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (!disabled) {
      setIsDragging(true)
    }
  }, [disabled])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files && files.length > 0) {
      handleFileUpload(files[0])
    }
  }

  const handleRemove = async () => {
    if (onRemove) {
      try {
        setIsUploading(true)
        await onRemove()
        setPreviewUrl(undefined)
      } catch (err: any) {
        setError(err.message || 'Failed to remove file')
      } finally {
        setIsUploading(false)
      }
    } else {
      setPreviewUrl(undefined)
    }
  }

  const openFileDialog = () => {
    fileInputRef.current?.click()
  }

  const openCameraDialog = () => {
    cameraInputRef.current?.click()
  }

  return (
    <div className="bg-white/[0.06] rounded-lg p-4 md:p-6">
      {/* Header */}
      <div className="mb-4">
        <h3 className="font-semibold text-white text-sm md:text-base mb-1">
          {title}
          {required && <span className="text-red-500 ml-1">*</span>}
        </h3>
        <p className="text-xs md:text-sm text-white/60">
          {description}
        </p>
      </div>

      {/* Preview or Upload Area */}
      {previewUrl ? (
        <div className="space-y-3">
          {/* Image Preview */}
          <div className="relative aspect-video bg-white/[0.10] rounded-lg overflow-hidden">
            <Image
              src={previewUrl}
              alt={title}
              fill
              className="object-contain"
            />
          </div>

          {/* Actions */}
          {!disabled && (
            <div className="flex gap-2">
              <button
                onClick={openFileDialog}
                disabled={isUploading}
                className="flex-1 px-4 py-2 text-sm font-medium text-brand-300 hover:bg-brand-500/15 rounded-lg transition-colors disabled:opacity-50"
              >
                {t('document_upload.replace')}
              </button>
              <button
                onClick={handleRemove}
                disabled={isUploading}
                className="flex-1 px-4 py-2 text-sm font-medium text-red-300 hover:bg-red-500/15 rounded-lg transition-colors disabled:opacity-50"
              >
                {t('actions.remove')}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`border-2 border-dashed rounded-lg p-6 md:p-8 text-center transition-all ${
            isDragging
              ? 'border-brand-400 bg-brand-500/15'
              : 'border-white/15 bg-white/[0.03] hover:bg-white/[0.12]'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          onClick={disabled ? undefined : openFileDialog}
        >
          {isUploading ? (
            <div className="flex flex-col items-center gap-3">
              <div className="w-12 h-12 border-4 border-brand-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-white/60">{t('document_upload.uploading')}</p>
            </div>
          ) : (
            <>
              {/* Upload Icon */}
              <div className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-brand-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </div>

              <p className="text-sm md:text-base font-medium text-white mb-1">
                {isDragging ? 'Drop file here' : 'Drag & drop or click to upload'}
              </p>
              <p className="text-xs text-white/50 mb-4">
                Maximum file size: {maxSizeMB}MB
              </p>

              {/* Mobile: Camera button */}
              <div className="flex flex-col sm:flex-row gap-2 justify-center">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    openFileDialog()
                  }}
                  disabled={disabled}
                  className="px-4 py-2 text-sm font-medium text-brand-300 bg-white/[0.08] rounded-lg hover:bg-white/[0.14] transition-colors disabled:opacity-50"
                >
                  {t('document_upload.choose_file')}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    openCameraDialog()
                  }}
                  disabled={disabled}
                  className="px-4 py-2 text-sm font-medium text-white bg-brand-700 rounded-lg hover:bg-brand-800 transition-colors disabled:opacity-50 sm:hidden"
                >
                  📷 Take Photo
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="mt-3 p-3 bg-red-500/10 rounded-lg">
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}

      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        onChange={handleFileSelect}
        className="hidden"
        disabled={disabled}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileSelect}
        className="hidden"
        disabled={disabled}
      />
    </div>
  )
}
