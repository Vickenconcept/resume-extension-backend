import axios from 'axios';
import logger from '../utils/logger';

export interface PaystackInitializeResponse {
  status: boolean;
  message: string;
  data: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
}

export interface PaystackVerifyResponse {
  status: boolean;
  message: string;
  data: {
    amount: number;
    currency: string;
    reference: string;
    status: string;
    customer: {
      email: string;
    };
    metadata?: {
      credits?: number;
      userId?: number;
    };
  };
}

export class PaymentService {
  private secretKey: string;
  private publicKey: string;
  private baseUrl = 'https://api.paystack.co';

  constructor() {
    this.secretKey = (process.env.PAYSTACK_SECRET_KEY || '').trim();
    this.publicKey = (process.env.PAYSTACK_PUBLIC_KEY || '').trim();
    
    if (!this.secretKey || !this.publicKey) {
      logger.warn('Paystack keys not configured. Payment features will not work.');
      logger.warn('PAYSTACK_SECRET_KEY:', this.secretKey ? 'Set (hidden)' : 'NOT SET');
      logger.warn('PAYSTACK_PUBLIC_KEY:', this.publicKey ? 'Set (hidden)' : 'NOT SET');
    } else {
      logger.info('Paystack keys loaded successfully');
    }
  }

  /**
   * Initialize a Paystack payment
   */
  async initializePayment(
    email: string,
    amount: number, // Amount in USD
    metadata: { userId: number; credits: number }
  ): Promise<PaystackInitializeResponse> {
    try {
      if (!this.secretKey) {
        throw new Error('Paystack secret key is not configured');
      }

      const chargeCurrency = (process.env.PAYSTACK_CHARGE_CURRENCY || 'NGN').toUpperCase();
      const isUsdCharge = chargeCurrency === 'USD';
      let amountInSubunit: number;

      if (isUsdCharge) {
        // USD uses cents
        amountInSubunit = Math.round(amount * 100);
      } else {
        // Convert USD to NGN (Paystack's base currency) - approximate rate
        // You may want to use a currency conversion API for real-time rates
        const usdToNgnRate = parseFloat(process.env.USD_TO_NGN_RATE || '1500');
        amountInSubunit = Math.round(amount * usdToNgnRate * 100); // Convert to kobo (smallest currency unit)
      }

      // Ensure secret key is properly formatted
      const secretKey = this.secretKey.trim();
      if (!secretKey || !secretKey.startsWith('sk_')) {
        logger.error('Invalid Paystack secret key format', {
          hasKey: !!secretKey,
          keyLength: secretKey?.length || 0,
          keyPrefix: secretKey?.substring(0, 3) || 'none',
        });
        throw new Error('Invalid Paystack secret key. Key must start with "sk_"');
      }

      const authHeader = `Bearer ${secretKey}`;
      
      logger.info('Initializing Paystack payment', {
        email,
        amountUSD: amount,
        chargeCurrency,
        amountSubunit: amountInSubunit,
        credits: metadata.credits,
        hasSecretKey: !!secretKey,
        keyPrefix: secretKey.substring(0, 10) + '...',
      });

      const response = await axios.post(
        `${this.baseUrl}/transaction/initialize`,
        {
          email,
          amount: amountInSubunit,
          currency: chargeCurrency,
          metadata: {
            userId: metadata.userId,
            credits: metadata.credits,
            amountUSD: amount,
            chargeCurrency,
          },
          callback_url: process.env.PAYSTACK_CALLBACK_URL || `${process.env.BACKEND_URL || 'http://localhost:3000'}/api/payment/callback`,
        },
        {
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data;
    } catch (error: any) {
      logger.error('Paystack initialize payment error:', {
        error: error.message,
        response: error.response?.data,
        status: error.response?.status,
        hasSecretKey: !!this.secretKey,
      });
      throw new Error(`Failed to initialize payment: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Verify a Paystack payment
   */
  async verifyPayment(reference: string): Promise<PaystackVerifyResponse> {
    try {
      if (!this.secretKey) {
        throw new Error('Paystack secret key is not configured');
      }

      const secretKey = this.secretKey.trim();
      const authHeader = `Bearer ${secretKey}`;

      const response = await axios.get(
        `${this.baseUrl}/transaction/verify/${reference}`,
        {
          headers: {
            'Authorization': authHeader,
          },
        }
      );

      return response.data;
    } catch (error: any) {
      logger.error('Paystack verify payment error:', {
        error: error.message,
        reference,
        response: error.response?.data,
      });
      throw new Error(`Failed to verify payment: ${error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Get payment plans (for future use)
   */
  getPaymentPlans(): Array<{ amount: number; credits: number; name: string }> {
    // These can be configured via env or database
    const plans = process.env.PAYMENT_PLANS || '5:20,10:50,20:120,50:350';
    const planArray = plans.split(',').map((plan) => {
      const [amount, credits] = plan.split(':').map(Number);
      return {
        amount,
        credits,
        name: `$${amount} - ${credits} Credits`,
      };
    });

    return planArray;
  }
}
