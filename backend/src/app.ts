import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import morgan from 'morgan';
import multer from 'multer';
import { config } from './config/index.js';
import { router } from './routes/api.js';
import { sendError } from './controllers/jobs.js';
import { ensureDir } from './utils/fs.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(morgan('tiny'));

  const origins = config.frontendOrigin.split(',').map((s) => s.trim()).filter(Boolean);
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true); // curl / health checks
        if (origins.includes(origin)) return cb(null, true);
        // Allow localhost dev variants
        if (config.nodeEnv !== 'production' && /^http:\/\/localhost:\d+$/.test(origin)) return cb(null, true);
        return cb(new Error('CORS blocked'), false);
      },
      allowedHeaders: ['Content-Type', 'x-session-id'],
      exposedHeaders: ['Content-Disposition'],
    })
  );

  const apiLimiter = rateLimit({
    windowMs: 60_000,
    max: 60,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Slow down and try again.' } },
  });
  const uploadLimiter = rateLimit({
    windowMs: 60_000,
    max: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many uploads. Wait a minute and try again.' } },
  });

  app.use('/api/', apiLimiter);
  app.use('/api/jobs', (req, res, next) => {
    if (req.method === 'POST' && req.path === '/') return uploadLimiter(req, res, next);
    next();
  });

  app.use(express.json({ limit: '1mb' }));

  // Ensure temp dir exists (best effort)
  ensureDir(config.tempDir).catch((e) => console.error('[tempdir]', (e as Error).message));

  app.use('/api', router);

  app.get('/', (_req, res) => {
    res.json({ success: true, data: { service: 'clip2gif-backend', docs: 'GET /api/health' } });
  });

  // 404
  app.use((_req, res) => {
    sendError(res, 404, 'NOT_FOUND', 'Route not found.');
  });

  // Central error handler — never leak internals
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const e = err as { status?: number; code?: string; message?: string };
    console.error('[error]', e?.message ?? e);
    if (e?.code === 'LIMIT_FILE_SIZE') {
      return sendError(res, 413, 'FILE_TOO_LARGE', `The uploaded video exceeds the configured ${config.maxUploadMB} MB limit.`);
    }
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return sendError(res, 413, 'FILE_TOO_LARGE', `The uploaded video exceeds the configured ${config.maxUploadMB} MB limit.`);
      }
      return sendError(res, 400, 'UPLOAD_ERROR', 'Upload failed. Try again with a smaller file.');
    }
    if (e?.message === 'CORS blocked') {
      return sendError(res, 403, 'FORBIDDEN', 'Origin not allowed.');
    }
    return sendError(res, 500, 'INTERNAL_ERROR', 'Something went wrong. Try again.');
  });

  return app;
}
