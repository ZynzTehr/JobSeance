import { useCallback, useState } from "react";

/**
 * Tracks which rows have a request in flight. A single `busy` id would let the first
 * request to finish re-enable the controls of another one that is still running.
 */
export function useInFlight() {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());
  const start = useCallback((id: string) => setIds((s) => new Set(s).add(id)), []);
  const end = useCallback(
    (id: string) =>
      setIds((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      }),
    [],
  );
  return { isBusy: (id: string) => ids.has(id), start, end };
}
