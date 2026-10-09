const KEY = 'clip2gif.session';

export function getSessionId(): string {
  let id = sessionStorage.getItem(KEY);
  if (!id) {
    id = (crypto as Crypto).randomUUID
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 24) + Date.now().toString(36)
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
    // Constrain to allowed charset/length
    id = id.replace(/[^A-Za-z0-9_-]/g, 'x').slice(0, 48);
    if (id.length < 16) id = id.padEnd(16, '0');
    sessionStorage.setItem(KEY, id);
  }
  return id;
}

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '00:00';
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

export function apiBase(): string {
  const v = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  if (v) return v.replace(/\/$/, '');
  return '';
}
