import { apiBase, getSessionId } from '../utils/format';
import type { JobDto, Limits } from '../types';

async function req(path: string, init: RequestInit = {}) {
  const base = apiBase();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'x-session-id': getSessionId(), ...(init.headers || {}) },
  });
  if (!res.ok) {
    let body: unknown = null;
    try { body = await res.json(); } catch { /* noop */ }
    const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw Object.assign(new Error(err?.message || `Request failed (${res.status})`), {
      code: err?.code || 'HTTP_ERROR',
      status: res.status,
    });
  }
  return res.json();
}

export const api = {
  health(): Promise<{ success: boolean; data: unknown }> {
    const base = apiBase();
    return fetch(`${base}/api/health`).then(async (r) => {
      if (!r.ok) throw new Error(`health ${r.status}`);
      return r.json();
    });
  },
  limits(): Promise<{ success: boolean; data: Limits }> {
    return req('/api/limits');
  },
  createJob(file: File, params: { start: number; end: number; preset: string; width?: number; fps?: number; colors?: number; dither?: string; optimize?: boolean; targetMB?: number | null }, onUploadProgress?: (pct: number) => void): Promise<{ success: boolean; data: { job: JobDto } }> {
    const base = apiBase();
    const form = new FormData();
    form.append('video', file, file.name);
    form.append('start', String(params.start));
    form.append('end', String(params.end));
    form.append('preset', params.preset);
    if (params.width !== undefined) form.append('width', String(params.width));
    if (params.fps !== undefined) form.append('fps', String(params.fps));
    if (params.colors !== undefined) form.append('colors', String(params.colors));
    if (params.dither !== undefined) form.append('dither', params.dither);
    if (params.optimize) {
      form.append('optimize', 'true');
      if (params.targetMB != null) form.append('targetMB', String(params.targetMB));
    }
    onUploadProgress?.(5);
    return fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'x-session-id': getSessionId() },
      body: form,
    }).then(async (res) => {
      onUploadProgress?.(100);
      if (!res.ok) {
        let body: unknown = null;
        try { body = await res.json(); } catch { /* noop */ }
        const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
        throw Object.assign(new Error(err?.message || `Upload failed (${res.status})`), {
          code: err?.code || 'HTTP_ERROR',
          status: res.status,
        });
      }
      return res.json();
    });
  },
  job(id: string): Promise<{ success: boolean; data: { job: JobDto } }> {
    return req(`/api/jobs/${id}`);
  },
  list(): Promise<{ success: boolean; data: { jobs: JobDto[] } }> {
    return req('/api/jobs');
  },
  cancel(id: string) {
    return req(`/api/jobs/${id}/cancel`, { method: 'POST' });
  },
  remove(id: string) {
    return req(`/api/jobs/${id}`, { method: 'DELETE' });
  },
  clearAll(): Promise<{ success: boolean; data: { cancelled: number; removed: number } }> {
    return req('/api/jobs', { method: 'DELETE' });
  },
  previewBlob(id: string): Promise<Blob> {
    const base = apiBase();
    return fetch(`${base}/api/jobs/${id}/preview`, { headers: { 'x-session-id': getSessionId() } }).then(async (r) => {
      if (!r.ok) throw new Error('Preview not available');
      return r.blob();
    });
  },
  downloadBlob(id: string, autoclear: boolean): Promise<Blob> {
    const base = apiBase();
    const q = autoclear ? '?autoclear=1' : '';
    return fetch(`${base}/api/jobs/${id}/download${q}`, { headers: { 'x-session-id': getSessionId() } }).then(async (r) => {
      if (!r.ok) {
        let msg = `Download failed (${r.status})`;
        try {
          const j = await r.json();
          if (j?.error?.message) msg = j.error.message;
        } catch { /* noop */ }
        throw new Error(msg);
      }
      return r.blob();
    });
  },
};
