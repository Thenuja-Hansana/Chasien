import { useCallback, useState } from 'react';

/**
 * Drives a text input's focus-highlight border. Every plain TextInput in
 * the app used to have exactly one hardcoded exception (the login
 * password field, styled as permanently "highlighted" regardless of
 * focus) and no real focus state anywhere else — this replaces that with
 * an actual onFocus/onBlur-driven highlight, reusable wherever a field
 * needs one.
 */
export function useFocusHighlight() {
  const [focused, setFocused] = useState(false);
  const onFocus = useCallback(() => setFocused(true), []);
  const onBlur = useCallback(() => setFocused(false), []);
  return { focused, onFocus, onBlur };
}
