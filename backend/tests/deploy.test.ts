import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

// js-yaml is CJS; load it via require for reliable interop under vitest.
const require = createRequire(import.meta.url);
const yaml = require('js-yaml') as {
  load: (src: string) => {
    services?: Array<{
      name?: string;
      rootDir?: string;
      buildCommand?: string;
      startCommand?: string;
      healthCheckPath?: string;
    }>;
  };
};

// Resolve backend/ regardless of the invoking working directory
// (backend/ via npm scripts, or repo root).
const BACKEND_DIR = fs.existsSync(path.join(process.cwd(), 'backend', 'package.json'))
  ? path.join(process.cwd(), 'backend')
  : process.cwd();
const ROOT_DIR = path.resolve(BACKEND_DIR, '..');

function readJson(p: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
}

describe('deploy contract: compiler output matches production start target', () => {
  const pkg = readJson(path.join(BACKEND_DIR, 'package.json'));
  const tsconfig = readJson(path.join(BACKEND_DIR, 'tsconfig.json'));
  const scripts = (pkg.scripts ?? {}) as Record<string, string>;
  const outDir = ((tsconfig.compilerOptions ?? {}) as Record<string, unknown>).outDir ?? 'dist';

  it('start script launches the compiler outDir entry point', () => {
    const m = /node\s+([^\s'"]+)/.exec(scripts.start ?? '');
    expect(m, 'start script must launch node with an explicit file path').toBeTruthy();
    expect(path.normalize(m![1])).toBe(path.normalize(path.join(String(outDir), 'server.js')));
  });

  it('compiled entry point exists on disk (run npm run build first)', () => {
    const entry = path.join(BACKEND_DIR, String(outDir), 'server.js');
    expect(fs.existsSync(entry), `missing compiled entry: ${entry}`).toBe(true);
    // Sanity: the emitted bundle is the Clip2GIF server, not a stray file.
    const src = fs.readFileSync(entry, 'utf8');
    expect(src).toContain('clip2gif');
  });

  it('build verifies output and prestart enforces it (no silent success)', () => {
    expect(scripts.build ?? '').toContain('ensure-dist.js');
    expect(scripts.prestart ?? '').toContain('ensure-dist.js');
    expect(fs.existsSync(path.join(BACKEND_DIR, 'scripts', 'ensure-dist.js'))).toBe(true);
  });

  it('render.yaml backend service agrees with backend scripts and routes', () => {
    const doc = yaml.load(fs.readFileSync(path.join(ROOT_DIR, 'render.yaml'), 'utf8'));
    const svc = (doc.services ?? []).find((s) => /backend/.test(s?.name ?? ''));
    expect(svc, 'backend service missing in render.yaml').toBeTruthy();
    expect(svc!.rootDir).toBe('backend');
    expect(String(svc!.buildCommand)).toContain('npm run build');
    expect(String(svc!.startCommand)).toContain('npm run start');
    expect(svc!.healthCheckPath).toBe('/api/health');
    // The health-check path must be a REAL registered route, not invented docs:
    // app.ts mounts the router at /api and routes/api.ts registers /health.
    const apiPrefix = '/api';
    expect(svc!.healthCheckPath.startsWith(apiPrefix)).toBe(true);
    const routePath = svc!.healthCheckPath.slice(apiPrefix.length);
    const routes = fs.readFileSync(path.join(BACKEND_DIR, 'src', 'routes', 'api.ts'), 'utf8');
    expect(routes).toContain(`'${routePath}'`);
    const appSrc = fs.readFileSync(path.join(BACKEND_DIR, 'src', 'app.ts'), 'utf8');
    expect(appSrc).toContain(`'${apiPrefix}'`);
  });
});
