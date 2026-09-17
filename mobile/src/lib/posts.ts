import { signMediaUrls } from '@/lib/media';
import { mediaKindFromPath } from '@/lib/mediaUtils';
import { supabase } from '@/lib/supabase';

export type PollOption = {
  id: string;
  label: string;
  position: number;
  votes: number;
};

export type Poll = {
  id: string;
  question: string;
  options: PollOption[];
  totalVotes: number;
  /** Whether voters can pick more than one option — supabase/migrations/20260916120000_poll_allow_multiple.sql. */
  allowMultiple: boolean;
  /** The option(s) this user picked — always 0 or 1 unless allowMultiple. */
  myOptionIds: string[];
};

export type EventInfo = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  link: string | null;
};

export type PostMediaItem = { url: string; kind: 'image' | 'video' };

/** A person tagged in a post — also the shape the composer's people picker selects. */
export type TaggedPerson = { userId: string; handle: string; name: string };

/** Mirrors tag_people_in_post()'s limit in 20260916170100_post_tags.sql. */
export const MAX_POST_TAGS = 20;

export type FeedPost = {
  id: string;
  roomId: string;
  pinned: boolean;
  authorId: string | null;
  authorHandle: string;
  authorName: string;
  /** owner/mod in this Room — drives the MOD badge the mock shows. */
  authorRole: 'owner' | 'mod' | 'member' | null;
  text: string | null;
  tag: string | null;
  /** Free-text place name, 1–100 chars or null — see supabase/migrations/20260916160000_post_location.sql. */
  location: string | null;
  /** People tagged in the post, ordered by name. See supabase/migrations/20260916170100_post_tags.sql. */
  tags: TaggedPerson[];
  createdAt: string;
  /** Signed, display-ready URLs, ordered by position. Empty when the post has no media. */
  media: PostMediaItem[];
  likeCount: number;
  likedByMe: boolean;
  commentCount: number;
  poll: Poll | null;
  event: EventInfo | null;
};

export type Comment = {
  id: string;
  parentCommentId: string | null;
  authorId: string | null;
  authorHandle: string;
  authorName: string;
  text: string;
  createdAt: string;
};

/**
 * `posts` and `comments` each have TWO foreign keys to `profiles`
 * (author_id and removed_by), so a bare `profiles(...)` embed is
 * ambiguous and PostgREST rejects it outright with PGRST201 regardless of
 * data — the exact bug that silently broke Room Settings in Phase 4 (see
 * docs/phase/phase04.md §4). Always name the constraint.
 */
const POST_SELECT = `
  id, room_id, pinned, author_id, text, tag, location, created_at,
  profiles!posts_author_id_fkey(handle, name),
  post_media(url, position),
  post_likes(count),
  comments(count),
  polls(id, question, allow_multiple, poll_options(id, label, position, poll_votes(count))),
  events(id, title, starts_at, ends_at, location, link),
  post_tags(user_id, profiles(handle, name))
` as const;

/**
 * Applied to every query using POST_SELECT. Without it, `comments(count)`
 * counts soft-deleted comments too, so a post's comment badge would
 * disagree with the list on its own detail screen (which does filter
 * them) the moment Phase 9's moderation starts removing content. Nothing
 * soft-deletes comments yet, so this is a latent bug being closed before
 * it can surface rather than a visible one being fixed.
 */
const LIVE_COMMENTS_ONLY = 'comments.deleted_at' as const;

type RawPost = {
  id: string;
  room_id: string;
  pinned: boolean;
  author_id: string | null;
  text: string | null;
  tag: string | null;
  location: string | null;
  created_at: string;
  profiles: { handle: string; name: string } | null;
  post_media: { url: string; position: number }[];
  post_likes: { count: number }[];
  comments: { count: number }[];
  /**
   * An OBJECT, not an array — `polls.post_id` carries a UNIQUE
   * constraint (feed.sql), so PostgREST resolves posts→polls as
   * one-to-one and embeds a single row (or null), the same way it does
   * for the many-to-one `profiles` embed above. Reading this as
   * `polls[0]` silently yields undefined and makes every poll vanish
   * from the feed, which no amount of typechecking would have caught —
   * these are hand-written types over an untyped JSON response.
   */
  polls: {
    id: string;
    question: string;
    allow_multiple: boolean;
    poll_options: { id: string; label: string; position: number; poll_votes: { count: number }[] }[];
  } | null;
  /** An OBJECT, not an array — `events.post_id` is unique, same reasoning as `polls` above. */
  events: { id: string; title: string; starts_at: string; ends_at: string | null; location: string | null; link: string | null } | null;
  /** An array — a post has many tags. Already filtered by RLS to posts the viewer can read. */
  post_tags: { user_id: string; profiles: { handle: string; name: string } | null }[];
};

/**
 * Turns the raw PostgREST shape into something a screen can render, and
 * folds in the two things that can't come from the same query: which
 * posts *this* user liked, and which poll option they picked.
 *
 * Those are separate queries rather than filtered embeds on purpose — an
 * embed like `post_likes!inner(user_id)` filtered to auth.uid() would
 * drop every post that has no likes at all, which is most of them.
 */
async function hydratePosts(raw: RawPost[], userId: string, roleByUser?: Map<string, 'owner' | 'mod' | 'member'>) {
  const postIds = raw.map((p) => p.id);
  const pollIds = raw.flatMap((p) => (p.polls ? [p.polls.id] : []));
  const mediaPaths = raw.flatMap((p) => p.post_media.map((m) => m.url));

  const [likedRes, votedRes, signedUrls] = await Promise.all([
    postIds.length
      ? supabase.from('post_likes').select('post_id').eq('user_id', userId).in('post_id', postIds)
      : Promise.resolve({ data: [] as { post_id: string }[] }),
    pollIds.length
      ? supabase.from('poll_votes').select('poll_id, poll_option_id').eq('user_id', userId).in('poll_id', pollIds)
      : Promise.resolve({ data: [] as { poll_id: string; poll_option_id: string }[] }),
    signMediaUrls(mediaPaths),
  ]);

  const likedPostIds = new Set((likedRes.data ?? []).map((r) => r.post_id));
  // A poll allowing multiple answers can have more than one vote row for
  // the same (poll_id, user_id), so this groups into a list rather than
  // the single value hydratePosts used before allow_multiple existed.
  const myOptionIdsByPoll = new Map<string, string[]>();
  for (const r of votedRes.data ?? []) {
    const existing = myOptionIdsByPoll.get(r.poll_id);
    if (existing) existing.push(r.poll_option_id);
    else myOptionIdsByPoll.set(r.poll_id, [r.poll_option_id]);
  }

  return raw.map((p): FeedPost => {
    const rawPoll = p.polls ?? null;
    const options = (rawPoll?.poll_options ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((o) => ({ id: o.id, label: o.label, position: o.position, votes: o.poll_votes[0]?.count ?? 0 }));

    return {
      id: p.id,
      roomId: p.room_id,
      pinned: p.pinned,
      authorId: p.author_id,
      authorHandle: p.profiles?.handle ?? 'unknown',
      authorName: p.profiles?.name ?? 'Deleted user',
      authorRole: (p.author_id && roleByUser?.get(p.author_id)) || null,
      text: p.text,
      tag: p.tag,
      location: p.location,
      tags: (p.post_tags ?? [])
        .map((t) => ({ userId: t.user_id, handle: t.profiles?.handle ?? 'unknown', name: t.profiles?.name ?? 'Deleted user' }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      createdAt: p.created_at,
      media: p.post_media
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((m): PostMediaItem | null => {
          const url = signedUrls.get(m.url);
          return url ? { url, kind: mediaKindFromPath(m.url) } : null;
        })
        .filter((m): m is PostMediaItem => m !== null),
      likeCount: p.post_likes[0]?.count ?? 0,
      likedByMe: likedPostIds.has(p.id),
      commentCount: p.comments[0]?.count ?? 0,
      poll: rawPoll
        ? {
            id: rawPoll.id,
            question: rawPoll.question,
            options,
            totalVotes: options.reduce((sum, o) => sum + o.votes, 0),
            allowMultiple: rawPoll.allow_multiple,
            myOptionIds: myOptionIdsByPoll.get(rawPoll.id) ?? [],
          }
        : null,
      event: p.events
        ? {
            id: p.events.id,
            title: p.events.title,
            startsAt: p.events.starts_at,
            endsAt: p.events.ends_at,
            location: p.events.location,
            link: p.events.link,
          }
        : null,
    };
  });
}

export const FEED_PAGE_SIZE = 20;

/** Where the next page starts: the last post already loaded. `createdAt` must be the exact string the API returned (microseconds included). */
export type FeedCursor = { createdAt: string; id: string };

/**
 * Reverse-chronological, paginated. Never ranked — `posts_room_feed_idx`
 * (room_id, created_at desc) exists precisely to make this ordering the
 * fast path, per feed.sql.
 *
 * Keyset pagination: each page continues strictly after `after`, ordered by
 * (created_at, id). It used to be offset pagination ordered by created_at
 * alone, which broke two ways, both reproduced on the local stack
 * (2026-09-16): a post arriving while you scroll pushed the last row of the
 * previous page onto the next one (the same post twice — React's
 * duplicate-key warning), and a post removed from a loaded page (hide,
 * delete) pulled a row back so it was never shown at all. `id` breaks ties
 * between posts with the same timestamp, so none are skipped or repeated at
 * a page boundary either.
 */
export async function fetchRoomFeed(roomId: string, userId: string, after: FeedCursor | null = null) {
  return fetchPostsPage(roomId, userId, after, 'older', false);
}

/** A clip is what the Clip tab creates: a post whose only media is one video. A video inside a multi-photo post stays part of that post. */
export function isClipPost(post: Pick<FeedPost, 'media'>) {
  return post.media.length === 1 && post.media[0].kind === 'video';
}

export function cursorOf(post: Pick<FeedPost, 'createdAt' | 'id'>): FeedCursor {
  return { createdAt: post.createdAt, id: post.id };
}

/**
 * One page of a Room's clips for the full-screen viewer, in feed order, on
 * either side of `from`: 'older' continues down the feed, 'newer' goes back
 * up it (returned newest-first, like everything else). `nextCursor` is the
 * last *row* read in that direction — not the last clip — so paging keeps
 * moving even when a page's posts filter down to no clips.
 */
export async function fetchRoomClips(
  roomId: string,
  userId: string,
  from: FeedCursor,
  direction: 'older' | 'newer',
): Promise<{ clips: FeedPost[]; nextCursor: FeedCursor | null; reachedEnd: boolean }> {
  const page = await fetchPostsPage(roomId, userId, from, direction, true);
  const edge = direction === 'older' ? page[page.length - 1] : page[0];
  return {
    clips: page.filter(isClipPost),
    nextCursor: edge ? cursorOf(edge) : null,
    reachedEnd: page.length < FEED_PAGE_SIZE,
  };
}

async function fetchPostsPage(roomId: string, userId: string, cursor: FeedCursor | null, direction: 'older' | 'newer', videosOnly: boolean) {
  // Hidden posts are excluded before pagination (not filtered out of an
  // already-paged result afterward), so a page never comes back short just
  // because some of what it fetched happened to be hidden. A separate
  // query, not a join, for the same reason likes/votes are separate in
  // hydratePosts() below — this is a small, rarely-populated table, so an
  // extra round trip is cheaper than complicating the main feed query.
  const hiddenRes = await supabase.from('hidden_posts').select('post_id').eq('user_id', userId);
  const hiddenIds = (hiddenRes.data ?? []).map((r) => r.post_id as string);

  // For clips, a second, filtered embed of post_media under its own alias
  // (`!inner` = only posts with a matching row) narrows the page to posts
  // with a video, while POST_SELECT's own post_media still returns every
  // item — which isClipPost() needs to tell a clip from a carousel.
  let postsQuery = supabase
    .from('posts')
    .select(videosOnly ? `${POST_SELECT}, clip_media:post_media!inner(url)` : POST_SELECT)
    .eq('room_id', roomId)
    .is('deleted_at', null)
    .is(LIVE_COMMENTS_ONLY, null);
  if (videosOnly) {
    postsQuery = postsQuery.like('clip_media.url', '%.mp4');
  }
  if (hiddenIds.length > 0) {
    postsQuery = postsQuery.not('id', 'in', `(${hiddenIds.join(',')})`);
  }
  if (cursor) {
    // Quoted: a timestamp's ':' and '+' are otherwise read as PostgREST syntax.
    postsQuery =
      direction === 'older'
        ? postsQuery.or(`created_at.lt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.lt.${cursor.id})`)
        : postsQuery.or(`created_at.gt."${cursor.createdAt}",and(created_at.eq."${cursor.createdAt}",id.gt.${cursor.id})`);
  }
  // 'newer' reads upward from the cursor (ascending) so the rows nearest to
  // it come first, then flips back to feed order below.
  const ascending = direction === 'newer';

  const [postsRes, membersRes] = await Promise.all([
    postsQuery.order('created_at', { ascending }).order('id', { ascending }).limit(FEED_PAGE_SIZE),
    // Powers the OWNER/MOD badge. Every approved member can read the
    // other approved members of a Room they're in (see
    // 20260814073649_members_can_see_each_other.sql) — before that
    // policy existed this returned only the caller's own row, which made
    // the badge visible to moderators and nobody else.
    supabase.from('room_memberships').select('user_id, role').eq('room_id', roomId).eq('join_state', 'approved'),
  ]);

  if (postsRes.error) throw postsRes.error;

  const roleByUser = new Map<string, 'owner' | 'mod' | 'member'>(
    (membersRes.data ?? []).map((m) => [m.user_id as string, m.role as 'owner' | 'mod' | 'member']),
  );

  const rows = (postsRes.data ?? []) as unknown as RawPost[];
  return hydratePosts(ascending ? [...rows].reverse() : rows, userId, roleByUser);
}

/** Everyone who liked a post, most recent first. Room members can read a post's likes (post_likes' SELECT policy); nobody else gets rows. */
export async function fetchPostLikers(postId: string): Promise<TaggedPerson[]> {
  const { data, error } = await supabase
    .from('post_likes')
    .select('user_id, created_at, profiles(handle, name)')
    .eq('post_id', postId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => {
    const profile = row.profiles as unknown as { handle: string; name: string } | null;
    return { userId: row.user_id as string, handle: profile?.handle ?? 'unknown', name: profile?.name ?? 'Deleted user' };
  });
}

export async function fetchPost(postId: string, userId: string) {
  const { data, error } = await supabase
    .from('posts')
    .select(POST_SELECT)
    .eq('id', postId)
    .is('deleted_at', null)
    .is(LIVE_COMMENTS_ONLY, null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const [post] = await hydratePosts([data as unknown as RawPost], userId);
  return post ?? null;
}

/**
 * Comments are one level deep by design — a trigger in feed.sql rejects a
 * reply to a reply — so this returns a flat, chronological list and the
 * screen indents rows that have a parent, rather than building a tree.
 */
export async function fetchComments(postId: string) {
  const { data, error } = await supabase
    .from('comments')
    .select('id, parent_comment_id, author_id, text, created_at, profiles!comments_author_id_fkey(handle, name)')
    .eq('post_id', postId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error) throw error;

  return (data ?? []).map((c): Comment => {
    const profile = c.profiles as unknown as { handle: string; name: string } | null;
    return {
      id: c.id,
      parentCommentId: c.parent_comment_id,
      authorId: c.author_id,
      authorHandle: profile?.handle ?? 'unknown',
      authorName: profile?.name ?? 'Deleted user',
      text: c.text,
      createdAt: c.created_at,
    };
  });
}

/**
 * One transaction, server-side — see
 * supabase/migrations/20260814063725_create_post_rpc.sql for why this
 * isn't four client calls. Returns the new post's id.
 */
export async function createPost(params: {
  roomId: string;
  text: string;
  mediaPaths: string[];
  pollQuestion: string | null;
  pollOptions: string[];
  pollAllowMultiple?: boolean;
  /** Free-text place name; blank or omitted means none (the RPC trims and stores NULL). */
  location?: string | null;
  /**
   * People to tag. The server silently leaves out anyone who isn't an
   * approved member of the Room or has a block with the author either way,
   * so what was picked and what gets saved can differ — by design, so no
   * error ever reveals a block.
   */
  taggedUserIds?: string[];
}) {
  // Every parameter is sent on every call, `null` rather than omitted: a
  // key left `undefined` is dropped by JSON.stringify, and a call missing
  // parameters is exactly what turned create_event_post's leftover
  // overload into a PGRST203 error (see 20260916130000).
  const { data, error } = await supabase.rpc('create_post', {
    p_room_id: params.roomId,
    p_text: params.text,
    p_tag: null,
    p_media_paths: params.mediaPaths,
    p_poll_question: params.pollQuestion,
    p_poll_options: params.pollOptions,
    p_poll_allow_multiple: params.pollAllowMultiple ?? false,
    p_location: params.location ?? null,
    p_tagged_user_ids: params.taggedUserIds ?? [],
  });
  if (error) throw error;
  return data as string;
}

/**
 * The Event tab's own creation path — see
 * supabase/migrations/20260915150100_create_event_post_rpc.sql for why
 * this is a separate RPC from createPost() rather than more optional
 * parameters on it.
 */
export async function createEventPost(params: {
  roomId: string;
  text: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  link: string | null;
}) {
  const { data, error } = await supabase.rpc('create_event_post', {
    p_room_id: params.roomId,
    p_text: params.text,
    p_event_title: params.title,
    p_event_starts_at: params.startsAt,
    p_event_location: params.location,
    p_event_ends_at: params.endsAt,
    p_event_link: params.link,
  });
  if (error) throw error;
  return data as string;
}

export async function setLiked(postId: string, userId: string, liked: boolean) {
  if (liked) {
    const { error } = await supabase.from('post_likes').insert({ post_id: postId, user_id: userId });
    if (error) throw error;
  } else {
    const { error } = await supabase.from('post_likes').delete().eq('post_id', postId).eq('user_id', userId);
    if (error) throw error;
  }
}

/**
 * Who can be tagged in a new post in this Room: its approved members (which
 * fellow members may read — 20260814073649_members_can_see_each_other.sql),
 * minus the viewer and anyone the viewer has blocked. People who blocked the
 * viewer can't be filtered here (you can't see those blocks, deliberately);
 * create_post() drops them server-side without saying so.
 */
export async function fetchTaggableMembers(roomId: string, userId: string): Promise<TaggedPerson[]> {
  const [membersRes, blocksRes] = await Promise.all([
    supabase
      .from('room_memberships')
      .select('user_id, profiles!room_memberships_user_id_fkey(handle, name)')
      .eq('room_id', roomId)
      .eq('join_state', 'approved'),
    supabase.from('blocks').select('blocked_id').eq('blocker_id', userId),
  ]);
  if (membersRes.error) throw membersRes.error;
  if (blocksRes.error) throw blocksRes.error;
  const blocked = new Set((blocksRes.data ?? []).map((b) => b.blocked_id as string));
  return (membersRes.data ?? [])
    .filter((m) => m.user_id !== userId && !blocked.has(m.user_id))
    .map((m) => {
      const profile = m.profiles as unknown as { handle: string; name: string } | null;
      return { userId: m.user_id as string, handle: profile?.handle ?? 'unknown', name: profile?.name ?? 'Deleted user' };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Takes the viewer off a post they're tagged in. RLS lets a tagged person delete only their own tag. */
export async function removeMyTag(postId: string, userId: string): Promise<void> {
  const { error } = await supabase.from('post_tags').delete().eq('post_id', postId).eq('user_id', userId);
  if (error) throw error;
}

/** Personal, one-way for now — see hidden_posts' own migration comment for why there's no unhide() yet. */
export async function hidePost(postId: string, userId: string): Promise<void> {
  const { error } = await supabase.from('hidden_posts').insert({ post_id: postId, user_id: userId });
  if (error) throw error;
}

/**
 * Soft-deletes a post — restricted, server-side, to its own author or the
 * Room's owner (not moderators). See supabase/migrations/
 * 20260915140100_delete_post_rpc.sql for why this has to be an RPC rather
 * than a plain client update.
 */
export async function deletePost(postId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_post', { p_post_id: postId });
  if (error) throw error;
}

export async function addComment(postId: string, userId: string, text: string, parentCommentId: string | null = null) {
  const { error } = await supabase.from('comments').insert({
    post_id: postId,
    author_id: userId,
    text: text.trim(),
    parent_comment_id: parentCommentId,
  });
  if (error) throw error;
}

/**
 * Toggles this option for the caller: retracts it if already picked,
 * otherwise picks it — replacing any previous pick for a single-choice
 * poll, or adding alongside existing picks for a multi-select one. All of
 * that lives server-side in vote_poll() (supabase/migrations/
 * 20260916120200_vote_poll_rpc.sql) rather than being a client-side
 * read-then-write, since "how many active votes are allowed" now depends
 * on polls.allow_multiple rather than a flat schema constraint the client
 * could safely race against.
 */
export async function votePoll(pollId: string, optionId: string) {
  const { error } = await supabase.rpc('vote_poll', { p_poll_id: pollId, p_option_id: optionId });
  if (error) throw error;
}

export type RoomActivityPreview = { authorName: string; summary: string; createdAt: string };

const ACTIVITY_PREVIEW_MAX_CHARS = 60;

function truncate(text: string, max: number) {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max).trimEnd()}…` : trimmed;
}

/**
 * The single newest post in a Room, condensed into a WhatsApp/Telegram-
 * style "Name: content" line (plus its timestamp) for Home's Room list.
 * A poll's question takes priority over the post's own text (the more
 * notable content when both exist on one post). Below that, a photo's
 * camera-icon prefix always shows whenever the post has media — WhatsApp
 * never drops the 📷 just because a caption exists (it shows "📷 <caption>",
 * not the caption alone), so a captioned photo post here still reads as a
 * photo at a glance instead of getting mistaken for a plain text post.
 * Returns null when the Room has no posts yet — distinct from "still
 * loading", which the caller represents separately.
 *
 * Scoped to posts only, not stories: stories already get their own ring
 * on Home and expire in 24h, so folding them into "latest activity" would
 * make that phrase mean two different things depending on timing.
 */
export async function fetchLatestPostPreview(roomId: string): Promise<RoomActivityPreview | null> {
  const { data, error } = await supabase
    .from('posts')
    // post_media(id) — only its presence matters here (the 📷 prefix
    // below), not the URL: this preview never shows the image itself,
    // just the WhatsApp-style "📷 <caption>" text.
    .select('text, created_at, profiles!posts_author_id_fkey(name), post_media(id), polls(question), events(title)')
    .eq('room_id', roomId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const row = data as unknown as {
    text: string | null;
    created_at: string;
    profiles: { name: string } | null;
    post_media: { id: string }[];
    polls: { question: string } | null;
    events: { title: string } | null;
  };

  const summary = row.events
    ? `New event — ${row.events.title}`
    : row.polls
    ? `New poll — ${row.polls.question}`
    : row.post_media.length > 0
      ? row.text
        ? `📷 ${truncate(row.text, ACTIVITY_PREVIEW_MAX_CHARS)}`
        : '📷 Photo'
      : row.text
        ? truncate(row.text, ACTIVITY_PREVIEW_MAX_CHARS)
        : '';

  return {
    authorName: row.profiles?.name ?? 'Someone',
    summary,
    createdAt: row.created_at,
  };
}

export type AuthorPostPreview = {
  id: string;
  roomSlug: string;
  mediaPath: string | null;
  mediaKind: 'image' | 'video' | null;
  text: string | null;
  hasPoll: boolean;
};

/**
 * The user-preview popup's small "some recent posts" strip, and the full
 * profile page's own post grid. Deliberately just `eq('author_id', ...)`
 * with no room_id filter — RLS on `posts` already only returns rows from
 * Rooms the *viewer* is a member of, so this naturally shows only posts
 * both people can actually see, the same guarantee every other cross-Room
 * query in this app already leans on. `rooms(slug)` is only there so a
 * tapped thumbnail can link straight to `/c/[communityId]/post/[postId]`
 * — the same two-param route every other post link in the app already
 * uses — without a second round-trip to look the Room back up.
 */
export async function fetchRecentPostsByAuthor(authorId: string, limit = 3): Promise<AuthorPostPreview[]> {
  const { data, error } = await supabase
    .from('posts')
    .select('id, text, post_media(url), polls(id), rooms(slug)')
    .eq('author_id', authorId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  const rows = data as unknown as {
    id: string;
    text: string | null;
    post_media: { url: string }[];
    polls: { id: string } | null;
    rooms: { slug: string } | null;
  }[];
  return rows.map((row) => {
    const path = row.post_media[0]?.url ?? null;
    return {
      id: row.id,
      roomSlug: row.rooms?.slug ?? '',
      mediaPath: path,
      mediaKind: path ? mediaKindFromPath(path) : null,
      text: row.text,
      hasPoll: !!row.polls,
    };
  });
}

/** "Sep 15, 2026" and "7:30 PM" — the two pills the Event tab's "Starts"/"Ends" rows render side by side. */
export function formatEventDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
export function formatEventTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** "Sep 15, 2026 · 7:30 PM" — EventCard's single-line reading of the same date/time. */
export function formatEventDateTime(iso: string) {
  return `${formatEventDate(iso)} · ${formatEventTime(iso)}`;
}

/** "3h", "2d" — the compact relative stamp the mock uses on every post. */
export function relativeTime(iso: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  return new Date(iso).toLocaleDateString();
}
