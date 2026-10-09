import os from 'node:os';
import path from 'node:path';

function num(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error(`Invalid ${name}=${raw}. Must be a positive number.`);
  }
  return v;
}

function str(name: string, def: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  return raw;
}

const tempDir =
  process.env.TEMP_DIR && process.env.TEMP_DIR.trim() !== ''
    ? process.env.TEMP_DIR
    : path.join(os.tmpdir(), 'clip2gif');

export const config = {
  nodeEnv: str('NODE_ENV', 'development'),
  port: num('PORT', 5000),
  frontendOrigin: str('FRONTEND_ORIGIN', 'http://localhost:5173'),
  tempDir,
  maxUploadMB: num('MAX_UPLOAD_MB', 100),
  maxSourceDurationSeconds: num('MAX_SOURCE_DURATION_SECONDS', 600),
  maxClipDurationSeconds: num('MAX_CLIP_DURATION_SECONDS', 120),
  maxGifOutputMB: num('MAX_GIF_OUTPUT_MB', 50),
  maxActiveConversions: Number(process.env.MAX_ACTIVE_CONVERSIONS ?? 1) || 1,
  maxQueuedJobs: Number(process.env.MAX_QUEUED_JOBS ?? 3) || 3,
  tempFileTtlMinutes: num('TEMP_FILE_TTL_MINUTES', 30),
  jobTimeoutSeconds: num('JOB_TIMEOUT_SECONDS', 900),
  cleanupIntervalMinutes: num('CLEANUP_INTERVAL_MINUTES', 5),
  allowedExtensions: ['.mp4', '.mov', '.webm', '.avi', '.mkv', '.m4v'],
  allowedWidths: [320, 480, 640],
  allowedFps: [5, 8, 10, 12, 15],
  allowedQualities: ['small', 'balanced', 'high'] as const,
  ffmpegThreads: 1,
};

export type AppConfig = typeof config;

export function getLimits() {
  return {
    maxUploadMB: config.maxUploadMB,
    maxUploadBytes: config.maxUploadMB * 1024 * 1024,
    maxSourceDurationSeconds: config.maxSourceDurationSeconds,
    maxClipDurationSeconds: config.maxClipDurationSeconds,
    maxGifOutputMB: config.maxGifOutputMB,
    maxGifOutputBytes: config.maxGifOutputMB * 1024 * 1024,
    allowedExtensions: config.allowedExtensions,
    allowedWidths: config.allowedWidths,
    allowedFps: config.allowedFps,
    allowedQualities: [...config.allowedQualities],
    tempFileTtlMinutes: config.tempFileTtlMinutes,
    jobTimeoutSeconds: config.jobTimeoutSeconds,
    maxActiveConversions: config.maxActiveConversions,
    maxQueuedJobs: config.maxQueuedJobs,
  };
}
