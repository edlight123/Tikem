import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { adminDb } from '@/lib/firebase/admin';
import { requireOrg } from '@/lib/organizer/context';

export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // The acting org's defaults: its owner or a team admin.
    const org = await requireOrg('manage_settings');
    if (!org.ok) return org.response;

    const body = await request.json();
    const {
      default_city,
      default_country,
      default_timezone,
      default_currency,
      default_categories,
    } = body;

    // Update organizer defaults in Firestore
    await adminDb.collection('organizers').doc(org.value.orgId).set({
      default_city: default_city || '',
      default_country: default_country || 'Haiti',
      default_timezone: default_timezone || 'America/Port-au-Prince',
      default_currency: default_currency || 'HTG',
      default_categories: default_categories || [],
      updated_at: new Date().toISOString(),
    }, { merge: true });

    return NextResponse.json({ 
      success: true,
      message: 'Event defaults updated successfully' 
    });
  } catch (error) {
    console.error('Error updating defaults:', error);
    return NextResponse.json(
      { error: 'Failed to update defaults' },
      { status: 500 }
    );
  }
}
