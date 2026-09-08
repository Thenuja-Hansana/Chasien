import { compressImageForUpload, randomId, signBucketUrls, uploadBase64, type PickedImage } from '@/lib/mediaUtils';
import { supabase } from '@/lib/supabase';

/**
 * A Room's own avatar/banner photos — shares compress/upload/sign
 * internals with post/message/story media (lib/mediaUtils.ts) but its
 * own bucket, since it's readable more broadly than gated member content
 * (see supabase/migrations/20260908120000_room_avatar_banner.sql's own
 * comment on why). 'original' variant, not 'feed'/'story': neither of
 * those crop presets matches an avatar (square) or a banner (wide) shape,
 * and the display containers themselves already crop via
 * `contentFit="cover"` — cropping twice would just double-compress for
 * no benefit.
 */
const BUCKET = 'room-media';

export async function uploadRoomAvatar(image: PickedImage, roomId: string, userId: string): Promise<string> {
  const base64 = await compressImageForUpload(image);
  const path = `${roomId}/${userId}/${randomId()}.jpg`;
  await uploadBase64(BUCKET, path, base64, 'image/jpeg');
  return path;
}

export async function uploadRoomBanner(image: PickedImage, roomId: string, userId: string): Promise<string> {
  const base64 = await compressImageForUpload(image);
  const path = `${roomId}/${userId}/${randomId()}.jpg`;
  await uploadBase64(BUCKET, path, base64, 'image/jpeg');
  return path;
}

/** Best-effort — used to clean up an image whose Room row update never completed. */
export async function deleteRoomMedia(path: string): Promise<void> {
  await supabase.storage.from(BUCKET).remove([path]);
}

export function signRoomMediaUrls(paths: string[]) {
  return signBucketUrls(BUCKET, paths);
}
