import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import logger from '../utils/logger';
import { EmailService } from '../services/email.service';

const prisma = new PrismaClient();
const emailService = new EmailService();

const JVZOO_SECRET = process.env.JVZOO_SECRET || '';
const FRONTEND_URL =
  process.env.FRONTEND_URL || process.env.ADMIN_DASHBOARD_URL || 'http://localhost:3002';
const APP_LOGIN_URL = `${FRONTEND_URL}/admin/login`;
const CHROME_EXT_URL =
  'https://chromewebstore.google.com/detail/onpage-cv/biglceojgmidchjmifhennljloohamni';

export class JvzooIpnController {
  /**
   * Public JVZoo IPN endpoint (JVZIPN v2)
   * Route: POST /api/ipn/jvzoo
   */
  async handle(req: Request, res: Response): Promise<void> {
    try {
      const data = req.body as Record<string, any>;
      logger.info('JVZoo IPN received', { data });

      if (!this.verifyJVZoo(data)) {
        logger.warn('Invalid JVZoo IPN signature');
        res.status(403).json({ message: 'Invalid JVZoo request' });
        return;
      }

      const transactionType = data.ctransaction as string | undefined;
      const email = data.ccustemail as string | undefined;
      const productId = data.cproditem as string | undefined;

      if (!transactionType || !email || !productId) {
        logger.warn('JVZoo IPN missing required fields', {
          transactionType,
          email,
          productId,
        });
        res.status(400).json({ message: 'Missing required fields' });
        return;
      }

      switch (transactionType) {
        case 'SALE':
          await this.handleSale(email, productId, data);
          break;
        case 'RFND':
          await this.handleRefund(email, productId, data);
          break;
        default:
          logger.warn('Unhandled JVZoo transaction type', { transactionType });
      }

      res.json({ message: 'Webhook processed' });
    } catch (error: any) {
      logger.error('JVZoo IPN handler error', {
        error: error?.message,
        stack: error?.stack,
      });
      res.status(500).json({ message: 'Server error' });
    }
  }

  /**
   * Verify JVZoo JVZIPN v2 signature
   */
  private verifyJVZoo(data: Record<string, any>): boolean {
    if (!JVZOO_SECRET) {
      logger.error('JVZOO_SECRET is not configured');
      return false;
    }

    if (!data.cverify) {
      return false;
    }

    const fields: string[] = [];

    for (const key in data) {
      if (key === 'cverify') continue;
      fields.push(key);
    }

    fields.sort();

    let pop = '';
    for (const field of fields) {
      pop += String(data[field] ?? '') + '|';
    }
    pop += JVZOO_SECRET;

    const calculated = crypto
      .createHash('sha1')
      .update(pop)
      .digest('hex')
      .substring(0, 8)
      .toUpperCase();

    return calculated === String(data.cverify).toUpperCase();
  }

  /**
   * SALE: create user if needed, give 50 main credits, send login + extension email
   */
  private async handleSale(email: string, productId: string, payload: Record<string, any>): Promise<void> {
    // 1) Find or create user
    let user = await prisma.user.findUnique({
      where: { email },
    });

    let generatedPassword: string | null = null;

    if (!user) {
      generatedPassword = crypto.randomBytes(6).toString('base64');
      const passwordHash = await bcrypt.hash(generatedPassword, 10);

      user = await prisma.user.create({
        data: {
          email,
          name: payload.ccustname || email.split('@')[0] || 'OnPage CV user',
          password: passwordHash,
          role: 'user',
          credits: 0,
          freeTrialUsed: 0,
        },
      });
    }

    // 2) Add 50 main (paid) credits
    await prisma.user.update({
      where: { id: user.id },
      data: {
        credits: {
          increment: 50,
        },
      },
    });

    // 3) Send welcome email with login details + extension link
    try {
      await emailService.sendJvzooWelcomeEmail({
        to: email,
        name: user.name,
        appLoginUrl: APP_LOGIN_URL,
        chromeExtensionUrl: CHROME_EXT_URL,
        email,
        passwordPlain: generatedPassword,
      });
    } catch (error: any) {
      // Don't fail the IPN if email sending fails
      logger.error('Failed to send JVZoo welcome email', {
        error: error?.message,
        email,
      });
    }

    logger.info('JVZoo SALE processed', {
      email,
      productId,
      userId: user.id,
      creditsGranted: 50,
    });
  }

  /**
   * RFND: optional – you can revoke credits or downgrade account
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async handleRefund(email: string, productId: string, payload: Record<string, any>): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      logger.warn('Refund for unknown user', { email, productId });
      return;
    }

    // For now, just log. You may choose to remove credits or mark subscription canceled.
    logger.info('JVZoo REFND received', {
      email,
      productId,
      userId: user.id,
    });
  }
}

