import type { DitherName, PresetName } from '../config/index.js';

export type { DitherName, PresetName };

export type JobStatus =
  | 'uploading'
  | 'queued'
  | 'analyzing'
  | 'converting'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired';

/** Effective conversion settings. `preset` is the requested preset name;
 *  width/fps/colors/dither are the ACTUAL values used (equal to the preset
 *  canonical values unless the request overrode them, in which case the
 *  backend reports preset 'custom'). */
export interface ConversionParams {
  start: number;
  end: number;
  width: number;
  fps: number;
  colors: number;
  dither: DitherName;
  preset: PresetName;
  /** Legacy Phase-1 field: accepted on input as an alias, normalized away. */
  quality?: string;
  optimize: boolean;
  /** Desired ceiling in MB when optimize=true. Always <= MAX_GIF_OUTPUT_MB. */
  targetMB: number | null;
}

export interface SourceMeta {
  duration: number;
  width: number;
  height: number;
  fps: number | null;
  sizeBytes: number;
  ext: string;
}

export interface OutputMeta {
  sizeBytes: number;
  width: number;
  height: number;
  duration: number;
  fps: number;
  colors: number;
  dither: DitherName;
  preset: PresetName;
  /** Wall-clock encoding time in ms (all attempts summed). */
  conversionMs: number;
  /** Number of encode attempts (1 when size optimization is off). */
  attempts: number;
  /** Set when optimize=true but the target could not be reached. */
  sizeNote: string | null;
}

export interface Job {
  id: string;
  sessionId: string;
  status: JobStatus;
  /** 0-100 when determinable, null = indeterminate */
  progress: number | null;
  stage: string;
  params: ConversionParams | null;
  source: SourceMeta | null;
  inputPath: string | null;
  outputPath: string | null;
  palettePath: string | null;
  dir: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number | null;
  completedAt: number | null;
  error: { code: string; message: string } | null;
  output: OutputMeta | null;
  cancelled: boolean;
}

export interface ApiError {
  code: string;
  message: string;
}
