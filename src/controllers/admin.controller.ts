import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { ApiResponseFormatter } from '../utils/response';
import logger from '../utils/logger';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();

export class AdminController {
  /**
   * Admin login
   */
  async login(req: Request, res: Response): Promise<void> {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        ApiResponseFormatter.error(res, 'Email and password are required', 400);
        return;
      }

      // Find user with admin role
      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user) {
        ApiResponseFormatter.error(res, 'Invalid email or password', 401);
        return;
      }

      // Check if user is admin
      if (user.role !== 'admin') {
        ApiResponseFormatter.error(res, 'Access denied. Admin access required.', 403);
        return;
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        ApiResponseFormatter.error(res, 'Invalid email or password', 401);
        return;
      }

      // Generate JWT token
      const token = jwt.sign(
        { userId: user.id, email: user.email, role: user.role },
        process.env.JWT_SECRET || 'your-secret-key',
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
      );

      ApiResponseFormatter.success(
        res,
        {
          token,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
          },
        },
        'Login successful'
      );
    } catch (error: any) {
      logger.error('Admin login error:', error);
      ApiResponseFormatter.error(res, 'Failed to login: ' + error.message, 500);
    }
  }

  /**
   * Get all users with pagination
   */
  async getUsers(req: Request, res: Response): Promise<void> {
    try {
      // Admin check is done by middleware

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;
      const search = req.query.search as string || '';

      const where: any = {};
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ];
      }

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            credits: true,
            freeTrialUsed: true,
            createdAt: true,
            updatedAt: true,
            _count: {
              select: {
                resumes: true,
                payments: true,
                usageLogs: true,
              },
            },
          },
        }),
        prisma.user.count({ where }),
      ]);

      const totalPages = Math.ceil(total / limit);

      ApiResponseFormatter.success(
        res,
        {
          users,
          pagination: {
            page,
            limit,
            total,
            totalPages,
            hasNext: page < totalPages,
            hasPrev: page > 1,
          },
        },
        'Users retrieved successfully'
      );
    } catch (error: any) {
      logger.error('Get users error:', error);
      ApiResponseFormatter.error(res, 'Failed to get users: ' + error.message, 500);
    }
  }

  /**
   * Get user details
   */
  async getUser(req: Request, res: Response): Promise<void> {
    try {
      // Admin check is done by middleware

      const userId = parseInt(req.params.id);
      if (!userId) {
        ApiResponseFormatter.error(res, 'Invalid user ID', 400);
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          credits: true,
          freeTrialUsed: true,
          createdAt: true,
          updatedAt: true,
          resumes: {
            select: {
              id: true,
              resumeId: true,
              filename: true,
              displayName: true,
              isDefault: true,
              createdAt: true,
            },
          },
          payments: {
            orderBy: { createdAt: 'desc' },
            take: 10,
            select: {
              id: true,
              amount: true,
              credits: true,
              status: true,
              createdAt: true,
            },
          },
          usageLogs: {
            orderBy: { createdAt: 'desc' },
            take: 20,
            select: {
              id: true,
              action: true,
              creditsUsed: true,
              usedFreeTrial: true,
              createdAt: true,
            },
          },
        },
      });

      if (!user) {
        ApiResponseFormatter.error(res, 'User not found', 404);
        return;
      }

      ApiResponseFormatter.success(res, { user }, 'User retrieved successfully');
    } catch (error: any) {
      logger.error('Get user error:', error);
      ApiResponseFormatter.error(res, 'Failed to get user: ' + error.message, 500);
    }
  }

  /**
   * Update user (credits, role, etc.)
   */
  async updateUser(req: Request, res: Response): Promise<void> {
    try {
      // Admin check is done by middleware

      const userId = parseInt(req.params.id);
      const { credits, role, freeTrialUsed } = req.body;

      if (!userId) {
        ApiResponseFormatter.error(res, 'Invalid user ID', 400);
        return;
      }

      const updateData: any = {};
      if (credits !== undefined) updateData.credits = parseInt(credits);
      if (role !== undefined) updateData.role = role;
      if (freeTrialUsed !== undefined) updateData.freeTrialUsed = parseInt(freeTrialUsed);

      const user = await prisma.user.update({
        where: { id: userId },
        data: updateData,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          credits: true,
          freeTrialUsed: true,
        },
      });

      ApiResponseFormatter.success(res, { user }, 'User updated successfully');
    } catch (error: any) {
      logger.error('Update user error:', error);
      ApiResponseFormatter.error(res, 'Failed to update user: ' + error.message, 500);
    }
  }

  /**
   * Get dashboard statistics
   */
  async getStats(req: Request, res: Response): Promise<void> {
    try {
      // Admin check is done by middleware

      const [
        totalUsers,
        totalAdmins,
        totalCredits,
        totalPayments,
        totalRevenue,
        recentPayments,
        recentUsers,
      ] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { role: 'admin' } }),
        prisma.user.aggregate({
          _sum: { credits: true },
        }),
        prisma.payment.count({ where: { status: 'completed' } }),
        prisma.payment.aggregate({
          where: { status: 'completed' },
          _sum: { amount: true },
        }),
        prisma.payment.findMany({
          where: { status: 'completed' },
          orderBy: { createdAt: 'desc' },
          take: 10,
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
        prisma.user.findMany({
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            name: true,
            email: true,
            credits: true,
            createdAt: true,
          },
        }),
      ]);

      ApiResponseFormatter.success(
        res,
        {
          stats: {
            totalUsers,
            totalAdmins,
            totalCredits: totalCredits._sum.credits || 0,
            totalPayments,
            totalRevenue: totalRevenue._sum.amount || 0,
          },
          recentPayments,
          recentUsers,
        },
        'Statistics retrieved successfully'
      );
    } catch (error: any) {
      logger.error('Get stats error:', error);
      ApiResponseFormatter.error(res, 'Failed to get statistics: ' + error.message, 500);
    }
  }

  /**
   * Get payment plans from database
   */
  async getPaymentPlans(req: Request, res: Response): Promise<void> {
    try {
      // Admin check is done by middleware

      const plans = await prisma.paymentPlan.findMany({
        where: { isActive: true },
        orderBy: { amount: 'asc' },
      });

      ApiResponseFormatter.success(res, { plans }, 'Payment plans retrieved successfully');
    } catch (error: any) {
      logger.error('Get payment plans error:', error);
      ApiResponseFormatter.error(res, 'Failed to get payment plans: ' + error.message, 500);
    }
  }

  /**
   * Create a new payment plan
   */
  async createPaymentPlan(req: Request, res: Response): Promise<void> {
    try {
      // Admin check is done by middleware

      const { amount, credits } = req.body;

      if (!amount || !credits || amount <= 0 || credits <= 0) {
        ApiResponseFormatter.error(res, 'Amount and credits must be greater than 0', 400);
        return;
      }

      const plan = await prisma.paymentPlan.create({
        data: {
          amount: parseFloat(amount),
          credits: parseInt(credits),
          isActive: true,
        },
      });

      ApiResponseFormatter.success(res, { plan }, 'Payment plan created successfully');
    } catch (error: any) {
      logger.error('Create payment plan error:', error);
      ApiResponseFormatter.error(res, 'Failed to create payment plan: ' + error.message, 500);
    }
  }

  /**
   * Update a payment plan
   */
  async updatePaymentPlan(req: Request, res: Response): Promise<void> {
    try {
      // Admin check is done by middleware

      const planId = parseInt(req.params.id);
      const { amount, credits, isActive } = req.body;

      if (!planId) {
        ApiResponseFormatter.error(res, 'Invalid plan ID', 400);
        return;
      }

      const updateData: any = {};
      if (amount !== undefined) updateData.amount = parseFloat(amount);
      if (credits !== undefined) updateData.credits = parseInt(credits);
      if (isActive !== undefined) updateData.isActive = Boolean(isActive);

      if (updateData.amount <= 0 || updateData.credits <= 0) {
        ApiResponseFormatter.error(res, 'Amount and credits must be greater than 0', 400);
        return;
      }

      const plan = await prisma.paymentPlan.update({
        where: { id: planId },
        data: updateData,
      });

      ApiResponseFormatter.success(res, { plan }, 'Payment plan updated successfully');
    } catch (error: any) {
      logger.error('Update payment plan error:', error);
      ApiResponseFormatter.error(res, 'Failed to update payment plan: ' + error.message, 500);
    }
  }

  /**
   * Delete a payment plan
   */
  async deletePaymentPlan(req: Request, res: Response): Promise<void> {
    try {
      // Admin check is done by middleware

      const planId = parseInt(req.params.id);

      if (!planId) {
        ApiResponseFormatter.error(res, 'Invalid plan ID', 400);
        return;
      }

      await prisma.paymentPlan.delete({
        where: { id: planId },
      });

      ApiResponseFormatter.success(res, null, 'Payment plan deleted successfully');
    } catch (error: any) {
      logger.error('Delete payment plan error:', error);
      ApiResponseFormatter.error(res, 'Failed to delete payment plan: ' + error.message, 500);
    }
  }
}
