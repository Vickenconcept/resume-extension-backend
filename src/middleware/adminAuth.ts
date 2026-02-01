import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { ApiResponseFormatter } from '../utils/response';

const prisma = new PrismaClient();

/**
 * Admin authentication middleware - verifies JWT without requiring token in database
 * This is used for admin login tokens which are not stored in the Token table
 */
export const adminAuthenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      ApiResponseFormatter.error(res, 'Authentication required', 401);
      return;
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error('JWT_SECRET is not configured');
    }

    const decoded = jwt.verify(token, jwtSecret) as any;

    // Get user
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
      },
    });

    if (!user) {
      ApiResponseFormatter.error(res, 'User not found', 401);
      return;
    }

    // Check if user is admin
    if (user.role !== 'admin') {
      ApiResponseFormatter.error(res, 'Admin access required', 403);
      return;
    }

    req.user = user;
    next();
  } catch (error: any) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      ApiResponseFormatter.error(res, 'Invalid or expired token', 401);
      return;
    }
    ApiResponseFormatter.error(res, 'Authentication failed', 500);
  }
};
