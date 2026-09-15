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
 * Which output shape `compressImageForUpload()` should crop and resize
 * to. 'original' (the default, used by chat/voice attachments) just caps
 * the longest edge — no cropping, so a chat photo's own framing survives
 * intact. 'feed' and 'story' match Instagram's own upload targets, since
 * both this app's feed cards and its Stories viewer are full-bleed,
 * fixed-box surfaces that need a predictable width:height coming in
 * rather than whatever ratio a phone camera happened to shoot.
 */
export type MediaVariant = 'original' | 'feed' | 'story';

/**
 * Feed posts crop to whichever of these three is closest to the source
 * photo's own ratio — square, Instagram's max-height portrait (4:5), or
 * landscape (1.91:1) — rather than forcing every photo into one shape.
 * Stories/Reels only ever have the one full-screen ratio (9:16).
 */
const FEED_PRESETS = [
  { width: 1080, height: 1080 }, // square, 1:1
  { width: 1080, height: 1350 }, // portrait, 4:5 — Instagram's max feed height
  { width: 1080, height: 566 }, // landscape, 1.91:1
];
const STORY_PRESET = { width: 1080, height: 1920 }; // 9:16

/** Closest-ratio match, compared on a log scale so 1:1.9 and 1:0.8 are equally "far" from 1:1. */
function closestFeedPreset(width: number, height: number) {
  const ratio = Math.log(width / height);
  return FEED_PRESETS.reduce((best, preset) => {
    const distance = Math.abs(ratio - Math.log(preset.width / preset.height));
    const bestDistance = Math.abs(ratio - Math.log(best.width / best.height));
    return distance < bestDistance ? preset : best;
  });
}

/** The width:height a 'feed' upload of this source photo will end up cropped to — for previewing the crop before upload. */
export function feedAspectRatioFor(width: number, height: number): number {
  const preset = closestFeedPreset(width, height);
  return preset.width / preset.height;
}

/** The largest centered rect of the given target ratio (width/height) that fits inside width x height. */
function centeredCropRect(width: number, height: number, targetRatio: number) {
  const currentRatio = width / height;
  if (currentRatio > targetRatio) {
    const cropWidth = Math.round(height * targetRatio);
    return { originX: Math.round((width - cropWidth) / 2), originY: 0, width: cropWidth, height };
  }
  if (currentRatio < targetRatio) {
    const cropHeight = Math.round(width / targetRatio);
    return { originX: 0, originY: Math.round((height - cropHeight) / 2), width, height: cropHeight };
  }
  return { originX: 0, originY: 0, width, height };
}

/**
 * Resize (and for 'feed'/'story', center-crop) + JPEG-compress before
 * upload, returning base64 because that's what every upload path here
 * needs — asking the manipulator for it directly avoids a second read
 * of the file off disk.
 *
 * Never upscales: a source already smaller than the target width comes
 * out cropped to the right ratio but at its own resolution, not blown up
 * past what the camera actually captured. Protects the free tier's
 * storage *and* egress (docs/architecture.md) — a modern phone camera
 * produces 4000px+ images no phone screen can actually display at full
 * resolution, so uploading them raw is pure waste on both counts.
 */
export async function compressImageForUpload(image: PickedImage, variant: MediaVariant = 'original'): Promise<string> {
  const context = ImageManipulator.manipulate(image.uri);

  if (variant === 'original') {
    const longestEdge = Math.max(image.width, image.height);
    if (longestEdge > MAX_DIMENSION) {
      context.resize(image.width >= image.height ? { width: MAX_DIMENSION } : { height: MAX_DIMENSION });
    }
  } else {
    const preset = variant === 'story' ? STORY_PRESET : closestFeedPreset(image.width, image.height);
    const cropRect = centeredCropRect(image.width, image.height, preset.width / preset.height);
    if (cropRect.width !== image.width || cropRect.height !== image.height) {
      context.crop(cropRect);
    }
    if (cropRect.width > preset.width) {
      context.resize({ width: preset.width });
    }
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

/**
 * Every video uploaded through this app lands at a fixed `.mp4` path
 * (stories.ts's `createStory()`, and post media below, both control the
 * extension themselves), so whether a stored object is an image or a
 * video is fully determined by its own filename — no separate `kind`
 * column needed anywhere media is stored.
 */
export function mediaKindFromPath(path: string): 'image' | 'video' {
  return /\.mp4$/i.test(path) ? 'video' : 'image';
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
