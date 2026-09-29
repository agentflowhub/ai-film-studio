// Samlet film: hvert shot bliver et klip i samme format, så de kan sættes
// sammen uden ny omkodning, og lyden aldrig forskubber sig mellem shots.

import { describe, expect, it } from 'vitest';
import { clipArgs, concatList, durationOf, fileName, hasAudioStream } from '../../src/lib/filmExport.ts';

const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe('klip til den samlede film', () => {
  it('video med egen lyd beholder lyden og sin længde', () => {
    const a = clipArgs({ kind: 'video', url: 'u' }, 'in0', 'c0.mp4', true, 5.04);
    expect(after(a, '-filter_complex')).toContain('[0:a]aresample=48000,apad[a]');
    expect(after(a, '-t')).toBe('5.04');
    expect(a.at(-1)).toBe('c0.mp4');
  });

  it('stum video og stillbillede får stilhed i shottets længde', () => {
    const mute = clipArgs({ kind: 'video', url: 'u' }, 'in1', 'c1.mp4', false, 3);
    expect(after(mute, '-filter_complex')).toContain('[1:a]');
    const still = clipArgs({ kind: 'still', url: 'u', seconds: 4 }, 'in2', 'c2.mp4', true);
    expect(still.slice(0, 5)).toEqual(['-loop', '1', '-t', '4', '-i']);
    expect(after(still, '-filter_complex')).toContain('[1:a]');
  });

  it('alle klip får samme billed- og lydformat', () => {
    for (const a of [clipArgs({ kind: 'black', seconds: 2 }, '', 'c.mp4', false), clipArgs({ kind: 'video', url: 'u' }, 'i', 'c.mp4', true, 2)]) {
      expect(after(a, '-filter_complex')).toContain('pad=1280:720');
      expect([after(a, '-c:v'), after(a, '-r'), after(a, '-c:a'), after(a, '-ar'), after(a, '-ac')]).toEqual(['libx264', '24', 'aac', '48000', '2']);
    }
  });

  it('læser lyd og længde ud af ffmpegs log', () => {
    const log = '  Duration: 00:01:05.50, start: 0.000000\n  Stream #0:1[0x2](und): Audio: aac (LC), 48000 Hz, stereo';
    expect([hasAudioStream(log), durationOf(log)]).toEqual([true, 65.5]);
    expect([hasAudioStream('Stream #0:0: Video: h264'), durationOf('')]).toEqual([false, 0]);
  });

  it('samleliste og filnavn', () => {
    expect(concatList(['c0.mp4', 'c1.mp4'])).toBe("file 'c0.mp4'\nfile 'c1.mp4'");
    expect(fileName('Beboeren')).toBe('Beboeren.mp4');
    expect(fileName('Blå øer & Æbler!')).toBe('Blaa-oeer-Aebler.mp4');
    expect(fileName('???')).toBe('film.mp4');
  });
});
