import { formatBytes } from '../utils/format';
import type { JobDto } from '../types';

export default function GifPreview({ job, url }: { job: JobDto; url: string | null }) {
  if (job.status !== 'completed' || !job.output) return null;
  return (
    <section aria-label="GIF result" className="glass rounded-2xl p-4 sm:p-5">
      <h2 className="mb-2 text-sm font-semibold text-slate-200">Your GIF</h2>
      {url ? (
        <img src={url} alt="Converted animated GIF" className="max-h-80 w-full rounded-xl bg-black object-contain" />
      ) : (
        <p className="text-xs text-slate-400">Loading preview…</p>
      )}
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-300 sm:grid-cols-4">
        <div><dt className="text-slate-500">Size</dt><dd className="font-mono">{formatBytes(job.output.sizeBytes)}</dd></div>
        <div><dt className="text-slate-500">Dimensions</dt><dd className="font-mono">{job.output.width}×{job.output.height}</dd></div>
        <div><dt className="text-slate-500">Frame rate</dt><dd className="font-mono">{job.output.fps} fps</dd></div>
        <div><dt className="text-slate-500">Clip</dt><dd className="font-mono">{job.output.duration.toFixed(1)}s</dd></div>
      </dl>
    </section>
  );
}
