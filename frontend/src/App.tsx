import { useCallback, useEffect, useRef, useState } from 'react';
import { Ban, RotateCcw, Wand2 } from 'lucide-react';
import Header from './components/Header';
import UploadZone from './components/UploadZone';
import VideoPreview from './components/VideoPreview';
import TrimControls from './components/TrimControls';
import GifSettings from './components/GifSettings';
import ConversionProgress from './components/ConversionProgress';
import GifPreview from './components/GifPreview';
import DownloadPanel from './components/DownloadPanel';
import FileManager from './components/FileManager';
import ColdStartNotice from './components/ColdStartNotice';
import ConfirmDialog from './components/ConfirmDialog';
import { useBackend } from './hooks/useBackend';
import { useToasts } from './hooks/useToasts';
import { api } from './services/api';
import type { DitherName, JobDto, Limits, PresetName } from './types';

const DEFAULT_LIMITS: Limits = {
  maxUploadMB: 100,
  maxUploadBytes: 100 * 1024 * 1024,
  maxSourceDurationSeconds: 600,
  maxClipDurationSeconds: 120,
  maxGifOutputMB: 50,
  maxGifOutputBytes: 50 * 1024 * 1024,
  allowedExtensions: ['.mp4', '.mov', '.webm', '.avi', '.mkv', '.m4v'],
  allowedWidths: [240, 320, 360, 480, 640, 800],
  allowedFps: [5, 6, 8, 10, 12, 15, 20],
  allowedColors: [64, 96, 128, 160, 192, 224, 256],
  allowedDithers: ['sierra2_4a', 'floyd_steinberg', 'bayer', 'none'],
  allowedPresets: ['tiny', 'compact', 'balanced', 'high', 'max', 'custom'],
  presets: {
    tiny: { width: 320, fps: 6, colors: 96, dither: 'bayer', blurb: '' },
    compact: { width: 320, fps: 8, colors: 128, dither: 'bayer', blurb: '' },
    balanced: { width: 480, fps: 10, colors: 192, dither: 'sierra2_4a', blurb: '' },
    high: { width: 640, fps: 12, colors: 256, dither: 'sierra2_4a', blurb: '' },
    max: { width: 640, fps: 15, colors: 256, dither: 'sierra2_4a', blurb: '' },
  },
  defaultPreset: 'balanced',
  suggestedTargetsMB: [5, 10, 15, 20],
  tempFileTtlMinutes: 30,
  jobTimeoutSeconds: 900,
  maxActiveConversions: 1,
  maxQueuedJobs: 3,
};

export default function App() {
  const [limits, setLimits] = useState<Limits | null>(null);
  const { state, elapsed, error, retry } = useBackend(setLimits);
  const lim = limits ?? DEFAULT_LIMITS;
  const { toasts, push } = useToasts();

  const [file, setFile] = useState<File | null>(null);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(10);
  const [width, setWidth] = useState(480);
  const [fps, setFps] = useState(10);
  const [colors, setColors] = useState(192);
  const [dither, setDither] = useState<DitherName>('sierra2_4a');
  const [preset, setPreset] = useState<PresetName>('balanced');
  const [optimize, setOptimize] = useState(false);
  const [targetMB, setTargetMB] = useState(10);

  // Adopt the server's default preset once limits arrive.
  useEffect(() => {
    if (!limits) return;
    const dp = limits.defaultPreset as PresetName;
    const def = limits.presets[dp];
    if (def) {
      setPreset(dp);
      setWidth(def.width);
      setFps(def.fps);
      setColors(def.colors);
      setDither(def.dither);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limits !== null]);
  const [job, setJob] = useState<JobDto | null>(null);
  const [jobs, setJobs] = useState<JobDto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const [autoclear, setAutoclear] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);
  const pollTimer = useRef<number | null>(null);

  // Local preview URL lifecycle
  useEffect(() => {
    if (!file) {
      setLocalUrl(null);
      setDuration(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setLocalUrl(url);
    setDuration(null);
    setStart(0);
    setEnd(10);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const onDuration = useCallback((d: number) => {
    setDuration(d);
    setEnd((prev) => {
      const cap = Math.min(d, lim.maxClipDurationSeconds);
      return prev <= 10 ? cap : Math.min(prev, d);
    });
  }, [lim.maxClipDurationSeconds]);

  const refreshList = useCallback(async () => {
    if (state !== 'online') return;
    try {
      const r = await api.list();
      setJobs(r.data.jobs);
    } catch { /* ignore */ }
  }, [state]);

  useEffect(() => {
    refreshList();
    const iv = window.setInterval(refreshList, 15000);
    return () => window.clearInterval(iv);
  }, [refreshList]);

  // Poll active job
  useEffect(() => {
    if (pollTimer.current) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    if (!job || ['completed', 'failed', 'cancelled', 'expired'].includes(job.status)) return;
    pollTimer.current = window.setInterval(async () => {
      try {
        const r = await api.job(job.id);
        setJob(r.data.job);
        if (['completed', 'failed', 'cancelled', 'expired'].includes(r.data.job.status)) {
          if (pollTimer.current) window.clearInterval(pollTimer.current);
          refreshList();
          if (r.data.job.status === 'failed') push('error', r.data.job.error?.message ?? 'Conversion failed.');
          if (r.data.job.status === 'expired') push('error', 'Files expired. Start a new conversion.');
        }
      } catch (e) {
        // Backend restart loses in-memory jobs
        if ((e as { status?: number }).status === 404) {
          if (pollTimer.current) window.clearInterval(pollTimer.current);
          push('error', 'Job not found — the service may have restarted. Start again.');
          setJob((j) => (j ? { ...j, status: 'expired', stage: 'Expired' } : j));
        }
      }
    }, 2000);
    return () => {
      if (pollTimer.current) window.clearInterval(pollTimer.current);
    };
  }, [job?.id, job?.status, push, refreshList]);

  // Load GIF preview blob (auth header required → fetch, not <img src>)
  useEffect(() => {
    if (gifUrl) {
      URL.revokeObjectURL(gifUrl);
      setGifUrl(null);
    }
    if (job?.status !== 'completed') return;
    let alive = true;
    api.previewBlob(job.id)
      .then((b) => {
        if (!alive) return;
        setGifUrl(URL.createObjectURL(b));
      })
      .catch(() => push('error', 'Could not load GIF preview. It may have expired.'));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.status]);

  const validTrim =
    file !== null &&
    end > start &&
    end - start <= lim.maxClipDurationSeconds + 1e-6 &&
    start >= 0 &&
    (duration === null || (start < duration && end <= duration + 0.5));

  async function handleConvert() {
    if (!file) {
      push('error', 'Choose a video first.');
      return;
    }
    if (!validTrim) {
      push('error', 'Fix the trim range before converting.');
      return;
    }
    setUploading(true);
    try {
      const r = await api.createJob(file, preset === 'custom'
        ? { start, end, preset, width, fps, colors, dither, optimize, targetMB: optimize ? targetMB : null }
        : { start, end, preset, optimize, targetMB: optimize ? targetMB : null });
      setJob(r.data.job);
      push('info', 'Upload complete — conversion queued.');
      refreshList();
    } catch (e) {
      push('error', (e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload() {
    if (!job) return;
    setBusy(true);
    try {
      const blob = await api.downloadBlob(job.id, autoclear);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `clip2gif-${job.id.slice(0, 8)}.gif`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      push('success', autoclear ? 'Download started — temporary files cleared.' : 'Download started.');
      if (autoclear) {
        // Backend cleared session after streaming; reflect locally
        setTimeout(async () => {
          await refreshList();
          setJob(null);
          if (gifUrl) {
            URL.revokeObjectURL(gifUrl);
            setGifUrl(null);
          }
        }, 1500);
      } else {
        refreshList();
      }
    } catch (e) {
      push('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!job) return;
    try {
      await api.cancel(job.id);
      push('info', 'Cancellation requested.');
      const r = await api.job(job.id);
      setJob(r.data.job);
    } catch (e) {
      push('error', (e as Error).message);
    }
  }

  function handleRestart() {
    setJob(null);
    if (gifUrl) {
      URL.revokeObjectURL(gifUrl);
      setGifUrl(null);
    }
  }

  async function handleDeleteJob() {
    if (!job) return;
    try {
      await api.remove(job.id);
      push('success', 'Conversion deleted.');
      setJob(null);
      if (gifUrl) {
        URL.revokeObjectURL(gifUrl);
        setGifUrl(null);
      }
      refreshList();
    } catch (e) {
      push('error', (e as Error).message);
    }
  }

  async function handleClearAll() {
    setConfirmClear(false);
    try {
      await api.clearAll();
      push('success', 'All temporary files cleared.');
      setJob(null);
      setJobs([]);
      if (gifUrl) {
        URL.revokeObjectURL(gifUrl);
        setGifUrl(null);
      }
      if (localUrl) {
        URL.revokeObjectURL(localUrl);
        setLocalUrl(null);
      }
      setFile(null);
    } catch (e) {
      push('error', (e as Error).message);
    }
  }

  const converting = job !== null && ['queued', 'analyzing', 'converting'].includes(job.status);

  return (
    <div className="min-h-screen pb-16">
      <Header privacy />
      <main className="mx-auto grid w-full max-w-5xl gap-4 px-4 pt-6 sm:px-6">
        {state !== 'online' ? (
          <ColdStartNotice elapsed={elapsed} error={state === 'offline' ? error : null} onRetry={retry} />
        ) : (
          <>
            <UploadZone onSelect={setFile} file={file} maxMB={lim.maxUploadMB} />
            {file && (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="grid content-start gap-4">
                  <VideoPreview url={localUrl} duration={duration} onDuration={onDuration} />
                  <TrimControls start={start} end={end} duration={duration} maxClip={lim.maxClipDurationSeconds} onChange={(s, e) => { setStart(s); setEnd(e); }} />
                </div>
                <div className="grid content-start gap-4">
                  <GifSettings
                    preset={preset} width={width} fps={fps} colors={colors} dither={dither}
                    optimize={optimize} targetMB={targetMB}
                    segSeconds={Math.max(0, end - start)} limits={lim}
                    onPreset={(p) => {
                      setPreset(p);
                      const def = lim.presets[p];
                      if (def) { setWidth(def.width); setFps(def.fps); setColors(def.colors); setDither(def.dither); }
                    }}
                    onCustom={(w, f, c, d) => { setPreset('custom'); setWidth(w); setFps(f); setColors(c); setDither(d); }}
                    onOptimize={(on, t) => { setOptimize(on); setTargetMB(t); }}
                  />
                  <div className="glass flex flex-wrap items-center gap-2 rounded-2xl p-4">
                    <button
                      onClick={handleConvert}
                      disabled={!validTrim || uploading || converting}
                      className="btn-primary inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm"
                    >
                      <Wand2 className="h-4 w-4" aria-hidden />
                      {uploading ? 'Uploading…' : converting ? 'Converting…' : 'Convert to GIF'}
                    </button>
                    {converting && (
                      <button onClick={handleCancel} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-600 px-4 py-3 text-sm hover:border-red-400 hover:text-red-300">
                        <Ban className="h-4 w-4" aria-hidden /> Cancel
                      </button>
                    )}
                    {job && ['failed', 'cancelled', 'expired'].includes(job.status) && (
                      <button onClick={handleRestart} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-600 px-4 py-3 text-sm hover:border-slate-400">
                        <RotateCcw className="h-4 w-4" aria-hidden /> Start over
                      </button>
                    )}
                  </div>
                  <ConversionProgress job={job} uploading={uploading} />
                  {job?.status === 'completed' && (
                    <>
                      <GifPreview job={job} url={gifUrl} />
                      <DownloadPanel
                        job={job} autoclear={autoclear} busy={busy}
                        onAutoclear={setAutoclear} onDownload={handleDownload}
                        onRestart={handleRestart} onDelete={handleDeleteJob}
                      />
                    </>
                  )}
                </div>
              </div>
            )}
            <FileManager
              jobs={jobs}
              activeId={job?.id ?? null}
              onSelect={async (id) => {
                try {
                  const r = await api.job(id);
                  setJob(r.data.job);
                } catch (e) { push('error', (e as Error).message); }
              }}
              onChanged={refreshList}
              notify={push}
              onConfirmClear={() => setConfirmClear(true)}
            />
            <section aria-label="Privacy" className="glass rounded-2xl p-4 text-xs leading-relaxed text-slate-400 sm:p-5">
              <h2 className="mb-1 font-semibold text-slate-200">Privacy &amp; temporary files</h2>
              <p>
                Your selected video stays on your device until you press Convert. Processing happens on this app&apos;s backend
                (not on your device). Uploads and GIFs are temporary: GIFs expire after ~{lim.tempFileTtlMinutes} minutes, failed
                uploads are removed, and a restart may delete files sooner. Use “Clear all files” anytime. No accounts, no tracking.
              </p>
              <p className="mt-1">
                Limits: source up to {lim.maxUploadMB} MB / {lim.maxSourceDurationSeconds}s · clip up to {lim.maxClipDurationSeconds}s ·
                GIF up to {lim.maxGifOutputMB} MB.
              </p>
            </section>
          </>
        )}
      </main>
      <footer className="mx-auto w-full max-w-5xl px-4 pt-6 text-center text-[11px] text-slate-500 sm:px-6">
        Clip2GIF · temporary server-side processing · files are not stored permanently.
      </footer>

      <div aria-live="polite" className="fixed bottom-4 left-1/2 z-50 flex w-full max-w-md -translate-x-1/2 flex-col gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={`rounded-xl border px-4 py-2.5 text-sm shadow-lg ${
              t.kind === 'error'
                ? 'border-red-500/50 bg-red-950/90 text-red-200'
                : t.kind === 'success'
                  ? 'border-emerald-500/40 bg-emerald-950/90 text-emerald-200'
                  : 'border-slate-600 bg-slate-900/95 text-slate-200'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={confirmClear}
        title="Clear all temporary files?"
        body="This cancels active conversions and deletes all GIFs for this session. Continue?"
        confirmLabel="Clear all"
        onConfirm={handleClearAll}
        onClose={() => setConfirmClear(false)}
      />
    </div>
  );
}
