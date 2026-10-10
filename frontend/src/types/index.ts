export type JobStatus =
  | 'uploading'
  | 'queued'
  | 'analyzing'
  | 'converting'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired';

export type PresetName = 'tiny' | 'compact' | 'balanced' | 'high' | 'max' | 'custom';
export type DitherName = 'sierra2_4a' | 'floyd_steinberg' | 'bayer' | 'none';

export interface PresetDef {
  width: number;
  fps: number;
  colors: number;
  dither: DitherName;
  blurb: string;
}

export interface ConversionParams {
  start: number;
  end: number;
  width: number;
  fps: number;
  colors: number;
  dither: DitherName;
  preset: PresetName;
  optimize: boolean;
  targetMB: number | null;
}

export interface JobDto {
  id: string;
  status: JobStatus;
  progress: number | null;
  stage: string;
  params: ConversionParams | null;
  source: {
    duration: number;
    width: number;
    height: number;
    fps: number | null;
    sizeBytes: number;
    ext: string;
  } | null;
  output: {
    sizeBytes: number;
    width: number;
    height: number;
    duration: number;
    fps: number;
    colors: number;
    dither: DitherName;
    preset: PresetName;
    conversionMs: number;
    attempts: number;
    sizeNote: string | null;
  } | null;
  error: { code: string; message: string } | null;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
  completedAt: number | null;
}

export interface Limits {
  maxUploadMB: number;
  maxUploadBytes: number;
  maxSourceDurationSeconds: number;
  maxClipDurationSeconds: number;
  maxGifOutputMB: number;
  maxGifOutputBytes: number;
  allowedExtensions: string[];
  allowedWidths: number[];
  allowedFps: number[];
  allowedColors: number[];
  allowedDithers: string[];
  allowedPresets: string[];
  presets: Record<string, PresetDef>;
  defaultPreset: string;
  suggestedTargetsMB: number[];
  tempFileTtlMinutes: number;
  jobTimeoutSeconds: number;
  maxActiveConversions: number;
  maxQueuedJobs: number;
}

export type BackendState = 'checking' | 'online' | 'starting' | 'offline';
