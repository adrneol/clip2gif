import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import type { BackendState, Limits } from '../types';

export function useBackend(limitsSetter: (l: Limits | null) => void) {
  const [state, setState] = useState<BackendState>('checking');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const check = useCallback(async () => {
    setState((s) => (s === 'online' ? s : 'checking'));
    setError(null);
    const start = Date.now();
    const tick = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 500);
    // Retry with backoff: 2s, 4s, 8s ... up to ~70s total
    const delays = [0, 2000, 4000, 8000, 10000, 12000, 15000];
    let online = false;
    for (let i = 0; i < delays.length; i++) {
      if (i > 0) setState('starting');
      if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
      try {
        await api.health();
        online = true;
        break;
      } catch {
        // keep retrying
      }
    }
    window.clearInterval(tick);
    if (online) {
      setState('online');
      setElapsed(0);
      try {
        const l = await api.limits();
        limitsSetter(l.data);
      } catch { /* non-fatal */ }
    } else {
      setState('offline');
      setError('The converter service is not responding. It may still be waking up — try again.');
    }
  }, [limitsSetter]);

  useEffect(() => {
    check();
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [check]);

  return { state, elapsed, error, retry: check };
}
