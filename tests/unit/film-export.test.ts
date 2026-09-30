// Samlet film: hvert shot bliver et mellemklip i nøjagtig samme format og med
// billede og lyd i præcis samme længde, så samlingen ikke hakker.

import { describe, expect, it } from 'vitest';
import { ambienceOffsets, captionChunks, voiceoverEnd, clipArgs, clipSeconds, concatList, DUCK_VOLUME, durationOf, fileName, finalArgs, fpsOf, frameCount, hasAudioStream, timeline } from '../../src/lib/filmExport.ts';

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
    const graph = after(a, '-filter_complex');
    expect(graph).toContain('[0:v]setpts=N/FRAME_RATE/TB[v0]');
    expect(graph).toContain('[0:a]asetpts=N/SR/TB[a0]');
    expect([after(a, '-map'), a[a.lastIndexOf('-map') + 1]]).toEqual(['[v0]', '[a0]']);
  });
});

describe('voiceover og tekst i samlingen', () => {
  const voices = [{ file: 'line2.wav', start: 6.5, end: 11 }];
  const overlays = [{ file: 't0.png', start: 0, end: 3.5 }, { file: 't1.png', start: 6.5, end: 8 }];
  const a = finalArgs('list.txt', 'film.mp4', 24, voices, overlays);
  const graph = after(a, '-filter_complex');

  it('voiceoveren lægges ind fra sit shot og blandes med klippenes lyd', () => {
    expect(a.filter((x) => x === '-i')).toHaveLength(4);
    expect(graph).toContain('[1:a]aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:4.500,afade=t=out:st=4.350:d=0.150,adelay=6500|6500[vo0]');
    expect(graph).toContain('[a0][vo0]amix=inputs=2:duration=first:normalize=0[a]');
    expect(a[a.lastIndexOf('-map') + 1]).toBe('[a]');
  });

  it('klippenes egen lyd dæmpes, mens voiceoveren taler', () => {
    expect(graph).toContain(`volume='if(between(t,6.500,11.000),${DUCK_VOLUME},1)':eval=frame`);
  });

  it('hvert tekstbillede vises kun i sit vindue', () => {
    expect(graph).toContain("[v0][2:v]overlay=0:0:eof_action=repeat:enable='between(t,0.000,3.500)'[v1]");
    expect(graph).toContain("[v1][3:v]overlay=0:0:eof_action=repeat:enable='between(t,6.500,8.000)'[v2]");
    expect(after(a, '-map')).toBe('[v2]');
  });
});

describe('tekst på replikker', () => {
  it('deles i stykker på højst to linjer, timet efter antal tegn', () => {
    const c = captionChunks('Mit navn er Sander Andersen. Og jeg er autoriseret Ole Lukøje, som det jo så fancy hedder på internationalsk.', 6);
    expect(c.length).toBeGreaterThan(1);
    expect(c.every((x) => x.text.length <= 76)).toBe(true);
    expect(c[0]!.text).toBe('Mit navn er Sander Andersen.');
    expect(c[0]!.start).toBe(0);
    expect(c.at(-1)!.end).toBeCloseTo(6);
  });

  it('tom replik eller ingen tid giver ingen tekst', () => {
    expect(captionChunks('  ', 3)).toEqual([]);
    expect(captionChunks('Hej', 0)).toEqual([]);
  });
});

describe('tidslinje', () => {
  it('shots ligger efter hinanden i hele billeder', () => {
    expect(timeline([2, 1.01, 3], 24).map((t) => [t.start, Number(t.end.toFixed(4))])).toEqual([[0, 2], [2, 3], [3, 6]]);
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

describe('voiceover stopper ved næste replik', () => {
  const times = [{ start: 0, end: 3 }, { start: 3, end: 4.5 }, { start: 4.5, end: 6 }, { start: 6, end: 9 }];
  it('taler færdigt hen over dækbilleder uden replik', () => {
    expect(voiceoverEnd(0, 5, times, [true, false, false, false])).toBe(5);
  });
  it('men stopper, hvor et senere shot har sin egen replik', () => {
    expect(voiceoverEnd(0, 8, times, [true, false, true, false])).toBe(4.5);
  });
  it('og aldrig efter filmens slutning', () => {
    expect(voiceoverEnd(2, 10, times, [false, false, true, false])).toBe(9);
  });
});

describe('rumlyd', () => {
  it('fortsætter samme sted og starter forfra ved et nyt sted', () => {
    expect(ambienceOffsets(['k', 'k', 'o', 'k'], [3, 4, 2, 5], [30, 30, 30, 30])).toEqual([0, 3, 0, 0]);
  });
  it('gentages, når forløbet er længere end lydklippet', () => {
    expect(ambienceOffsets(['k', 'k', 'k'], [20, 20, 5], [30, 30, 30])).toEqual([0, 20, 10]);
  });
  it('shots uden rumlyd får intet offset', () => {
    expect(ambienceOffsets([null, 'k'], [3, 3], [null, 30])).toEqual([0, 0]);
  });
  it('lægges lavt under klippets egen lyd fra det rigtige sted', () => {
    const a = clipArgs({ kind: 'video', url: 'u', seconds: 5 }, 'i', 'c.mkv', { ...opts, ambience: { file: 'amb0.mp3', offset: 7.25 } });
    expect(a.slice(a.indexOf('-stream_loop'), a.indexOf('-stream_loop') + 6)).toEqual(['-stream_loop', '-1', '-ss', '7.250', '-i', 'amb0.mp3']);
    expect(after(a, '-filter_complex')).toContain('[2:a]aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo,loudnorm=I=-30:LRA=11:TP=-3,aresample=48000,aformat=sample_rates=48000:channel_layouts=stereo[amb];[own][amb]amix=inputs=2');
  });
});
