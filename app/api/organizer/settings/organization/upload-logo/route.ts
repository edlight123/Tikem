import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { adminStorage } from '@/lib/firebase/admin';
import { sniffRasterImage } from '@/lib/security/sniffImage';
import { writeOrgBrandAdmin } from '@/lib/firestore/org-brand-server';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Same gate as the organization details PUT next door. Needed now that the
    // write below can create organizers/{uid} rather than only update it.
    if (!['organizer', 'admin', 'super_admin'].includes(String(user.role))) {
      return NextResponse.json(
        { error: 'Only organizers can update organization details' },
        { status: 403 }
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    if (!file.type.startsWith('image/')) {
      return NextResponse.json(
        { error: 'File must be an image' },
        { status: 400 }
      );
    }

    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'File size must be less than 5MB' },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();

    const buffer = Buffer.from(bytes);


    // The declared type and file name are the uploader's to choose. The bytes

    // decide: only JPEG/PNG/WebP/GIF pass (no SVG, which can carry script on a

    // public URL), and the stored extension and content type come from them.

    const sniffed = sniffRasterImage(buffer);

    if (!sniffed) {

      return NextResponse.json(

        { error: 'File must be a JPEG, PNG, WebP or GIF image' },

        { status: 400 }

      );

    }

    const fileExtension = sniffed.ext;
    const fileName = `organization-logos/${user.id}/${Date.now()}.${fileExtension}`;

    const bucket = adminStorage.bucket();
    const fileRef = bucket.file(fileName);

    await fileRef.save(buffer, {
      metadata: {
        contentType: sniffed.mime,
      },
    });

    await fileRef.makePublic();

    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

    // Canonical public_profiles/{uid}, plus the users/{uid} copy the app reads
    // and organizers/{uid} for the settings page (lib/profile/org-brand.ts).
    // merge, not update: an organizer who set up on mobile may have no
    // organizers/{uid} doc yet, and update() throws on a missing doc.
    await writeOrgBrandAdmin(user.id, { organization_logo: publicUrl }, { organizers: true });

    return NextResponse.json({ 
      success: true,
      logo_url: publicUrl 
    });
  } catch (error) {
    console.error('Error uploading logo:', error);
    return NextResponse.json(
      { error: 'Failed to upload logo' },
      { status: 500 }
    );
  }
}
