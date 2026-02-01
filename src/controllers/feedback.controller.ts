import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { ApiResponseFormatter } from '../utils/response';
import logger from '../utils/logger';

const prisma = new PrismaClient();

export class FeedbackController {
  /**
   * Submit user feedback (thumbs up/down)
   */
  async submitFeedback(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        ApiResponseFormatter.error(res, 'User not authenticated', 401);
        return;
      }

      const { type, rating, message, resumeId, versionId } = req.body;

      // Validate required fields
      if (!type || !rating) {
        ApiResponseFormatter.error(res, 'Type and rating are required', 400);
        return;
      }

      if (type !== 'resume' && type !== 'cover_letter') {
        ApiResponseFormatter.error(res, 'Type must be "resume" or "cover_letter"', 400);
        return;
      }

      if (rating !== 'positive' && rating !== 'negative') {
        ApiResponseFormatter.error(res, 'Rating must be "positive" or "negative"', 400);
        return;
      }

      // Negative feedback requires a message
      if (rating === 'negative' && !message) {
        ApiResponseFormatter.error(res, 'Message is required for negative feedback', 400);
        return;
      }

      // Create feedback record
      const feedback = await prisma.feedback.create({
        data: {
          userId: req.user.id,
          type,
          rating,
          message: message || null,
          resumeId: resumeId || null,
          versionId: versionId || null,
        },
      });

      logger.info('User feedback submitted', {
        userId: req.user.id,
        feedbackId: feedback.id,
        type,
        rating,
      });

      ApiResponseFormatter.success(
        res,
        { feedback },
        'Feedback submitted successfully'
      );
    } catch (error: any) {
      logger.error('Submit feedback error:', error);
      ApiResponseFormatter.error(res, 'Failed to submit feedback: ' + error.message, 500);
    }
  }

  /**
   * Get user's own feedback
   */
  async getUserFeedback(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        ApiResponseFormatter.error(res, 'User not authenticated', 401);
        return;
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;

      const [feedback, total] = await Promise.all([
        prisma.feedback.findMany({
          where: { userId: req.user.id },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
          select: {
            id: true,
            type: true,
            rating: true,
            message: true,
            resumeId: true,
            versionId: true,
            createdAt: true,
          },
        }),
        prisma.feedback.count({
          where: { userId: req.user.id },
        }),
      ]);

      ApiResponseFormatter.success(
        res,
        {
          feedback,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        },
        'Feedback retrieved successfully'
      );
    } catch (error: any) {
      logger.error('Get user feedback error:', error);
      ApiResponseFormatter.error(res, 'Failed to get feedback: ' + error.message, 500);
    }
  }

  /**
   * Get all feedback (admin only)
   */
  async getAllFeedback(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user || req.user.role !== 'admin') {
        ApiResponseFormatter.error(res, 'Admin access required', 403);
        return;
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;
      const type = req.query.type as string | undefined;
      const rating = req.query.rating as string | undefined;

      const where: any = {};
      if (type) where.type = type;
      if (rating) where.rating = rating;

      const [feedback, total] = await Promise.all([
        prisma.feedback.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        }),
        prisma.feedback.count({ where }),
      ]);

      ApiResponseFormatter.success(
        res,
        {
          feedback,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        },
        'Feedback retrieved successfully'
      );
    } catch (error: any) {
      logger.error('Get all feedback error:', error);
      ApiResponseFormatter.error(res, 'Failed to get feedback: ' + error.message, 500);
    }
  }
}
