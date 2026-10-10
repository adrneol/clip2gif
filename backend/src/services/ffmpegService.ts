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
  /** Caller-provided temp path for the palette PNG (same job dir). Deleted after use. */
  palette: string;
  start: number;
  duration: number;
  width: number;
  fps: number;
  colors: number;
  dither: 'sierra2_4a' | 'floyd_steinberg' | 'bayer' | 'none';
  threads: number;
  timeoutMs: number;
  onProgress?: (fraction: number | null, stage: string) => void;
  isCancelled?: () => boolean;
}

export interface EncodeTimings {
  paletteMs: number;
  encodeMs: number;
}

function ditherValue(d: ConvertOptions['dither']): string {
  // bayer_scale=2 is FFmpeg's default; explicit for reproducibility.
  switch (d) {
    case 'bayer': return 'bayer:bayer_scale=2';
    case 'floyd_steinberg': return 'floyd_steinberg';
    case 'none': return 'none';
    case 'sierra2_4a':
    default: return 'sierra2_4a';
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

function runFfmpeg(args: string[], opts: { timeoutMs: number; onStderr?: (chunk: string) => void; onProgressMs?: (ms: number) => void; isCancelled?: () => boolean }): Promise<{ code: number; stderr: string }> {
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
    // Machine-readable progress (-progress pipe:1 emits out_time_ms=... lines on stdout)
    if (opts.onProgressMs) {
      let carry = '';
      child.stdout.on('data', (d) => {
        carry += d.toString();
        const lines = carry.split('\n');
        carry = lines.pop() ?? '';
        for (const line of lines) {
          const m = /^out_time_ms=(-?\d+)/.exec(line.trim());
          if (m) {
            const ms = Number(m[1]);
            if (Number.isFinite(ms) && ms >= 0) opts.onProgressMs?.(ms);
          }
        }
      });
    }
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

/**
 * Two-stage palette conversion.
 *
 * Stage 1 — palette: decode the selected segment once with the SAME
 * fps/scale filters as stage 2, build a difference-focused palette
 * (`stats_mode=diff`, one entry reserved for transparency) and write
 * exactly one PNG (`-frames:v 1`; without it the image muxer fails with
 * "Cannot write more than one file" on FFmpeg 6+).
 *
 * Stage 2 — encode: decode the segment again, apply the saved palette
 * with rectangle frame-differencing. Streams with bounded memory,
 * unlike single-pass split graphs that buffer the whole clip
 * (measured 517MB vs 78MB RSS on a 28s 360x640 clip).
 *
 * Both stages use input seeking (-ss before -i) so only the selected
 * segment is decoded, spawn() arg arrays (no shell), and report real
 * progress from `-progress pipe:1` with stderr `time=` as fallback.
 * Throws on failure/cancel/timeout.
 */
export async function convertToGif(o: ConvertOptions): Promise<EncodeTimings> {
  const scale = buildScaleFilter(o.width);
  const ss = o.start.toFixed(3);
  const t = o.duration.toFixed(3);
  const dither = ditherValue(o.dither);
  const fpsScale = `fps=${o.fps},${scale}`;

  const checkCancel = () => {
    if (o.isCancelled?.()) throw Object.assign(new Error('Job cancelled'), { code: 'CANCELLED' });
  };
  // Prefer -progress pipe values; fall back to stderr time= if the pipe yields nothing.
  const makeTracker = (base: number, span: number, stage: string) => {
    let best = 0;
    return (sec: number) => {
      if (!(sec >= 0) || !(o.duration > 0)) return;
      const frac = base + Math.min(1, sec / o.duration) * span;
      if (frac > best) {
        best = frac;
        o.onProgress?.(Math.min(0.99, frac), stage);
      }
    };
  };

  // ---- Stage 1: palette ----
  o.onProgress?.(0.01, 'Generating palette');
  const track1 = makeTracker(0, 0.2, 'Generating palette');
  const t1 = Date.now();
  const r1 = await runFfmpeg(
    ['-y', '-ss', ss, '-t', t, '-i', o.input,
      '-vf', `${fpsScale},palettegen=max_colors=${o.colors}:reserve_transparent=1:stats_mode=diff`,
      '-frames:v', '1', '-threads', String(o.threads),
      '-progress', 'pipe:1', '-nostats',
      o.palette],
    {
      timeoutMs: o.timeoutMs,
      isCancelled: o.isCancelled,
      onProgressMs: (ms) => track1(ms / 1_000_000),
      onStderr: (chunk) => {
        const s = parseTimeToSeconds(chunk);
        if (s !== null) track1(s);
      },
    }
  );
  const paletteMs = Date.now() - t1;
  checkCancel();
  if (r1.code !== 0) {
    throw Object.assign(new Error(`Palette generation failed (exit ${r1.code})`), {
      code: 'FFMPEG_FAILED',
      stderr: r1.stderr.slice(-2000),
    });
  }

  // ---- Stage 2: encode with palette ----
  o.onProgress?.(0.2, 'Encoding GIF');
  const track2 = makeTracker(0.2, 0.8, 'Encoding GIF');
  const t2 = Date.now();
  const r2 = await runFfmpeg(
    ['-y', '-ss', ss, '-t', t, '-i', o.input, '-i', o.palette,
      '-lavfi', `${fpsScale}[a];[a][1:v]paletteuse=dither=${dither}:diff_mode=rectangle`,
      '-threads', String(o.threads),
      '-progress', 'pipe:1', '-nostats',
      o.output],
    {
      timeoutMs: o.timeoutMs,
      isCancelled: o.isCancelled,
      onProgressMs: (ms) => track2(ms / 1_000_000),
      onStderr: (chunk) => {
        const s = parseTimeToSeconds(chunk);
        if (s !== null) track2(s);
      },
    }
  );
  const encodeMs = Date.now() - t2;
  checkCancel();
  if (r2.code !== 0) {
    throw Object.assign(new Error(`GIF rendering failed (exit ${r2.code})`), {
      code: 'FFMPEG_FAILED',
      stderr: r2.stderr.slice(-2000),
    });
  }
  return { paletteMs, encodeMs };
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
