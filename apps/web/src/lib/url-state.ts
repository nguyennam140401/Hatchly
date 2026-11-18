import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

/** Trạng thái giao diện lưu trên URL (bộ lọc, tab, bước) – chia sẻ/tải lại không mất. */
export function useUrlState(
  key: string,
  fallback: string,
): [string, (value: string | null) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(key) ?? fallback;
  const set = useCallback(
    (next: string | null) => {
      setParams(
        (prev) => {
          const copy = new URLSearchParams(prev);
          if (next === null || next === fallback) copy.delete(key);
          else copy.set(key, next);
          return copy;
        },
        { replace: true },
      );
    },
    [key, fallback, setParams],
  );
  return [value, set];
}
