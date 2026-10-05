/**
 * Mobile Verification System - Firebase Integration
 * Handles organizer verification requests and document uploads
 */

import { db, storage, auth } from '../config/firebase';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import {
  ref,
  uploadBytes,
  getDownloadURL,
} from 'firebase/storage';
import * as ImagePicker from 'expo-image-picker';
import { backendJson } from './api/backend';

// Types
export type VerificationStatus =
  | 'not_started'
  | 'in_progress'
  | 'pending' // legacy (migrate to pending_review)
  | 'pending_review'
  | 'in_review'
  | 'approved'
  | 'changes_requested'
  | 'rejected';

export type StepStatus = 'incomplete' | 'complete' | 'needs_attention';

export interface VerificationStep {
  id: string;
  title: string;
  description: string;
  status: StepStatus;
  required: boolean;
  fields: Record<string, any>;
  missingFields?: string[];
  errorMessage?: string;
}

export interface VerificationFiles {
  governmentId?: {
    front?: string;
    back?: string;
    uploadedAt?: Date;
    /**
     * WHICH document this is. A passport is a single photo page — asking for a
     * "back" produces either a blank submission or a photo of nothing, and the
     * reviewer cannot tell those apart from a missing upload. Knowing the type
     * also tells the reviewer what they should be looking at: an MRZ on a
     * passport, a CIN number on a Haitian national ID.
     */
    documentType?: 'passport' | 'national_id' | 'drivers_license';
  };
  selfie?: {
    path?: string;
    uploadedAt?: Date;
  };
  /**
   * The liveness clip and the challenge it was recorded against.
   *
   * `sequence` is what makes the video evidence rather than decoration: it is
   * generated fresh per attempt, so a reviewer (or the analysis service) can
   * check the person performed THESE actions in THIS order. A clip that does not
   * match its own challenge is a replay, however convincing the face looks.
   */
  liveness?: {
    path?: string;
    uploadedAt?: Date;
    sequence?: { id: string; signal: string }[];
    secondsPerPrompt?: number;
    startedAt?: string;
    /**
     * Consent to biometric capture, recorded BEFORE the camera ran.
     *
     * Illinois' BIPA and Texas' CUBI attach to where the PERSON is, not to which
     * currency they are paid in — and much of this audience is diaspora holding a
     * Haitian payout profile while living in the US. Both require informed,
     * explicit consent before capture; an unrecorded consent is indistinguishable
     * from none. `version` pins which wording they actually saw.
     */
    consent?: {
      version: string;
      grantedAt: string;
    };
  };
}

export interface VerificationRequest {
  userId: string;
  status: VerificationStatus;
  steps: {
    organizerInfo: VerificationStep;
    governmentId: VerificationStep;
    selfie: VerificationStep;
    businessDetails: VerificationStep;
    payoutSetup: VerificationStep;
  };
  files: VerificationFiles;
  submittedAt?: string;
  reviewedAt?: string;
  reviewNotes?: string;
  reasonCodes?: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Get verification request for user
 */
export async function getVerificationRequest(
  userId: string
): Promise<VerificationRequest | null> {
  try {
    const docRef = doc(db, 'verification_requests', userId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      return null;
    }

    const data = docSnap.data();

    return {
      ...data,
      createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
      updatedAt: data.updatedAt?.toDate?.()?.toISOString() || new Date().toISOString(),
      submittedAt: data.submittedAt?.toDate?.()?.toISOString() || undefined,
      reviewedAt: data.reviewedAt?.toDate?.()?.toISOString() || undefined,
    } as VerificationRequest;
  } catch (error) {
    console.error('Error fetching verification request:', error);
    return null;
  }
}

/**
 * Initialize new verification request
 */
export async function initializeVerificationRequest(
  userId: string
): Promise<VerificationRequest> {
  const initialRequest: VerificationRequest = {
    userId,
    status: 'in_progress',
    steps: {
      organizerInfo: {
        id: 'organizerInfo',
        title: 'Organizer Information',
        description: 'Basic information about you and your organization',
        status: 'incomplete',
        required: true,
        fields: {},
        missingFields: ['full_name', 'phone', 'organization_name'],
      },
      governmentId: {
        id: 'governmentId',
        title: 'Government ID Upload',
        description: 'Upload a valid government-issued ID (front and back)',
        status: 'incomplete',
        required: true,
        fields: {},
        missingFields: ['id_front', 'id_back'],
      },
      selfie: {
        id: 'selfie',
        title: 'Identity Verification',
        description: 'Take a selfie holding your ID for verification',
        status: 'incomplete',
        required: true,
        fields: {},
      },
      businessDetails: {
        id: 'businessDetails',
        title: 'Business Details',
        description: 'Optional business registration and tax information',
        status: 'incomplete',
        required: false,
        fields: {},
      },
      payoutSetup: {
        id: 'payoutSetup',
        title: 'Payout Setup',
        description: 'Configure how you receive payments (can be set up later)',
        status: 'incomplete',
        required: false,
        fields: {},
      },
    },
    files: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const docRef = doc(db, 'verification_requests', userId);
  await setDoc(docRef, {
    ...initialRequest,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return initialRequest;
}

/**
 * Update verification step
 */
export async function updateVerificationStep(
  userId: string,
  stepId: keyof VerificationRequest['steps'],
  stepData: Partial<VerificationStep>
): Promise<void> {
  try {
    const docRef = doc(db, 'verification_requests', userId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      throw new Error('Verification request not found');
    }

    const currentData = docSnap.data() as VerificationRequest;
    const updatedSteps = {
      ...currentData.steps,
      [stepId]: {
        ...currentData.steps[stepId],
        ...stepData,
      },
    };

    await updateDoc(docRef, {
      steps: updatedSteps,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    console.error('Error updating verification step:', error);
    throw error;
  }
}

/**
 * Pick and upload image from camera or library
 */
export async function pickAndUploadImage(
  userId: string,
  documentType: 'id_front' | 'id_back' | 'selfie',
  useCamera: boolean = false,
  useFrontCamera: boolean = false
): Promise<string> {
  // Request permissions
  if (useCamera) {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      throw new Error('Camera permission is required');
    }
  } else {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      throw new Error('Photo library permission is required');
    }
  }

  // Launch picker
  const result = useCamera
    ? await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [3, 4],
        quality: 0.9,
        cameraType: useFrontCamera 
          ? ImagePicker.CameraType.front 
          : ImagePicker.CameraType.back,
      })
    : await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [3, 4],
        quality: 0.9,
      });

  if (result.canceled) {
    throw new Error('Image selection cancelled');
  }

  // Upload to Firebase Storage
  const uri = result.assets[0].uri;
  return await uploadImageToStorage(userId, uri, documentType);
}

/**
 * Upload image blob to Firebase Storage
 */
async function uploadImageToStorage(
  userId: string,
  uri: string,
  documentType: string
): Promise<string> {
  try {
    // Check authentication
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error('You must be logged in to upload documents');
    }
    
    if (currentUser.uid !== userId) {
      throw new Error('User ID mismatch');
    }

    console.log(`[Upload] Starting upload for ${documentType}`, {
      userId,
      authUserId: currentUser.uid,
      uri: uri.substring(0, 50) + '...',
    });

    // Fetch the image as blob
    const response = await fetch(uri);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }
    const blob = await response.blob();

    if (!blob || blob.size === 0) {
      throw new Error('Invalid image file');
    }

    // Create storage reference
    const timestamp = Date.now();
    const extension = uri.split('.').pop()?.toLowerCase() || 'jpg';
    const fileName = `${documentType}_${timestamp}.${extension}`;
    const storagePath = `verification/${userId}/${fileName}`;
    const storageRef = ref(storage, storagePath);

    console.log(`[Upload] Uploading to: ${storagePath}, Size: ${blob.size} bytes`);

    // Upload with metadata
    const metadata = {
      contentType: `image/${extension === 'jpg' ? 'jpeg' : extension}`,
      customMetadata: {
        uploadedAt: new Date().toISOString(),
        documentType,
      },
    };

    await uploadBytes(storageRef, blob, metadata);
    console.log(`[Upload] Success: ${storagePath}`);

    // Return storage path
    return storagePath;
  } catch (error: any) {
    console.error('Error uploading image:', error);
    throw new Error(error?.message || 'Failed to upload image to storage');
  }
}

/**
 * Upload a liveness clip.
 *
 * Kept separate from the image path because the content type, size and
 * sensitivity differ: this is biometric video, so it carries its own retention
 * expectations. Storage rules and any deletion policy should key on the
 * `liveness_` prefix.
 */
export async function uploadLivenessVideo(userId: string, uri: string): Promise<string> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('You must be logged in to upload documents');
  if (currentUser.uid !== userId) throw new Error('User ID mismatch');

  const response = await fetch(uri);
  if (!response.ok) throw new Error(`Failed to read recording: ${response.statusText}`);
  const blob = await response.blob();
  if (!blob || blob.size === 0) throw new Error('The recording was empty. Please try again');

  const extension = uri.split('.').pop()?.toLowerCase() || 'mp4';
  const storagePath = `verification/${userId}/liveness_${Date.now()}.${extension}`;
  await uploadBytes(ref(storage, storagePath), blob, {
    contentType: extension === 'mov' ? 'video/quicktime' : 'video/mp4',
    customMetadata: { uploadedAt: new Date().toISOString(), documentType: 'liveness' },
  });

  return storagePath;
}

/**
 * Upload an image we ALREADY have a URI for.
 *
 * `pickAndUploadImage` owns the picker as well as the upload, which is fine when
 * the picker is how the photo arrives. The document scanner returns a captured,
 * deskewed file instead, so it needs the upload half on its own.
 */
export async function uploadIdImageFromUri(
  userId: string,
  uri: string,
  documentType: 'id_front' | 'id_back' | 'selfie'
): Promise<string> {
  return await uploadImageToStorage(userId, uri, documentType);
}

/**
 * Update verification files in Firestore
 */
export async function updateVerificationFiles(
  userId: string,
  filesData: Partial<VerificationFiles>
): Promise<void> {
  try {
    const docRef = doc(db, 'verification_requests', userId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      console.warn('[Verification] Document does not exist, initializing...');
      await initializeVerificationRequest(userId);
    }

    const currentData = docSnap.exists() ? docSnap.data() as VerificationRequest : null;
    // Deep-merge one level (governmentId/selfie) so a partial write (e.g. front
    // only) never wipes the stored other side, and strip undefined values —
    // Firestore's updateDoc throws on any `undefined` field.
    const stripUndefined = (obj: Record<string, any>) =>
      Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
    const currentFiles: Record<string, any> = currentData?.files || {};
    const updatedFiles: Record<string, any> = { ...currentFiles };
    for (const [key, value] of Object.entries(filesData)) {
      if (value === undefined) continue;
      updatedFiles[key] =
        value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
          ? stripUndefined({ ...(currentFiles[key] || {}), ...value })
          : value;
    }

    console.log(`[Verification] Updating files for user: ${userId}`);
    await updateDoc(docRef, {
      files: updatedFiles,
      updatedAt: serverTimestamp(),
    });
    console.log('[Verification] Files updated successfully');
  } catch (error: any) {
    console.error('[Verification] Error updating files:', error);
    throw new Error(error?.message || 'Failed to update verification files');
  }
}

/**
 * Submit verification for review
 */
export async function submitVerificationForReview(userId: string): Promise<void> {
  try {
    // Submit through the SERVER endpoint (not a bare client updateDoc). The
    // server marks the request pending_review, mirrors verification_status onto
    // the user/organizer docs, and alerts the admin to review — a client-only
    // write would leave the KYC submission invisible to review and unmirrored,
    // so the organizer could wait forever and never get verified/paid.
    const snap = await getDoc(doc(db, 'verification_requests', userId));
    const files = (snap.exists() ? (snap.data() as any)?.files : null) || {};
    const frontRaw = files?.governmentId?.front;
    const backRaw = files?.governmentId?.back;
    const selfieRaw = files?.selfie?.path;
    if (!frontRaw || !backRaw || !selfieRaw) {
      throw new Error(
        'Please upload the front and back of your ID and a selfie before submitting.'
      );
    }

    // Documents are stored as Storage paths; resolve to download URLs the
    // reviewer can open. If a value is already an http(s) URL, use it as-is.
    const resolve = async (v: string) =>
      /^https?:\/\//i.test(v) ? v : await getDocumentDownloadURL(v);
    const [idFrontUrl, idBackUrl, facePhotoUrl] = await Promise.all([
      resolve(String(frontRaw)),
      resolve(String(backRaw)),
      resolve(String(selfieRaw)),
    ]);

    await backendJson('/api/organizer/submit-verification', {
      method: 'POST',
      body: JSON.stringify({ userId, idFrontUrl, idBackUrl, facePhotoUrl }),
    });
  } catch (error) {
    console.error('Error submitting verification:', error);
    throw error;
  }
}

/**
 * Calculate completion percentage
 */
export function calculateCompletionPercentage(request: VerificationRequest): number {
  const requiredSteps = Object.values(request.steps).filter((s) => s.required);
  const completedSteps = requiredSteps.filter((s) => s.status === 'complete');
  return Math.round((completedSteps.length / requiredSteps.length) * 100);
}

/**
 * Get download URL for document (for preview)
 */
export async function getDocumentDownloadURL(storagePath: string): Promise<string> {
  try {
    const storageRef = ref(storage, storagePath);
    return await getDownloadURL(storageRef);
  } catch (error) {
    console.error('Error getting document download URL:', error);
    throw error;
  }
}
