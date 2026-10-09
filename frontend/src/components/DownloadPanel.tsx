import { Download, Plus, Trash2 } from 'lucide-react';
import type { JobDto } from '../types';

interface Props {
  job: JobDto;
  autoclear: boolean;
  busy: boolean;
  onAutoclear: (v: boolean) => void;
  onDownload: () => void;
  onRestart: () => void;
  onDelete: () => void;
}

export default function DownloadPanel({ job, autoclear, busy, onAutoclear, onDownload, onRestart, onDelete }: Props) {
  if (job.status !== 'completed') return null;
  return (
    <section aria-label="Download" className="glass rounded-2xl p-4 sm:p-5">
      <div className="flex flex-col gap-3">
        <button onClick={onDownload} disabled={busy} className="btn-primary inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm">
          <Download className="h-4 w-4" aria-hidden /> {busy ? 'Preparing…' : 'Download GIF'}
        </button>
        <div className="flex flex-wrap gap-2">
          <button onClick={onRestart} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 px-3 py-2 text-xs hover:border-slate-400">
            <Plus className="h-3.5 w-3.5" aria-hidden /> New conversion
          </button>
          <button onClick={onDelete} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 px-3 py-2 text-xs hover:border-red-400 hover:text-red-300">
            <Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete
          </button>
        </div>
        <label className="flex cursor-pointer items-start gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={autoclear} onChange={(e) => onAutoclear(e.target.checked)} className="mt-0.5 h-4 w-4" />
          <span><strong>Automatically clear temporary files after download</strong> (recommended). The server deletes your session files right after streaming the GIF.</span>
        </label>
      </div>
    </section>
  );
}
