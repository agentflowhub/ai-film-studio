// Hele filmen som én MP4 — samlet i browseren med ffmpeg (WebAssembly), så
// intet køres eller betales på serveren. Samme rækkefølge og indhold som
// Preview: godkendt video, ellers startframen i shottets længde, ellers sort.
//
// Sådan undgås hak mellem klippene:
//  1. Hvert shot gøres til et mellemklip i nøjagtig samme format, og billede
//     og lyd skæres til PRÆCIS samme længde (hele billeder, hele lydprøver),
//     så intet spor kommer foran det andet ved samlingen.
//  2. Billedhastigheden følger filmens første video (24/25/30 fps), så ingen
//     billeder kastes væk eller gentages undervejs.
//  3. Mellemklippene har ukomprimeret lyd og samles til sidst med én
//     sammenhængende omkodning — ikke ved at lime færdige MP4-filer sammen.
//  4. Lyden tones ind/ud over 20 ms i hver samling, så der ikke kommer klik.
//     Valgfrit: bløde overgange (kort toning via sort) i stedet for hårde klip.
//
// Oven på billedet, i samme sidste omkodning:
//  - Voiceover: replik-lyden lægges ind på tidslinjen, hvor dens shot starter,
//    og må fortsætte hen over de næste shots. Klippenes egen lyd dæmpes imens.
//  - Tekster på replikker, titel over åbningen, slogan over sidste billede og
//    et sort slutskilt. Teksten tegnes af browseren som gennemsigtige billeder
//    (textCards.ts), så ffmpeg ikke skal have skrifttyper med.
//
// ffmpeg-kernen (~30 MB) ligger i vores eget build og hentes først, når
// brugeren trykker "Hent film".

export const WIDTH = 1280;
export const HEIGHT = 720;
export const RATE = 48000;
export const SOFT_SECONDS = 0.3;

// Shottets godkendte replik: lyden, ordene og om taleren ses eller høres over billedet.
export interface ExportLine {
  url: string;
  text: string;
  mode: 'on_camera' | 'voiceover';
}

export type ExportPart = (
  // Video skæres til shottets længde fra storyboardet. En talende video
  // skæres aldrig før replikken er sagt færdig.
  | { kind: 'video'; url: string; seconds: number }
  | { kind: 'still'; url: string; seconds: number }
  | { kind: 'black'; seconds: number }
) & { line?: ExportLine | null };

export type Transition = 'cut' | 'soft';

// Tekst, der lægges oven på billedet. Tegnes af browseren (textCards.ts).
export type TextCard =
  | { kind: 'caption'; text: string }
  | { kind: 'title'; title: string; subtitle: string | null }
  | { kind: 'tagline'; text: string }
  | { kind: 'endcard'; tagline: string | null; sender: string | null };

export interface ExportOptions {
  transition: Transition;
  captions: boolean;
  title: string | null;
  subtitle: string | null;
  tagline: string | null;
  sender: string | null;
  // Tegner et gennemsigtigt PNG i filmens størrelse.
  render: (card: TextCard) => Promise<Uint8Array>;
}

export const TITLE_SECONDS = 3.5;
export const TAGLINE_SECONDS = 3;
export const ENDCARD_SECONDS = 3.5;
// Klippenes egen lyd, mens en voiceover taler.
export const DUCK_VOLUME = 0.3;

const SILENCE = ['-f', 'lavfi', '-i', `anullsrc=r=${RATE}:cl=stereo`];
const MEZZANINE = ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '12', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le'];
const FINAL = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'];

// Hvor langt et videoklip skal være i filmen: shottets længde, men aldrig
// længere end klippet selv, og for en talende video aldrig kortere end
// replikken plus et lille åndehul.
export function clipSeconds(clip: number, shot: number, speech: number | null): number {
  const wanted = speech ? Math.max(shot, speech + 0.4) : shot;
  return Math.max(0.5, Math.min(clip, wanted > 0 ? wanted : clip));
}

// Længde i hele billeder, så billede og lyd kan skæres helt ens.
export function frameCount(seconds: number, fps: number): number {
  return Math.max(1, Math.round(seconds * fps));
}

// ffmpeg-argumenter, der gør ét shot til et mellemklip i filmens format.
export function clipArgs(part: ExportPart, input: string, output: string, o: { hasAudio: boolean; seconds: number; fps: number; transition: Transition }): string[] {
  const frames = frameCount(o.seconds, o.fps);
  const exact = frames / o.fps;
  const samples = Math.round(exact * RATE);
  const pad = String(Math.ceil(exact) + 1);
  const source =
    part.kind === 'video' ? ['-i', input]
      : part.kind === 'still' ? ['-loop', '1', '-t', pad, '-i', input]
        : ['-f', 'lavfi', '-t', pad, '-i', `color=c=black:s=${WIDTH}x${HEIGHT}:r=${o.fps}`];
  const audio = part.kind === 'video' && o.hasAudio ? '[0:a]' : '[1:a]';
  const fade = o.transition === 'soft' ? Math.min(SOFT_SECONDS, exact / 3) : 0;
  const vFade = fade ? `,fade=t=in:d=${fade.toFixed(3)},fade=t=out:st=${(exact - fade).toFixed(3)}:d=${fade.toFixed(3)}` : '';
  const aFade = Math.max(fade, 0.02);
  const v = `[0:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${o.fps},format=yuv420p,trim=end_frame=${frames},setpts=PTS-STARTPTS${vFade}[v]`;
  const a = `${audio}aresample=${RATE},aformat=sample_rates=${RATE}:channel_layouts=stereo,apad,atrim=end_sample=${samples},asetpts=PTS-STARTPTS,afade=t=in:d=${aFade.toFixed(3)},afade=t=out:st=${(exact - aFade).toFixed(3)}:d=${aFade.toFixed(3)}[a]`;
  return [...source, ...SILENCE, '-filter_complex', `${v};${a}`, '-map', '[v]', '-map', '[a]', '-r', String(o.fps), ...MEZZANINE, output];
}

export interface Timed { file: string; start: number; end: number }

const sec = (n: number) => n.toFixed(3);

// Samlingen tæller tiden forfra ud fra antal billeder og lydprøver i stedet
// for mellemklippenes tidsstempler, som containeren runder til hele
// millisekunder. Afrundingen giver ellers små huller i lyden ved hver samling.
// Voiceovers lægges ind fra deres start; tekstbilleder vises i deres vindue.
export function finalArgs(list: string, output: string, fps: number, voices: Timed[] = [], overlays: Timed[] = []): string[] {
  const inputs = ['-f', 'concat', '-safe', '0', '-i', list];
  for (const v of voices) inputs.push('-i', v.file);
  for (const o of overlays) inputs.push('-i', o.file);
  const graph: string[] = [];
  // Billede: tiden forfra, derefter hvert tekstbillede i sit vindue.
  graph.push('[0:v]setpts=N/FRAME_RATE/TB[v0]');
  overlays.forEach((o, i) => {
    graph.push(`[v${i}][${1 + voices.length + i}:v]overlay=0:0:eof_action=repeat:enable='between(t,${sec(o.start)},${sec(o.end)})'[v${i + 1}]`);
  });
  // Lyd: klippenes lyd dæmpes, mens en voiceover taler, og voiceoverne blandes ind.
  const duck = voices.length ? `,volume='if(${voices.map((v) => `between(t,${sec(v.start)},${sec(v.end)})`).join('+')},${DUCK_VOLUME},1)':eval=frame` : '';
  graph.push(`[0:a]asetpts=N/SR/TB${duck}[a0]`);
  voices.forEach((v, i) => {
    const ms = Math.round(v.start * 1000);
    graph.push(`[${1 + i}:a]aresample=${RATE},aformat=sample_rates=${RATE}:channel_layouts=stereo,adelay=${ms}|${ms}[vo${i}]`);
  });
  const audioOut = voices.length ? 'a' : 'a0';
  if (voices.length) graph.push(`[a0]${voices.map((_, i) => `[vo${i}]`).join('')}amix=inputs=${voices.length + 1}:duration=first:normalize=0[a]`);
  return [...inputs, '-filter_complex', graph.join(';'), '-map', `[v${overlays.length}]`, '-map', `[${audioOut}]`, '-r', String(fps), ...FINAL, output];
}

// Replikkens ord delt i tekststykker på højst to linjer, vist i takt med
// talen: hvert stykke får tid efter, hvor mange tegn det har.
export function captionChunks(text: string, seconds: number, maxChars = 76): { text: string; start: number; end: number }[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (!words.length || seconds <= 0) return [];
  const chunks: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    // Et nyt stykke ved sætningsslut, når stykket allerede har fået noget længde.
    if (next.length > maxChars && cur) { chunks.push(cur); cur = w; continue; }
    cur = next;
    if (/[.!?]$/.test(w) && cur.length > maxChars / 3) { chunks.push(cur); cur = ''; }
  }
  if (cur) chunks.push(cur);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  let t = 0;
  return chunks.map((c) => {
    const d = (c.length / total) * seconds;
    const out = { text: c, start: t, end: t + d };
    t += d;
    return out;
  });
}

// Hvor filmens shots starter og slutter, når de er skåret til hele billeder.
export function timeline(seconds: number[], fps: number): { start: number; end: number }[] {
  let t = 0;
  return seconds.map((s) => {
    const d = frameCount(s, fps) / fps;
    const out = { start: t, end: t + d };
    t += d;
    return out;
  });
}

export function concatList(files: string[]): string {
  return files.map((f) => `file '${f}'`).join('\n');
}

// Filnavn ud fra filmens titel: kun tegn, alle systemer accepterer.
export function fileName(title: string): string {
  // Danske bogstaver først; NFKD ville ellers gøre å til a.
  const base = title.normalize('NFC')
    .replace(/[æÆ]/g, (c) => (c === 'æ' ? 'ae' : 'Ae')).replace(/[øØ]/g, (c) => (c === 'ø' ? 'oe' : 'Oe')).replace(/[åÅ]/g, (c) => (c === 'å' ? 'aa' : 'Aa'))
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-');
  return `${base || 'film'}.mp4`;
}

// ffmpeg skriver strømmene ud, når den læser en fil; en lydstrøm ser sådan ud.
export const hasAudioStream = (log: string) => /Stream #\d+:\d+.*: Audio:/.test(log);

// Længden fra samme log ("Duration: 00:00:05.04"); 0, hvis den ikke findes.
export function durationOf(log: string): number {
  const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(log);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

// Billedhastigheden fra samme log (", 24 fps,"), rundet til hele billeder.
// 23,976 bliver 24 og 29,97 bliver 30; ukendt eller urimelig giver 24.
export function fpsOf(log: string): number {
  const m = /Video:.*?, (\d+(?:\.\d+)?) fps/.exec(log);
  const n = m ? Math.round(Number(m[1])) : 0;
  return n >= 12 && n <= 60 ? n : 24;
}

export async function exportFilm(input: ExportPart[], o: ExportOptions, onProgress: (share: number, step: string) => void): Promise<Blob> {
  const [{ FFmpeg }, { fetchFile }, { default: coreURL }, { default: wasmURL }] = await Promise.all([
    import('@ffmpeg/ffmpeg'), import('@ffmpeg/util'), import('@ffmpeg/core?url'), import('@ffmpeg/core/wasm?url'),
  ]);
  // Slutskiltet er et sort shot til sidst med slogan og afsender.
  const endcard = !!(o.tagline || o.sender);
  const parts: ExportPart[] = endcard ? [...input, { kind: 'black', seconds: ENDCARD_SECONDS }] : input;
  const ff = new FFmpeg();
  let log = '';
  ff.on('log', ({ message }) => { log += `${message}\n`; });
  let at = 0;
  const steps = parts.length + 2; // hentning og aflæsning tæller med, samlingen fylder et helt trin
  ff.on('progress', ({ progress }) => onProgress((at + 1 + Math.min(1, Math.max(0, progress))) / steps, at < parts.length ? `Shot ${at + 1} af ${parts.length}` : 'Samler filmen …'));
  onProgress(0, 'Henter videoværktøjet …');
  await ff.load({ coreURL, wasmURL });
  // Læser en fil og returnerer ffmpegs beskrivelse af den.
  const probe = async (name: string) => {
    log = '';
    await ff.exec(['-hide_banner', '-i', name]); // fejler bevidst (intet output), men logger strømmene
    return log;
  };
  try {
    // Først alle kilder ind, så filmens billedhastighed kendes, før noget omkodes.
    const info: { input: string; hasAudio: boolean; seconds: number; line: { file: string; seconds: number } | null }[] = [];
    let fps = 0;
    for (const [i, part] of parts.entries()) {
      onProgress(i / parts.length / steps, `Henter shot ${i + 1} af ${parts.length}`);
      const input = `in${i}`;
      let line: { file: string; seconds: number } | null = null;
      if (part.line) {
        const file = `line${i}.wav`;
        await ff.writeFile(file, await fetchFile(part.line.url));
        const d = durationOf(await probe(file));
        if (d) line = { file, seconds: d };
      }
      if (part.kind === 'black') { info.push({ input, hasAudio: false, seconds: part.seconds, line }); continue; }
      await ff.writeFile(input, await fetchFile(part.url));
      if (part.kind === 'still') { info.push({ input, hasAudio: false, seconds: part.seconds, line }); continue; }
      const l = await probe(input);
      const clip = durationOf(l);
      if (!clip) throw new Error(`shot ${i + 1}: videoen kunne ikke læses`);
      fps ||= fpsOf(l);
      const speech = part.line?.mode === 'on_camera' ? line?.seconds ?? null : null;
      info.push({ input, hasAudio: hasAudioStream(l), seconds: clipSeconds(clip, part.seconds, speech), line });
    }
    fps ||= 24;

    const outs: string[] = [];
    for (const [i, part] of parts.entries()) {
      at = i;
      const { input, hasAudio, seconds } = info[i]!;
      const out = `c${i}.mkv`;
      const code = await ff.exec(clipArgs(part, input, out, { hasAudio, seconds, fps, transition: o.transition }));
      if (code !== 0) throw new Error(`shot ${i + 1} kunne ikke omkodes`);
      if (part.kind !== 'black') await ff.deleteFile(input);
      outs.push(out);
    }

    // Tidslinjen: voiceovers og tekst placeres ud fra, hvor shottene faktisk ligger.
    const times = timeline(info.map((x) => x.seconds), fps);
    const filmEnd = times.at(-1)!.end;
    const voices: Timed[] = [];
    const overlays: Timed[] = [];
    const card = async (c: TextCard, start: number, end: number) => {
      const file = `t${overlays.length}.png`;
      await ff.writeFile(file, await o.render(c));
      overlays.push({ file, start, end: Math.min(end, filmEnd) });
    };
    for (const [i, part] of parts.entries()) {
      const line = info[i]!.line;
      if (!part.line || !line) continue;
      const start = times[i]!.start;
      if (part.line.mode === 'voiceover') voices.push({ file: line.file, start, end: Math.min(start + line.seconds, filmEnd) });
      if (o.captions) for (const c of captionChunks(part.line.text, line.seconds)) await card({ kind: 'caption', text: c.text }, start + c.start, start + c.end);
    }
    const first = times[0]!;
    if (o.title) await card({ kind: 'title', title: o.title, subtitle: o.subtitle }, first.start, Math.min(first.end, TITLE_SECONDS));
    const lastShot = times[endcard ? times.length - 2 : times.length - 1];
    if (o.tagline && lastShot) await card({ kind: 'tagline', text: o.tagline }, Math.max(lastShot.start, lastShot.end - TAGLINE_SECONDS), lastShot.end);
    if (endcard) await card({ kind: 'endcard', tagline: o.tagline, sender: o.sender }, times.at(-1)!.start, filmEnd);

    at = parts.length;
    onProgress((parts.length + 1) / steps, 'Samler filmen …');
    await ff.writeFile('list.txt', concatList(outs));
    const code = await ff.exec(finalArgs('list.txt', 'film.mp4', fps, voices, overlays));
    if (code !== 0) throw new Error('klippene kunne ikke samles');
    const data = await ff.readFile('film.mp4');
    if (typeof data === 'string') throw new Error('uventet output');
    onProgress(1, 'Færdig');
    return new Blob([data.slice().buffer], { type: 'video/mp4' });
  } finally {
    ff.terminate();
  }
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
