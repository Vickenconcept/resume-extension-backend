import { PrismaClient } from '@prisma/client';
import logger from '../utils/logger';
import { PaymentService } from './payment.service';

const prisma = new PrismaClient();

const DEFAULT_CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_RETRY_DAYS = 1;

const addMonths = (date: Date, months: number): Date => {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
};

const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

export class SubscriptionService {
  private paymentService = new PaymentService();
  private isProcessing = false;

  start(): void {
    const intervalMs = parseInt(process.env.SUBSCRIPTION_CHECK_INTERVAL_MS || '', 10) || DEFAULT_CHECK_INTERVAL_MS;

    this.processDueSubscriptions().catch((error) => {
      logger.error('Initial subscription processing failed', { error: error.message });
    });

    setInterval(() => {
      if (this.isProcessing) {
        return;
      }
      this.processDueSubscriptions().catch((error) => {
        logger.error('Subscription processing failed', { error: error.message });
      });
    }, intervalMs);
  }

  async upsertFromPayment(options: {
    userId: number;
    amount: number;
    credits: number;
    authorizationCode?: string;
    customerCode?: string;
  }): Promise<void> {
    const now = new Date();
    const nextChargeAt = addMonths(now, 1);

    const existing = await prisma.subscription.findFirst({
      where: { userId: options.userId, status: 'active' },
      orderBy: { updatedAt: 'desc' },
    });

    if (existing) {
      await prisma.subscription.update({
        where: { id: existing.id },
        data: {
          amount: options.amount,
          credits: options.credits,
          paystackAuthorizationCode: options.authorizationCode || existing.paystackAuthorizationCode,
          paystackCustomerCode: options.customerCode || existing.paystackCustomerCode,
          status: 'active',
          nextChargeAt,
        },
      });
      return;
    }

    await prisma.subscription.create({
      data: {
        userId: options.userId,
        amount: options.amount,
        credits: options.credits,
        paystackAuthorizationCode: options.authorizationCode,
        paystackCustomerCode: options.customerCode,
        status: 'active',
        nextChargeAt,
      },
    });
  }

  private async processDueSubscriptions(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;
    try {
      const now = new Date();
      const dueSubscriptions = await prisma.subscription.findMany({
        where: {
          status: 'active',
          nextChargeAt: {
            lte: now,
          },
        },
        include: {
          user: {
            select: { email: true },
          },
        },
      });

      if (!dueSubscriptions.length) {
        return;
      }

      for (const subscription of dueSubscriptions) {
        if (!subscription.paystackAuthorizationCode) {
          logger.warn('Subscription missing authorization code', {
            subscriptionId: subscription.id,
            userId: subscription.userId,
          });
          await prisma.subscription.update({
            where: { id: subscription.id },
            data: {
              status: 'past_due',
              nextChargeAt: addDays(now, DEFAULT_RETRY_DAYS),
            },
          });
          continue;
        }

        try {
          const chargeResult = await this.paymentService.chargeAuthorization({
            authorizationCode: subscription.paystackAuthorizationCode,
            email: subscription.user.email,
            amount: Number(subscription.amount),
          });

          if (chargeResult.data.status !== 'success') {
            throw new Error(`Charge failed with status ${chargeResult.data.status}`);
          }

          await prisma.$transaction([
            prisma.user.update({
              where: { id: subscription.userId },
              data: {
                credits: {
                  increment: subscription.credits,
                },
              },
            }),
            prisma.subscription.update({
              where: { id: subscription.id },
              data: {
                lastChargedAt: now,
                nextChargeAt: addMonths(now, 1),
                status: 'active',
              },
            }),
          ]);

          logger.info('Subscription charged successfully', {
            subscriptionId: subscription.id,
            userId: subscription.userId,
            credits: subscription.credits,
          });
        } catch (error: any) {
          logger.error('Subscription charge failed', {
            subscriptionId: subscription.id,
            userId: subscription.userId,
            error: error.message,
          });

          await prisma.subscription.update({
            where: { id: subscription.id },
            data: {
              status: 'past_due',
              nextChargeAt: addDays(now, DEFAULT_RETRY_DAYS),
            },
          });
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }
}
