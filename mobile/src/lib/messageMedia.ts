import { compressImageForUpload, randomId, signBucketUrls, uploadBase64, uploadLocalFile, type PickedImage } from '@/lib/mediaUtils';

/**
 * Chat image + voice attachments. Shares its compress/upload/sign
 * internals with post images (lib/media.ts, Phase 5) via lib/mediaUtils.ts,
 * but is its own bucket: `message-media`'s RLS is scoped by
 * conversation_participants (supabase/migrations/20260815001933_message_media_storage.sql),
 * since a DM has no room_id for a Room-based policy to check the way
 * post-media's does. Image *picking* itself has nothing bucket-specific
 * about it — the chat composer reuses `pickImage()` from lib/media.ts
 * directly rather than a second copy of it here.
 *
 * Recording itself (start/stop/playback) uses expo-audio's
 * `useAudioRecorder` hook, which — being a hook — has to live in the
 * chat screen component, not here; this module only ever receives an
 * already-recorded local file's URI and uploads it.
 */

const BUCKET = 'message-media';

export async function uploadMessageImage(image: PickedImage, conversationId: string, userId: string): Promise<string> {
  const base64 = await compressImageForUpload(image);
  const path = `${conversationId}/${userId}/${randomId()}.jpg`;
  await uploadBase64(BUCKET, path, base64, 'image/jpeg');
  return path;
}

/** `fileUri` is the local recording produced by expo-audio's recorder — see ChatView's voice-message flow. */
export async function uploadMessageVoice(fileUri: string, conversationId: string, userId: string): Promise<string> {
  const path = `${conversationId}/${userId}/${randomId()}.m4a`;
  await uploadLocalFile(BUCKET, path, fileUri, 'audio/m4a');
  return path;
}

export function signMessageMediaUrls(paths: string[]) {
  return signBucketUrls(BUCKET, paths);
}
