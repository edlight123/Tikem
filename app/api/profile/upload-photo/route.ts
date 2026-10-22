import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { FieldValue } from 'firebase-admin/firestore'
import { adminDb, adminStorage } from '@/lib/firebase/admin'
import { sniffRasterImage } from '@/lib/security/sniffImage'

/**
 * The signed-in reader's own avatar. Mirrors the organization-logo upload, but
 * writes `users/{uid}.photo_url` — the field the mobile app's Edit Profile
 * writes and every avatar (Who's going, connections) reads.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'File size must be less than 5MB' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())

    // The bytes decide, not the declared type: only JPEG/PNG/WebP/GIF pass (no
    // SVG, which can carry script on a public URL).
    const sniffed = sniffRasterImage(buffer)
    if (!sniffed) {
      return NextResponse.json({ error: 'File must be a JPEG, PNG, WebP or GIF image' }, { status: 400 })
    }

    const fileName = `profile-images/${user.id}/avatar_${Date.now()}.${sniffed.ext}`
    const bucket = adminStorage.bucket()
    const fileRef = bucket.file(fileName)
    await fileRef.save(buffer, { metadata: { contentType: sniffed.mime } })
    await fileRef.makePublic()

    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`

    await adminDb.collection('users').doc(user.id).set(
      { photo_url: publicUrl, updated_at: FieldValue.serverTimestamp() },
      { merge: true }
    )

    return NextResponse.json({ success: true, photo_url: publicUrl })
  } catch (error) {
    console.error('Error uploading profile photo:', error)
    return NextResponse.json({ error: 'Failed to upload photo' }, { status: 500 })
  }
}
