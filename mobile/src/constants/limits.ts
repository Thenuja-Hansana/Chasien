/**
 * How long each piece of text can be, in characters.
 *
 * These are the database's numbers, not the app's: each is a CHECK
 * constraint in supabase/migrations/20261002140000_text_length_limits.sql
 * (handle: the 3-30 rule on profiles since Phase 1). They are repeated here
 * so every input can stop at the limit with `maxLength`, instead of letting
 * someone type past it and then showing a refusal. Change a number there
 * first; changing it only here does nothing but confuse the two.
 *
 * `maxLength` counts UTF-16 code units and Postgres's char_length() counts
 * characters, so an input can stop a little short of the database's limit
 * when the text has emoji in it. It can never go over, which is the
 * direction that matters.
 */
export const Limits = {
  postText: 2000,
  comment: 1000,
  message: 4000,
  displayName: 50,
  handle: 30,
  bio: 160,
  roomName: 50,
  roomDescription: 300,
  subgroupName: 50,
  subgroupDescription: 300,
  storyCaption: 200,
  pollQuestion: 150,
  pollOption: 60,
  eventTitle: 100,
  eventLocation: 100,
  eventLink: 500,
  emailDomain: 255,
} as const;

/**
 * The longest clip, in seconds, in a post or a story. Video is uploaded as
 * it was recorded (there is no compression module in the app), so length is
 * what keeps a file inside the bucket's 25 MB limit
 * (20261002140200_upload_limits.sql) and the project inside its free-tier
 * storage. The camera stops recording here; a longer video from the gallery
 * can't be picked.
 */
export const MAX_CLIP_SECONDS = 60;

/** Shown when a gallery video is over the limit. */
export const CLIP_TOO_LONG_MESSAGE = `Clips can be up to ${MAX_CLIP_SECONDS} seconds long. Pick a shorter one.`;
