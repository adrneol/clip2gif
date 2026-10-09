import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/index.js';
import { convertToGif, probeVideo } from './ffmpegService.js';
import { getJob, updateJob } from './jobService.js';
import { removePathSafe } from '../utils/fs.js';
import type { ConversionParams } from '../types/index.js';

export function validateParams(
  p: Partial<ConversionParams>,
  sourceDuration: number | null
): { ok: boolean; code?: string; message?: string; params?: ConversionParams } {
  const start = Number(p.start);
  const end = Number(p.end);
  const width = Number(p.width);
  const fps = Number(p.fps);
  const quality = p.quality;

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { ok: false, code: 'INVALID_TRIM', message: 'Start and end times must be numbers.' };
  }
  if (start < 0) return { ok: false, code: 'INVALID_TRIM', message: 'Start time cannot be negative.' };
  if (!(end > start)) return { ok: false, code: 'INVALID_TRIM', message: 'End time must be greater than start time.' };
  const seg = end - start;
  if (seg <= 0.2) return { ok: false, code: 'INVALID_TRIM', message: 'Selected segment is too short (minimum ~0.2s).' };
  if (seg > config.maxClipDurationSeconds + 1e-6) {
    return { ok: false, code: 'TRIM_TOO_LONG', message: `Selected segment (${seg.toFixed(1)}s) exceeds the ${config.maxClipDurationSeconds}s limit. Shorten the clip.` };
  }
  if (sourceDuration !== null && Number.isFinite(sourceDuration)) {
    if (start >= sourceDuration) {
      return { ok: false, code: 'INVALID_TRIM', message: 'Start time is beyond the video duration.' };
    }
    if (end > sourceDuration + 0.5) {
      return { ok: false, code: 'INVALID_TRIM', message: `End time exceeds the video duration (${sourceDuration.toFixed(1)}s).` };
    }
  }
  if (!config.allowedWidths.includes(width)) {
    return { ok: false, code: 'INVALID_SETTINGS', message: `Width must be one of ${config.allowedWidths.join(', ')} px.` };
  }
  if (!config.allowedFps.includes(fps)) {
    return { ok: false, code: 'INVALID_SETTINGS', message: `Frame rate must be one of ${config.allowedFps.join(', ')} fps.` };
  }
  if (!(['small', 'balanced', 'high'] as string[]).includes(String(quality))) {
    return { ok: false, code: 'INVALID_SETTINGS', message: 'Quality must be small, balanced, or high.' };
  }
  return { ok: true, params: { start, end, width, fps, quality: quality as ConversionParams['quality'] } };
}

export async function processJob(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job || !job.inputPath || !job.params) return;
  const params = job.params;

  updateJob(jobId, { status: 'analyzing', stage: 'Analyzing video', progress: null });

  try {
    // Re-probe to be safe (file may have moved)
    const probe = await probeVideo(job.inputPath);
    if (!probe.hasVideoStream) {
      throw Object.assign(new Error('No video stream found'), { code: 'NO_VIDEO_STREAM' });
    }

    if (job.cancelled) {
      updateJob(jobId, { status: 'cancelled', stage: 'Cancelled', error: { code: 'CANCELLED', message: 'Job was cancelled.' } });
      await removePathSafe(job.dir);
      return;
    }

    const duration = params.end - params.start;
    updateJob(jobId, { status: 'converting', stage: 'Converting to GIF', progress: 0 });

    const outputPath = path.join(job.dir, 'output.gif');
    updateJob(jobId, { outputPath });

    await convertToGif({
      input: job.inputPath,
      output: outputPath,
      start: params.start,
      duration,
      width: params.width,
      fps: params.fps,
      quality: params.quality,
      threads: config.ffmpegThreads,
      timeoutMs: config.jobTimeoutSeconds * 1000,
      isCancelled: () => getJob(jobId)?.cancelled === true,
      onProgress: (fraction, stage) => {
        const j = getJob(jobId);
        if (!j || j.cancelled) return;
        updateJob(jobId, {
          stage,
          progress: fraction === null ? null : Math.round(fraction * 100),
        });
      },
    });

    if (getJob(jobId)?.cancelled) {
      updateJob(jobId, { status: 'cancelled', stage: 'Cancelled', error: { code: 'CANCELLED', message: 'Job was cancelled.' } });
      await removePathSafe(outputPath);
      return;
    }

    // Validate output
    let size = 0;
    try {
      const st = await fsp.stat(outputPath);
      size = st.size;
    } catch {
      throw Object.assign(new Error('Conversion produced no output'), { code: 'FFMPEG_FAILED' });
    }
    if (size <= 0) {
      await removePathSafe(outputPath);
      throw Object.assign(new Error('Conversion produced an empty file'), { code: 'FFMPEG_FAILED' });
    }
    // Check GIF magic bytes
    const fd = await fsp.open(outputPath, 'r');
    const buf = Buffer.alloc(6);
    await fd.read(buf, 0, 6, 0);
    await fd.close();
    const magic = buf.toString('ascii');
    if (magic !== 'GIF87a' && magic !== 'GIF89a') {
      await removePathSafe(outputPath);
      throw Object.assign(new Error('Output is not a valid GIF'), { code: 'FFMPEG_FAILED' });
    }

    const maxBytes = config.maxGifOutputMB * 1024 * 1024;
    if (size > maxBytes) {
      await removePathSafe(outputPath);
      updateJob(jobId, {
        status: 'failed',
        stage: 'Failed',
        progress: null,
        error: {
          code: 'OUTPUT_TOO_LARGE',
          message: `The GIF (${(size / 1048576).toFixed(1)} MB) exceeds the ${config.maxGifOutputMB} MB limit. Try a smaller size, lower frame rate, or shorter segment.`,
        },
      });
      return;
    }

    // Remove source video ASAP to save ephemeral disk.
    await removePathSafe(job.inputPath);
    updateJob(jobId, { inputPath: null, palettePath: null });

    // Probe output dimensions via ffprobe? Use lightweight: keep requested fps/duration; get width/height via probe
    let outW = params.width;
    let outH = 0;
    try {
      const op = await probeVideo(outputPath);
      if (op.width) { outW = op.width; outH = op.height; }
    } catch { /* keep estimates */ }

    const now = Date.now();
    updateJob(jobId, {
      status: 'completed',
      stage: 'Completed',
      progress: 100,
      completedAt: now,
      expiresAt: now + config.tempFileTtlMinutes * 60 * 1000,
      output: {
        sizeBytes: size,
        width: outW,
        height: outH,
        duration,
        fps: params.fps,
      },
      error: null,
    });
  } catch (e: unknown) {
    const err = e as Error & { code?: string; stderr?: string };
    console.error(`[job ${jobId}] conversion error:`, err.message);
    const code = err.code || 'CONVERSION_FAILED';
    let message = 'Conversion failed. Try shorter clips or lower settings.';
    if (code === 'CANCELLED') message = 'Job was cancelled.';
    else if (code === 'CONVERSION_TIMEOUT') message = `Conversion timed out after ${config.jobTimeoutSeconds}s. Try a shorter segment or lower settings.`;
    else if (code === 'NO_VIDEO_STREAM') message = 'The file contains no video stream.';
    else if (code === 'FFMPEG_FAILED') message = 'Video processing failed. The file may be corrupted or use an unsupported codec.';
    const j = getJob(jobId);
    if (j) {
      await removePathSafe(j.outputPath);
      await removePathSafe(j.palettePath);
      // Keep input? Remove on failure to avoid accumulation, unless cancelled mid-way — still remove dir files partially.
      // Keep dir for potential retry? No — remove partial outputs, keep job record.
    }
    const cur = getJob(jobId);
    if (cur?.cancelled) {
      updateJob(jobId, { status: 'cancelled', stage: 'Cancelled', progress: null, error: { code: 'CANCELLED', message: 'Job was cancelled.' } });
    } else {
      updateJob(jobId, { status: 'failed', stage: 'Failed', progress: null, error: { code, message } });
    }
  }
}

export function friendlyError(code: string, fallback: string): { code: string; message: string } {
  return { code, message: fallback };
}
