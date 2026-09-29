// Samlet film: hvert shot bliver et mellemklip i nøjagtig samme format og med
// billede og lyd i præcis samme længde, så samlingen ikke hakker.

import { describe, expect, it } from 'vitest';
import { clipArgs, clipSeconds, concatList, durationOf, fileName, finalArgs, fpsOf, frameCount, hasAudioStream } from '../../src/lib/filmExport.ts';

const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1]!;
const opts = { hasAudio: true, seconds: 5, fps: 24, transition: 'cut' as const };

describe('mellemklip', () => {
  it('billede og lyd skæres til præcis samme længde', () => {
    const f = after(clipArgs({ kind: 'video', url: 'u', seconds: 5 }, 'in0', 'c0.mkv', { ...opts, seconds: 3.01 }), '-filter_complex');
    // 3,01 sek. ved 24 fps = 72 billeder = 3,000 sek. = 144.000 lydprøver
    expect(f).toContain('trim=end_frame=72');
    expect(f).toContain('atrim=end_sample=144000');
  });

  it('video med egen lyd beholder den; stumme klip og stillbilleder får stilhed', () => {
    expect(after(clipArgs({ kind: 'video', url: 'u', seconds: 5 }, 'i', 'c.mkv', opts), '-filter_complex')).toContain('[0:a]aresample');
    expect(after(clipArgs({ kind: 'video', url: 'u', seconds: 5 }, 'i', 'c.mkv', { ...opts, hasAudio: false }), '-filter_complex')).toContain('[1:a]aresample');
    const still = clipArgs({ kind: 'still', url: 'u', seconds: 4 }, 'i', 'c.mkv', { ...opts, seconds: 4 });
    expect(still.slice(0, 2)).toEqual(['-loop', '1']);
    expect(after(still, '-filter_complex')).toContain('[1:a]aresample');
  });

  it('alle klip får filmens billedhastighed og ukomprimeret lyd', () => {
    for (const a of [clipArgs({ kind: 'black', seconds: 2 }, '', 'c.mkv', { ...opts, fps: 30 }), clipArgs({ kind: 'video', url: 'u', seconds: 2 }, 'i', 'c.mkv', { ...opts, fps: 30 })]) {
      expect(after(a, '-filter_complex')).toContain('fps=30');
      expect(after(a, '-filter_complex')).toContain('pad=1280:720');
      expect([after(a, '-r'), after(a, '-c:a')]).toEqual(['30', 'pcm_s16le']);
    }
  });

  it('lyden tones altid kort ind og ud; bløde overgange toner også billedet', () => {
    const cut = after(clipArgs({ kind: 'video', url: 'u', seconds: 5 }, 'i', 'c.mkv', opts), '-filter_complex');
    expect(cut).toContain('afade=t=in:d=0.020');
    expect(cut).not.toContain('fade=t=in:d=0.300');
    const soft = after(clipArgs({ kind: 'video', url: 'u', seconds: 5 }, 'i', 'c.mkv', { ...opts, transition: 'soft' }), '-filter_complex');
    expect(soft).toContain(',fade=t=in:d=0.300');
    expect(soft).toContain('fade=t=out:st=4.700:d=0.300');
  });

  it('samlingen omkoder det hele i ét stræk', () => {
    const a = finalArgs('list.txt', 'film.mp4', 25);
    expect(a.slice(0, 6)).toEqual(['-f', 'concat', '-safe', '0', '-i', 'list.txt']);
    expect([after(a, '-r'), after(a, '-c:v'), after(a, '-c:a')]).toEqual(['25', 'libx264', 'aac']);
    expect(a).not.toContain('copy');
    expect([after(a, '-vf'), after(a, '-af')]).toEqual(['setpts=N/FRAME_RATE/TB', 'asetpts=N/SR/TB']);
  });
});

describe('længder', () => {
  it('video skæres til shottets længde, men aldrig længere end klippet', () => {
    expect(clipSeconds(5.04, 3, null)).toBe(3);
    expect(clipSeconds(5.04, 8, null)).toBe(5.04);
  });

  it('en talende video skæres aldrig før replikken er sagt færdig', () => {
    expect(clipSeconds(10, 3, 4.2)).toBeCloseTo(4.6);
    expect(clipSeconds(5, 3, 1.5)).toBe(3);
    expect(clipSeconds(5, 3, 6)).toBe(5);
  });

  it('hele billeder', () => {
    expect([frameCount(3.01, 24), frameCount(0.01, 24), frameCount(2, 30)]).toEqual([72, 1, 60]);
  });
});

describe('aflæsning af ffmpegs log', () => {
  const log = '  Duration: 00:01:05.50, start: 0.000000\n  Stream #0:0: Video: h264 (High), yuv420p, 1280x720, 1500 kb/s, 29.97 fps, 29.97 tbr\n  Stream #0:1[0x2](und): Audio: aac (LC), 48000 Hz, stereo';

  it('lyd, længde og billedhastighed', () => {
    expect([hasAudioStream(log), durationOf(log), fpsOf(log)]).toEqual([true, 65.5, 30]);
    expect([hasAudioStream('Stream #0:0: Video: h264'), durationOf(''), fpsOf('')]).toEqual([false, 0, 24]);
    expect(fpsOf('Video: h264, 1280x720, 23.98 fps, 24 tbr')).toBe(24);
  });
});

describe('fil', () => {
  it('samleliste og filnavn', () => {
    expect(concatList(['c0.mkv', 'c1.mkv'])).toBe("file 'c0.mkv'\nfile 'c1.mkv'");
    expect(fileName('Beboeren')).toBe('Beboeren.mp4');
    expect(fileName('Blå øer & Æbler!')).toBe('Blaa-oeer-Aebler.mp4');
    expect(fileName('???')).toBe('film.mp4');
  });
});
