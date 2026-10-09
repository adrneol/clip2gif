import { Router } from 'express';
import { cancelJob, clearAllHandler, createJobHandler, deleteJobHandler, downloadJob, getJobHandler, health, limits, listJobs, previewJob } from '../controllers/jobs.js';
import { requireSession } from '../middleware/session.js';
import { upload } from '../middleware/upload.js';

export const router = Router();

router.get('/health', health);
router.get('/limits', limits);

router.post('/jobs', requireSession, upload.single('video'), createJobHandler);
router.get('/jobs', requireSession, listJobs);
router.get('/jobs/:id', requireSession, getJobHandler);
router.post('/jobs/:id/cancel', requireSession, cancelJob);
router.get('/jobs/:id/preview', requireSession, previewJob);
router.get('/jobs/:id/download', requireSession, downloadJob);
router.delete('/jobs/:id', requireSession, deleteJobHandler);
router.delete('/jobs', requireSession, clearAllHandler);
