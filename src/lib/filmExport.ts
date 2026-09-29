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
// ffmpeg-kernen (~30 MB) ligger i vores eget build og hentes først, når
// brugeren trykker "Hent film".

export const WIDTH = 1280;
export const HEIGHT = 720;
export const RATE = 48000;
export const SOFT_SECONDS = 0.3;

export type ExportPart =
  // Video skæres til shottets længde fra storyboardet. En talende video
  // skæres aldrig før replikken er sagt færdig (`speechUrl` er replik-lyden).
  | { kind: 'video'; url: string; seconds: number; speechUrl?: string | null }
  | { kind: 'still'; url: string; seconds: number }
  | { kind: 'black'; seconds: number };

export type Transition = 'cut' | 'soft';

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

// Samlingen tæller tiden forfra ud fra antal billeder og lydprøver i stedet
// for mellemklippenes tidsstempler, som containeren runder til hele
// millisekunder. Afrundingen giver ellers små huller i lyden ved hver samling.
export function finalArgs(list: string, output: string, fps: number): string[] {
  return ['-f', 'concat', '-safe', '0', '-i', list, '-vf', 'setpts=N/FRAME_RATE/TB', '-af', 'asetpts=N/SR/TB', '-r', String(fps), ...FINAL, output];
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

export async function exportFilm(parts: ExportPart[], transition: Transition, onProgress: (share: number, step: string) => void): Promise<Blob> {
  const [{ FFmpeg }, { fetchFile }, { default: coreURL }, { default: wasmURL }] = await Promise.all([
    import('@ffmpeg/ffmpeg'), import('@ffmpeg/util'), import('@ffmpeg/core?url'), import('@ffmpeg/core/wasm?url'),
  ]);
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
    const info: { input: string; hasAudio: boolean; seconds: number }[] = [];
    let fps = 0;
    for (const [i, part] of parts.entries()) {
      onProgress(i / parts.length / steps, `Henter shot ${i + 1} af ${parts.length}`);
      const input = `in${i}`;
      if (part.kind === 'black') { info.push({ input, hasAudio: false, seconds: part.seconds }); continue; }
      await ff.writeFile(input, await fetchFile(part.url));
      if (part.kind === 'still') { info.push({ input, hasAudio: false, seconds: part.seconds }); continue; }
      const l = await probe(input);
      const clip = durationOf(l);
      if (!clip) throw new Error(`shot ${i + 1}: videoen kunne ikke læses`);
      fps ||= fpsOf(l);
      let speech: number | null = null;
      if (part.speechUrl) {
        await ff.writeFile(`sp${i}`, await fetchFile(part.speechUrl));
        speech = durationOf(await probe(`sp${i}`)) || null;
        await ff.deleteFile(`sp${i}`);
      }
      info.push({ input, hasAudio: hasAudioStream(l), seconds: clipSeconds(clip, part.seconds, speech) });
    }
    fps ||= 24;

    const outs: string[] = [];
    for (const [i, part] of parts.entries()) {
      at = i;
      const { input, hasAudio, seconds } = info[i]!;
      const out = `c${i}.mkv`;
      const code = await ff.exec(clipArgs(part, input, out, { hasAudio, seconds, fps, transition }));
      if (code !== 0) throw new Error(`shot ${i + 1} kunne ikke omkodes`);
      if (part.kind !== 'black') await ff.deleteFile(input);
      outs.push(out);
    }
    at = parts.length;
    onProgress((parts.length + 1) / steps, 'Samler filmen …');
    await ff.writeFile('list.txt', concatList(outs));
    const code = await ff.exec(finalArgs('list.txt', 'film.mp4', fps));
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
