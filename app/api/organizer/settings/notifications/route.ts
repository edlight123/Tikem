import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { adminDb } from '@/lib/firebase/admin';
import { withOrganizerNotificationDefaults } from '@/lib/organizer/notificationPreferences';

/**
 * The signed-in organizer's preferences, with the same defaults the web
 * settings page applies. The mobile app reads them here because client rules
 * do not expose the notificationPreferences subcollection.
 */
export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const prefsDoc = await adminDb
      .collection('organizers')
      .doc(user.id)
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

    const body = await request.json();

    // Update notification preferences in Firestore
    await adminDb
      .collection('organizers')
      .doc(user.id)
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
