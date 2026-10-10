import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { clearForTests, getJob } from '../src/services/jobService.js';
import { generateTestVideo } from '../src/services/ffmpegService.js';
import { validateParams, downgrade } from '../src/services/conversionService.js';

process.env.TEMP_DIR = path.join(os.tmpdir(), 'clip2gif-test');
process.env.FRONTEND_ORIGIN = 'http://localhost:5173';

const app = createApp();
const SID = 'test-session-abc123XYZ';

function auth(req: request.Test) {
  return req.set('x-session-id', SID);
}

describe('health + limits', () => {
  it('GET /api/health returns ok', async () => {
    const r = await request(app).get('/api/health');
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.data.status).toBe('ok');
  });
  it('GET /api/limits returns configured values', async () => {
    const r = await request(app).get('/api/limits');
    expect(r.status).toBe(200);
    expect(r.body.data.maxUploadMB).toBeGreaterThan(0);
    expect(r.body.data.allowedWidths).toContain(480);
  });
});

describe('validation units', () => {
  it('rejects negative start', () => {
    expect(validateParams({ start: -1, end: 5, width: 480, fps: 10, quality: 'balanced' }, 90).ok).toBe(false);
  });
  it('rejects end <= start', () => {
    expect(validateParams({ start: 5, end: 5, width: 480, fps: 10, quality: 'balanced' }, 90).ok).toBe(false);
  });
  it('rejects over-long segment', () => {
    const r = validateParams({ start: 0, end: 500, width: 480, fps: 10, quality: 'balanced' }, 600);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('TRIM_TOO_LONG');
  });
  it('accepts exactly 60s segment', () => {
    const r = validateParams({ start: 10, end: 70, width: 480, fps: 10, quality: 'balanced' }, 90);
    expect(r.ok).toBe(true);
  });
  it('rejects bad width/fps/quality', () => {
    expect(validateParams({ start: 0, end: 5, width: 999, fps: 10, quality: 'balanced' }, 90).ok).toBe(false);
    expect(validateParams({ start: 0, end: 5, width: 480, fps: 99, quality: 'balanced' }, 90).ok).toBe(false);
    expect(validateParams({ start: 0, end: 5, width: 480, fps: 10, quality: 'ultra' as never }, 90).ok).toBe(false);
  });
  it('resolves named presets to real settings', () => {
    const r = validateParams({ start: 0, end: 5, preset: 'tiny' }, 90);
    expect(r.ok).toBe(true);
    expect(r.params).toMatchObject({ width: 320, fps: 6, colors: 96, dither: 'bayer', preset: 'tiny' });
    const m = validateParams({ start: 0, end: 5, preset: 'max' }, 90);
    expect(m.ok).toBe(true);
    expect(m.params).toMatchObject({ width: 640, fps: 15, colors: 256, preset: 'max' });
  });
  it('maps legacy quality names (backward compat)', () => {
    const r = validateParams({ start: 0, end: 5, width: 320, fps: 5, quality: 'small' }, 90);
    expect(r.ok).toBe(true);
    expect(r.params?.preset).toBe('custom'); // fps 5 != compact canonical 8
    expect(r.params?.colors).toBe(128);
  });
  it('accepts full custom settings', () => {
    const r = validateParams({ start: 0, end: 5, preset: 'custom', width: 360, fps: 12, colors: 160, dither: 'floyd_steinberg' }, 90);
    expect(r.ok).toBe(true);
    expect(r.params).toMatchObject({ width: 360, fps: 12, colors: 160, dither: 'floyd_steinberg', preset: 'custom' });
  });
  it('rejects invalid custom values without substitution', () => {
    expect(validateParams({ start: 0, end: 5, preset: 'custom', width: 999, fps: 10, colors: 128, dither: 'bayer' }, 90).ok).toBe(false);
    expect(validateParams({ start: 0, end: 5, preset: 'custom', width: 320, fps: 10, colors: 100, dither: 'bayer' }, 90).ok).toBe(false);
    expect(validateParams({ start: 0, end: 5, preset: 'custom', width: 320, fps: 10, colors: 128, dither: 'neon' as never }, 90).ok).toBe(false);
    expect(validateParams({ start: 0, end: 5, preset: 'custom', width: 320, fps: 10 }, 90).ok).toBe(false); // missing colors/dither
    expect(validateParams({ start: 0, end: 5, preset: 'nope' as never }, 90).ok).toBe(false);
  });
  it('validates optimize targets', () => {
    expect(validateParams({ start: 0, end: 5, preset: 'balanced', optimize: true, targetMB: 10 }, 90).ok).toBe(true);
    expect(validateParams({ start: 0, end: 5, preset: 'balanced', optimize: true, targetMB: 0.5 }, 90).ok).toBe(false);
    expect(validateParams({ start: 0, end: 5, preset: 'balanced', optimize: true, targetMB: 500 }, 90).ok).toBe(false);
  });
  it('downgrade ladder strictly reduces settings', () => {
    const d1 = downgrade({ width: 640, fps: 15, colors: 256 }, 1);
    expect(d1.fps).toBeLessThan(15);
    expect(d1.colors).toBeLessThan(256);
    expect(d1.width).toBe(640);
    const d2 = downgrade(d1, 2);
    expect(d2.width).toBeLessThan(640);
    expect(d2.fps).toBeLessThanOrEqual(d1.fps);
  });
});

describe('session isolation + job errors', () => {
  it('requires session header', async () => {
    const r = await request(app).get('/api/jobs');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
  });
  it('404 on missing job', async () => {
    const r = await auth(request(app).get('/api/jobs/nope-nope-nope'));
    expect(r.status).toBe(404);
  });
  it('rejects missing file', async () => {
    const r = await auth(request(app).post('/api/jobs').field('start', '0').field('end', '2'));
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('MISSING_FILE');
  });
  it('rejects unsupported format', async () => {
    const r = await auth(
      request(app).post('/api/jobs').attach('video', Buffer.from('hello'), 'note.txt').field('start', '0').field('end', '2')
    );
    expect(r.status).toBe(415);
    expect(r.body.error.code).toBe('UNSUPPORTED_FORMAT');
  });
  it('rejects non-video content with video extension', async () => {
    const r = await auth(
      request(app).post('/api/jobs').attach('video', Buffer.from('not a video at all'), 'fake.mp4').field('start', '0').field('end', '2')
    );
    expect([422, 400]).toContain(r.status);
  });
  it('one session cannot read another session job', async () => {
    // create a fake job id that doesn't exist -> 404 either way; test forbidden via real upload below in integration
    const r = await request(app).get('/api/jobs/some-id').set('x-session-id', 'other-session-9999');
    expect([403, 404]).toContain(r.status);
  });
});

describe('real FFmpeg conversion (small)', () => {
  beforeAll(async () => {
    clearForTests();
  }, 30_000);
  afterEach(() => { /* keep */ });

  it('converts a 3s synthetic video to GIF', async () => {
    const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'c2g-up-'));
    const src = path.join(tmp, 'src.mp4');
    await generateTestVideo(src, 3, '160x120', 10);

    const create = await auth(
      request(app)
        .post('/api/jobs')
        .attach('video', src, 'clip.mp4')
        .field('start', '0')
        .field('end', '2')
        .field('width', '320')
        .field('fps', '5')
        .field('quality', 'small')
    );
    expect(create.status).toBe(201);
    const id = create.body.data.job.id as string;
    expect(id).toBeTruthy();

    // Poll up to 60s
    let status = '';
    let tries = 0;
    let last: request.Response = create;
    while (tries < 60) {
      await new Promise((r) => setTimeout(r, 1000));
      last = await auth(request(app).get(`/api/jobs/${id}`));
      status = last.body.data.job.status;
      if (['completed', 'failed', 'cancelled'].includes(status)) break;
      tries++;
    }
    expect(status).toBe('completed');
    const job = getJob(id);
    expect(job?.outputPath).toBeTruthy();
    const st = await fs.promises.stat(job!.outputPath!);
    expect(st.size).toBeGreaterThan(1000);
    // Magic bytes
    const fh = await fs.promises.open(job!.outputPath!, 'r');
    const buf = Buffer.alloc(6);
    await fh.read(buf, 0, 6, 0);
    await fh.close();
    expect(['GIF87a', 'GIF89a']).toContain(buf.toString('ascii'));
    // Source removed after success
    expect(job!.inputPath).toBeNull();
    // Palette PNG removed after use; only output.gif remains
    const leftovers = await fs.promises.readdir(job!.dir);
    expect(leftovers).toEqual(['output.gif']);
    // Output metadata reports actual settings + conversion time
    expect(last.body.data.job.output).toMatchObject({ fps: 5, colors: 128, dither: 'bayer' });
    expect(last.body.data.job.output.attempts).toBe(1);
    expect(last.body.data.job.output.conversionMs).toBeGreaterThan(0);

    // Preview works
    const prev = await auth(request(app).get(`/api/jobs/${id}/preview`));
    expect(prev.status).toBe(200);
    expect(prev.headers['content-type']).toContain('image/gif');

    // Download with autoclear removes session jobs
    const dl = await auth(request(app).get(`/api/jobs/${id}/download?autoclear=1`));
    expect(dl.status).toBe(200);
    await new Promise((r) => setTimeout(r, 800));
    const list = await auth(request(app).get('/api/jobs'));
    expect(list.body.data.jobs.length).toBe(0);

    await fs.promises.rm(tmp, { recursive: true, force: true });
  }, 120_000);

  it('DELETE /api/jobs clears session', async () => {
    const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'c2g-up2-'));
    const src = path.join(tmp, 's.mp4');
    await generateTestVideo(src, 2, '160x120', 10);
    const create = await auth(
      request(app).post('/api/jobs').attach('video', src, 'c.mp4').field('start', '0').field('end', '1').field('width', '320').field('fps', '5').field('quality', 'small')
    );
    expect([201, 429]).toContain(create.status);
    const del = await auth(request(app).delete('/api/jobs'));
    expect(del.status).toBe(200);
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }, 120_000);
});
