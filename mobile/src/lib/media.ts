import * as ImagePicker from 'expo-image-picker';

import { compressImageForUpload, randomId, signBucketUrls, uploadBase64, type PickedImage } from '@/lib/mediaUtils';
import { supabase } from '@/lib/supabase';

/**
 * The one place that knows *where post images* physically live (chat
 * attachments have their own lib/messageMedia.ts, sharing the compress/
 * upload/sign internals in lib/mediaUtils.ts but not this bucket).
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

export type { PickedImage };

/** Returns null when the user cancels or declines the permission prompt. */
export async function pickImage(): Promise<PickedImage | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1, // Compression happens in compressImageForUpload() — don't do it twice.
  });
  if (result.canceled) return null;

  const asset = result.assets[0];
  return { uri: asset.uri, width: asset.width, height: asset.height };
}

export type PickedMedia = ({ kind: 'image' } & PickedImage) | { kind: 'video'; uri: string };

/**
 * Stories (Phase 7) accept either — the one media picker in the app that
 * does. Video isn't compressed client-side (no video-compression module
 * in this app; `story-media`'s size ceiling is set with that in mind —
 * see supabase/migrations/20260901190000_story_media_storage.sql), so
 * it's uploaded via uploadLocalFile() the same way voice notes are.
 */
export async function pickImageOrVideo(): Promise<PickedMedia | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images', 'videos'],
    quality: 1,
  });
  if (result.canceled) return null;

  const asset = result.assets[0];
  if (asset.type === 'video') return { kind: 'video', uri: asset.uri };
  return { kind: 'image', uri: asset.uri, width: asset.width, height: asset.height };
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
  const base64 = await compressImageForUpload(image);
  const path = `${roomId}/${userId}/${randomId()}.jpg`;
  await uploadBase64(BUCKET, path, base64, 'image/jpeg');
  return path;
}

/** Best-effort — used to clean up an image whose post row failed to insert. */
export async function deletePostImage(path: string): Promise<void> {
  await supabase.storage.from(BUCKET).remove([path]);
}

export function signMediaUrls(paths: string[]) {
  return signBucketUrls(BUCKET, paths);
}
