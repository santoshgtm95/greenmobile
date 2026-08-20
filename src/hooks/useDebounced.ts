import { useEffect, useState } from 'react';

/**
 * Delays a rapidly-changing value.
 *
 * Search boxes use this so a query is not fired per keystroke — which matters
 * once a shop has tens of thousands of products (spec §78).
 */
export function useDebounced<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
