import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PaymentService } from '../services/payment.service';
import { SubscriptionService } from '../services/subscription.service';
import { ApiResponseFormatter } from '../utils/response';
import logger from '../utils/logger';

const prisma = new PrismaClient();
const paymentService = new PaymentService();
const subscriptionService = new SubscriptionService();

export class PaymentController {
  /**
   * Initialize a payment
   */
  async initialize(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        ApiResponseFormatter.error(res, 'User not authenticated', 401);
        return;
      }

      const { planId, amount, credits } = req.body;

      let plan = null;

      if (planId) {
        plan = await prisma.paymentPlan.findUnique({
          where: { id: parseInt(planId, 10) },
        });
      } else if (amount && credits) {
        const amountValue = parseFloat(amount);
        const creditsValue = parseInt(credits, 10);

        if (!Number.isFinite(amountValue) || !Number.isFinite(creditsValue)) {
          ApiResponseFormatter.error(res, 'Invalid amount or credits', 400);
          return;
        }

        plan = await prisma.paymentPlan.findFirst({
          where: {
            amount: amountValue,
            credits: creditsValue,
            isActive: true,
          },
        });
      }

      if (!plan || plan.isActive === false) {
        ApiResponseFormatter.error(res, 'Invalid or inactive payment plan', 400);
        return;
      }

      // Initialize payment with Paystack
      const paymentData = await paymentService.initializePayment(
        req.user.email,
        plan.amount,
        {
          userId: req.user.id,
          credits: plan.credits,
        }
      );

      // Create payment record
      const payment = await prisma.payment.create({
        data: {
          userId: req.user.id,
          paystackRef: paymentData.data.reference,
          amount: plan.amount,
          credits: plan.credits,
          status: 'pending',
          paystackResponse: paymentData as any,
        },
      });

      ApiResponseFormatter.success(
        res,
        {
          authorizationUrl: paymentData.data.authorization_url,
          reference: paymentData.data.reference,
          paymentId: payment.id,
        },
        'Payment initialized successfully'
      );
    } catch (error: any) {
      logger.error('Initialize payment error:', error);
      ApiResponseFormatter.error(res, 'Failed to initialize payment: ' + error.message, 500);
    }
  }

  /**
   * Verify a payment
   */
  async verify(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        ApiResponseFormatter.error(res, 'User not authenticated', 401);
        return;
      }

      const { reference } = req.body;

      if (!reference) {
        ApiResponseFormatter.error(res, 'Payment reference is required', 400);
        return;
      }

      // Find payment record
      const payment = await prisma.payment.findUnique({
        where: { paystackRef: reference },
      });

      if (!payment) {
        ApiResponseFormatter.error(res, 'Payment not found', 404);
        return;
      }

      if (payment.userId !== req.user.id) {
        ApiResponseFormatter.error(res, 'Unauthorized', 403);
        return;
      }

      // If payment is already completed (processed by callback), return immediately
      if (payment.status === 'completed') {
        const successPageUrl = process.env.FRONTEND_URL 
          ? `${process.env.FRONTEND_URL}/payment/success?reference=${reference}`
          : `http://localhost:3002/payment/success?reference=${reference}`;

        ApiResponseFormatter.success(
          res,
          {
            status: 'completed',
            verified: true,
            credits: payment.credits,
            successPageUrl: successPageUrl,
          },
          'Payment verified successfully'
        );
        return;
      }

      // If payment is already failed, return immediately
      if (payment.status === 'failed') {
        ApiResponseFormatter.success(
          res,
          {
            status: 'failed',
            verified: false,
            credits: 0,
          },
          'Payment verification completed'
        );
        return;
      }

      // Payment is still pending, verify with Paystack
      const verification = await paymentService.verifyPayment(reference);

      // Update payment record only if status changed
      let updatedPayment = payment;
      if (verification.data.status === 'success' && payment.status !== 'completed') {
        const expectedAmount = this.convertUsdToNgnKobo(Number(payment.amount));
        if (verification.data.amount !== expectedAmount) {
          logger.error('Payment amount mismatch', {
            paymentId: payment.id,
            expectedAmount,
            receivedAmount: verification.data.amount,
            reference,
          });
          await prisma.payment.update({
            where: { id: payment.id },
            data: {
              status: 'failed',
              paystackResponse: verification as any,
            },
          });
          ApiResponseFormatter.error(res, 'Payment verification failed', 400);
          return;
        }

        updatedPayment = await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: 'completed',
            paystackResponse: verification as any,
          },
        });

        // Add credits to user
        await prisma.user.update({
          where: { id: req.user.id },
          data: {
            credits: {
              increment: payment.credits,
            },
          },
        });

        // Check if authorization is reusable before saving for recurring payments
        const authorization = verification.data.authorization;
        if (authorization?.authorization_code) {
          if (authorization.reusable === false) {
            logger.warn('Authorization code is not reusable - recurring payments will not work', {
              userId: req.user.id,
              paymentId: payment.id,
              authorizationCode: authorization.authorization_code,
              cardType: authorization.card_type,
            });
            // Still save it, but log the warning - some cards may not support recurring
          } else {
            logger.info('Authorization code is reusable - recurring payments enabled', {
              userId: req.user.id,
              paymentId: payment.id,
              reusable: authorization.reusable,
              cardType: authorization.card_type,
            });
          }
        }

        await subscriptionService.upsertFromPayment({
          userId: req.user.id,
          amount: Number(payment.amount),
          credits: payment.credits,
          authorizationCode: authorization?.authorization_code,
          customerCode: verification.data.customer?.customer_code,
        });

        logger.info('Credits added to user via verify', {
          userId: req.user.id,
          credits: payment.credits,
          paymentId: payment.id,
          authorizationReusable: authorization?.reusable,
        });
      } else if (verification.data.status !== 'success' && payment.status === 'pending') {
        // Only update to failed if Paystack explicitly says it failed
        // Don't update if it's still processing
        if (verification.data.status === 'failed') {
          updatedPayment = await prisma.payment.update({
            where: { id: payment.id },
            data: {
              status: 'failed',
              paystackResponse: verification as any,
            },
          });
        }
      }

      const successPageUrl = process.env.FRONTEND_URL 
        ? `${process.env.FRONTEND_URL}/payment/success?reference=${reference}`
        : `http://localhost:3002/payment/success?reference=${reference}`;

      // Return status based on what we found
      const finalStatus = updatedPayment.status; // 'pending', 'completed', or 'failed'
      
      ApiResponseFormatter.success(
        res,
        {
          status: finalStatus,
          verified: finalStatus === 'completed',
          credits: finalStatus === 'completed' ? payment.credits : 0,
          successPageUrl: finalStatus === 'completed' ? successPageUrl : null,
        },
        finalStatus === 'completed' ? 'Payment verified successfully' : 
        finalStatus === 'pending' ? 'Payment is being processed' :
        'Payment verification completed'
      );
    } catch (error: any) {
      logger.error('Verify payment error:', error);
      ApiResponseFormatter.error(res, 'Failed to verify payment: ' + error.message, 500);
    }
  }

  /**
   * Payment callback endpoint - called by Paystack after payment
   */
  async callback(req: Request, res: Response): Promise<void> {
    try {
      const { reference } = req.query;

      if (!reference || typeof reference !== 'string') {
        // Redirect to success page with error
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3002';
        res.redirect(`${frontendUrl}/payment/success?reference=${reference || ''}&error=invalid_reference`);
        return;
      }

      // Verify payment
      const verification = await paymentService.verifyPayment(reference);

      // Find payment record
      const payment = await prisma.payment.findUnique({
        where: { paystackRef: reference },
      });

      if (payment && verification.data.status === 'success') {
        if (payment.status === 'completed') {
          const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3002';
          res.redirect(`${frontendUrl}/payment/success?reference=${reference}`);
          return;
        }

        const expectedAmount = this.convertUsdToNgnKobo(Number(payment.amount));
        if (verification.data.amount !== expectedAmount) {
          logger.error('Payment amount mismatch (callback)', {
            paymentId: payment.id,
            expectedAmount,
            receivedAmount: verification.data.amount,
            reference,
          });
          await prisma.payment.update({
            where: { id: payment.id },
            data: {
              status: 'failed',
              paystackResponse: verification as any,
            },
          });
          const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3002';
          res.redirect(`${frontendUrl}/payment/success?reference=${reference}&error=verification_failed`);
          return;
        }

        // Update payment status
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: 'completed',
            paystackResponse: verification as any,
          },
        });

        // Add credits to user
        await prisma.user.update({
          where: { id: payment.userId },
          data: {
            credits: {
              increment: payment.credits,
            },
          },
        });

        await subscriptionService.upsertFromPayment({
          userId: payment.userId,
          amount: Number(payment.amount),
          credits: payment.credits,
          authorizationCode: verification.data.authorization?.authorization_code,
          customerCode: verification.data.customer?.customer_code,
        });

        logger.info('Payment completed via callback', {
          userId: payment.userId,
          credits: payment.credits,
          paymentId: payment.id,
        });
      }

      // Redirect to success page
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3002';
      res.redirect(`${frontendUrl}/payment/success?reference=${reference}`);
    } catch (error: any) {
      logger.error('Payment callback error:', error);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3002';
      const reference = req.query.reference || '';
      res.redirect(`${frontendUrl}/payment/success?reference=${reference}&error=verification_failed`);
    }
  }

  /**
   * Get payment plans from database
   */
  async getPlans(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        ApiResponseFormatter.error(res, 'User not authenticated', 401);
        return;
      }

      // Get active payment plans from database
      const plans = await prisma.paymentPlan.findMany({
        where: { isActive: true },
        orderBy: { amount: 'asc' },
        select: {
          id: true,
          amount: true,
          credits: true,
        },
      });

      ApiResponseFormatter.success(res, { plans }, 'Payment plans retrieved successfully');
    } catch (error: any) {
      logger.error('Get payment plans error:', error);
      ApiResponseFormatter.error(res, 'Failed to get payment plans: ' + error.message, 500);
    }
  }

  /**
   * Get user's credit balance and usage
   */
  async getCredits(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        ApiResponseFormatter.error(res, 'User not authenticated', 401);
        return;
      }

      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: {
          id: true,
          credits: true,
          freeTrialUsed: true,
        },
      });

      if (!user) {
        ApiResponseFormatter.error(res, 'User not found', 404);
        return;
      }

      const freeTrialLimit = parseInt(process.env.FREE_TRIAL_LIMIT || '3', 10);
      const freeTrialRemaining = Math.max(0, freeTrialLimit - user.freeTrialUsed);

      // Get recent usage logs
      const recentUsage = await prisma.usageLog.findMany({
        where: { userId: req.user.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      ApiResponseFormatter.success(
        res,
        {
          credits: user.credits,
          freeTrialUsed: user.freeTrialUsed,
          freeTrialLimit,
          freeTrialRemaining,
          recentUsage,
        },
        'Credit information retrieved successfully'
      );
    } catch (error: any) {
      logger.error('Get credits error:', error);
      ApiResponseFormatter.error(res, 'Failed to get credit information: ' + error.message, 500);
    }
  }

  private convertUsdToNgnKobo(amount: number): number {
    const usdToNgnRate = parseFloat(process.env.USD_TO_NGN_RATE || '1500');
    return Math.round(amount * usdToNgnRate * 100);
  }
}
