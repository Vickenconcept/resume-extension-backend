import { Request, Response, NextFunction } from 'express';
import { ApiResponseFormatter } from '../utils/response';

/**
 * Middleware to check if user is admin
 * Must be used after authenticate middleware
 */
export const requireAdmin = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    ApiResponseFormatter.error(res, 'Authentication required', 401);
    return;
  }

  if (req.user.role !== 'admin') {
    ApiResponseFormatter.error(res, 'Admin access required', 403);
    return;
  }

  next();
};
