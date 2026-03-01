import { Resend } from 'resend';
import logger from '../utils/logger';

const resend = new Resend(process.env.RESEND_API_KEY);

const emailFrom = () => process.env.EMAIL_FROM || 'OnPage CV <onboarding@resend.dev>';
const appName = 'OnPage CV';

export class EmailService {
  async sendWelcomeEmail(params: { to: string; name: string }): Promise<void> {
    const { to, name } = params;

    if (!process.env.RESEND_API_KEY) {
      logger.error('RESEND_API_KEY is not configured');
      throw new Error('Email service not configured');
    }

    const { error } = await resend.emails.send({
      from: emailFrom(),
      to: [to],
      subject: `Welcome to ${appName}!`,
      html: `
        <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #111827; margin-bottom: 16px;">Welcome to ${appName}!</h2>
          <p style="color: #374151; margin-bottom: 16px;">Hi ${name},</p>
          <p style="color: #374151; margin-bottom: 16px;">
            Thanks for creating an account. You can start by uploading your resume and tailoring it to any job description to get more interviews.
          </p>
          <p style="color: #374151; margin-bottom: 16px;">
            You have a few free generations to try—when you're ready, you can buy more credits to keep going.
          </p>
          <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">
            If you have any questions, just reply to this email. We're here to help.
          </p>
          <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
            — The ${appName} team
          </p>
        </div>
      `,
    });

    if (error) {
      const errMessage = typeof error === 'object' && error !== null && 'message' in error
        ? (error as { message?: string }).message
        : String(error);
      logger.error('Resend failed to send welcome email', { resendError: error, message: errMessage });
      throw new Error(`Failed to send welcome email: ${errMessage}`);
    }
  }

  async sendFreeTrialEndedEmail(params: { to: string; name: string }): Promise<void> {
    const { to, name } = params;

    if (!process.env.RESEND_API_KEY) {
      logger.error('RESEND_API_KEY is not configured');
      throw new Error('Email service not configured');
    }

    const frontendUrl = process.env.FRONTEND_URL || process.env.ADMIN_DASHBOARD_URL || 'http://localhost:3002';
    const buyCreditsUrl = `${frontendUrl}/payment/success`; // or a direct link to buy credits in app

    const { error } = await resend.emails.send({
      from: emailFrom(),
      to: [to],
      subject: `Your ${appName} free trial has ended`,
      html: `
        <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #111827; margin-bottom: 16px;">You've used your free trial</h2>
          <p style="color: #374151; margin-bottom: 16px;">Hi ${name},</p>
          <p style="color: #374151; margin-bottom: 16px;">
            You've used all your free generations on ${appName}. We hope they helped you tailor your resume and get closer to your next role.
          </p>
          <p style="color: #374151; margin-bottom: 16px;">
            To keep tailoring resumes and cover letters, you can buy credits anytime. We'd love to have you back.
          </p>
          <p style="text-align: center; margin: 24px 0;">
            <a href="${buyCreditsUrl}" style="display: inline-block; padding: 12px 20px; background-color: #3b82f6; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600;">Buy credits</a>
          </p>
          <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">
            If you have any questions, reply to this email. We're happy to help.
          </p>
          <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
            — The ${appName} team
          </p>
        </div>
      `,
    });

    if (error) {
      const errMessage = typeof error === 'object' && error !== null && 'message' in error
        ? (error as { message?: string }).message
        : String(error);
      logger.error('Resend failed to send free-trial-ended email', { resendError: error, message: errMessage });
      throw new Error(`Failed to send free-trial-ended email: ${errMessage}`);
    }
  }

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
      from: emailFrom(),
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

  /** Admin: send custom email to one recipient. Supports {{name}} in subject/html. */
  async sendCustomEmail(params: { to: string; subject: string; html: string; name?: string | null }): Promise<void> {
    const { to, subject, html, name } = params;

    if (!process.env.RESEND_API_KEY) {
      logger.error('RESEND_API_KEY is not configured');
      throw new Error('Email service not configured');
    }

    const replaceName = (text: string) => (name ? text.replace(/\{\{name\}\}/g, name) : text);

    const { error } = await resend.emails.send({
      from: emailFrom(),
      to: [to],
      subject: replaceName(subject),
      html: replaceName(html),
    });

    if (error) {
      const errMessage = typeof error === 'object' && error !== null && 'message' in error
        ? (error as { message?: string }).message
        : String(error);
      logger.error('Resend failed to send custom email', { to, resendError: error, message: errMessage });
      throw new Error(`Failed to send email: ${errMessage}`);
    }
  }

  /** Admin: return the 3 email templates (id, name, subject, body). */
  getEmailTemplates(): { id: string; name: string; subject: string; body: string }[] {
    const wrap = (body: string) =>
      `<div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #374151;">${body}<p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">— The ${appName} team</p></div>`;

    return [
      {
        id: 'product_update',
        name: 'Product update',
        subject: `What's new on ${appName}`,
        body: wrap(
          '<h2 style="color: #111827;">What\'s new</h2><p>Hi {{name}},</p><p>We\'ve added some improvements and new features. Log in to your account to try them out.</p><p>As always, if you have feedback, just reply to this email.</p>'
        ),
      },
      {
        id: 'promotion',
        name: 'Promotion / offer',
        subject: `A special offer for you from ${appName}`,
        body: wrap(
          '<h2 style="color: #111827;">Special offer</h2><p>Hi {{name}},</p><p>We\'re offering a limited-time discount on credits. Use the app to buy credits and continue tailoring your resume.</p><p>Thank you for being a user.</p>'
        ),
      },
      {
        id: 'general',
        name: 'General announcement',
        subject: `Update from ${appName}`,
        body: wrap(
          '<h2 style="color: #111827;">Update</h2><p>Hi {{name}},</p><p>We wanted to share a quick update with you. You can edit this message in the composer before sending.</p>'
        ),
      },
    ];
  }
}

