import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { adminDb } from '@/lib/firebase/admin';
import { requireOrg } from '@/lib/organizer/context';
import { withOrganizerNotificationDefaults } from '@/lib/organizer/notificationPreferences';

/**
 * The acting org's preferences (lib/organizer/context.ts), with the same defaults the web
 * settings page applies. The mobile app reads them here because client rules
 * do not expose the notificationPreferences subcollection.
 */
export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const org = await requireOrg('view');
    if (!org.ok) return org.response;

    const prefsDoc = await adminDb
      .collection('organizers')
      .doc(org.value.orgId)
      .collection('notificationPreferences')
      .doc('main')
      .get();

    return NextResponse.json({
      preferences: withOrganizerNotificationDefaults(prefsDoc.exists ? prefsDoc.data() : null),
    });
  } catch (error) {
    console.error('Error reading notification preferences:', error);
    return NextResponse.json(
      { error: 'Failed to read notification preferences' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Org settings: the owner or a team admin.
    const org = await requireOrg('manage_settings');
    if (!org.ok) return org.response;

    const body = await request.json();

    // Update notification preferences in Firestore
    await adminDb
      .collection('organizers')
      .doc(org.value.orgId)
      .collection('notificationPreferences')
      .doc('main')
      .set({
        ...body,
        updated_at: new Date().toISOString(),
      }, { merge: true });

    return NextResponse.json({ 
      success: true,
      message: 'Notification preferences updated successfully' 
    });
  } catch (error) {
    console.error('Error updating notifications:', error);
    return NextResponse.json(
      { error: 'Failed to update notification preferences' },
      { status: 500 }
    );
  }
}
