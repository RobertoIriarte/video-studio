import { useCallback, useEffect, useState } from 'react';
import type { z } from 'zod';
import { api } from './api';

export function usePolling<T>(path: string, schema: z.ZodType<T>, intervalMs = 5000) {
  const [snapshot, setSnapshot] = useState<{ path: string; data: T }>(); const [error, setError] = useState<unknown>(); const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(navigator.onLine); const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let alive = true; let timer: ReturnType<typeof setTimeout> | undefined; let controller: AbortController | undefined; let running = false; let failures = 0; let wakePending = false;
    const canPoll = () => navigator.onLine && document.visibilityState !== 'hidden';
    setLoading(true); setError(undefined);
    const poll = async () => {
      if (!alive || running || !canPoll()) { if (alive) setLoading(false); return; }
      running = true; controller = new AbortController();
      try { const value = await api(path, schema, { signal: controller.signal }); if (alive) { setSnapshot({ path, data: value }); setError(undefined); failures = 0; } }
      catch (e) { if (alive && !controller.signal.aborted) { setError(e); failures++; } }
      finally {
        running = false;
        if (alive) {
          setLoading(false);
          if (wakePending && canPoll()) { wakePending = false; void poll(); }
          else timer = setTimeout(() => { void poll(); }, failures ? Math.min(30000, 5000 * 2 ** Math.min(failures, 3)) : Math.max(5000, Math.min(240000, intervalMs)));
        }
      }
    };
    const wake = () => { setOnline(navigator.onLine); if (timer) clearTimeout(timer); if (!canPoll()) controller?.abort(); else if (running) wakePending = true; else void poll(); };
    window.addEventListener('online', wake); window.addEventListener('offline', wake); document.addEventListener('visibilitychange', wake); void poll();
    return () => { alive = false; if (timer) clearTimeout(timer); controller?.abort(); window.removeEventListener('online', wake); window.removeEventListener('offline', wake); document.removeEventListener('visibilitychange', wake); };
  }, [path, schema, version, intervalMs]);
  return { data: snapshot?.path === path ? snapshot.data : undefined, error, loading, online, refresh };
}
