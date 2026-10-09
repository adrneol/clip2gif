export type JobStatus =
  | 'uploading'
  | 'queued'
  | 'analyzing'
  | 'converting'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired';

export type QualityPreset = 'small' | 'balanced' | 'high';

export interface ConversionParams {
  start: number;
  end: number;
  width: number;
  fps: number;
  quality: QualityPreset;
}

export interface SourceMeta {
  duration: number;
  width: number;
  height: number;
  fps: number | null;
  sizeBytes: number;
  ext: string;
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
  output: {
    sizeBytes: number;
    width: number;
    height: number;
    duration: number;
    fps: number;
  } | null;
  cancelled: boolean;
}

export interface ApiError {
  code: string;
  message: string;
}
