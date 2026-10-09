export type JobStatus =
  | 'uploading'
  | 'queued'
  | 'analyzing'
  | 'converting'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired';

export interface ConversionParams {
  start: number;
  end: number;
  width: number;
  fps: number;
  quality: 'small' | 'balanced' | 'high';
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
  allowedQualities: string[];
  tempFileTtlMinutes: number;
  jobTimeoutSeconds: number;
  maxActiveConversions: number;
  maxQueuedJobs: number;
}

export type BackendState = 'checking' | 'online' | 'starting' | 'offline';
