import { Loader2 } from 'lucide-react';
import type { JobDto } from '../types';

export default function ConversionProgress({ job, uploading }: { job: JobDto | null; uploading: boolean }) {
  if (!job && !uploading) return null;
  const status = job?.status ?? 'uploading';
  const label =
    uploading && !job ? 'Uploading…' :
    status === 'queued' ? 'Waiting in queue…' :
    status === 'analyzing' ? 'Analyzing video…' :
    status === 'converting' ? (job?.stage || 'Converting…') :
    status === 'completed' ? 'Completed' :
    status === 'failed' ? 'Failed' :
    status === 'cancelled' ? 'Cancelled' : status;
  const pct = job?.progress ?? null;
  return (
    <section aria-label="Conversion progress" aria-live="polite" className="glass rounded-2xl p-4 sm:p-5">
      <div className="flex items-center gap-2 text-sm font-medium">
        {(status === 'converting' || status === 'analyzing' || status === 'queued' || uploading) && (
          <Loader2 className="h-4 w-4 animate-spin text-cyan-300" aria-hidden />
        )}
        <span>{label}</span>
        {pct !== null && <span className="ml-auto font-mono text-cyan-200">{pct}%</span>}
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-700/60" role="progressbar" aria-valuenow={pct ?? undefined} aria-label={label}>
        {pct !== null ? (
          <div className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-cyan-300 transition-all" style={{ width: `${pct}%` }} />
        ) : (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-cyan-300/70" />
        )}
      </div>
      {job?.error && (
        <p role="alert" className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {job.error.message}
        </p>
      )}
    </section>
  );
}
