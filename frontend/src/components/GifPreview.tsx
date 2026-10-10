import { formatBytes } from '../utils/format';
import type { JobDto } from '../types';

function fmtMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export default function GifPreview({ job, url }: { job: JobDto; url: string | null }) {
  if (job.status !== 'completed' || !job.output) return null;
  const o = job.output;
  const src = job.source;
  const diff = src ? o.sizeBytes - src.sizeBytes : null;
  return (
    <section aria-label="GIF result" className="glass rounded-2xl p-4 sm:p-5">
      <h2 className="mb-2 text-sm font-semibold text-slate-200">Your GIF</h2>
      {url ? (
        <img src={url} alt="Converted animated GIF" className="max-h-80 w-full rounded-xl bg-black object-contain" />
      ) : (
        <p className="text-xs text-slate-400">Loading preview…</p>
      )}
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-300 sm:grid-cols-4">
        <div><dt className="text-slate-500">Output size</dt><dd className="font-mono">{formatBytes(o.sizeBytes)}</dd></div>
        <div><dt className="text-slate-500">Dimensions</dt><dd className="font-mono">{o.width}×{o.height}</dd></div>
        <div><dt className="text-slate-500">Frame rate</dt><dd className="font-mono">{o.fps} fps</dd></div>
        <div><dt className="text-slate-500">Clip</dt><dd className="font-mono">{o.duration.toFixed(1)}s</dd></div>
        <div><dt className="text-slate-500">Palette / dither</dt><dd className="font-mono">{o.colors} · {o.dither.replace('_', ' ')}</dd></div>
        <div><dt className="text-slate-500">Preset</dt><dd className="font-mono">{o.preset}{o.attempts > 1 ? ` · ${o.attempts} tries` : ''}</dd></div>
        <div><dt className="text-slate-500">Converted in</dt><dd className="font-mono">{fmtMs(o.conversionMs)}</dd></div>
        <div>
          <dt className="text-slate-500">vs source</dt>
          <dd className="font-mono">
            {src ? `${formatBytes(src.sizeBytes)} → ${diff !== null && diff > 0 ? '+' : ''}${formatBytes(diff ?? 0)}` : '—'}
          </dd>
        </div>
      </dl>
      {o.sizeNote && (
        <p role="status" className="mt-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
          {o.sizeNote}
        </p>
      )}
      {src && o.sizeBytes > src.sizeBytes && (
        <p className="mt-2 text-[11px] text-slate-400">
          GIFs can be larger than their source video: GIF uses a 256-color palette per frame and far less efficient
          compression than modern video codecs, so animated GIFs often outweigh the MP4 they came from.
        </p>
      )}
    </section>
  );
}
