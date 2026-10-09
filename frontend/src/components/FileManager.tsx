import { useEffect, useState } from 'react';
import { Download, FolderX, Trash2 } from 'lucide-react';
import { api } from '../services/api';
import { formatBytes, formatTime } from '../utils/format';
import type { JobDto } from '../types';

interface Props {
  jobs: JobDto[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onChanged: () => void;
  notify: (kind: 'info' | 'success' | 'error', msg: string) => void;
  onConfirmClear: () => void;
}

export default function FileManager({ jobs, activeId, onSelect, onChanged, notify, onConfirmClear }: Props) {
  const [busy, setBusy] = useState(false);
  if (jobs.length === 0) return null;
  return (
    <section aria-label="Temporary files" className="glass rounded-2xl p-4 sm:p-5">
      <h2 className="mb-1 text-sm font-semibold text-slate-200">Temporary files</h2>
      <p className="mb-3 text-xs text-slate-400">
        {jobs.length} conversion{jobs.length === 1 ? '' : 's'} available · files expire automatically
      </p>
      <ul className="grid gap-2">
        {jobs.map((j) => (
          <li key={j.id} className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-xs ${j.id === activeId ? 'border-cyan-400/60 bg-cyan-400/5' : 'border-slate-700 bg-slate-900/50'}`}>
            <button onClick={() => onSelect(j.id)} className="min-w-0 flex-1 text-left" title={j.id}>
              <span className="block truncate font-mono text-[11px] text-slate-300">{j.id.slice(0, 8)}… · {j.status}</span>
              <span className="text-slate-400">
                {j.output ? `${formatBytes(j.output.sizeBytes)} · ${j.output.duration.toFixed(1)}s` : j.source ? `${formatTime(j.source.duration)} source` : j.stage}
              </span>
            </button>
            {j.status === 'completed' && (
              <DownloadButton id={j.id} notify={notify} />
            )}
            <button
              onClick={async () => {
                setBusy(true);
                try { await api.remove(j.id); notify('success', 'Conversion deleted.'); onChanged(); }
                catch (e) { notify('error', (e as Error).message); }
                finally { setBusy(false); }
              }}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-600 px-2 py-1.5 hover:border-red-400 hover:text-red-300"
              aria-label={`Delete conversion ${j.id.slice(0, 8)}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <button
        onClick={onConfirmClear}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-600 px-3 py-2 text-xs hover:border-red-400 hover:text-red-300"
      >
        <FolderX className="h-4 w-4" aria-hidden /> Clear all files
      </button>
    </section>
  );
}

function DownloadButton({ id, notify }: { id: string; notify: Props['notify'] }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => () => {}, []);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const blob = await api.downloadBlob(id, false);
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `clip2gif-${id.slice(0, 8)}.gif`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
        } catch (e) { notify('error', (e as Error).message); }
        finally { setBusy(false); }
      }}
      className="inline-flex items-center gap-1 rounded-lg border border-slate-600 px-2 py-1.5 hover:border-cyan-300 hover:text-cyan-200"
    >
      <Download className="h-3.5 w-3.5" /> GIF
    </button>
  );
}
