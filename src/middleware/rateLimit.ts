import { Request, Response, NextFunction } from 'express';
import { ApiResponseFormatter } from '../utils/response';

type RateLimitEntry = {
  count: number;
  windowStart: number;
};

const rateLimitStore = new Map<string, RateLimitEntry>();

export const rateLimit = (options: { windowMs: number; max: number }) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const entry = rateLimitStore.get(key);

    if (!entry || now - entry.windowStart >= options.windowMs) {
      rateLimitStore.set(key, { count: 1, windowStart: now });
      next();
      return;
    }

    if (entry.count >= options.max) {
      ApiResponseFormatter.error(res, 'Too many requests', 429);
      return;
    }

    entry.count += 1;
    next();
  };
};
