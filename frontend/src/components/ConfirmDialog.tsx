import { useEffect, useRef } from 'react';

interface Props {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}

export default function ConfirmDialog({ open, title, body, confirmLabel = 'Confirm', onConfirm, onClose }: Props) {
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) btn.current?.focus();
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="glass w-full max-w-sm rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-slate-400">{body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-slate-600 px-4 py-2 text-sm hover:border-slate-400">Cancel</button>
          <button ref={btn} onClick={onConfirm} className="rounded-lg bg-red-500/90 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500">
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
