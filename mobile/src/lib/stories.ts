import { compressImageForUpload, randomId, signBucketUrls, uploadBase64, uploadLocalFile } from '@/lib/mediaUtils';
import { supabase } from '@/lib/supabase';
import type { PickedMedia } from '@/lib/media';

/**
 * Phase 7 stories. Shares its compress/upload/sign internals with post
 * images and chat attachments via lib/mediaUtils.ts, in its own
 * `story-media` bucket (supabase/migrations/20260901190000_story_media_storage.sql).
 *
 * Expiry isn't filtered here — `stories`' own SELECT policy
 * (supabase/migrations/20260813051235_row_level_security.sql) already
 * refuses to return a row past `expires_at`, so a plain unfiltered
 * SELECT can't see an expired story regardless of what this file does.
 * The actual purge of expired media from storage is
 * supabase/functions/cleanup-expired-stories, run hourly via pg_cron.
 *
 * The schema stores one `media_url` column, no separate image/video
 * flag — kind is inferred from the stored file's extension rather than
 * adding a column for it, since the upload path already fully controls
 * what that extension is (randomId() + a fixed .jpg/.mp4).
 */

const BUCKET = 'story-media';

export type Story = {
  id: string;
  room_id: string;
  author_id: string | null;
  media_url: string;
  kind: 'image' | 'video';
  caption: string | null;
  created_at: string;
  authorHandle: string;
  authorName: string;
};

function kindFromPath(path: string): 'image' | 'video' {
  return /\.mp4$/i.test(path) ? 'video' : 'image';
}

type StoryRow = {
  id: string;
  room_id: string;
  author_id: string | null;
  media_url: string;
  caption: string | null;
  created_at: string;
  profiles: { handle: string; name: string } | null;
};

/** Every active (non-expired, RLS already guarantees that) story in a Room, oldest first — matches the mock's flat sequential STORIES array. */
export async function fetchActiveStories(roomId: string): Promise<Story[]> {
  const { data, error } = await supabase
    .from('stories')
    .select('id, room_id, author_id, media_url, caption, created_at, profiles(handle, name)')
    .eq('room_id', roomId)
    .order('created_at', { ascending: true });
  if (error) throw error;

  return ((data ?? []) as unknown as StoryRow[]).map((row) => ({
    id: row.id,
    room_id: row.room_id,
    author_id: row.author_id,
    media_url: row.media_url,
    kind: kindFromPath(row.media_url),
    caption: row.caption,
    created_at: row.created_at,
    authorHandle: row.profiles?.handle ?? '',
    authorName: row.profiles?.name ?? 'Someone',
  }));
}

export async function createStory(roomId: string, userId: string, media: PickedMedia, caption: string | null): Promise<void> {
  let path: string;
  if (media.kind === 'image') {
    const base64 = await compressImageForUpload(media);
    path = `${roomId}/${userId}/${randomId()}.jpg`;
    await uploadBase64(BUCKET, path, base64, 'image/jpeg');
  } else {
    path = `${roomId}/${userId}/${randomId()}.mp4`;
    await uploadLocalFile(BUCKET, path, media.uri, 'video/mp4');
  }

  const { error } = await supabase
    .from('stories')
    .insert({ room_id: roomId, author_id: userId, media_url: path, caption: caption || null });
  if (error) throw error;
}

export function signStoryUrls(paths: string[]) {
  return signBucketUrls(BUCKET, paths);
}
