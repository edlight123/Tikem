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

    // Gather all user data
    const userData: any = {};

    // Get user profile
    const userDoc = await adminDb.collection('users').doc(user.id).get();
    userData.profile = userDoc.data();

    // Get organizer data
    const organizerDoc = await adminDb.collection('organizers').doc(user.id).get();
    userData.organizer = organizerDoc.data();

    // Get events
    const eventsSnapshot = await adminDb.collection('events')
      .where('organizer_id', '==', user.id)
      .get();
    userData.events = eventsSnapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));

    // Get payout config
    const payoutConfigDoc = await adminDb
      .collection('organizers')
      .doc(user.id)
      .collection('payoutConfig')
      .doc('main')
      .get();
    userData.payoutConfig = payoutConfigDoc.data();

    // Get payouts
    const payoutsSnapshot = await adminDb
      .collection('organizers')
      .doc(user.id)
      .collection('payouts')
      .get();
    userData.payouts = payoutsSnapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));

    // Get team members
    const teamSnapshot = await adminDb
      .collection('organizers')
      .doc(user.id)
      .collection('team')
      .get();
    userData.team = teamSnapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));

    // Create JSON file
    const jsonData = JSON.stringify(userData, null, 2);
    const buffer = Buffer.from(jsonData);

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="tikem-data-${user.id}-${Date.now()}.json"`,
      },
    });
  } catch (error) {
    console.error('Error exporting data:', error);
    return NextResponse.json(
      { error: 'Failed to export data' },
      { status: 500 }
    );
  }
}
