import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function resolveBinary(pkg: string, envName: string, fallback: string): string {
  // ffmpeg-static / ffprobe-static export the binary path directly.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  try {
    // Works for both CJS packages
    const mod = require(pkg);
    const p = typeof mod === 'string' ? mod : mod?.path;
    if (p && typeof p === 'string' && fs.existsSync(p)) return p;
  } catch {
    // fall through
  }
  if (process.env[envName]) return process.env[envName] as string;
  return fallback;
}

export function ffmpegPath(): string {
  return resolveBinary('ffmpeg-static', 'FFMPEG_PATH', 'ffmpeg');
}

export function ffprobePath(): string {
  try {
    // ffprobe-static exports { path }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('ffprobe-static');
    const p = typeof mod === 'string' ? mod : mod?.path;
    if (p && fs.existsSync(p)) return p;
  } catch {
    // ignore
  }
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;
  // On Windows ffmpeg-static binary sits next to ffprobe? fallback to PATH
  return 'ffprobe';
}

export interface ProbeResult {
  duration: number;
  width: number;
  height: number;
  fps: number | null;
  hasVideoStream: boolean;
  rawDuration: number | null;
}

function parseFps(s: string | undefined): number | null {
  if (!s || s === '0/0') return null;
  if (s.includes('/')) {
    const [n, d] = s.split('/').map(Number);
    if (!n || !d) return null;
    return n / d;
  }
  const v = Number(s);
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function probeVideo(filePath: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const bin = ffprobePath();
    const args = [
      '-v', 'error',
      '-show_entries', 'stream=width,height,avg_frame_rate,r_frame_rate,codec_type,duration',
      '-show_entries', 'format=duration,size',
      '-of', 'json',
      filePath,
    ];
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => reject(new Error(`FFprobe failed to start: ${(e as Error).message}`)));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`FFprobe exited with code ${code}: ${err.slice(0, 500)}`));
        return;
      }
      try {
        const json = JSON.parse(out || '{}');
        const streams: Array<Record<string, unknown>> = json.streams || [];
        const video = streams.find((s) => s.codec_type === 'video') as
          | { width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string; duration?: string }
          | undefined;
        if (!video) {
          resolve({ duration: NaN, width: 0, height: 0, fps: null, hasVideoStream: false, rawDuration: null });
          return;
        }
        const width = Number(video.width || 0);
        const height = Number(video.height || 0);
        const fps = parseFps(video.avg_frame_rate as string) ?? parseFps(video.r_frame_rate as string);
        let duration = Number(video.duration);
        if (!Number.isFinite(duration) || duration <= 0) {
          duration = Number(json.format?.duration);
        }
        resolve({
          duration,
          width,
          height,
          fps,
          hasVideoStream: true,
          rawDuration: Number.isFinite(duration) ? duration : null,
        });
      } catch (e) {
        reject(new Error(`FFprobe output parse failed: ${(e as Error).message}`));
      }
    });
  });
}

export interface ConvertOptions {
  input: string;
  output: string;
  start: number;
  duration: number;
  width: number;
  fps: number;
  quality: 'small' | 'balanced' | 'high';
  threads: number;
  timeoutMs: number;
  onProgress?: (fraction: number | null, stage: string) => void;
  isCancelled?: () => boolean;
}

function qualitySettings(quality: string): { maxColors: number; dither: string } {
  switch (quality) {
    case 'small':
      return { maxColors: 128, dither: 'bayer:bayer_scale=4' };
    case 'high':
      return { maxColors: 256, dither: 'sierra2_4a' };
    case 'balanced':
    default:
      return { maxColors: 192, dither: 'sierra2_4a' };
  }
}

export function buildScaleFilter(maxDim: number): string {
  // Cap the longest side at maxDim while preserving aspect ratio.
  // force_original_aspect_ratio=decrease keeps portrait vs landscape intact.
  return `scale=${maxDim}:${maxDim}:flags=lanczos:force_original_aspect_ratio=decrease`;
}

function parseTimeToSeconds(stderrChunk: string): number | null {
  // FFmpeg logs "time=00:00:12.34"
  const m = /time=(\d+):(\d+):([\d.]+)/.exec(stderrChunk);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  const s = Number(m[3]);
  if (![h, mi, s].every(Number.isFinite)) return null;
  return h * 3600 + mi * 60 + s;
}

function runFfmpeg(args: string[], opts: { timeoutMs: number; onStderr?: (chunk: string) => void; isCancelled?: () => boolean }): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const bin = ffmpegPath();
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch { /* noop */ }
    }, opts.timeoutMs);
    child.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      if (stderr.length > 200_000) stderr = stderr.slice(-200_000);
      opts.onStderr?.(s);
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`FFmpeg failed to start: ${(e as Error).message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(Object.assign(new Error('Conversion timed out'), { code: 'CONVERSION_TIMEOUT' }));
        return;
      }
      resolve({ code: code ?? 1, stderr });
    });
    // Poll cancellation
    if (opts.isCancelled) {
      const iv = setInterval(() => {
        if (opts.isCancelled?.()) {
          try { child.kill('SIGKILL'); } catch { /* noop */ }
          clearInterval(iv);
        }
        if (child.exitCode !== null) clearInterval(iv);
      }, 200);
    }
  });
}

/** Single-pass palette conversion via split + palettegen + paletteuse.
 *  Avoids the separate palette PNG step (which fails on some FFmpeg
 *  image-muxer combinations) and halves process spawns for free-tier use.
 *  Throws on failure/cancel/timeout. */
export async function convertToGif(o: ConvertOptions): Promise<void> {
  const { maxColors, dither } = qualitySettings(o.quality);
  const scale = buildScaleFilter(o.width);
  const ss = o.start.toFixed(3);
  const t = o.duration.toFixed(3);
  const lavfi =
    `fps=${o.fps},${scale},split[s0][s1];` +
    `[s0]palettegen=max_colors=${maxColors}:reserve_transparent=0[p];` +
    `[s1][p]paletteuse=dither=${dither}`;

  const args = [
    '-y',
    '-ss', ss,
    '-t', t,
    '-i', o.input,
    '-lavfi', lavfi,
    '-threads', String(o.threads),
    o.output,
  ];
  o.onProgress?.(0.05, 'Converting to GIF');
  const r = await runFfmpeg(args, {
    timeoutMs: o.timeoutMs,
    isCancelled: o.isCancelled,
    onStderr: (chunk) => {
      const s = parseTimeToSeconds(chunk);
      if (s !== null && o.duration > 0) {
        o.onProgress?.(Math.min(0.99, 0.05 + (s / o.duration) * 0.94), 'Converting to GIF');
      }
    },
  });
  if (o.isCancelled?.()) throw Object.assign(new Error('Job cancelled'), { code: 'CANCELLED' });
  if (r.code !== 0) {
    throw Object.assign(new Error(`GIF rendering failed (exit ${r.code})`), {
      code: 'FFMPEG_FAILED',
      stderr: r.stderr.slice(-2000),
    });
  }
}

/** Generate a tiny synthetic test video with FFmpeg (no repo binary needed). */
export async function generateTestVideo(outPath: string, durationSec: number, size = '160x120', fps = 10): Promise<void> {
  const args = [
    '-y',
    '-f', 'lavfi',
    '-i', `testsrc=duration=${durationSec}:size=${size}:rate=${fps}`,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-t', String(durationSec),
    outPath,
  ];
  const r = await runFfmpeg(args, { timeoutMs: 120_000 });
  if (r.code !== 0) throw new Error(`Test video generation failed: ${r.stderr.slice(-1000)}`);
}

export async function gifInfo(outPath: string): Promise<{ width: number; height: number; frames: number }> {
  return new Promise((resolve, reject) => {
    const bin = ffprobePath();
    const args = ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,nb_frames', '-count_frames', '-of', 'json', outPath];
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`gif probe failed: ${err.slice(0, 300)}`));
      try {
        const j = JSON.parse(out || '{}');
        const s = j.streams?.[0] || {};
        resolve({ width: Number(s.width || 0), height: Number(s.height || 0), frames: Number(s.nb_frames || 0) });
      } catch (e) { reject(e); }
    });
  });
}
