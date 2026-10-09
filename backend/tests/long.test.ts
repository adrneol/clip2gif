import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { convertToGif, generateTestVideo } from '../src/services/ffmpegService.js';

/**
 * Long-duration test: 61s synthetic video -> 60s GIF segment.
 * Run with: npm run test:long
 * Kept small (128x96, 5fps, small quality) so it stays cheap.
 */
describe('60-second segment conversion', () => {
  it('processes a 60s segment from a 61s video', async () => {
    if (!process.env.LONG_TESTS && !process.env.RUN_LONG) {
      console.log('Skipping long test (set LONG_TESTS=1 to run).');
      return;
    }
    const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'c2g-long-'));
    const src = path.join(tmp, 'long.mp4');
    const out = path.join(tmp, 'out.gif');
    await generateTestVideo(src, 61, '128x96', 5);
    await convertToGif({
      input: src,
      output: out,
      start: 1,
      duration: 60,
      width: 320,
      fps: 5,
      quality: 'small',
      threads: 1,
      timeoutMs: 600_000,
    });
    const st = await fs.promises.stat(out);
    expect(st.size).toBeGreaterThan(5000);
    const fh = await fs.promises.open(out, 'r');
    const buf = Buffer.alloc(6);
    await fh.read(buf, 0, 6, 0);
    await fh.close();
    expect(['GIF87a', 'GIF89a']).toContain(buf.toString('ascii'));
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }, 600_000);
});
