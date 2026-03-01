import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { ApiResponseFormatter } from '../utils/response';
import logger from '../utils/logger';
import { JwtPayload } from '../types';
import crypto from 'crypto';
import { EmailService } from '../services/email.service';

const prisma = new PrismaClient();
const emailService = new EmailService();

export class AuthController {
  async register(req: Request, res: Response): Promise<void> {
    try {
      const { name, email, password, password_confirmation } = req.body;

      // Validation
      if (!name || !email || !password) {
        ApiResponseFormatter.error(res, 'Name, email, and password are required', 422);
        return;
      }

      if (password !== password_confirmation) {
        ApiResponseFormatter.error(res, 'Password confirmation does not match', 422);
        return;
      }

      if (password.length < 8) {
        ApiResponseFormatter.error(res, 'Password must be at least 8 characters', 422);
        return;
      }

      // Check if user exists
      const existingUser = await prisma.user.findUnique({
        where: { email },
      });

      if (existingUser) {
        ApiResponseFormatter.error(res, 'Email already registered', 422);
        return;
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create user
      const user = await prisma.user.create({
        data: {
          name,
          email,
          password: hashedPassword,
        },
        select: {
          id: true,
          name: true,
          email: true,
        },
      });

      // Send welcome email (non-blocking; don't fail registration if email fails)
      emailService.sendWelcomeEmail({ to: user.email, name: user.name }).catch((err) => {
        logger.warn('Welcome email failed to send', { userId: user.id, error: err?.message });
      });

      // Generate token
      const token = this.generateToken({ userId: user.id, email: user.email });

      // Save token to database
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

      await prisma.token.create({
        data: {
          userId: user.id,
          token,
          expiresAt,
        },
      });

      ApiResponseFormatter.success(
        res,
        {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
          },
          token,
        },
        'User registered successfully'
      );
    } catch (error: any) {
      logger.error('Registration error:', error);
      ApiResponseFormatter.error(res, 'Failed to register user: ' + error.message, 500);
    }
  }

  async login(req: Request, res: Response): Promise<void> {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        ApiResponseFormatter.error(res, 'Email and password are required', 422);
        return;
      }

      // Find user
      const user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user) {
        ApiResponseFormatter.error(res, 'Invalid credentials', 401);
        return;
      }

      // Verify password
      const isValid = await bcrypt.compare(password, user.password);

      if (!isValid) {
        ApiResponseFormatter.error(res, 'Invalid credentials', 401);
        return;
      }

      // Generate token
      const token = this.generateToken({ userId: user.id, email: user.email });

      // Save token to database
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

      await prisma.token.create({
        data: {
          userId: user.id,
          token,
          expiresAt,
        },
      });

      ApiResponseFormatter.success(
        res,
        {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
          },
          token,
        },
        'Login successful'
      );
    } catch (error: any) {
      logger.error('Login error:', error);
      ApiResponseFormatter.error(res, 'Failed to login: ' + error.message, 500);
    }
  }

  async forgotPassword(req: Request, res: Response): Promise<void> {
    try {
      const { email } = req.body;

      if (!email) {
        ApiResponseFormatter.error(res, 'Email is required', 422);
        return;
      }

      const user = await prisma.user.findUnique({
        where: { email },
      });

      // Don't reveal whether the email exists
      if (!user) {
        ApiResponseFormatter.success(res, null, 'If that email is registered, a reset link has been sent');
        return;
      }

      // Invalidate previous tokens
      await prisma.passwordResetToken.deleteMany({
        where: {
          userId: user.id,
        },
      });

      // Generate token
      const rawToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          token: rawToken,
          expiresAt,
        },
      });

      await emailService.sendPasswordResetEmail({
        to: user.email,
        name: user.name,
        token: rawToken,
      });

      ApiResponseFormatter.success(
        res,
        null,
        'If that email is registered, a reset link has been sent'
      );
    } catch (error: any) {
      logger.error('Forgot password error:', error);
      ApiResponseFormatter.error(res, 'Failed to process request: ' + error.message, 500);
    }
  }

  async resetPassword(req: Request, res: Response): Promise<void> {
    try {
      const { token, password, password_confirmation } = req.body;

      if (!token || !password || !password_confirmation) {
        ApiResponseFormatter.error(res, 'Token, password and confirmation are required', 422);
        return;
      }

      if (password !== password_confirmation) {
        ApiResponseFormatter.error(res, 'Password confirmation does not match', 422);
        return;
      }

      if (password.length < 8) {
        ApiResponseFormatter.error(res, 'Password must be at least 8 characters', 422);
        return;
      }

      const resetToken = await prisma.passwordResetToken.findUnique({
        where: { token },
        include: { user: true },
      });

      if (!resetToken || resetToken.expiresAt < new Date()) {
        ApiResponseFormatter.error(res, 'This reset link is invalid or has expired', 400);
        return;
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      await prisma.$transaction([
        prisma.user.update({
          where: { id: resetToken.userId },
          data: { password: hashedPassword },
        }),
        prisma.passwordResetToken.deleteMany({
          where: { userId: resetToken.userId },
        }),
        prisma.token.deleteMany({
          where: { userId: resetToken.userId },
        }),
      ]);

      ApiResponseFormatter.success(res, null, 'Password has been reset successfully');
    } catch (error: any) {
      logger.error('Reset password error:', error);
      ApiResponseFormatter.error(res, 'Failed to reset password: ' + error.message, 500);
    }
  }

  async me(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        ApiResponseFormatter.error(res, 'User not authenticated', 401);
        return;
      }

      // Check if user has resume
      const hasResume = await prisma.resume.findFirst({
        where: { userId: req.user.id },
      });

      ApiResponseFormatter.success(
        res,
        {
          user: {
            id: req.user.id,
            name: req.user.name,
            email: req.user.email,
          },
          hasResume: !!hasResume,
        },
        'User retrieved successfully'
      );
    } catch (error: any) {
      logger.error('Get user error:', error);
      ApiResponseFormatter.error(res, 'Failed to get user: ' + error.message, 500);
    }
  }

  async logout(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        ApiResponseFormatter.error(res, 'User not authenticated', 401);
        return;
      }

      const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;

      if (token) {
        // Delete token from database
        await prisma.token.deleteMany({
          where: { token },
        });
      }

      ApiResponseFormatter.success(res, null, 'Logout successful');
    } catch (error: any) {
      logger.error('Logout error:', error);
      ApiResponseFormatter.error(res, 'Failed to logout: ' + error.message, 500);
    }
  }

  private generateToken(payload: JwtPayload): string {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error('JWT_SECRET is not configured');
    }

    const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
    return jwt.sign(payload, jwtSecret, { expiresIn: expiresIn } as jwt.SignOptions);
  }
}
