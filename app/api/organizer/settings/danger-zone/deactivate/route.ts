import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { adminDb } from '@/lib/firebase/admin';
import { denyIfActingForAnotherOrg } from '@/lib/organizer/ownerOnly';

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Money and identity stay with the org owner (lib/organizer/ownerOnly.ts).
    const notOwner = await denyIfActingForAnotherOrg(user.id);
    if (notOwner) return notOwner;

    // Mark account as deactivated
    await adminDb.collection('users').doc(user.id).update({
      account_status: 'deactivated',
      deactivated_at: new Date().toISOString(),
      reactivation_deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
    });

    // Hide all events
    const eventsSnapshot = await adminDb.collection('events')
      .where('organizer_id', '==', user.id)
      .get();

    const batch = adminDb.batch();
    eventsSnapshot.docs.forEach((doc: any) => {
      batch.update(doc.ref, { status: 'hidden', hidden_reason: 'account_deactivated' });
    });
    await batch.commit();

    return NextResponse.json({ 
      success: true,
      message: 'Account deactivated successfully',
      reactivation_deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    });
  } catch (error) {
    console.error('Error deactivating account:', error);
    return NextResponse.json(
      { error: 'Failed to deactivate account' },
      { status: 500 }
    );
  }
}
