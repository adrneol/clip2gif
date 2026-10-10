# Clip2GIF Phase-2 Benchmark Report

Environment: Windows dev machine, FFmpeg 6.1.1 (essentials build, via `ffmpeg-static`),
single conversion thread (`-threads 1`, same as production default).
Harness: `bench/bench.mjs` (`node bench/bench.mjs portrait`). Outputs land in the
OS temp dir — nothing large is committed to the repo.

## Sources (all synthetic, generated with FFmpeg `testsrc`/`testsrc2`)

| id | filter | geometry | fps | dur | mp4 size |
|---|---|---|---|---|---|
| short | testsrc | 160x120 | 10 | 3s | 0.01 MB |
| portrait | testsrc2 | 360x640 | 30 | 28s | 2.60 MB |
| staticish | testsrc2 blended 15% over blue | 480x270 | 30 | 10s | 0.12 MB |
| long (existing test) | testsrc | 128x96 | 5 | 61s | — |

`testsrc2` is high-detail synthetic motion. It is NOT photo content: the reported
real-world case (15.6 MB source, 28s → 49.69 MB GIF at 360x640/15fps) produced a
much larger GIF than the same geometry here (14.45 MB), because real photo/video
content has far more color variance. Expect `diff`-mode gains to be *larger* on
real content with static regions, not smaller.

## Variant key

- **A (old default):** single-pass `split→palettegen→paletteuse`,
  `stats_mode=full` (default), `reserve_transparent=0`, `dither=sierra2_4a`
- **A2:** A + `reserve_transparent=1`
- **B:** single-pass, `stats_mode=diff`, `reserve_transparent=1`, sierra2_4a + `diff_mode=rectangle`
- **B2:** B with `dither=bayer:bayer_scale=3`
- **C:** two-stage (`-frames:v 1` palette PNG + encode), full/rt0/sierra — same effective settings as A
- **D:** two-stage, diff/rt1/sierra+rect — same effective settings as B
- **E:** single-pass diff/rt1, `dither=floyd_steinberg` + rect
- **F:** single-pass diff/rt1, `dither=none` + rect

## Reported-case mirror: portrait 28s, 15 fps, width 640, 256 colors

Two runs (machine noise is real; sizes are deterministic):

| variant | size | wall run 1 | wall run 2 |
|---|---|---|---|
| A (old) | 14.45 MB | 23.7s | 16.5s |
| A2 | 10.97 MB (−24.1%) | 26.4s | 15.1s |
| B | 10.43 MB (−27.8%) | 19.9s | 14.2s |
| B2 | 9.87 MB (−31.7%) | 14.3s | 9.6s |
| C | 14.45 MB (byte-identical to A) | 20.9s | 17.4s |
| D | 10.43 MB (byte-identical to B) | 14.3s | 18.8s |
| E | 10.08 MB (−30.2%) | 15.2s | 19.4s |
| F | 8.87 MB (−38.6%) | 8.1s | 12.0s |

Short 2s clip (320px/5fps/256c): A 0.14 MB → B2 0.11 MB → F 0.09 MB.
Static-ish 10s clip (480px/10fps/192c, old-style vs new-style two-stage):
1052.7 KB / 2.0s vs 1049.5 KB / 1.6s — **no meaningful difference** (static content
already compresses via frame offsetting; reported honestly).

## Memory (measured peak RSS, same 28s portrait workload)

- Single-pass split graph: **517 MB**
- Two-stage encode pass: **78 MB**

Why: `palettegen` emits its palette only at end-of-stream, so `split` queues every
filtered frame (28s × 15fps × 360×640 ≈ 290 MB of raw frames plus overhead).
Two-stage streams both passes with bounded memory. On a 512 MB Render Free
instance, the single-pass queue alone can exhaust RAM — the most plausible cause
of the reported ~3-minute conversion (paging under memory pressure).

## Quality (single-frame PSNR vs Lanczos-scaled source frame @t=5; imperfect proxy)

| A | B | B2 | E | F |
|---|---|---|---|---|
| 36.32 | 36.89 | 36.76 | 37.05 | 38.32 |

No variant is worse than the old default; `none` scores highest because it adds no
dithering noise (it can still band on smooth gradients — human caveat stands).

## Old two-stage failure explained

Phase-1's two-stage attempt failed with "Cannot write more than one file" because
the palette stage omitted `-frames:v 1`: the image2 muxer received more than one
frame for a single PNG path. With `-frames:v 1` the two-stage pipeline works on
FFmpeg 6.1.1 (proven by byte-identical C==A and D==B outputs).

## Conclusions (measured, not assumed)

1. `reserve_transparent=0` was defeating the gif encoder's default `transdiff`
   frame-difference optimization (it needs a transparency palette entry): −24% alone.
2. `stats_mode=diff` + `diff_mode=rectangle` beats `full` on size (−28% combined with rt1).
3. Bayer dithering is smaller AND faster than sierra2_4a at equal PSNR → size-first presets.
4. Two-stage output is byte-identical to single-pass at equal settings, with ~6.6× less
   peak RAM. Chosen as the production pipeline for memory safety on Free tier.
5. Wall-clock: no reliable single-vs-two-stage speed winner on this machine (noise
   dominates); the Free-tier speed win is expected via avoided memory pressure,
   stated as expectation, not measured here.
6. Static content: optimization changes ~nothing — targets/retries handle those cases.
