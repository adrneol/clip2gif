import { formatTime } from '../utils/format';

interface Props {
  start: number;
  end: number;
  duration: number | null;
  maxClip: number;
  onChange: (start: number, end: number) => void;
}

export default function TrimControls({ start, end, duration, maxClip, onChange }: Props) {
  const dur = duration ?? maxClip;
  const seg = Math.max(0, end - start);
  const valid = start >= 0 && end > start && seg <= maxClip + 1e-6 && (duration === null || end <= duration + 0.5);
  const err = !valid
    ? seg > maxClip
      ? `Segment is ${seg.toFixed(1)}s — max ${maxClip}s. Shorten it.`
      : 'End must be after start and within the video.'
    : null;

  return (
    <section aria-label="Trim video" className="glass rounded-2xl p-4 sm:p-5">
      <h2 className="mb-1 text-sm font-semibold text-slate-200">Trim clip</h2>
      <p className="mb-3 text-xs text-slate-400">
        {duration !== null ? `Video: ${formatTime(duration)}` : 'Video duration loading…'} · Max segment: {formatTime(maxClip)} · Selected:{' '}
        <strong className="text-cyan-300">{formatTime(seg)} ({seg.toFixed(1)}s)</strong>
      </p>
      <div className="grid gap-4">
        <label className="block">
          <span className="mb-1 flex justify-between text-xs text-slate-300">
            <span>Start</span><span className="font-mono">{formatTime(start)}</span>
          </span>
          <input
            type="range" min={0} max={dur} step={0.5} value={Math.min(start, dur)}
            onChange={(e) => onChange(Math.min(Number(e.target.value), end - 0.5), end)}
            className="w-full" aria-label="Start time in seconds"
          />
        </label>
        <label className="block">
          <span className="mb-1 flex justify-between text-xs text-slate-300">
            <span>End</span><span className="font-mono">{formatTime(end)}</span>
          </span>
          <input
            type="range" min={0} max={dur} step={0.5} value={Math.min(end, dur)}
            onChange={(e) => onChange(start, Math.max(Number(e.target.value), start + 0.5))}
            className="w-full" aria-label="End time in seconds"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs text-slate-300">
            Start (s)
            <input
              type="number" min={0} max={dur} step={0.5} value={start}
              onChange={(e) => onChange(Number(e.target.value), end)}
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-xs text-slate-300">
            End (s)
            <input
              type="number" min={0} max={dur} step={0.5} value={end}
              onChange={(e) => onChange(start, Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
            />
          </label>
        </div>
        {err && (
          <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {err}
          </p>
        )}
      </div>
    </section>
  );
}
