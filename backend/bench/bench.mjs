// Clip2GIF benchmark harness — synthetic videos + pipeline variants.
// Run:  node bench/bench.mjs   (from backend/)
// Results: bench/results.json (git-ignored)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FFMPEG = process.env.FFMPEG_PATH || new URL('../node_modules/ffmpeg-static/ffmpeg.exe', import.meta.url).pathname.replace(/^\//, '');
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
const ROOT = path.join(os.tmpdir(), 'clip2gif-bench');

function ffmpegBin() {
  const rel = path.resolve('node_modules/ffmpeg-static/ffmpeg.exe');
  if (fs.existsSync(rel)) return rel;
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) return process.env.FFMPEG_PATH;
  return 'ffmpeg';
}
function ffprobeBin() {
  return 'ffprobe';
}

function run(bin, args, label) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, ms: Date.now() - t0, err }));
  });
}

async function probe(file) {
  const bins = [];
  try {
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const mod = req('ffprobe-static');
    const p = typeof mod === 'string' ? mod : mod?.path;
    if (p) bins.push(p);
  } catch { /* noop */ }
  bins.push('ffprobe');
  for (const bin of bins) {
    try {
      const r = await run(bin, ['-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,avg_frame_rate,nb_frames,duration',
        '-show_entries', 'format=duration,size', '-count_frames', '-of', 'json', file]);
      if (r.code !== 0) continue;
      // stdout was ignored; re-run capturing stdout
      const out = await new Promise((resolve, reject) => {
        const c = spawn(bin, ['-v', 'error', '-select_streams', 'v:0',
          '-show_entries', 'stream=width,height,avg_frame_rate,nb_frames,duration',
          '-show_entries', 'format=duration,size', '-count_frames', '-of', 'json', file],
          { stdio: ['ignore', 'pipe', 'pipe'] });
        let s = '';
        c.stdout.on('data', (d) => { s += d; });
        c.on('error', reject);
        c.on('close', () => resolve(s));
      });
      const j = JSON.parse(out || '{}');
      const s = j.streams?.[0] || {};
      const fps = s.avg_frame_rate && s.avg_frame_rate.includes('/')
        ? s.avg_frame_rate.split('/').reduce((a, b) => Number(a) / Number(b))
        : Number(s.avg_frame_rate);
      return {
        width: Number(s.width || 0), height: Number(s.height || 0),
        frames: Number(s.nb_frames || 0), fps: Number.isFinite(fps) ? fps : null,
        duration: Number(s.duration || j.format?.duration || 0),
      };
    } catch { /* try next */ }
  }
  return null;
}

const FF = ffmpegBin();

async function gen(name, srcFilter, seconds) {
  const out = path.join(ROOT, name);
  if (fs.existsSync(out)) return out;
  console.log(`gen ${name} ...`);
  const r = await run(FF, ['-y', '-f', 'lavfi', '-i', srcFilter, '-c:v', 'libx264',
    '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-t', String(seconds), out]);
  if (r.code !== 0) throw new Error(`gen ${name} failed: ${r.err.slice(-500)}`);
  return out;
}

const SCALE = (w) => `scale=${w}:${w}:flags=lanczos:force_original_aspect_ratio=decrease`;

// Variant builders return { name, stages: [argsArray,...] } — stages run sequentially.
function singlePass({ fps, width, colors, dither, stats = 'full', reserveT = 0, diffMode = null, tag }) {
  const pal = `palettegen=max_colors=${colors}:reserve_transparent=${reserveT}` + (stats !== 'full' ? `:stats_mode=${stats}` : '');
  const use = `paletteuse=dither=${dither}` + (diffMode ? `:diff_mode=${diffMode}` : '');
  return {
    name: tag,
    stages: [
      ['-y', '-ss', 'SS', '-t', 'DUR', '-i', 'IN',
        '-lavfi', `fps=${fps},${SCALE(width)},split[s0][s1];[s0]${pal}[p];[s1][p]${use}`,
        '-threads', '1', 'OUT'],
    ],
  };
}
function twoStage({ fps, width, colors, dither, stats = 'full', reserveT = 0, diffMode = null, tag }) {
  const pal = `palettegen=max_colors=${colors}:reserve_transparent=${reserveT}` + (stats !== 'full' ? `:stats_mode=${stats}` : '');
  const use = `paletteuse=dither=${dither}` + (diffMode ? `:diff_mode=${diffMode}` : '');
  return {
    name: tag,
    stages: [
      ['-y', '-ss', 'SS', '-t', 'DUR', '-i', 'IN',
        '-vf', `fps=${fps},${SCALE(width)},${pal}`, '-frames:v', '1', '-threads', '1', 'PAL'],
      ['-y', '-ss', 'SS', '-t', 'DUR', '-i', 'IN', '-i', 'PAL',
        '-lavfi', `fps=${fps},${SCALE(width)}[a];[a][1:v]${use}`,
        '-threads', '1', 'OUT'],
    ],
  };
}

async function runVariant(src, variant, ss, dur, workdir) {
  const out = path.join(workdir, `${variant.name}.gif`);
  const pal = path.join(workdir, `${variant.name}.pal.png`);
  let msTotal = 0;
  for (const stage of variant.stages) {
    const args = stage.map((a) => (a === 'SS' ? ss.toFixed(3) : a === 'DUR' ? dur.toFixed(3) : a === 'IN' ? src : a === 'OUT' ? out : a === 'PAL' ? pal : a));
    const r = await run(FF, args, variant.name);
    msTotal += r.ms;
    if (r.code !== 0) return { name: variant.name, ok: false, error: r.err.slice(-300), ms: msTotal };
  }
  let bytes = 0;
  try { bytes = fs.statSync(out).size; } catch { return { name: variant.name, ok: false, error: 'no output', ms: msTotal }; }
  const info = await probe(out);
  try { fs.unlinkSync(pal); } catch { /* noop */ }
  return { name: variant.name, ok: true, ms: msTotal, bytes, info };
}

async function main() {
  fs.mkdirSync(ROOT, { recursive: true });
  const only = process.argv[2]; // optional: portrait|landscape|short
  const videos = {};
  videos.short = await gen('short-160x120-3s.mp4', 'testsrc=duration=3:size=160x120:rate=10', 3);
  if (!only || only === 'landscape' || only === 'all') {
    videos.landscape = await gen('land-640x360-28s.mp4', 'testsrc2=duration=28:size=640x360:rate=30', 28);
  }
  if (!only || only === 'portrait' || only === 'all') {
    videos.portrait = await gen('port-360x640-28s.mp4', 'testsrc2=duration=28:size=360x640:rate=30', 28);
  }
  for (const [k, v] of Object.entries(videos)) {
    const st = fs.statSync(v);
    const info = await probe(v);
    console.log(`src ${k}: ${v} ${(st.size / 1048576).toFixed(2)}MB`, JSON.stringify(info));
  }

  const workdir = path.join(ROOT, 'out');
  fs.mkdirSync(workdir, { recursive: true });

  // Mirror of reported case: portrait 360x640, 28s, 15fps, ~640 max-dim, 256 colors
  const CASES = [
    { video: 'portrait', ss: 0, dur: 28, fps: 15, width: 640, label: 'reported-case' },
    { video: 'landscape', ss: 0, dur: 28, fps: 15, width: 640, label: 'landscape-28s' },
    { video: 'short', ss: 0, dur: 2, fps: 5, width: 320, label: 'short-2s' },
  ];

  const VARIANTS = (base) => [
    singlePass({ ...base, stats: 'full', reserveT: 0, dither: 'sierra2_4a', tag: 'A-current(single,full,rt0,sierra)' }),
    singlePass({ ...base, stats: 'full', reserveT: 1, dither: 'sierra2_4a', tag: 'A2-single,full,rt1,sierra' }),
    singlePass({ ...base, stats: 'diff', reserveT: 1, dither: 'sierra2_4a', diffMode: 'rectangle', tag: 'B-single,diff,rt1,sierra+rect' }),
    singlePass({ ...base, stats: 'diff', reserveT: 1, dither: 'bayer:bayer_scale=3', diffMode: 'rectangle', tag: 'B2-single,diff,rt1,bayer+rect' }),
    twoStage({ ...base, stats: 'full', reserveT: 0, dither: 'sierra2_4a', tag: 'C-twoStage,full,rt0,sierra' }),
    twoStage({ ...base, stats: 'diff', reserveT: 1, dither: 'sierra2_4a', diffMode: 'rectangle', tag: 'D-twoStage,diff,rt1,sierra+rect' }),
    singlePass({ ...base, stats: 'diff', reserveT: 1, dither: 'floyd_steinberg', diffMode: 'rectangle', tag: 'E-single,diff,rt1,floyd+rect' }),
    singlePass({ ...base, stats: 'diff', reserveT: 1, dither: 'none', diffMode: 'rectangle', tag: 'F-single,diff,rt1,none+rect' }),
  ];

  const results = [];
  for (const c of CASES) {
    if (!videos[c.video]) continue;
    const casedir = path.join(workdir, c.label);
    fs.mkdirSync(casedir, { recursive: true });
    console.log(`\n=== ${c.label} (${c.video} ss=${c.ss} dur=${c.dur} fps=${c.fps} w=${c.width}) ===`);
    for (const v of VARIANTS({ fps: c.fps, width: c.width, colors: 256 })) {
      const r = await runVariant(videos[c.video], v, c.ss, c.dur, casedir);
      const line = `${r.name}: ${r.ok ? `${(r.bytes / 1048576).toFixed(2)}MB ${(r.ms / 1000).toFixed(1)}s ${r.info?.width}x${r.info?.height} f=${r.info?.frames}` : `FAILED ${r.error?.slice(0, 120)}`}`;
      console.log('  ' + line);
      results.push({ case: c.label, ...r });
    }
  }
  fs.writeFileSync(path.join(ROOT, 'results.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
  console.log('\nwrote', path.join(ROOT, 'results.json'));
}

main().catch((e) => { console.error(e); process.exit(1); });
