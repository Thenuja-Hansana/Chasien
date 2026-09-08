import { compressImageForUpload, randomId, signBucketUrls, uploadBase64, type PickedImage } from '@/lib/mediaUtils';

/**
 * A user's own profile photo — shares compress/upload/sign internals with
 * post/message/story/Room media (lib/mediaUtils.ts) but its own bucket,
 * since it's readable by any authenticated user regardless of shared Room
 * membership (see supabase/migrations/20260908140000_profile_avatar_storage.sql).
 * 'original' variant (the default), not 'feed'/'story': the display
 * container crops to a circle via Avatar's own borderRadius, so a second
 * crop preset here would just double-compress for no benefit.
 */
const BUCKET = 'profile-media';

export async function uploadProfileAvatar(image: PickedImage, userId: string): Promise<string> {
  const base64 = await compressImageForUpload(image);
  const path = `${userId}/${randomId()}.jpg`;
  await uploadBase64(BUCKET, path, base64, 'image/jpeg');
  return path;
}

export async function uploadProfileBanner(image: PickedImage, userId: string): Promise<string> {
  const base64 = await compressImageForUpload(image);
  const path = `${userId}/${randomId()}.jpg`;
  await uploadBase64(BUCKET, path, base64, 'image/jpeg');
  return path;
}

export function signProfileMediaUrls(paths: string[]) {
  return signBucketUrls(BUCKET, paths);
}
