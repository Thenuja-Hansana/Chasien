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
