import { Resend } from 'resend';
import logger from '../utils/logger';

const resend = new Resend(process.env.RESEND_API_KEY);

export class EmailService {
  async sendPasswordResetEmail(params: {
    to: string;
    name?: string | null;
    token: string;
  }): Promise<void> {
    const { to, name, token } = params;

    if (!process.env.RESEND_API_KEY) {
      logger.error('RESEND_API_KEY is not configured');
      throw new Error('Email service not configured');
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3002';
    const resetUrl = `${frontendUrl}/reset-password?token=${encodeURIComponent(token)}`;

    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'OnPage CV <onboarding@resend.dev>',
      to: [to],
      subject: 'Reset your OnPage CV password',
      html: `
        <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #111827; margin-bottom: 16px;">Reset your password</h2>
          <p style="color: #374151; margin-bottom: 16px;">
            ${name ? `Hi ${name},` : 'Hi,'}
          </p>
          <p style="color: #374151; margin-bottom: 16px;">
            We received a request to reset your OnPage CV password. Click the button below to choose a new password.
          </p>
          <p style="text-align: center; margin: 24px 0;">
            <a href="${resetUrl}" style="display: inline-block; padding: 12px 20px; background-color: #3b82f6; color: #ffffff; text-decoration: none; border-radius: 999px; font-weight: 600;">
              Reset password
            </a>
          </p>
          <p style="color: #6b7280; font-size: 14px; margin-bottom: 16px;">
            This link will expire in 30 minutes. If you didn't request a password reset, you can safely ignore this email.
          </p>
          <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
            If the button above doesn't work, copy and paste this URL into your browser:<br>
            <a href="${resetUrl}" style="color: #3b82f6; word-break: break-all;">${resetUrl}</a>
          </p>
        </div>
      `,
    });

    if (error) {
      const errMessage = typeof error === 'object' && error !== null && 'message' in error
        ? (error as { message?: string }).message
        : String(error);
      logger.error('Resend failed to send password reset email', {
        resendError: error,
        message: errMessage,
        from: process.env.EMAIL_FROM,
      });
      throw new Error(`Failed to send password reset email: ${errMessage}`);
    }
  }
}

