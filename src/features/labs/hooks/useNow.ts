import { useEffect, useState } from 'react';
import { useNetworkStore } from '../../../store/useNetworkStore';

/** Current time (epoch milliseconds) from the store clock, refreshed on an interval while active. */
export function useNow(active: boolean, intervalMs = 1000): number {
  const clock = useNetworkStore((state) => state.runtime.clock);
  const [now, setNow] = useState(() => clock());

  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(clock()), intervalMs);
    return () => clearInterval(timer);
  }, [active, clock, intervalMs]);

  return now;
}
