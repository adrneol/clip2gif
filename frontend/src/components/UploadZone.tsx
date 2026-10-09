import { useRef, useState } from 'react';
import { Film, UploadCloud, X } from 'lucide-react';
import { formatBytes } from '../utils/format';

interface Props {
  onSelect: (f: File | null) => void;
  file: File | null;
  maxMB: number;
}

export default function UploadZone({ onSelect, file, maxMB }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  const pick = (f: File | undefined) => {
    if (f) onSelect(f);
  };

  return (
    <section aria-label="Upload video" className="glass rounded-2xl p-5 sm:p-6">
      <div
        role="button"
        tabIndex={0}
        aria-label="Choose a video file"
        onClick={() => input.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') input.current?.click(); }}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          pick(e.dataTransfer.files?.[0]);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-10 text-center transition-colors ${
          drag ? 'border-cyan-300 bg-cyan-400/10' : 'border-slate-600/70 hover:border-cyan-400/60'
        }`}
      >
        <UploadCloud className="mb-3 h-9 w-9 text-cyan-300" aria-hidden />
        <p className="font-semibold">Drag &amp; drop a video here, or click to browse</p>
        <p className="mt-1 text-xs text-slate-400">
          MP4, MOV, WebM, AVI, MKV, M4V · up to {maxMB} MB · stays on your device until you convert
        </p>
        <input
          ref={input}
          type="file"
          accept="video/mp4,video/quicktime,video/webm,video/x-msvideo,video/x-matroska,.mp4,.mov,.webm,.avi,.mkv,.m4v"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </div>
      {file && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-slate-800/60 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Film className="h-5 w-5 shrink-0 text-cyan-300" aria-hidden />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium" title={file.name}>{file.name}</p>
              <p className="text-xs text-slate-400">{formatBytes(file.size)}</p>
            </div>
          </div>
          <button
            onClick={() => onSelect(null)}
            className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs hover:border-red-400 hover:text-red-300"
            aria-label="Remove selected video"
          >
            <span className="inline-flex items-center gap-1"><X className="h-3.5 w-3.5" /> Remove</span>
          </button>
        </div>
      )}
    </section>
  );
}
