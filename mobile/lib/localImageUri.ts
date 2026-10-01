/**
 * Does this image URI exist only on this phone, so it must be uploaded before
 * it can be saved as an event's banner_image_url?
 *
 * Covers what the composer can hand over: an image-picker file (`file://`), an
 * Android `content://`, an iOS `ph://` / `assets-library://`, and a bundled art
 * piece, which resolves to a `file://` copy in release builds, or to the Metro
 * dev server (`http://localhost:8081/assets/…`, a LAN IP on a device) in dev.
 * A public `https://` URL (an earlier upload, an Unsplash flyer) is kept as is.
 */
export function isDeviceOnlyImageUri(uri: string | null | undefined): boolean {
  if (!uri) return false;
  const u = uri.trim();
  if (!u) return false;
  if (/^https:\/\//i.test(u)) return false;
  if (/^http:\/\//i.test(u)) {
    // Only a dev-server asset is device-only; any other http URL is a hosted
    // image and stays untouched, as it always has.
    return /^http:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(u);
  }
  return true;
}
