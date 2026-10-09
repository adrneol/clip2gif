import { CloudOff, RefreshCw } from 'lucide-react';

export default function ColdStartNotice({ elapsed, error, onRetry }: { elapsed: number; error: string | null; onRetry: () => void }) {
  return (
    <section aria-live="polite" className="glass rounded-2xl p-5 text-center sm:p-6">
      <CloudOff className="mx-auto mb-2 h-8 w-8 text-amber-300" aria-hidden />
      <h2 className="font-semibold">Starting the converter</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">
        The video converter is waking up. On free hosting, the first connection can take around a minute. Please keep this page open while we
        reconnect{elapsed > 0 ? ` (waiting ${elapsed}s…)` : '…'}
      </p>
      {error && (
        <p role="alert" className="mx-auto mt-3 max-w-md rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}
      <button onClick={onRetry} className="btn-primary mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm">
        <RefreshCw className="h-4 w-4" aria-hidden /> Retry now
      </button>
    </section>
  );
}
