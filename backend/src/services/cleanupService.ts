import { allJobs, deleteJobRecord, getJob, updateJob } from './jobService.js';
import { config } from '../config/index.js';
import { removePathSafe } from '../utils/fs.js';

let timer: NodeJS.Timeout | null = null;

export async function cleanupOnce(now = Date.now()): Promise<{ removed: number }> {
  let removed = 0;
  const ttlMs = config.tempFileTtlMinutes * 60 * 1000;
  for (const job of allJobs()) {
    const active = job.status === 'converting' || job.status === 'analyzing' || job.status === 'queued' || job.status === 'uploading';
    if (active) {
      // Abandoned active jobs: if older than timeout and still active, expire them
      const ageMs = now - job.createdAt;
      if (ageMs > config.jobTimeoutSeconds * 1000 + ttlMs) {
        job.cancelled = true;
        await removePathSafe(job.dir);
        deleteJobRecord(job.id);
        removed++;
      }
      continue;
    }
    // Terminal jobs with expiry
    const expires = job.expiresAt ?? job.createdAt + ttlMs;
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      if (now >= expires) {
        await removePathSafe(job.dir);
        // Mark expired briefly? Spec has 'expired' status. Mark then delete record? Keep record as expired without files.
        updateJob(job.id, { status: 'expired', stage: 'Expired', outputPath: null, inputPath: null, palettePath: null, error: { code: 'EXPIRED', message: 'Files expired and were removed.' } });
        removed++;
      }
    } else if (job.status === 'expired') {
      // Purge very old expired records
      if (now - job.updatedAt > 60 * 60 * 1000) {
        await removePathSafe(job.dir);
        deleteJobRecord(job.id);
        removed++;
      }
    }
  }
  return { removed };
}

export function startCleanupLoop(): void {
  stopCleanupLoop();
  const intervalMs = Math.max(60_000, config.cleanupIntervalMinutes * 60 * 1000);
  timer = setInterval(() => {
    cleanupOnce().catch((e) => console.error('[cleanup] failed:', (e as Error).message));
  }, intervalMs);
  if (timer.unref) timer.unref();
}

export function stopCleanupLoop(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Delete all files + records for a session. Cancels active jobs first. */
export async function clearSession(sessionId: string): Promise<{ cancelled: number; removed: number }> {
  const { allJobs } = await import('./jobService.js');
  let cancelled = 0;
  let removed = 0;
  for (const job of allJobs()) {
    if (job.sessionId !== sessionId) continue;
    if (['converting', 'analyzing', 'queued', 'uploading'].includes(job.status)) {
      job.cancelled = true;
      cancelled++;
    }
  }
  // Give running ffmpeg a moment to notice cancellation
  await new Promise((r) => setTimeout(r, 300));
  for (const job of [...allJobs()]) {
    if (job.sessionId !== sessionId) continue;
    await removePathSafe(job.dir);
    const { deleteJobRecord } = await import('./jobService.js');
    deleteJobRecord(job.id);
    removed++;
  }
  return { cancelled, removed };
}

export async function deleteSingleJob(jobId: string): Promise<boolean> {
  const job = getJob(jobId);
  if (!job) return false;
  if (['converting', 'analyzing', 'queued', 'uploading'].includes(job.status)) {
    job.cancelled = true;
    await new Promise((r) => setTimeout(r, 300));
  }
  await removePathSafe(job.dir);
  deleteJobRecord(jobId);
  return true;
}
