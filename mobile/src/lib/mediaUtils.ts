// Installs the crypto.getRandomValues polyfill that randomId() below
// depends on. Imported here explicitly rather than relying on it
// arriving transitively through some other module — this module's
// correctness shouldn't hinge on another module's import order.
import 'react-native-get-random-values';

import { decode } from 'base64-arraybuffer';
import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';
import type { BufferOptions } from 'expo-video';

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
 * The only shapes a feed post's photos can be — square (1:1), portrait
 * (3:4), or landscape (1.91:1). Every photo in one post shares a single
 * shape (the Post composer's photo editor picks it); until someone picks
 * one, a post takes whichever is closest to its first photo's own ratio.
 * Stories/Reels only ever have the one full-screen ratio (9:16).
 *
 * Portrait was 4:5 (1080×1350) until 2026-09-16. 3:4 is the shape phone
 * cameras actually shoot in portrait, so those photos now post uncropped
 * instead of losing ~6% off the top and bottom, and it's Instagram's own
 * current portrait size. Posts uploaded as 4:5 keep displaying as 4:5 —
 * the feed sizes each post from its stored file, not from this table.
 */
export type FeedShape = 'square' | 'portrait' | 'landscape';

// Declared in this order on purpose: closestFeedShape() keeps the earlier
// shape on an exact tie.
export const FEED_SHAPES: Record<FeedShape, { width: number; height: number }> = {
  square: { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1440 },
  landscape: { width: 1080, height: 566 },
};
const STORY_PRESET = { width: 1080, height: 1920 }; // 9:16

/** Closest-ratio match, compared on a log scale so 1:1.9 and 1:0.8 are equally "far" from 1:1. */
export function closestFeedShape(width: number, height: number): FeedShape {
  const ratio = Math.log(width / height);
  let best: FeedShape = 'square';
  let bestDistance = Infinity;
  for (const shape of Object.keys(FEED_SHAPES) as FeedShape[]) {
    const preset = FEED_SHAPES[shape];
    const distance = Math.abs(ratio - Math.log(preset.width / preset.height));
    if (distance < bestDistance) {
      best = shape;
      bestDistance = distance;
    }
  }
  return best;
}

export function feedShapeAspectRatio(shape: FeedShape): number {
  const preset = FEED_SHAPES[shape];
  return preset.width / preset.height;
}

/**
 * A crop/rotate/flip from the Post composer's photo editor. Stored relative
 * to the photo, never in pixels: the editor works on a downscaled copy,
 * the preview renders from another, and the upload from the full-size
 * original, and a relative edit selects the same framing from all three.
 * It also survives the post's shape changing — the crop keeps its center
 * and zoom and just takes the new shape.
 */
export type PhotoEdit = {
  /** Clockwise degrees, applied first. */
  rotation: 0 | 90 | 180 | 270;
  /** Mirrored left-to-right, applied after rotation. */
  flipped: boolean;
  /** 1 = the largest crop of the post's shape that fits the photo; 2 = half that crop's width; up to MAX_PHOTO_ZOOM. */
  zoom: number;
  /** The crop's center, as a fraction (0–1) of the rotated-and-flipped photo's width and height. */
  focusX: number;
  focusY: number;
};

export const MAX_PHOTO_ZOOM = 4;
export const UNEDITED_PHOTO: PhotoEdit = { rotation: 0, flipped: false, zoom: 1, focusX: 0.5, focusY: 0.5 };

export function isUneditedPhoto(edit: PhotoEdit): boolean {
  return (
    edit.rotation === 0 && !edit.flipped && edit.zoom === 1 && edit.focusX === 0.5 && edit.focusY === 0.5
  );
}

/**
 * Pulls a crop center back inside the photo, so the crop never hangs off an
 * edge — an upload can't have blank bands. A worklet, because the editor's
 * pan/pinch gestures call it on the UI thread every frame.
 */
export function clampPhotoFocus(
  focusX: number,
  focusY: number,
  zoom: number,
  width: number,
  height: number,
  aspectRatio: number,
): [number, number] {
  'worklet';
  const cropWidth = Math.min(width, height * aspectRatio) / zoom;
  const cropHeight = cropWidth / aspectRatio;
  const halfX = cropWidth / 2 / width;
  const halfY = cropHeight / 2 / height;
  return [Math.min(Math.max(focusX, halfX), 1 - halfX), Math.min(Math.max(focusY, halfY), 1 - halfY)];
}

/**
 * Buffering limits for every in-app video player (set in each
 * useVideoPlayer setup). expo-video's Android defaults buffer 20 s ahead
 * with a byte cap sized for long videos (over 100 MB per player). With
 * `loop` on, "ahead" includes the next repeats: a 5 s phone clip queued
 * four more copies of itself, each downloaded again and held in memory,
 * even while paused. Three looping players in the clips viewer took the
 * Galaxy A14's 256 MB Java heap from ~60 MB to out-of-memory in about 7 s,
 * re-downloading both clips every second. Capped, a looping clip holds at
 * most one extra repeat. 16 MB still fits 5 s of a 17 Mbps 1080p phone
 * recording, so playback doesn't stall.
 */
export const VIDEO_BUFFER_OPTIONS: BufferOptions = {
  preferredForwardBufferDuration: 5,
  maxBufferBytes: 16 * 1024 * 1024,
};

/**
 * How a clip is cropped in the feed — the photo editor's model minus
 * rotate/flip, stored per media row (20260917100000_clip_framing.sql) and
 * applied at display time, since video can't be re-encoded on the phone.
 */
export type MediaFraming = { shape: FeedShape; zoom: number; focusX: number; focusY: number };

/** A clip's box shape: the author's choice, else the shape closest to the video's own aspect, else portrait (what phones record). */
export function clipShape(framing: MediaFraming | null | undefined, videoAspect: number | null | undefined): FeedShape {
  if (framing) return framing.shape;
  if (videoAspect && videoAspect > 0) return closestFeedShape(videoAspect, 1);
  return 'portrait';
}

/**
 * Where to draw a video inside a feed box so the box shows exactly its
 * framed crop: the video's size and top-left offset, in the box's own
 * points. The one layout used by the composer's preview, the feed and the
 * post screen, so they can't drift apart.
 *
 * Works in "video units" (width = videoAspect, height = 1), so it needs the
 * displayed aspect, not pixel sizes. Scales so the crop covers the box even
 * when the box isn't exactly the shape's ratio (the feed's height cap), and
 * clamps the centre against the crop that's actually visible, so the video
 * never leaves a gap.
 */
export function framedVideoLayout(
  boxWidth: number,
  boxHeight: number,
  videoAspect: number,
  shape: FeedShape,
  framing: MediaFraming | null | undefined,
) {
  const ratio = feedShapeAspectRatio(shape);
  const zoom = framing?.zoom ?? 1;
  const cropWidth = Math.min(videoAspect, ratio) / zoom;
  const cropHeight = cropWidth / ratio;
  const scale = Math.max(boxWidth / cropWidth, boxHeight / cropHeight);
  const width = videoAspect * scale;
  const height = scale;
  const halfX = boxWidth / 2 / width;
  const halfY = boxHeight / 2 / height;
  const focusX = Math.min(Math.max(framing?.focusX ?? 0.5, halfX), 1 - halfX);
  const focusY = Math.min(Math.max(framing?.focusY ?? 0.5, halfY), 1 - halfY);
  return { width, height, left: boxWidth / 2 - focusX * width, top: boxHeight / 2 - focusY * height };
}

/** The pixel rect an edit selects from an image that has already been rotated and flipped per that edit. */
function photoEditCropRect(width: number, height: number, aspectRatio: number, edit: PhotoEdit) {
  const [focusX, focusY] = clampPhotoFocus(edit.focusX, edit.focusY, edit.zoom, width, height, aspectRatio);
  const cropWidth = Math.min(width, height * aspectRatio) / edit.zoom;
  const cropHeight = cropWidth / aspectRatio;
  const roundedWidth = Math.min(Math.max(Math.round(cropWidth), 1), width);
  const roundedHeight = Math.min(Math.max(Math.round(cropHeight), 1), height);
  return {
    originX: Math.min(Math.max(Math.round(focusX * width - cropWidth / 2), 0), width - roundedWidth),
    originY: Math.min(Math.max(Math.round(focusY * height - cropHeight / 2), 0), height - roundedHeight),
    width: roundedWidth,
    height: roundedHeight,
  };
}

/**
 * Rotate and flip first, then crop — in two renders, because the crop is
 * computed from the rotated image's real pixel size as the manipulator
 * itself sees it, not from the gallery's reported width/height.
 * `sourceMaxEdge` downscales before any of that, for the preview.
 */
async function renderEditedPhoto(image: PickedImage, edit: PhotoEdit, shape: FeedShape, sourceMaxEdge?: number) {
  const preset = FEED_SHAPES[shape];
  const orient = ImageManipulator.manipulate(image.uri);
  if (sourceMaxEdge && Math.max(image.width, image.height) > sourceMaxEdge) {
    orient.resize(image.width >= image.height ? { width: sourceMaxEdge } : { height: sourceMaxEdge });
  }
  if (edit.rotation !== 0) orient.rotate(edit.rotation);
  if (edit.flipped) orient.flip('horizontal');
  const oriented = await orient.renderAsync();
  try {
    const rect = photoEditCropRect(oriented.width, oriented.height, preset.width / preset.height, edit);
    const crop = ImageManipulator.manipulate(oriented).crop(rect);
    if (rect.width > preset.width) crop.resize({ width: preset.width });
    return await crop.renderAsync();
  } finally {
    oriented.release();
  }
}

// Big enough to stay sharp on a phone screen at the editor's max zoom,
// small enough to decode quickly on a low-end device like the Galaxy A14.
const EDITING_MAX_EDGE = 1440;

/** A downscaled, unrotated copy of a photo for the editor to pan and zoom — decoded once when the editor opens. */
export async function loadPhotoForEditing(image: PickedImage): Promise<PickedImage> {
  const context = ImageManipulator.manipulate(image.uri);
  if (Math.max(image.width, image.height) > EDITING_MAX_EDGE) {
    context.resize(image.width >= image.height ? { width: EDITING_MAX_EDGE } : { height: EDITING_MAX_EDGE });
  }
  const rendered = await context.renderAsync();
  try {
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
    return { uri: saved.uri, width: saved.width, height: saved.height };
  } finally {
    rendered.release();
  }
}

/**
 * A local JPEG of an edited photo, framed exactly as its upload will be —
 * the composer's preview shows this file instead of the original. Renders
 * from a downscaled source; the edit being relative is what keeps the
 * framing identical to the full-resolution upload.
 */
export async function renderPhotoEditPreview(image: PickedImage, edit: PhotoEdit, shape: FeedShape): Promise<string> {
  const rendered = await renderEditedPhoto(image, edit, shape, EDITING_MAX_EDGE);
  try {
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
    return saved.uri;
  } finally {
    rendered.release();
  }
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
 *
 * 'feed' takes an optional `shape` (the post's; defaults to the photo's
 * closest) and `edit` (the photo editor's crop/rotate/flip, rendered from
 * this full-size original — the preview's JPEG is never what uploads, so
 * the photo is only ever JPEG-compressed once).
 */
export async function compressImageForUpload(
  image: PickedImage,
  variant: MediaVariant = 'original',
  feed?: { shape?: FeedShape; edit?: PhotoEdit },
): Promise<string> {
  if (variant === 'feed' && feed?.edit) {
    const rendered = await renderEditedPhoto(image, feed.edit, feed.shape ?? closestFeedShape(image.width, image.height));
    return encodeForUpload(rendered);
  }

  const context = ImageManipulator.manipulate(image.uri);

  if (variant === 'original') {
    const longestEdge = Math.max(image.width, image.height);
    if (longestEdge > MAX_DIMENSION) {
      context.resize(image.width >= image.height ? { width: MAX_DIMENSION } : { height: MAX_DIMENSION });
    }
  } else {
    const preset =
      variant === 'story' ? STORY_PRESET : FEED_SHAPES[feed?.shape ?? closestFeedShape(image.width, image.height)];
    const cropRect = centeredCropRect(image.width, image.height, preset.width / preset.height);
    if (cropRect.width !== image.width || cropRect.height !== image.height) {
      context.crop(cropRect);
    }
    if (cropRect.width > preset.width) {
      context.resize({ width: preset.width });
    }
  }

  return encodeForUpload(await context.renderAsync());
}

async function encodeForUpload(rendered: ImageRef): Promise<string> {
  try {
    const saved = await rendered.saveAsync({
      format: SaveFormat.JPEG,
      compress: JPEG_QUALITY,
      base64: true,
    });
    if (!saved.base64) throw new Error('Image processing produced no data.');
    return saved.base64;
  } finally {
    rendered.release();
  }
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
 * An expo-image `source` for a media URL, cached by what the URL points at
 * rather than by the URL itself.
 *
 * Every signed URL carries a fresh token, so each feed load, refresh or page
 * produced a new URL for the same photo, and expo-image, which caches by URL,
 * never got a hit: on a Galaxy A14, 11 photos were downloaded 155 times over
 * a day of use, and one scroll through the Grit Club feed re-downloaded 9
 * photos 21 times. The cache key is the bucket and path from the signed URL.
 * That's safe because every upload path ends in a fresh `randomId()`, so a
 * path never points at different bytes. Signing still gates access: without
 * a URL the app can't show the image at all.
 *
 * Anything that isn't a signed storage URL (a local file:// or content://
 * URI from the picker or camera) is passed through, cached by URI as before.
 * Tied to Supabase Storage's `/object/sign/<bucket>/<path>` URL shape, which
 * is why it lives next to signBucketUrls: the R2 migration changes both.
 */
export function cachedImageSource(uri: string): { uri: string; cacheKey?: string } {
  const match = /\/storage\/v1\/object\/sign\/([^?]+)/.exec(uri);
  return match ? { uri, cacheKey: decodeURIComponent(match[1]) } : { uri };
}

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
