// Beskeder om udfaldet af en handling. De lever her — over siderne — så de
// overlever, at knappen, der udløste dem, forsvinder efter en genindlæsning.

import { useCallback, useState, useSyncExternalStore } from 'react';
import type { ApiResult } from './api.ts';
import { useFilm } from './data.ts';

export interface Flash {
  id: number;
  tone: 'ok' | 'fail' | 'info';
  text: string;
}

let items: Flash[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function flash(text: string, tone: Flash['tone'] = 'ok'): void {
  const id = ++seq;
  items = [...items.slice(-3), { id, tone, text }];
  emit();
  setTimeout(() => dismiss(id), tone === 'fail' ? 9000 : 5000);
}

export function dismiss(id: number): void {
  items = items.filter((f) => f.id !== id);
  emit();
}

export function useFlashes(): Flash[] {
  return useSyncExternalStore((l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  }, () => items);
}

// Kør et kald mod en Edge Function: viser udfaldet og henter filmen igen.
export function useRun() {
  const { reload } = useFilm();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(async <T,>(key: string, call: () => Promise<ApiResult<T>>, ok?: string | ((d: T) => string | undefined)): Promise<ApiResult<T>> => {
    setBusy(key);
    const res = await call();
    setBusy(null);
    if (res.ok) {
      const text = typeof ok === 'function' ? ok(res.data) : ok;
      if (text) flash(text, 'ok');
    } else {
      flash(res.message, 'fail');
    }
    await reload();
    return res;
  }, [reload]);
  return { busy, run };
}
