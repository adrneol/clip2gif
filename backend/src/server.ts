import { config } from './config/index.js';
import { createApp } from './app.js';
import { startCleanupLoop, stopCleanupLoop } from './services/cleanupService.js';
import { ffmpegPath, ffprobePath } from './services/ffmpegService.js';
import fs from 'node:fs';

if (config.maxActiveConversions < 1 || config.maxQueuedJobs < 0) {
  console.error('Invalid queue configuration.');
  process.exit(1);
}

const app = createApp();
const port = Number(process.env.PORT || config.port);

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`[clip2gif] backend listening on 0.0.0.0:${port} (${config.nodeEnv})`);
  console.log(`[clip2gif] tempDir=${config.tempDir}`);
  try {
    console.log(`[clip2gif] ffmpeg=${ffmpegPath()} exists=${fs.existsSync(ffmpegPath())}`);
    console.log(`[clip2gif] ffprobe=${ffprobePath()} exists=${fs.existsSync(ffprobePath())}`);
  } catch { /* noop */ }
  startCleanupLoop();
});

function shutdown(signal: string) {
  console.log(`[clip2gif] received ${signal}, shutting down...`);
  stopCleanupLoop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
