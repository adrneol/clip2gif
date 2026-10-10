import { useState } from 'react';
import { ChevronDown, Gauge } from 'lucide-react';
import type { DitherName, Limits, PresetName } from '../types';

interface Props {
  preset: PresetName;
  width: number;
  fps: number;
  colors: number;
  dither: DitherName;
  optimize: boolean;
  targetMB: number;
  segSeconds: number;
  limits: Limits | null;
  onPreset: (p: PresetName) => void;
  onCustom: (w: number, f: number, c: number, d: DitherName) => void;
  onOptimize: (on: boolean, target: number) => void;
}

const PRESET_ORDER: PresetName[] = ['tiny', 'compact', 'balanced', 'high', 'max'];
const PRESET_DESC: Record<string, string> = {
  tiny: '320px · 6fps · 96 colors',
  compact: '320px · 8fps · 128 colors',
  balanced: '480px · 10fps · 192 colors',
  high: '640px · 12fps · 256 colors',
  max: '640px · 15fps · 256 colors',
};

const DITHER_HELP: Record<string, string> = {
  sierra2_4a: 'Error diffusion. Best gradients, slightly larger files.',
  floyd_steinberg: 'Classic error diffusion. Good detail, moderate size.',
  bayer: 'Ordered pattern. Smaller files, visible pattern on gradients.',
  none: 'No dithering. Smallest files, possible color banding.',
};

/** Heuristic risk score (not a size prediction): frames × pixels proxy. */
function risk(seg: number, fps: number, width: number): 'low' | 'medium' | 'high' {
  const score = (seg * fps * width * width) / 1e9;
  if (score >= 0.1) return 'high';
  if (score >= 0.03) return 'medium';
  return 'low';
}

export default function GifSettings(props: Props) {
  const { preset, width, fps, colors, dither, optimize, targetMB, segSeconds, limits, onPreset, onCustom, onOptimize } = props;
  const [advanced, setAdvanced] = useState(preset === 'custom');
  const widths = limits?.allowedWidths ?? [240, 320, 360, 480, 640, 800];
  const fpsOpts = limits?.allowedFps ?? [5, 6, 8, 10, 12, 15, 20];
  const colorOpts = limits?.allowedColors ?? [64, 96, 128, 160, 192, 224, 256];
  const ditherOpts = (limits?.allowedDithers ?? ['sierra2_4a', 'floyd_steinberg', 'bayer', 'none']) as DitherName[];
  const targets = limits?.suggestedTargetsMB ?? [5, 10, 15, 20];
  const maxOut = limits?.maxGifOutputMB ?? 50;
  const r = risk(segSeconds, fps, width);

  return (
    <section aria-label="GIF settings" className="glass rounded-2xl p-4 sm:p-5">
      <h2 className="mb-3 text-sm font-semibold text-slate-200">GIF settings</h2>

      <div role="radiogroup" aria-label="Quality preset" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {PRESET_ORDER.map((p) => (
          <button
            key={p}
            role="radio"
            aria-checked={preset === p}
            onClick={() => onPreset(p)}
            className={`rounded-xl border px-3 py-2 text-left ${preset === p ? 'border-cyan-300 bg-cyan-400/15' : 'border-slate-600 hover:border-slate-400'}`}
          >
            <span className={`block text-sm font-semibold capitalize ${preset === p ? 'text-cyan-200' : 'text-slate-200'}`}>{p}</span>
            <span className="block text-[11px] text-slate-400">{PRESET_DESC[p]}</span>
          </button>
        ))}
        <button
          role="radio"
          aria-checked={preset === 'custom'}
          onClick={() => { setAdvanced(true); onCustom(width, fps, colors, dither); }}
          className={`rounded-xl border px-3 py-2 text-left ${preset === 'custom' ? 'border-cyan-300 bg-cyan-400/15' : 'border-slate-600 hover:border-slate-400'}`}
        >
          <span className={`block text-sm font-semibold ${preset === 'custom' ? 'text-cyan-200' : 'text-slate-200'}`}>Custom</span>
          <span className="block text-[11px] text-slate-400">Fine-tune everything</span>
        </button>
      </div>
      <p className="mt-2 text-[11px] text-slate-400">
        {preset === 'custom'
          ? 'Custom settings below. Every value is validated by the server; invalid values are rejected, never silently changed.'
          : `${limits?.presets?.[preset]?.blurb ?? ''} Higher fps is smoother but usually bigger. More colors help gradients (GIF max: 256). Max fidelity may approach the ${maxOut} MB limit.`}
      </p>

      <button
        onClick={() => setAdvanced((v) => !v)}
        aria-expanded={advanced}
        className="mt-3 inline-flex w-full items-center justify-between rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-slate-200 hover:border-slate-500"
      >
        <span className="inline-flex items-center gap-2">
          <Gauge className="h-4 w-4 text-cyan-300" aria-hidden /> Advanced settings
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${advanced ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      {advanced && (
        <div className="mt-3 grid gap-3 rounded-xl border border-slate-700/70 p-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs text-slate-300">
              Max dimension
              <select value={width} onChange={(e) => onCustom(Number(e.target.value), fps, colors, dither)} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-2 py-2 text-sm" aria-label="Max dimension in pixels">
                {widths.map((w) => <option key={w} value={w}>{w}px</option>)}
              </select>
            </label>
            <label className="block text-xs text-slate-300">
              Frame rate
              <select value={fps} onChange={(e) => onCustom(width, Number(e.target.value), colors, dither)} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-2 py-2 text-sm" aria-label="Frames per second">
                {fpsOpts.map((f) => <option key={f} value={f}>{f} fps</option>)}
              </select>
            </label>
            <label className="block text-xs text-slate-300">
              Palette colors
              <select value={colors} onChange={(e) => onCustom(width, fps, Number(e.target.value), dither)} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-2 py-2 text-sm" aria-label="Palette color count">
                {colorOpts.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="block text-xs text-slate-300">
              Dithering
              <select value={dither} onChange={(e) => onCustom(width, fps, colors, e.target.value as DitherName)} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-2 py-2 text-sm" aria-label="Dithering method">
                {ditherOpts.map((d) => <option key={d} value={d}>{d.replace('_', ' ')}</option>)}
              </select>
            </label>
          </div>
          <p className="text-[11px] text-slate-400">
            Larger dimensions preserve detail but need more data. More colors improve color fit but cannot exceed 256.
            {' '}{DITHER_HELP[dither] ?? ''}
            {' '}Aspect ratio is always preserved; portrait and landscape both work.
          </p>
        </div>
      )}

      <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-xs text-slate-300">
        <input type="checkbox" checked={optimize} onChange={(e) => onOptimize(e.target.checked, targetMB)} className="mt-0.5 h-4 w-4" />
        <span>
          <strong>Optimize file size</strong> — retry once or twice with reduced fps/colors/size if the GIF exceeds the target.
          Targets are goals, not guarantees; extra attempts take extra time.
        </span>
      </label>
      {optimize && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-300">Target:</span>
          {targets.map((t) => (
            <button key={t} onClick={() => onOptimize(true, t)} aria-pressed={targetMB === t} className={`rounded-lg border px-2.5 py-1 text-xs ${targetMB === t ? 'border-cyan-300 bg-cyan-400/15 text-cyan-200' : 'border-slate-600 text-slate-300'}`}>
              {t} MB
            </button>
          ))}
          <label className="inline-flex items-center gap-1 text-xs text-slate-300">
            Custom
            <input
              type="number" min={1} max={maxOut} value={targetMB}
              onChange={(e) => onOptimize(true, Math.max(1, Math.min(maxOut, Number(e.target.value) || 1)))}
              className="w-16 rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-xs" aria-label="Custom target size in MB"
            /> MB
          </label>
        </div>
      )}

      <div className={`mt-3 rounded-lg border px-3 py-2 text-[11px] ${r === 'high' ? 'border-amber-400/50 bg-amber-400/10 text-amber-200' : r === 'medium' ? 'border-slate-600 bg-slate-900/60 text-slate-300' : 'border-slate-700 bg-slate-900/60 text-slate-400'}`} aria-live="polite">
        {r === 'high' ? (
          <span><strong>Large-output risk: high.</strong> {segSeconds.toFixed(0)}s × {fps}fps at {width}px often produces a big GIF (GIF compresses far worse than video). If it exceeds {maxOut} MB you&apos;ll be asked to retry smaller. Consider {Math.max(widths[0], 320)}px, fewer fps, or enabling Optimize file size.</span>
        ) : r === 'medium' ? (
          <span><strong>Size risk: medium.</strong> Final size depends on content and can only be known after conversion. GIFs loop infinitely.</span>
        ) : (
          <span>These settings should produce a modest file. Final size depends on content; GIFs loop infinitely.</span>
        )}
      </div>
    </section>
  );
}
