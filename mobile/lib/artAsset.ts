import { Asset } from 'expo-asset';
import type { ArtPiece } from './artLibrary';

/**
 * Resolve a bundled art piece to a local file URI the poster upload can read.
 *
 * A bundled `require()` is not a URL anyone else can open: it only means
 * something inside this app binary or OTA bundle. So a picked art flyer is
 * turned into a real file here (expo-asset copies Android resources into the
 * cache; iOS and OTA assets are already files), handed to the composer like an
 * image-picker result, and uploaded to Storage on save by the existing
 * `uploadEventImage` path, which stores the public https URL in
 * banner_image_url for web and mobile alike.
 *
 * expo-asset ships inside `expo` itself (already linked), so this adds no
 * native module.
 */
export async function resolveArtFileUri(piece: ArtPiece): Promise<string> {
  const asset = Asset.fromModule(piece.source);
  await asset.downloadAsync();
  const uri = asset.localUri || asset.uri;
  if (!uri) throw new Error(`Art "${piece.key}" could not be resolved`);
  return uri;
}
