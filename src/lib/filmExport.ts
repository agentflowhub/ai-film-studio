// Hele filmen som én MP4 — samlet i browseren med ffmpeg (WebAssembly), så
// intet køres eller betales på serveren. Samme rækkefølge og indhold som
// Preview: godkendt video, ellers startframen i shottets længde, ellers sort.
//
// Hvert shot omkodes først til samme format (1280x720, 24 fps, H.264 + AAC
// stereo), så klippene kan sættes sammen uden ny omkodning. Klip uden lyd får
// stilhed, så lyden ikke forskubber sig mellem shots.
//
// ffmpeg-kernen (~30 MB) ligger i vores eget build og hentes først, når
// brugeren trykker "Hent film".

export const WIDTH = 1280;
export const HEIGHT = 720;
export const FPS = 24;

export type ExportPart =
  | { kind: 'video'; url: string }
  | { kind: 'still'; url: string; seconds: number }
  | { kind: 'black'; seconds: number };

const ENCODE = [
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS),
  '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
];
const SILENCE = ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo'];
const FIT = `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${FPS},format=yuv420p`;

const secs = (n: number) => String(Math.max(0.5, Math.round(n * 100) / 100));

// ffmpeg-argumenter, der gør ét shot til et ensartet klip. `input` er filen i
// ffmpegs filsystem (ikke brugt for sort); `hasAudio` og `videoSeconds` gælder
// kun video. Klippets længde sættes eksplicit med -t: stilheden og apad er
// uendelige, og -shortest stopper ikke pålideligt, når lyden er forlænget.
export function clipArgs(part: ExportPart, input: string, output: string, hasAudio: boolean, videoSeconds = 0): string[] {
  const source =
    part.kind === 'video' ? ['-i', input]
      : part.kind === 'still' ? ['-loop', '1', '-t', secs(part.seconds), '-i', input]
        : ['-f', 'lavfi', '-t', secs(part.seconds), '-i', `color=c=black:s=${WIDTH}x${HEIGHT}:r=${FPS}`];
  // Egen lyd, hvis videoen har den; ellers stilheden fra input 1. apad
  // forlænger lyd, der er kortere end billedet.
  const audio = part.kind === 'video' && hasAudio ? '[0:a]' : '[1:a]';
  const seconds = part.kind === 'video' ? videoSeconds : part.seconds;
  return [
    ...source, ...SILENCE,
    '-filter_complex', `[0:v]${FIT}[v];${audio}aresample=48000,apad[a]`,
    '-map', '[v]', '-map', '[a]', '-t', secs(seconds), ...ENCODE, output,
  ];
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

export async function exportFilm(parts: ExportPart[], onProgress: (share: number, step: string) => void): Promise<Blob> {
  const [{ FFmpeg }, { fetchFile }, { default: coreURL }, { default: wasmURL }] = await Promise.all([
    import('@ffmpeg/ffmpeg'), import('@ffmpeg/util'), import('@ffmpeg/core?url'), import('@ffmpeg/core/wasm?url'),
  ]);
  const ff = new FFmpeg();
  let log = '';
  ff.on('log', ({ message }) => { log += `${message}\n`; });
  let at = 0;
  ff.on('progress', ({ progress }) => onProgress((at + Math.min(1, Math.max(0, progress))) / (parts.length + 1), at < parts.length ? `Shot ${at + 1} af ${parts.length}` : 'Samler filmen …'));
  onProgress(0, 'Henter videoværktøjet …');
  await ff.load({ coreURL, wasmURL });
  try {
    const outs: string[] = [];
    for (const [i, part] of parts.entries()) {
      at = i;
      onProgress(i / (parts.length + 1), `Shot ${i + 1} af ${parts.length}`);
      const input = `in${i}`;
      let hasAudio = false;
      let seconds = 0;
      if (part.kind !== 'black') {
        await ff.writeFile(input, await fetchFile(part.url));
        if (part.kind === 'video') {
          log = '';
          await ff.exec(['-hide_banner', '-i', input]); // fejler bevidst (ingen output), men logger strømmene
          hasAudio = hasAudioStream(log);
          seconds = durationOf(log);
          if (!seconds) throw new Error(`shot ${i + 1}: videoen kunne ikke læses`);
        }
      }
      const out = `c${i}.mp4`;
      const code = await ff.exec(clipArgs(part, input, out, hasAudio, seconds));
      if (code !== 0) throw new Error(`shot ${i + 1} kunne ikke omkodes`);
      if (part.kind !== 'black') await ff.deleteFile(input);
      outs.push(out);
    }
    at = parts.length;
    onProgress(parts.length / (parts.length + 1), 'Samler filmen …');
    await ff.writeFile('list.txt', concatList(outs));
    const code = await ff.exec(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', '-movflags', '+faststart', 'film.mp4']);
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
