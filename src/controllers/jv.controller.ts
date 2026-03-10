import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { ApiResponseFormatter } from '../utils/response';
import logger from '../utils/logger';

const prisma = new PrismaClient();

export class JvController {
  /**
   * Public endpoint – store affiliate/JV request
   */
  async createAffiliateRequest(req: Request, res: Response): Promise<void> {
    try {
      const { name, email, wherePromote } = req.body as {
        name?: string;
        email?: string;
        wherePromote?: string;
      };

      if (!name || !email) {
        ApiResponseFormatter.error(res, 'Name and email are required', 400);
        return;
      }

      const request = await prisma.affiliateRequest.create({
        data: {
          name: name.trim(),
          email: email.trim(),
          wherePromote: wherePromote?.trim() || null,
        },
      });

      ApiResponseFormatter.success(
        res,
        { request },
        'Affiliate request submitted successfully'
      );
    } catch (error: any) {
      logger.error('Create affiliate request error:', error);
      ApiResponseFormatter.error(res, 'Failed to submit request', 500);
    }
  }

  /**
   * Admin – list affiliate/JV requests with pagination
   */
  async getAffiliateRequests(req: Request, res: Response): Promise<void> {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;

      const [requests, total] = await Promise.all([
        prisma.affiliateRequest.findMany({
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        prisma.affiliateRequest.count(),
      ]);

      const totalPages = Math.ceil(total / limit);

      ApiResponseFormatter.success(
        res,
        {
          requests,
          pagination: {
            page,
            limit,
            total,
            totalPages,
            hasNext: page < totalPages,
            hasPrev: page > 1,
          },
        },
        'Affiliate requests retrieved successfully'
      );
    } catch (error: any) {
      logger.error('Get affiliate requests error:', error);
      ApiResponseFormatter.error(res, 'Failed to get affiliate requests', 500);
    }
  }
}

