import { useSyncExternalStore } from 'react';

// Điểm ngắt `lg` = 1024 px (token `--breakpoint-lg`): ≥ lg dùng thanh bên, < lg dùng thanh dưới.
const QUERY = '(min-width: 1024px)';

function subscribe(listener: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', listener);
  return () => {
    mql.removeEventListener('change', listener);
  };
}

function snapshot(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches;
}

export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
