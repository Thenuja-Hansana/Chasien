import type { Room, RoomRole } from '@/lib/rooms';

/**
 * A tiny in-memory "we already know this" cache, not a general data-fetching
 * layer — deliberately not React Query/SWR, since this app has exactly one
 * use for it: the Home tab's Room list already fetches every joined Room's
 * full row *and* the caller's role in it (`fetchMyRooms`), and tapping a row
 * used to throw that away and have the Room screen re-fetch the same room
 * (`fetchRoomBySlug`) plus the caller's membership (`fetchMyMembership`) from
 * scratch — two sequential round trips before the feed/stories fetch could
 * even start. Caching what Home already knows lets the Room screen render
 * its header immediately and start the feed/stories fetch right away,
 * instead of gating both behind a fresh room+membership check that, for the
 * common "open a Room you're already in" case, almost always comes back
 * unchanged. The Room screen still re-fetches room+membership in the
 * background to catch real changes (renamed Room, role changed, removed) —
 * this only removes it from the *critical path* of the first paint.
 *
 * Never populated for a Room the caller hasn't joined (Discover's list) —
 * there's no "myRole" to cache in that case, and that screen's own join flow
 * already handles first entry into a new Room.
 */
const cache = new Map<string, { room: Room; myRole: RoomRole }>();

export function cacheJoinedRoom(room: Room, myRole: RoomRole) {
  cache.set(room.slug, { room, myRole });
}

export function getCachedJoinedRoom(slug: string) {
  return cache.get(slug);
}
