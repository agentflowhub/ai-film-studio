import { useRef, useState } from 'react';
import { api } from './api.ts';
import type { FilmData } from './data.ts';
import { changedPrice } from './describeError.ts';
import { useRun } from './flash.ts';
import { IdempotencyKey } from './idempotency.ts';
import { kr } from './shotState.ts';

// Fælles for Shot Editor og Produktion: start én generering med den viste pris.
// Har prisen ændret sig, vises den nye, og brugeren skal godkende igen.
export function useStartOne(d: FilmData) {
  const { busy, run } = useRun();
  const keys = useRef(new Map<string, IdempotencyKey>());
  const [repriced, setRepriced] = useState<Record<string, number>>({});
  async function start(id: string, item: Parameters<typeof api.start>[2][number], cents: number): Promise<void> {
    const k = keys.current.get(id) ?? new IdempotencyKey('gen');
    keys.current.set(id, k);
    const total = repriced[id] ?? cents;
    const res = await run(id, () => api.start(d.project.id, k.get(), [item], total), `Genereringen er startet (${kr(total)} reserveret).`);
    if (res.ok) {
      k.reset();
      setRepriced(({ [id]: _, ...rest }) => rest);
    } else {
      const price = changedPrice(res.body);
      if (price !== null) {
        k.reset();
        setRepriced((r) => ({ ...r, [id]: price }));
      }
    }
  }
  return { busy, start, repriced };
}
