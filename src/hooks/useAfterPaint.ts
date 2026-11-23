import { useEffect, useState } from 'react';

/**
 * False until the screen has painted once.
 *
 * Gate heavy queries with it: the main process runs SQLite synchronously, and
 * while it is busy the window cannot present a new frame, so firing queries on
 * mount keeps the previous screen frozen until the data arrives.
 */
export function useAfterPaint() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // Two frames: the first rAF runs before this frame paints, the second after it.
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => setReady(true));
    });
    return () => cancelAnimationFrame(id);
  }, []);
  return ready;
}
