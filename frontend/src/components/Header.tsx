import { Clapperboard, ShieldCheck } from 'lucide-react';

export default function Header({ privacy }: { privacy: boolean }) {
  return (
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 pt-6 sm:px-6">
      <div className="flex items-center gap-3">
        <div className="glass flex h-10 w-10 items-center justify-center rounded-xl">
          <Clapperboard className="h-5 w-5 text-cyan-300" aria-hidden />
        </div>
        <div>
          <h1 className="text-lg font-extrabold tracking-tight">Clip2GIF</h1>
          <p className="text-xs text-slate-400">Turn video clips into lightweight GIFs.</p>
        </div>
      </div>
      <div className="flex items-center gap-2 rounded-full border border-slate-700/60 bg-slate-900/60 px-3 py-1.5 text-xs text-slate-300">
        <ShieldCheck className="h-4 w-4 text-emerald-300" aria-hidden />
        <span>{privacy ? 'Temporary files only' : 'Privacy-first'}</span>
      </div>
    </header>
  );
}
