import multer from 'multer';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config/index.js';

const stagingDir = path.join(os.tmpdir(), 'clip2gif-staging');
try { fs.mkdirSync(stagingDir, { recursive: true }); } catch { /* noop */ }

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, stagingDir),
  filename: (_req, file, cb) => {
    const safe = `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname || '').toLowerCase()}`;
    cb(null, safe);
  },
});

export const upload = multer({
  storage,
  limits: {
    fileSize: config.maxUploadMB * 1024 * 1024,
    files: 1,
    fields: 20,
  },
});
