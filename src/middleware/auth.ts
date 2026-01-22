import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { ApiResponseFormatter } from '../utils/response';
import { JwtPayload } from '../types';

const prisma = new PrismaClient();

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '') || 
                  req.cookies?.token;

    if (!token) {
      ApiResponseFormatter.error(res, 'Authentication required', 401);
      return;
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error('JWT_SECRET is not configured');
    }

    const decoded = jwt.verify(token, jwtSecret) as JwtPayload;

    // Verify token exists in database (optional - for token revocation)
    const tokenRecord = await prisma.token.findUnique({
      where: { token },
    });

    if (!tokenRecord || tokenRecord.expiresAt < new Date()) {
      ApiResponseFormatter.error(res, 'Token expired or invalid', 401);
      return;
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        name: true,
      },
    });

    if (!user) {
      ApiResponseFormatter.error(res, 'User not found', 401);
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
