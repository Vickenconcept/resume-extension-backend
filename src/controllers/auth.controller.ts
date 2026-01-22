import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { ApiResponseFormatter } from '../utils/response';
import logger from '../utils/logger';
import { JwtPayload } from '../types';

const prisma = new PrismaClient();

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

    return jwt.sign(payload, jwtSecret, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    });
  }
}
