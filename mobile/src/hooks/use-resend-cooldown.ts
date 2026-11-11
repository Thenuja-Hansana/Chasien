import { useEffect, useState } from 'react';

/**
 * Seconds left before another code can be asked for. Counts down from
 * `start()` (each time a code is sent), or from the first render when
 * `runningAtStart` is set: a screen reached just after a code went out.
 */
export function useResendCooldown(seconds: number, runningAtStart = false) {
  const [left, setLeft] = useState(runningAtStart ? seconds : 0);

  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);

  return { left, start: () => setLeft(seconds) };
}
