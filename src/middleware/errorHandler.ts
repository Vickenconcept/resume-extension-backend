import { Request, Response, NextFunction } from 'express';
import { ApiResponseFormatter } from '../utils/response';
import logger from '../utils/logger';

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  logger.error('Error:', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  // Handle validation errors
  if (err.name === 'ValidationError') {
    ApiResponseFormatter.error(res, err.message, 422);
    return;
  }

  // Handle Prisma errors
  if (err.name === 'PrismaClientKnownRequestError') {
    ApiResponseFormatter.error(res, 'Database error occurred', 500);
    return;
  }

  // Default error
  ApiResponseFormatter.error(
    res,
    err.message || 'Internal server error',
    500
  );
};
