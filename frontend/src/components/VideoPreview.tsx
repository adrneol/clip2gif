import { useEffect, useRef } from 'react';
import { formatTime } from '../utils/format';

interface Props {
  url: string | null;
  duration: number | null;
  onDuration: (d: number) => void;
}

export default function VideoPreview({ url, duration, onDuration }: Props) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const h = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) onDuration(v.duration);
    };
    v.addEventListener('loadedmetadata', h);
    return () => v.removeEventListener('loadedmetadata', h);
  }, [url, onDuration]);

  if (!url) return null;
  return (
    <section aria-label="Video preview" className="glass rounded-2xl p-4 sm:p-5">
      <h2 className="mb-2 text-sm font-semibold text-slate-200">Preview</h2>
      <video ref={ref} src={url} controls preload="metadata" className="max-h-72 w-full rounded-xl bg-black" />
      <p className="mt-2 text-xs text-slate-400" aria-live="polite">
        {duration !== null ? `Duration: ${formatTime(duration)} (${duration.toFixed(1)}s)` : 'Loading duration…'}
      </p>
    </section>
  );
}
