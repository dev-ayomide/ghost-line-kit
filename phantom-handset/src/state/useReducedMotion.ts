import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function mql(): MediaQueryList | undefined {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
  return window.matchMedia(QUERY);
}

function subscribe(onChange: () => void): () => void {
  const m = mql();
  if (!m) return () => undefined;
  m.addEventListener('change', onChange);
  return () => m.removeEventListener('change', onChange);
}

const getSnapshot = (): boolean => mql()?.matches ?? false;
const getServerSnapshot = (): boolean => false;

/** True when the OS asks for reduced motion. Follows live changes. False without matchMedia. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
