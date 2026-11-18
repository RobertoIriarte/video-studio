import { useCallback, useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { api, ApiFailure } from './api';

type Pending = { path: string; schema: z.ZodType; body: string; key: string; method: 'POST' | 'PATCH' };
export function useCommand(onSuccess: (path: string, value: unknown) => void) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(); const [retryable, setRetryable] = useState(false);
  const lock = useRef(false); const pending = useRef<Pending | null>(null); const success = useRef(onSuccess); const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { success.current = onSuccess; }, [onSuccess]);
  const run = useCallback(async (request: Pending) => {
    if (lock.current) return; lock.current = true; setBusy(true); setError(undefined); setRetryable(false); pending.current = request;
    try {
      const value = await api(request.path, request.schema, { method: request.method, headers: { 'idempotency-key': request.key }, body: request.body });
      pending.current = null; if (alive.current) success.current(request.path, value);
    } catch (e) {
      if (!alive.current) return; setError(e);
      const uncertain = !(e instanceof ApiFailure) || e.status === 0 || e.status >= 500 || e.status === 429;
      setRetryable(uncertain); if (!uncertain) pending.current = null;
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  }, []);
  const send = (path: string, schema: z.ZodType, body: unknown, method: 'POST' | 'PATCH' = 'POST') => {
    if (pending.current) {
      if (pending.current.path !== path || pending.current.body !== JSON.stringify(body) || pending.current.method !== method) {
        setError(new ApiFailure(409, 'Reintenta primero la operación pendiente antes de cambiar de acción.')); setRetryable(true); return;
      }
      void run(pending.current); return;
    }
    void run({ path, schema, body: JSON.stringify(body), key: crypto.randomUUID(), method });
  };
  return { busy, error, retryable, send, retry: () => { if (pending.current) void run(pending.current); } };
}
