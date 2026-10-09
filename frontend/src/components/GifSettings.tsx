import type { Limits } from '../types';

interface Props {
  width: number;
  fps: number;
  quality: 'small' | 'balanced' | 'high';
  segSeconds: number;
  limits: Limits | null;
  onChange: (w: number, f: number, q: 'small' | 'balanced' | 'high') => void;
}

const QUALITY_HELP: Record<string, string> = {
  small: '128 colors · smallest file',
  balanced: '192 colors · good default',
  high: '256 colors · best detail, larger file',
};

export default function GifSettings({ width, fps, quality, segSeconds, limits, onChange }: Props) {
  const widths = limits?.allowedWidths ?? [320, 480, 640];
  const fpsOpts = limits?.allowedFps ?? [5, 8, 10, 12, 15];
  // Rough heuristic warning (not an exact estimate)
  const heavy = segSeconds * fps * (width / 480) > 60 * 10;
  return (
    <section aria-label="GIF settings" className="glass rounded-2xl p-4 sm:p-5">
      <h2 className="mb-3 text-sm font-semibold text-slate-200">GIF settings</h2>
      <div className="grid gap-4">
        <fieldset>
          <legend className="mb-1 text-xs text-slate-300">Max dimension (aspect preserved)</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Max dimension">
            {widths.map((w) => (
              <button
                key={w}
                role="radio"
                aria-checked={width === w}
                onClick={() => onChange(w, fps, quality)}
                className={`rounded-lg border px-3 py-1.5 text-sm ${width === w ? 'border-cyan-300 bg-cyan-400/15 text-cyan-200' : 'border-slate-600 text-slate-300 hover:border-slate-400'}`}
              >
                {w}px
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1 text-xs text-slate-300">Frame rate</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Frame rate">
            {fpsOpts.map((f) => (
              <button
                key={f}
                role="radio"
                aria-checked={fps === f}
                onClick={() => onChange(width, f, quality)}
                className={`rounded-lg border px-3 py-1.5 text-sm ${fps === f ? 'border-cyan-300 bg-cyan-400/15 text-cyan-200' : 'border-slate-600 text-slate-300 hover:border-slate-400'}`}
              >
                {f} fps
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">Higher fps is smoother but usually makes a bigger file.</p>
        </fieldset>
        <label className="block text-xs text-slate-300">
          Quality
          <select
            value={quality}
            onChange={(e) => onChange(width, fps, e.target.value as Props['quality'])}
            className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
          >
            <option value="small">Small file</option>
            <option value="balanced">Balanced</option>
            <option value="high">High quality</option>
          </select>
          <span className="mt-1 block text-[11px] text-slate-400">{QUALITY_HELP[quality]} · palette-optimized conversion · loops forever</span>
        </label>
        <div className="rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2 text-[11px] text-slate-400">
          {heavy ? (
            <span className="text-amber-300">
              Heads-up: this combination (long clip + high fps/size) may produce a large GIF. If it exceeds {limits?.maxGifOutputMB ?? 50} MB
              you&apos;ll be asked to retry with smaller settings.
            </span>
          ) : (
            <span>
              Final size depends on the video content and settings — it can only be known after conversion. GIFs loop infinitely by default.
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
