import type { NextFunction, Request, Response } from 'express';

const SESSION_RE = /^[A-Za-z0-9_-]{8,128}$/;

export function getSessionId(req: Request): string | null {
  const h = req.header('x-session-id');
  if (!h) return null;
  const v = h.trim();
  if (!SESSION_RE.test(v)) return null;
  return v;
}

export function requireSession(req: Request, res: Response, next: NextFunction): void {
  const sid = getSessionId(req);
  if (!sid) {
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Missing or invalid session. Refresh the page to get a new session.' },
    });
    return;
  }
  (req as unknown as { sessionId: string }).sessionId = sid;
  next();
}

export function sessionIdOf(req: Request): string {
  return (req as unknown as { sessionId: string }).sessionId;
}
