import dotenv from 'dotenv';
import os from 'node:os';
import path from 'node:path';

// Load backend/.env relative to THIS file, not the process working directory.
// Root-level scripts (`npm --prefix backend ...`) run with CWD=root, so a
// CWD-based lookup would silently miss backend/.env. This path resolves to
// backend/.env both in development (src/config) and compiled (dist/config).
// Real environment variables (Render dashboard, shell exports, test setup)
// always win: dotenv never overrides existing values, and a missing file
// (production) is a silent no-op.
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

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

export type PresetName = 'tiny' | 'compact' | 'balanced' | 'high' | 'max' | 'custom';
export type DitherName = 'sierra2_4a' | 'floyd_steinberg' | 'bayer' | 'none';

export interface PresetDef {
  width: number;
  fps: number;
  colors: number;
  dither: DitherName;
  blurb: string;
}

/**
 * Canonical quality presets. Each maps to REAL encoder settings
 * (see ffmpegService.buildFilterGraphs). Benchmarks in bench/REPORT.md
 * justify the dither/colors choices: bayer for size-first presets,
 * sierra2_4a for quality-first ones.
 */
export const PRESETS: Record<Exclude<PresetName, 'custom'>, PresetDef> = {
  tiny:     { width: 320, fps: 6,  colors: 96,  dither: 'bayer',       blurb: 'Very small files; simple animations.' },
  compact:  { width: 320, fps: 8,  colors: 128, dither: 'bayer',       blurb: 'Compact files, reasonably smooth.' },
  balanced: { width: 480, fps: 10, colors: 192, dither: 'sierra2_4a',  blurb: 'General purpose; quality/size balance.' },
  high:     { width: 640, fps: 12, colors: 256, dither: 'sierra2_4a',  blurb: 'More detail and smoother motion.' },
  max:      { width: 640, fps: 15, colors: 256, dither: 'sierra2_4a',  blurb: 'Maximum fidelity; may be large. Not lossless.' },
};

/** Legacy Phase-1 names accepted for backward compatibility. */
export const LEGACY_QUALITY_ALIAS: Record<string, PresetName> = {
  small: 'compact',
  balanced: 'balanced',
  high: 'high',
};

const defaultPresetRaw = str('DEFAULT_PRESET', 'balanced');
if (!(defaultPresetRaw in PRESETS)) {
  throw new Error(`Invalid DEFAULT_PRESET=${defaultPresetRaw}. Must be one of ${Object.keys(PRESETS).join(', ')}.`);
}

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
  allowedWidths: [240, 320, 360, 480, 640, 800],
  allowedFps: [5, 6, 8, 10, 12, 15, 20],
  allowedColors: [64, 96, 128, 160, 192, 224, 256],
  allowedDithers: ['sierra2_4a', 'floyd_steinberg', 'bayer', 'none'] as DitherName[],
  allowedPresets: ['tiny', 'compact', 'balanced', 'high', 'max', 'custom'] as PresetName[],
  defaultPreset: defaultPresetRaw as PresetName,
  /** Suggested "optimize file size" targets (MB). Custom targets must be 1..MAX_GIF_OUTPUT_MB. */
  suggestedTargetsMB: [5, 10, 15, 20],
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
    allowedColors: config.allowedColors,
    allowedDithers: [...config.allowedDithers],
    allowedPresets: [...config.allowedPresets],
    presets: Object.fromEntries(
      (Object.keys(PRESETS) as Array<keyof typeof PRESETS>).map((k) => [k, { ...PRESETS[k] }])
    ),
    defaultPreset: config.defaultPreset,
    suggestedTargetsMB: [...config.suggestedTargetsMB],
    tempFileTtlMinutes: config.tempFileTtlMinutes,
    jobTimeoutSeconds: config.jobTimeoutSeconds,
    maxActiveConversions: config.maxActiveConversions,
    maxQueuedJobs: config.maxQueuedJobs,
  };
}
