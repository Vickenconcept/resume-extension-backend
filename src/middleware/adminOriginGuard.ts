import { Request, Response, NextFunction } from 'express';
import { ApiResponseFormatter } from '../utils/response';

const defaultAdminOrigins = [
  'http://localhost:3002',
  'https://resume.phanrise.com',
];

const getAllowedOrigins = (): string[] => {
  const extra = (process.env.ADMIN_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return Array.from(new Set([...defaultAdminOrigins, ...extra]));
};

export const adminOriginGuard = (req: Request, res: Response, next: NextFunction): void => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }

  const origin = req.get('origin');
  const referer = req.get('referer');
  const allowedOrigins = getAllowedOrigins();

  const matchesOrigin = origin && allowedOrigins.includes(origin);
  const matchesReferer = referer && allowedOrigins.some((allowed) => referer.startsWith(allowed));

  if (!matchesOrigin && !matchesReferer) {
    ApiResponseFormatter.error(res, 'Forbidden', 403);
    return;
  }

  next();
};
