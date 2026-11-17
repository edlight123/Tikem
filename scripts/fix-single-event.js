/**
 * Simple script to fix tickets_sold for event RYqKK0tUkxH6NQibCkAS
 * Run with: node scripts/fix-single-event.js
 */

const { initializeApp, cert } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')

// Use environment variables
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY || '{}')

if (!serviceAccount.project_id) {
  console.error('❌ FIREBASE_SERVICE_ACCOUNT_KEY environment variable not set')
  console.log('\n📝 To fix manually:')
  console.log('1. Go to Firebase Console: https://console.firebase.google.com')
  console.log('2. Navigate to Firestore Database')
  console.log('3. Find the events collection')
  console.log('4. Find event ID: RYqKK0tUkxH6NQibCkAS')
  console.log('5. Click on the document')
  console.log('6. Edit the "tickets_sold" field and change it from 0 to 2')
  console.log('7. Save the changes\n')
  process.exit(1)
}

initializeApp({
  credential: cert(serviceAccount),
})

const db = getFirestore()

async function fixEvent() {
  const eventId = 'RYqKK0tUkxH6NQibCkAS'
  
  console.log(`🔄 Fixing tickets_sold for event ${eventId}...`)
  
  // Count tickets
  const ticketsSnapshot = await db
    .collection('tickets')
    .where('event_id', '==', eventId)
    .where('status', 'in', ['valid', 'confirmed', 'active'])
    .get()
  
  const actualCount = ticketsSnapshot.size
  console.log(`Found ${actualCount} tickets`)
  
  // Update event
  await db.collection('events').doc(eventId).update({
    tickets_sold: actualCount
  })
  
  console.log(`✅ Updated event tickets_sold to ${actualCount}`)
}

fixEvent()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error.message)
    console.log('\n📝 To fix manually:')
    console.log('1. Go to Firebase Console: https://console.firebase.google.com')
    console.log('2. Navigate to Firestore Database')
    console.log('3. Find the events collection')
    console.log('4. Find event ID: RYqKK0tUkxH6NQibCkAS')
    console.log('5. Click on the document')
    console.log('6. Edit the "tickets_sold" field and change it from 0 to 2')
    console.log('7. Save the changes\n')
    process.exit(1)
  })
