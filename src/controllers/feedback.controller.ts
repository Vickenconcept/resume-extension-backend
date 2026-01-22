import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { ApiResponseFormatter } from '../utils/response';
import logger from '../utils/logger';

const prisma = new PrismaClient();

export class FeedbackController {
  async submitFeedback(req: Request, res: Response): Promise<void> {
    try {
      const { resumeId, feedback, qualityScore, similarityMetrics } = req.body;

      if (!resumeId || !feedback) {
        ApiResponseFormatter.error(res, 'Resume ID and feedback are required', 422);
        return;
      }

      if (!req.user) {
        ApiResponseFormatter.error(res, 'User not authenticated', 401);
        return;
      }

      const user = req.user;

      // Verify resume belongs to user
      const resume = await prisma.resume.findFirst({
        where: {
          resumeId,
          userId: user.id,
        },
      });

      if (!resume) {
        ApiResponseFormatter.error(res, 'Resume not found', 404);
        return;
      }

      // Store feedback (for now, we'll log it - you can create a Feedback model later)
      logger.info('User feedback received', {
        userId: user.id,
        resumeId,
        feedback,
        qualityScore,
        similarityMetrics,
        timestamp: new Date().toISOString(),
      });

      // TODO: Create a Feedback model in Prisma to store this data
      // For now, we'll just log it and return success

      ApiResponseFormatter.success(
        res,
        { feedback, timestamp: new Date().toISOString() },
        'Feedback submitted successfully'
      );
    } catch (error: any) {
      logger.error('Submit feedback error:', error);
      ApiResponseFormatter.error(res, 'Failed to submit feedback: ' + error.message, 500);
    }
  }
}
