import { signMediaUrls } from '@/lib/media';
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
  /** The option this user picked, or null if they haven't voted. One vote per poll (schema PK). */
  myOptionId: string | null;
};

export type FeedPost = {
  id: string;
  authorId: string | null;
  authorHandle: string;
  authorName: string;
  /** owner/mod in this Room — drives the MOD badge the mock shows. */
  authorRole: 'owner' | 'mod' | 'member' | null;
  text: string | null;
  tag: string | null;
  createdAt: string;
  /** Signed, display-ready URLs. Empty when the post has no media. */
  imageUrls: string[];
  imageCount: number;
  likeCount: number;
  likedByMe: boolean;
  commentCount: number;
  poll: Poll | null;
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
  id, author_id, text, tag, created_at,
  profiles!posts_author_id_fkey(handle, name),
  post_media(url, position),
  post_likes(count),
  comments(count),
  polls(id, question, poll_options(id, label, position, poll_votes(count)))
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
  author_id: string | null;
  text: string | null;
  tag: string | null;
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
    poll_options: { id: string; label: string; position: number; poll_votes: { count: number }[] }[];
  } | null;
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
  const myVoteByPoll = new Map((votedRes.data ?? []).map((r) => [r.poll_id, r.poll_option_id]));

  return raw.map((p): FeedPost => {
    const rawPoll = p.polls ?? null;
    const options = (rawPoll?.poll_options ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((o) => ({ id: o.id, label: o.label, position: o.position, votes: o.poll_votes[0]?.count ?? 0 }));

    return {
      id: p.id,
      authorId: p.author_id,
      authorHandle: p.profiles?.handle ?? 'unknown',
      authorName: p.profiles?.name ?? 'Deleted user',
      authorRole: (p.author_id && roleByUser?.get(p.author_id)) || null,
      text: p.text,
      tag: p.tag,
      createdAt: p.created_at,
      imageUrls: p.post_media
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((m) => signedUrls.get(m.url))
        .filter((u): u is string => Boolean(u)),
      imageCount: p.post_media.length,
      likeCount: p.post_likes[0]?.count ?? 0,
      likedByMe: likedPostIds.has(p.id),
      commentCount: p.comments[0]?.count ?? 0,
      poll: rawPoll
        ? {
            id: rawPoll.id,
            question: rawPoll.question,
            options,
            totalVotes: options.reduce((sum, o) => sum + o.votes, 0),
            myOptionId: myVoteByPoll.get(rawPoll.id) ?? null,
          }
        : null,
    };
  });
}

export const FEED_PAGE_SIZE = 20;

/**
 * Reverse-chronological, paginated. Never ranked — `posts_room_feed_idx`
 * (room_id, created_at desc) exists precisely to make this ordering the
 * fast path, per feed.sql.
 */
export async function fetchRoomFeed(roomId: string, userId: string, page = 0) {
  const from = page * FEED_PAGE_SIZE;

  const [postsRes, membersRes] = await Promise.all([
    supabase
      .from('posts')
      .select(POST_SELECT)
      .eq('room_id', roomId)
      .is('deleted_at', null)
      .is(LIVE_COMMENTS_ONLY, null)
      .order('created_at', { ascending: false })
      .range(from, from + FEED_PAGE_SIZE - 1),
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

  return hydratePosts((postsRes.data ?? []) as unknown as RawPost[], userId, roleByUser);
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
}) {
  const { data, error } = await supabase.rpc('create_post', {
    p_room_id: params.roomId,
    p_text: params.text,
    p_tag: null,
    p_media_paths: params.mediaPaths,
    p_poll_question: params.pollQuestion,
    p_poll_options: params.pollOptions,
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
 * The schema allows one vote per poll (PK on poll_id, user_id) and there
 * is no UPDATE policy on poll_votes — only insert and delete-your-own. So
 * changing a vote is delete-then-insert, which is also what makes the
 * mock's "vote once, then see results" behaviour honest rather than
 * cosmetic: retracting is a real, permitted operation.
 */
export async function votePoll(pollId: string, optionId: string, userId: string, previousOptionId: string | null) {
  if (previousOptionId === optionId) return;

  if (previousOptionId) {
    const { error } = await supabase.from('poll_votes').delete().eq('poll_id', pollId).eq('user_id', userId);
    if (error) throw error;
  }

  const { error } = await supabase
    .from('poll_votes')
    .insert({ poll_id: pollId, poll_option_id: optionId, user_id: userId });
  if (error) throw error;
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
