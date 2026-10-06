/**
 * Pick and upload a profile photo or organization logo. Paths and limits are
 * in profileImagePath.ts (see there for why the logo moved prefix).
 */
import * as ImagePicker from 'expo-image-picker';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { storage } from '../config/firebase';
import {
  MAX_PROFILE_IMAGE_BYTES,
  profileImageContentType,
  profileImagePath,
  type ProfileImageKind,
} from './profileImagePath';

export type ImageSource = 'camera' | 'library';

/** Thrown with a locale key the caller shows as-is. */
export class ProfileImageError extends Error {
  constructor(public readonly key: string) {
    super(key);
  }
}

/** Ask for permission and open the camera or library. Null when cancelled. */
export async function pickProfileImage(source: ImageSource): Promise<ImagePicker.ImagePickerAsset | null> {
  const perm =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    throw new ProfileImageError(
      source === 'camera' ? 'profile.photo.cameraPermissionRequired' : 'profile.uploads.photoPermissionRequired',
    );
  }
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.85,
  };
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets?.[0]?.uri) return null;
  return result.assets[0];
}

/** Upload under profile-images/{uid}/ and return the download URL. */
export async function uploadProfileImage(
  uid: string,
  asset: ImagePicker.ImagePickerAsset,
  kind: ProfileImageKind,
): Promise<string> {
  const res = await fetch(asset.uri);
  const blob = await res.blob();
  if (blob.size >= MAX_PROFILE_IMAGE_BYTES) throw new ProfileImageError('profile.photo.tooLarge');
  const fileRef = storageRef(storage, profileImagePath(uid, kind));
  await uploadBytes(fileRef, blob, { contentType: profileImageContentType(asset.mimeType) });
  return getDownloadURL(fileRef);
}
