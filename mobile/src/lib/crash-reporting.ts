import * as Sentry from '@sentry/react-native';

/**
 * Crash reporting: Sentry's free plan (5,000 errors a month), switched off
 * until a key exists. Phase 10 slice 8 — see decision-log, 2026-11-09.
 *
 * Nothing here runs unless `EXPO_PUBLIC_SENTRY_DSN` is set, and even then
 * only a release build sends anything: a crash during development is on
 * Metro's screen already, and sending it would spend the month's quota.
 * Once started, Sentry catches uncaught JS errors, unhandled promise
 * rejections and native crashes on its own. A crash an error screen
 * catches never reaches it that way, so the screens call `reportError`.
 *
 * What a report may carry is kept to what a stack trace needs, because a
 * report leaves the Room-isolation guarantee behind it: Sentry is a third
 * party, and the developer reading reports isn't a member of every Room.
 * - No user id, no IP address (`sendDefaultPii: false`; the SDK tells the
 *   server not to infer one), no screenshot, no view hierarchy (it holds
 *   the screen's text: messages, posts, names), no session replay, no
 *   performance tracing, and no sessions: Sentry would otherwise report
 *   every app start and close, which is usage tracking, not crashes.
 * - Breadcrumbs are kept only for network requests and the app moving
 *   between foreground and background. Console output and touches are
 *   dropped (touches are labelled with accessibility labels, which carry a
 *   chat row's last message), and so are the battery, power-saving and
 *   network events Android's side adds, in `beforeSend`, since they never
 *   pass through `beforeBreadcrumb`. No network breadcrumbs were recorded
 *   at all when this was checked (7.11.0); the filter is for if they are.
 * - A request's URL loses its query string. Supabase puts filters there:
 *   Room and user ids, handles, search text, a verification token.
 * A report does carry Sentry's own install id: random, made by Sentry on
 * first launch, tied to neither the account nor the hardware. Android's
 * side adds it to native crash reports where this file can't reach.
 *
 * The privacy policy and Play's Data safety form must say crash logs and
 * diagnostics go to Sentry (store-compliance.md).
 */

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
const KEPT_BREADCRUMBS = new Set(['fetch', 'xhr', 'http', 'app.lifecycle']);

let started = false;

function withoutQuery(url: unknown): unknown {
  if (typeof url !== 'string') return url;
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/** Starts Sentry if a DSN is set. Called once, as the app's code loads. */
export function initCrashReporting() {
  if (!DSN || started) return;
  started = true;
  Sentry.init({
    dsn: DSN,
    enabled: !__DEV__,
    environment: __DEV__ ? 'development' : 'production',
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    tracesSampleRate: 0,
    enableAutoSessionTracking: false,
    beforeBreadcrumb(breadcrumb) {
      if (!breadcrumb.category || !KEPT_BREADCRUMBS.has(breadcrumb.category)) return null;
      if (breadcrumb.data?.url) {
        breadcrumb.data = { ...breadcrumb.data, url: withoutQuery(breadcrumb.data.url) };
      }
      return breadcrumb;
    },
    beforeSend(event) {
      delete event.user;
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs
          .filter((b) => b.category && KEPT_BREADCRUMBS.has(b.category))
          .map((b) => (b.data?.url ? { ...b, data: { ...b.data, url: withoutQuery(b.data.url) } } : b));
      }
      if (event.request?.url) event.request.url = withoutQuery(event.request.url) as string;
      return event;
    },
  });
}

/**
 * Reports a crash an error screen caught. `where` says which one: a single
 * screen, or the whole app (see `app/_layout.tsx`).
 */
export function reportError(error: unknown, where: 'screen' | 'app') {
  if (!started) return;
  Sentry.captureException(error, { tags: { boundary: where } });
}
