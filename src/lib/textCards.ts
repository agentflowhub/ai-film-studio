// Tekst til den samlede film, tegnet af browseren som gennemsigtige PNG'er i
// filmens størrelse. ffmpeg lægger dem oven på billedet (filmExport.ts), så
// den ikke selv skal have skrifttyper med.

import { HEIGHT, WIDTH, type TextCard } from './filmExport.ts';

const FONT = '"Inter", "Helvetica Neue", Arial, sans-serif';

// Deler tekst i linjer, der kan være i bredden — og så lige lange som
// muligt, så sidste linje ikke står med ét ord alene.
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines = greedy(ctx, text, maxWidth);
  if (lines.length < 2) return lines;
  let lo = maxWidth / lines.length;
  let hi = maxWidth;
  for (let k = 0; k < 12; k++) {
    const mid = (lo + hi) / 2;
    if (greedy(ctx, text, mid).length > lines.length) lo = mid;
    else hi = mid;
  }
  return greedy(ctx, text, hi);
}

function greedy(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

// Tekst med mørk kant og skygge, så den kan læses på både lyse og mørke billeder.
function drawLines(ctx: CanvasRenderingContext2D, lines: string[], centerY: number, size: number, color: string, outline: boolean) {
  const lh = size * 1.25;
  const top = centerY - ((lines.length - 1) * lh) / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => {
    const y = top + i * lh;
    if (outline) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(4, size / 7);
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.strokeText(l, WIDTH / 2, y);
    }
    ctx.fillStyle = color;
    ctx.fillText(l, WIDTH / 2, y);
  });
}

export async function renderCard(card: TextCard): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas er ikke tilgængelig');
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 12;

  if (card.kind === 'caption') {
    ctx.font = `600 34px ${FONT}`;
    const lines = wrap(ctx, card.text, WIDTH * 0.8).slice(0, 3);
    drawLines(ctx, lines, HEIGHT - 70 - ((lines.length - 1) * 34 * 1.25) / 2, 34, '#ffffff', true);
  } else if (card.kind === 'title') {
    ctx.font = `700 76px ${FONT}`;
    const t = wrap(ctx, card.title, WIDTH * 0.8).slice(0, 2);
    drawLines(ctx, t, HEIGHT * 0.62, 76, '#ffffff', true);
    if (card.subtitle) {
      ctx.font = `500 32px ${FONT}`;
      drawLines(ctx, wrap(ctx, card.subtitle, WIDTH * 0.7).slice(0, 2), HEIGHT * 0.62 + t.length * 48 + 20, 32, '#ffffff', true);
    }
  } else if (card.kind === 'tagline') {
    ctx.font = `700 54px ${FONT}`;
    drawLines(ctx, wrap(ctx, card.text, WIDTH * 0.75).slice(0, 3), HEIGHT * 0.42, 54, '#ffffff', true);
  } else {
    ctx.shadowBlur = 0;
    if (card.tagline) {
      ctx.font = `700 50px ${FONT}`;
      drawLines(ctx, wrap(ctx, card.tagline, WIDTH * 0.75).slice(0, 3), HEIGHT * 0.42, 50, '#ffffff', false);
    }
    if (card.sender) {
      ctx.font = `600 36px ${FONT}`;
      drawLines(ctx, [card.sender], HEIGHT * (card.tagline ? 0.66 : 0.5), 36, 'rgba(255,255,255,0.85)', false);
    }
  }

  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('teksten kunne ikke tegnes');
  return new Uint8Array(await blob.arrayBuffer());
}
