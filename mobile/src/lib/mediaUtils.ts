// Installs the crypto.getRandomValues polyfill that randomId() below
// depends on. Imported here explicitly rather than relying on it
// arriving transitively through some other module — this module's
// correctness shouldn't hinge on another module's import order.
import 'react-native-get-random-values';

import { decode } from 'base64-arraybuffer';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { supabase } from '@/lib/supabase';

/**
 * Shared internals behind every private-bucket media path in the app
 * (post images — lib/media.ts, Phase 5; chat image/voice attachments —
 * lib/messageMedia.ts, Phase 6). One place for the parts that are
 * genuinely identical regardless of *which* bucket or table a caller is
 * ultimately serving — the random filename scheme, image resize/
 * compression, and signed-URL batching — so those don't drift into two
 * slightly-different copies as the app grows more upload surfaces.
 */

/**
 * A random hex id for object filenames.
 *
 * Deliberately not `crypto.randomUUID()`: browsers have it, but React
 * Native does not, and `react-native-get-random-values` — the polyfill
 * this project already ships — provides ONLY `crypto.getRandomValues`.
 * So `randomUUID()` works perfectly on web and throws
 * "crypto.randomUUID is not a function" on a real device, which is
 * precisely the web-passes/native-breaks trap that cost Phase 3 two
 * rounds of debugging (docs/phase/phase03.md §4) and was caught again by
 * Phase 5's own verification before it shipped (docs/phase/phase05.md §4.2).
 */
export function randomId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const MAX_DIMENSION = 1080;
const JPEG_QUALITY = 0.7;

export type PickedImage = { uri: string; width: number; height: number };

/**
 * Resize + JPEG-compress before upload, returning base64 because that's
 * what every upload path here needs — asking the manipulator for it
 * directly avoids a second read of the file off disk.
 *
 * Only ever downscales: `resize` is skipped entirely when the image is
 * already under the cap, so a small image isn't upscaled into a bigger
 * file than it started as. Protects the free tier's storage *and*
 * egress (docs/architecture.md) — a modern phone camera produces
 * 4000px+ images no phone screen can actually display at full
 * resolution, so uploading them raw is pure waste on both counts.
 */
export async function compressImageForUpload(image: PickedImage): Promise<string> {
  const context = ImageManipulator.manipulate(image.uri);

  const longestEdge = Math.max(image.width, image.height);
  if (longestEdge > MAX_DIMENSION) {
    context.resize(image.width >= image.height ? { width: MAX_DIMENSION } : { height: MAX_DIMENSION });
  }

  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: JPEG_QUALITY,
    base64: true,
  });

  if (!saved.base64) throw new Error('Image processing produced no data.');
  return saved.base64;
}

export async function uploadBase64(bucket: string, path: string, base64: string, contentType: string) {
  const { error } = await supabase.storage.from(bucket).upload(path, decode(base64), { contentType });
  if (error) throw error;
}

export async function uploadLocalFile(bucket: string, path: string, fileUri: string, contentType: string) {
  const response = await fetch(fileUri);
  const arrayBuffer = await response.arrayBuffer();
  const { error } = await supabase.storage.from(bucket).upload(path, arrayBuffer, { contentType });
  if (error) throw error;
}

/** Long enough to scroll a list without re-signing; short enough that a leaked URL dies quickly. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * Batch-signs storage paths for display. Returns a path -> URL map;
 * paths that fail to sign are simply absent, so a single broken item
 * degrades to a missing image/voice note rather than failing a whole
 * list's render.
 */
export async function signBucketUrls(bucket: string, paths: string[]): Promise<Map<string, string>> {
  const signed = new Map<string, string>();
  if (paths.length === 0) return signed;

  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (error || !data) return signed;

  for (const item of data) {
    if (item.path && item.signedUrl) signed.set(item.path, item.signedUrl);
  }
  return signed;
}
