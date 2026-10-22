import { useEffect, useState } from 'react';

/**
 * False until React has hydrated. Buttons wired to client-side handlers stay disabled until
 * then, so an early click isn't lost (or turned into a native form submission).
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
