import type { Request, Response } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config, getLimits } from '../config/index.js';
import { probeVideo } from '../services/ffmpegService.js';
import { countActive, countQueued, createJob, deleteJobRecord, getJob, jobsForSession, publicJob, updateJob } from '../services/jobService.js';
import { processJob, validateParams } from '../services/conversionService.js';
import { clearSession, deleteSingleJob } from '../services/cleanupService.js';
import { sessionIdOf } from '../middleware/session.js';
import { ensureDir, extensionOf, fileExists, removePathSafe, safeJoin } from '../utils/fs.js';

export function sendError(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ success: false, error: { code, message } });
}

export function health(_req: Request, res: Response) {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ success: true, data: { status: 'ok', service: 'clip2gif', time: new Date().toISOString() } });
}

export function limits(_req: Request, res: Response) {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ success: true, data: getLimits() });
}

export async function createJobHandler(req: Request, res: Response) {
  const sessionId = sessionIdOf(req);

  // Queue guard
  const active = countActive();
  const queued = countQueued();
  if (active >= config.maxActiveConversions && queued >= config.maxQueuedJobs) {
    if (req.file?.path) await removePathSafe(req.file.path);
    return sendError(res, 429, 'QUEUE_FULL', 'The converter is busy. Please wait a moment and try again.');
  }
  if (active >= config.maxActiveConversions && queued >= config.maxQueuedJobs) {
    if (req.file?.path) await removePathSafe(req.file.path);
    return sendError(res, 429, 'QUEUE_FULL', 'The converter is busy. Please wait a moment and try again.');
  }

  const file = (req as unknown as { file?: Express.Multer.File }).file;
  if (!file) {
    return sendError(res, 400, 'MISSING_FILE', 'No video file was uploaded. Choose a video and try again.');
  }
  if (file.size <= 0) {
    await removePathSafe(file.path);
    return sendError(res, 400, 'EMPTY_UPLOAD', 'The uploaded file is empty.');
  }

  const origExt = extensionOf(file.originalname || file.filename);
  if (!config.allowedExtensions.includes(origExt)) {
    await removePathSafe(file.path);
    return sendError(res, 415, 'UNSUPPORTED_FORMAT', `Unsupported format "${origExt || 'unknown'}". Supported: ${config.allowedExtensions.join(', ')}`);
  }

  // Inspect with ffprobe (never trust extension alone)
  let probe;
  try {
    probe = await probeVideo(file.path);
  } catch {
    await removePathSafe(file.path);
    return sendError(res, 422, 'INVALID_VIDEO', 'Could not read this file as a video. It may be corrupted or use an unsupported codec.');
  }
  if (!probe.hasVideoStream) {
    await removePathSafe(file.path);
    return sendError(res, 422, 'NO_VIDEO_STREAM', 'The file contains no video stream.');
  }
  if (!Number.isFinite(probe.duration) || probe.duration <= 0) {
    await removePathSafe(file.path);
    return sendError(res, 422, 'INVALID_VIDEO', 'Could not determine the video duration. The file may be corrupted.');
  }
  if (probe.duration > config.maxSourceDurationSeconds + 1e-6) {
    await removePathSafe(file.path);
    return sendError(res, 413, 'VIDEO_TOO_LONG', `Video is ${probe.duration.toFixed(0)}s, exceeding the ${config.maxSourceDurationSeconds}s limit.`);
  }

  // Parse + validate conversion params.
  // New clients send preset (+ colors/dither/optimize/targetMB, all required for 'custom').
  // Phase-1 clients sent quality ('small'|'balanced'|'high') with width/fps — still accepted.
  const body = req.body as Record<string, unknown>;
  const parsed: Partial<import('../types/index.js').ConversionParams> & { quality?: string } = {
    start: Number(body.start ?? 0),
    end: Number(body.end ?? Math.min(probe.duration, config.maxClipDurationSeconds)),
    preset: body.preset !== undefined && body.preset !== '' ? (String(body.preset) as import('../types/index.js').ConversionParams['preset']) : undefined,
    width: body.width !== undefined && body.width !== '' ? Number(body.width) : undefined,
    fps: body.fps !== undefined && body.fps !== '' ? Number(body.fps) : undefined,
    colors: body.colors !== undefined && body.colors !== '' ? Number(body.colors) : undefined,
    dither: body.dither !== undefined && body.dither !== '' ? (String(body.dither) as import('../types/index.js').ConversionParams['dither']) : undefined,
    quality: body.quality !== undefined && body.quality !== '' ? String(body.quality) : undefined,
    optimize: body.optimize === true || String(body.optimize ?? '').toLowerCase() === 'true',
    targetMB: body.targetMB !== undefined && body.targetMB !== '' ? Number(body.targetMB) : undefined,
  };
  const v = validateParams(parsed, probe.duration);
  if (!v.ok || !v.params) {
    await removePathSafe(file.path);
    const status = v.code === 'TRIM_TOO_LONG' ? 413 : 400;
    return sendError(res, status, v.code ?? 'INVALID_SETTINGS', v.message ?? 'Invalid settings.');
  }

  // Create isolated job dir
  await ensureDir(config.tempDir);
  const tmpJob = createJob(sessionId, '');
  const jobDir = safeJoin(config.tempDir, tmpJob.id);
  await ensureDir(jobDir);
  tmpJob.dir = jobDir;

  const inputName = `input${origExt}`;
  const inputPath = safeJoin(jobDir, inputName);
  try {
    await fs.rename(file.path, inputPath);
  } catch {
    await removePathSafe(file.path);
    deleteJobRecord(tmpJob.id);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Could not store the upload. Try again.');
  }

  const stat = await fs.stat(inputPath).catch(() => null);
  updateJob(tmpJob.id, {
    status: 'queued',
    stage: 'Queued',
    progress: null,
    params: v.params,
    source: {
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      fps: probe.fps,
      sizeBytes: stat?.size ?? file.size,
      ext: origExt,
    },
    inputPath,
    expiresAt: null,
  });

  // Async processing (do not await)
  setImmediate(() => {
    processJob(tmpJob.id).catch((e) => console.error('[job]', (e as Error).message));
  });

  res.status(201).json({ success: true, data: { job: publicJob(getJob(tmpJob.id)!) } });
}

export function listJobs(req: Request, res: Response) {
  const sessionId = sessionIdOf(req);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ success: true, data: { jobs: jobsForSession(sessionId).map(publicJob) } });
}

export function getJobHandler(req: Request, res: Response) {
  const sessionId = sessionIdOf(req);
  const job = getJob(req.params.id);
  if (!job) return sendError(res, 404, 'NOT_FOUND', 'Job not found. It may have expired after a restart.');
  if (job.sessionId !== sessionId) return sendError(res, 403, 'FORBIDDEN', 'You do not have access to this job.');
  res.setHeader('Cache-Control', 'no-store');
  res.json({ success: true, data: { job: publicJob(job) } });
}

export async function cancelJob(req: Request, res: Response) {
  const sessionId = sessionIdOf(req);
  const job = getJob(req.params.id);
  if (!job) return sendError(res, 404, 'NOT_FOUND', 'Job not found.');
  if (job.sessionId !== sessionId) return sendError(res, 403, 'FORBIDDEN', 'You do not have access to this job.');
  if (['completed', 'failed', 'cancelled', 'expired'].includes(job.status)) {
    return sendError(res, 409, 'NOT_CANCELLABLE', `Job is already ${job.status}.`);
  }
  job.cancelled = true;
  updateJob(job.id, { stage: 'Cancelling' });
  res.json({ success: true, data: { job: publicJob(job) } });
}

export async function previewJob(req: Request, res: Response) {
  const sessionId = sessionIdOf(req);
  const job = getJob(req.params.id);
  if (!job) return sendError(res, 404, 'NOT_FOUND', 'Job not found. It may have expired.');
  if (job.sessionId !== sessionId) return sendError(res, 403, 'FORBIDDEN', 'You do not have access to this job.');
  if (job.status !== 'completed' || !job.outputPath) {
    const code = job.status === 'expired' ? 'EXPIRED' : 'NOT_READY';
    return sendError(res, job.status === 'expired' ? 410 : 409, code, job.status === 'expired' ? 'This GIF has expired.' : `GIF is not ready (status: ${job.status}).`);
  }
  if (!(await fileExists(job.outputPath))) return sendError(res, 410, 'MISSING_OUTPUT', 'Output file is no longer available. It may have expired.');
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.resolve(job.outputPath));
}

export async function downloadJob(req: Request, res: Response) {
  const sessionId = sessionIdOf(req);
  const job = getJob(req.params.id);
  if (!job) return sendError(res, 404, 'NOT_FOUND', 'Job not found. It may have expired.');
  if (job.sessionId !== sessionId) return sendError(res, 403, 'FORBIDDEN', 'You do not have access to this job.');
  if (job.status !== 'completed' || !job.outputPath) {
    return sendError(res, 409, 'NOT_READY', `GIF is not ready (status: ${job.status}).`);
  }
  if (!(await fileExists(job.outputPath))) return sendError(res, 410, 'MISSING_OUTPUT', 'Output file is no longer available.');
  const stat = await fs.stat(job.outputPath).catch(() => null);
  const size = stat?.size ?? job.output?.sizeBytes ?? 0;
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', String(size));
  res.setHeader('Content-Disposition', `attachment; filename="clip2gif-${job.id.slice(0, 8)}.gif"`);
  const autoclear = String(req.query.autoclear ?? '') === '1' || String(req.query.autoclear ?? '').toLowerCase() === 'true';

  // Stream then optionally clear session — never delete before streaming finishes.
  res.sendFile(path.resolve(job.outputPath), async (err) => {
    if (err) {
      console.error('[download] stream error:', (err as Error).message);
      return;
    }
    if (autoclear) {
      try {
        await clearSession(sessionId);
      } catch (e) {
        console.error('[autoclear] failed:', (e as Error).message);
      }
    }
  });
}

export async function deleteJobHandler(req: Request, res: Response) {
  const sessionId = sessionIdOf(req);
  const job = getJob(req.params.id);
  if (!job) return sendError(res, 404, 'NOT_FOUND', 'Job not found.');
  if (job.sessionId !== sessionId) return sendError(res, 403, 'FORBIDDEN', 'You do not have access to this job.');
  await deleteSingleJob(job.id);
  res.json({ success: true, data: { deleted: req.params.id } });
}

export async function clearAllHandler(req: Request, res: Response) {
  const sessionId = sessionIdOf(req);
  const result = await clearSession(sessionId);
  res.json({ success: true, data: result });
}
