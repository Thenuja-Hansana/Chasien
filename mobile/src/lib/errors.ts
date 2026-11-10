/**
 * The message to show when an action fails.
 *
 * supabase-js returns a failed query's error as a plain object parsed from
 * the response (`{ code, message, details, hint }`), not an `Error`, and
 * `lib/` rethrows it as is. So the `e instanceof Error ? e.message :
 * fallback` checks screens used to do showed the fallback for every
 * database error, including the messages our own SQL writes for people to
 * read ("You must be friends to start a conversation.", the content
 * filter's refusal). Found in Phase 9's content-filter slice.
 *
 * This shows a message when we wrote it: any `Error` (thrown by our own
 * code, or an Edge Function's reply unwrapped by lib/), or a database error
 * raised by our own SQL: `raise exception` without a custom code, SQLSTATE
 * P0001. Everything else (permission and row-level-security refusals,
 * constraint violations, network failures) keeps the screen's own
 * fallback, so Postgres's technical wording never reaches people. SQL meant
 * to be read by people should therefore raise without a custom errcode.
 */
export function errorMessage(e: unknown, fallback: string): string {
  if (isNetworkError(e)) return NO_CONNECTION;
  if (e instanceof Error) return e.message;
  if (errorCode(e) === 'P0001') {
    const { message } = e as { message?: unknown };
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return fallback;
}

/** A database error's SQLSTATE (e.g. '23505', unique violation), when there is one. */
export function errorCode(e: unknown): string | undefined {
  if (typeof e !== 'object' || e === null) return undefined;
  const { code } = e as { code?: unknown };
  return typeof code === 'string' ? code : undefined;
}

/** What every failed request says when the network, not the request, was the problem. */
export const NO_CONNECTION = 'No connection. Check your internet and try again.';

/**
 * A request that never got an answer: the connection dropped or was
 * refused, or it timed out (lib/supabase.ts). Phase 10 slice 9.
 *
 * The global `fetch` here is Expo's native one (SDK 57), not React
 * Native's: a refused or dropped connection rejects with "fetch failed:
 * java.net.ConnectException: ..." (seen on the A14), where React Native's
 * says "Network request failed". A timeout from lib/supabase.ts says
 * "Network request timed out". supabase-js then reports it differently in
 * each part, so this checks the shapes it actually produces:
 * - a database query returns a plain object whose message is the fetch
 *   error's, prefixed with its name ("Error: fetch failed: ...");
 * - Storage and Auth rethrow an `Error` carrying that message;
 * - Edge Functions throw a `FunctionsFetchError`, with a message of its
 *   own, only when the request couldn't be made at all.
 * A server that answered with an error is not a network error, whatever
 * it said.
 */
export function isNetworkError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const { name, message } = e as { name?: unknown; message?: unknown };
  if (name === 'FunctionsFetchError') return true;
  return typeof message === 'string' && /fetch failed|Network request (failed|timed out)/.test(message);
}
