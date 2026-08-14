// Installs the crypto.getRandomValues polyfill that randomId() below
// depends on. Imported here explicitly rather than relying on it
// arriving transitively through lib/supabase.ts — this module's
// correctness shouldn't hinge on another module's import order.
import 'react-native-get-random-values';

import { decode } from 'base64-arraybuffer';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from '@/lib/supabase';

/**
 * The one place that knows *where* media physically lives.
 *
 * `docs/architecture.md` picks Cloudflare R2 as the eventual home, for
 * its zero egress fees — the single biggest cost lever once image volume
 * grows. R2 can't be provisioned or verified locally though (no
 * emulator, real credentials required), and every phase so far has held
 * itself to "verified against the live local stack." So this runs on
 * Supabase Storage, which the local stack already provides, and the swap
 * to R2 lands in Phase 11 alongside the rest of the hosted-backend work
 * (docs/roadmap.md already lists the bucket there).
 *
 * Everything outside this module — create-post, the feed, post detail —
 * only ever sees `uploadPostImage()` and `signMediaUrls()`, so that swap
 * is a change to this file, not a change to every screen.
 */

const BUCKET = 'post-media';

/** Long enough to scroll a feed and open a post without re-signing; short enough that a leaked URL dies quickly. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

/**
 * Cap on the longest edge. Protects the free tier's storage *and* egress
 * (docs/architecture.md) — a modern phone camera produces 4000px+ images
 * that no phone screen can actually display at full resolution, so
 * uploading them raw is pure waste on both counts.
 */
const MAX_DIMENSION = 1080;
const JPEG_QUALITY = 0.7;

export type PickedImage = { uri: string; width: number; height: number };

/**
 * A random hex id for the object filename.
 *
 * Deliberately not `crypto.randomUUID()`: browsers have it, but React
 * Native does not, and `react-native-get-random-values` — the polyfill
 * this project already ships — provides ONLY `crypto.getRandomValues`.
 * So `randomUUID()` works perfectly on web and throws
 * "crypto.randomUUID is not a function" on a real device, which is
 * precisely the web-passes/native-breaks trap that cost Phase 3 two
 * rounds of debugging (docs/phase/phase03.md §4).
 */
function randomId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Returns null when the user cancels or declines the permission prompt. */
export async function pickImage(): Promise<PickedImage | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1, // Compression happens in compressForUpload() — don't do it twice.
  });
  if (result.canceled) return null;

  const asset = result.assets[0];
  return { uri: asset.uri, width: asset.width, height: asset.height };
}

/**
 * Resize + JPEG-compress before upload, returning base64 because that's
 * what the upload path actually needs (see uploadPostImage) — asking the
 * manipulator for it here avoids a second read of the file off disk.
 *
 * Only ever downscales: `resize` is skipped entirely when the image is
 * already under the cap, so a small image isn't upscaled into a bigger
 * file than it started as.
 */
async function compressForUpload(image: PickedImage) {
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

/**
 * Uploads one post image and returns its storage path (NOT a URL —
 * the bucket is private, so a stored URL would be a signed one that
 * expires; `post_media.url` holds this stable path and reading goes
 * through `signMediaUrls()` at render time).
 *
 * The `{roomId}/{userId}/{uuid}` shape isn't cosmetic: the bucket's RLS
 * policies parse both segments back out to answer "is the caller a
 * member of this Room" and "does the caller own this object" — see
 * supabase/migrations/20260814063412_post_media_storage.sql.
 */
export async function uploadPostImage(image: PickedImage, roomId: string, userId: string): Promise<string> {
  const base64 = await compressForUpload(image);
  const path = `${roomId}/${userId}/${randomId()}.jpg`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, decode(base64), {
    contentType: 'image/jpeg',
  });
  if (error) throw error;

  return path;
}

/** Best-effort — used to clean up an image whose post row failed to insert. */
export async function deletePostImage(path: string): Promise<void> {
  await supabase.storage.from(BUCKET).remove([path]);
}

/**
 * Batch-signs storage paths for display. Returns a path -> URL map;
 * paths that fail to sign are simply absent, so a single broken image
 * degrades to a missing image rather than failing a whole feed render.
 */
export async function signMediaUrls(paths: string[]): Promise<Map<string, string>> {
  const signed = new Map<string, string>();
  if (paths.length === 0) return signed;

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (error || !data) return signed;

  for (const item of data) {
    if (item.path && item.signedUrl) signed.set(item.path, item.signedUrl);
  }
  return signed;
}
