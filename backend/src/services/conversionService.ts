import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { LEGACY_QUALITY_ALIAS, PRESETS, config } from '../config/index.js';
import type { DitherName, PresetName } from '../config/index.js';
import { convertToGif, probeVideo } from './ffmpegService.js';
import { getJob, updateJob } from './jobService.js';
import { removePathSafe } from '../utils/fs.js';
import type { ConversionParams } from '../types/index.js';

function lowerNotch(list: number[], v: number): number {
  const sorted = [...list].sort((a, b) => a - b);
  const below = sorted.filter((x) => x < v);
  return below.length ? below[below.length - 1] : sorted[0];
}

export function validateParams(
  p: Partial<ConversionParams> & { quality?: string },
  sourceDuration: number | null
): { ok: boolean; code?: string; message?: string; params?: ConversionParams } {
  const start = Number(p.start);
  const end = Number(p.end);

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

  // --- Preset resolution ---
  // New clients send preset (+ explicit values for 'custom').
  // Phase-1 clients sent quality ('small'|'balanced'|'high') with width/fps.
  let preset = p.preset as PresetName | undefined;
  if (p.quality !== undefined && preset === undefined) {
    const alias = LEGACY_QUALITY_ALIAS[String(p.quality)];
    if (!alias) {
      return { ok: false, code: 'INVALID_SETTINGS', message: `Quality must be one of ${config.allowedPresets.join(', ')}.` };
    }
    preset = alias;
  }
  if (preset === undefined) preset = config.defaultPreset;
  if (!config.allowedPresets.includes(preset)) {
    return { ok: false, code: 'INVALID_SETTINGS', message: `Preset must be one of ${config.allowedPresets.join(', ')}.` };
  }

  const canonical = preset === 'custom' ? null : PRESETS[preset];
  // Explicit values override preset defaults; 'custom' requires all four.
  let width = p.width === undefined || (p.width as unknown as string) === '' ? canonical?.width : Number(p.width);
  let fps = p.fps === undefined || (p.fps as unknown as string) === '' ? canonical?.fps : Number(p.fps);
  let colors = (p as { colors?: unknown }).colors === undefined || (p as { colors?: unknown }).colors === '' ? canonical?.colors : Number((p as { colors?: unknown }).colors);
  let dither = ((p as { dither?: unknown }).dither === undefined || (p as { dither?: unknown }).dither === '' ? canonical?.dither : String((p as { dither?: unknown }).dither)) as DitherName | undefined;

  if (preset === 'custom' && (width === undefined || fps === undefined || colors === undefined || dither === undefined)) {
    return { ok: false, code: 'INVALID_SETTINGS', message: 'Custom preset requires width, fps, colors, and dither.' };
  }
  width = Number(width);
  fps = Number(fps);
  colors = Number(colors);
  if (!config.allowedWidths.includes(width)) {
    return { ok: false, code: 'INVALID_SETTINGS', message: `Width must be one of ${config.allowedWidths.join(', ')} px.` };
  }
  if (!config.allowedFps.includes(fps)) {
    return { ok: false, code: 'INVALID_SETTINGS', message: `Frame rate must be one of ${config.allowedFps.join(', ')} fps.` };
  }
  if (!config.allowedColors.includes(colors)) {
    return { ok: false, code: 'INVALID_SETTINGS', message: `Palette colors must be one of ${config.allowedColors.join(', ')} (GIF supports at most 256).` };
  }
  if (!dither || !config.allowedDithers.includes(dither)) {
    return { ok: false, code: 'INVALID_SETTINGS', message: `Dithering must be one of ${config.allowedDithers.join(', ')}.` };
  }

  // If explicit values differ from the named preset, report effective preset as custom.
  // Never silently substitute: the response echoes the effective values.
  let effectivePreset = preset;
  if (canonical && (width !== canonical.width || fps !== canonical.fps || colors !== canonical.colors || dither !== canonical.dither)) {
    effectivePreset = 'custom';
  }

  // --- Size optimization ---
  const optimize = p.optimize === true || String(p.optimize).toLowerCase() === 'true';
  let targetMB: number | null = null;
  if (optimize) {
    const raw = (p as { targetMB?: unknown }).targetMB;
    targetMB = raw === undefined || raw === '' ? config.suggestedTargetsMB[1] : Number(raw);
    if (!Number.isFinite(targetMB) || targetMB < 1) {
      return { ok: false, code: 'INVALID_SETTINGS', message: 'Target size must be at least 1 MB.' };
    }
    if (targetMB > config.maxGifOutputMB) {
      return { ok: false, code: 'INVALID_SETTINGS', message: `Target size cannot exceed the ${config.maxGifOutputMB} MB output limit.` };
    }
  }

  return {
    ok: true,
    params: { start, end, width, fps, colors, dither, preset: effectivePreset, optimize, targetMB },
  };
}

/**
 * Conservative downgrade ladder for size optimization. Bounded: at most
 * two retries (three attempts total). Each step lowers fps, then colors,
 * then width — documented and reported via output metadata.
 */
export function downgrade(eff: { width: number; fps: number; colors: number }, step: number): { width: number; fps: number; colors: number } {
  if (step === 1) {
    return { width: eff.width, fps: lowerNotch(config.allowedFps, eff.fps), colors: lowerNotch(config.allowedColors, eff.colors) };
  }
  return { width: lowerNotch(config.allowedWidths, eff.width), fps: lowerNotch(config.allowedFps, eff.fps), colors: lowerNotch(config.allowedColors, eff.colors) };
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
    const palettePath = path.join(job.dir, 'palette.png');
    updateJob(jobId, { outputPath, palettePath });

    const targetBytes = params.optimize && params.targetMB ? params.targetMB * 1024 * 1024 : null;
    const maxAttempts = params.optimize ? 3 : 1;
    let eff = { width: params.width, fps: params.fps, colors: params.colors };
    let attempts = 0;
    let conversionMs = 0;
    let finalSize = 0;
    let sizeNote: string | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (getJob(jobId)?.cancelled) break;
      attempts = attempt;
      if (attempt > 1) {
        eff = downgrade(eff, attempt - 1);
        updateJob(jobId, { stage: `Retrying with smaller settings (attempt ${attempt}/${maxAttempts})`, progress: null });
      }
      const timings = await convertToGif({
        input: job.inputPath,
        output: outputPath,
        palette: palettePath,
        start: params.start,
        duration,
        width: eff.width,
        fps: eff.fps,
        colors: eff.colors,
        dither: params.dither,
        threads: config.ffmpegThreads,
        timeoutMs: config.jobTimeoutSeconds * 1000,
        isCancelled: () => getJob(jobId)?.cancelled === true,
        onProgress: (fraction, stage) => {
          const j = getJob(jobId);
          if (!j || j.cancelled) return;
          updateJob(jobId, {
            stage: attempt > 1 ? `${stage} (attempt ${attempt}/${maxAttempts})` : stage,
            progress: fraction === null ? null : Math.round(fraction * 100),
          });
        },
      });
      conversionMs += timings.paletteMs + timings.encodeMs;
      // Palette is single-use: remove immediately to keep temp dir lean.
      await removePathSafe(palettePath);

      const st = await fsp.stat(outputPath).catch(() => null);
      finalSize = st?.size ?? 0;
      if (finalSize <= 0) {
        await removePathSafe(outputPath);
        throw Object.assign(new Error('Conversion produced an empty file'), { code: 'FFMPEG_FAILED' });
      }
      if (targetBytes !== null && finalSize > targetBytes && attempt < maxAttempts) {
        await removePathSafe(outputPath);
        continue; // retry with downgraded settings
      }
      break;
    }

    if (getJob(jobId)?.cancelled) {
      updateJob(jobId, { status: 'cancelled', stage: 'Cancelled', progress: null, error: { code: 'CANCELLED', message: 'Job was cancelled.' } });
      await removePathSafe(outputPath);
      await removePathSafe(palettePath);
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
          message:
            `The GIF (${(size / 1048576).toFixed(1)} MB) exceeds the ${config.maxGifOutputMB} MB limit. ` +
            `You used ${eff.width}px / ${eff.fps} FPS / ${eff.colors} colors / ${params.dither}. ` +
            `Try ${lowerNotch(config.allowedFps, eff.fps)} FPS, ${lowerNotch(config.allowedWidths, eff.width)}px, ` +
            `fewer colors, or a shorter segment. GIFs are often larger than their source video because ` +
            `GIF compresses far less efficiently than modern video codecs.`,
        },
      });
      return;
    }

    if (targetBytes !== null && size > targetBytes) {
      sizeNote = `Target of ${params.targetMB} MB not reached after ${attempts} attempts; smallest result kept (${(size / 1048576).toFixed(2)} MB).`;
    }

    // Remove source video ASAP to save ephemeral disk.
    await removePathSafe(job.inputPath);
    updateJob(jobId, { inputPath: null, palettePath: null });

    let outW = eff.width;
    let outH = 0;
    try {
      const op = await probeVideo(outputPath);
      if (op.width) { outW = op.width; outH = op.height; }
    } catch { /* keep estimates */ }

    // Effective preset: 'custom' if optimization changed the settings.
    const usedPreset = attempts > 1 ? 'custom' as const : params.preset;

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
        fps: eff.fps,
        colors: eff.colors,
        dither: params.dither,
        preset: usedPreset,
        conversionMs,
        attempts,
        sizeNote,
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
