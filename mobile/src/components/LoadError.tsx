import EmptyState from '@/components/EmptyState';

/**
 * What a screen shows when its first load failed and there's nothing on
 * it yet, instead of loading placeholders that never stop (Phase 10 slice
 * 9). Before this, a failed load left the skeleton running under a red
 * line with no way to try again but leaving and coming back. `message` is
 * the screen's own `errorMessage()` result, so a dropped connection reads
 * as one. The screen also reloads by itself when the connection returns
 * (`useOnReconnect`, lib/network.tsx).
 */
export default function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <EmptyState icon="alertCircle" heading="Couldn't load this" message={message} actionLabel="Try again" onAction={onRetry} />;
}
