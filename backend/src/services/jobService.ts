import { v4 as uuidv4 } from 'uuid';
import type { ConversionParams, Job, JobStatus } from '../types/index.js';

const jobs = new Map<string, Job>();

const MAX_JOBS = 500;

export function createJob(sessionId: string, dir: string): Job {
  if (jobs.size >= MAX_JOBS) {
    // Evict oldest terminal job to bound memory
    const oldest = [...jobs.values()]
      .filter((j) => ['completed', 'failed', 'cancelled', 'expired'].includes(j.status))
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (oldest) jobs.delete(oldest.id);
  }
  const now = Date.now();
  const job: Job = {
    id: uuidv4(),
    sessionId,
    status: 'queued' as JobStatus,
    progress: null,
    stage: 'Queued',
    params: null,
    source: null,
    inputPath: null,
    outputPath: null,
    palettePath: null,
    dir,
    createdAt: now,
    updatedAt: now,
    expiresAt: null,
    completedAt: null,
    error: null,
    output: null,
    cancelled: false,
  };
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function updateJob(id: string, patch: Partial<Job>): Job | undefined {
  const j = jobs.get(id);
  if (!j) return undefined;
  Object.assign(j, patch, { updatedAt: Date.now() });
  return j;
}

export function deleteJobRecord(id: string): void {
  jobs.delete(id);
}

export function jobsForSession(sessionId: string): Job[] {
  return [...jobs.values()]
    .filter((j) => j.sessionId === sessionId)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function countActive(): number {
  let n = 0;
  for (const j of jobs.values()) {
    if (j.status === 'converting' || j.status === 'analyzing') n++;
  }
  return n;
}

export function countQueued(): number {
  let n = 0;
  for (const j of jobs.values()) {
    if (j.status === 'queued') n++;
  }
  return n;
}

export function allJobs(): Job[] {
  return [...jobs.values()];
}

export function clearForTests(): void {
  jobs.clear();
}

export function publicJob(j: Job) {
  return {
    id: j.id,
    status: j.status,
    progress: j.progress,
    stage: j.stage,
    params: j.params,
    source: j.source,
    output: j.output,
    error: j.error,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
    expiresAt: j.expiresAt,
    completedAt: j.completedAt,
  };
}

export function setParams(id: string, params: ConversionParams): void {
  const j = jobs.get(id);
  if (j) {
    j.params = params;
    j.updatedAt = Date.now();
  }
}
