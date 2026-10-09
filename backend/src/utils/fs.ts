import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export async function ensureDir(dir: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
}

export async function removePathSafe(p: string | null | undefined): Promise<void> {
  if (!p) return;
  try {
    await fsp.rm(p, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

export function safeJoin(base: string, ...parts: string[]): string {
  const resolvedBase = path.resolve(base);
  const joined = path.resolve(base, ...parts);
  if (joined !== resolvedBase && !joined.startsWith(resolvedBase + path.sep)) {
    throw new Error('Path traversal blocked');
  }
  return joined;
}

export async function fileExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function fileSize(p: string): Promise<number> {
  const st = await fsp.stat(p);
  return st.size;
}

export function extensionOf(filename: string): string {
  return path.extname(filename || '').toLowerCase();
}
