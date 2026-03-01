import { Router } from 'express';
import multer from 'multer';
import { AuthController } from '../controllers/auth.controller';
import { ResumeController } from '../controllers/resume.controller';
import { FeedbackController } from '../controllers/feedback.controller';
import { PaymentController } from '../controllers/payment.controller';
import { AdminController } from '../controllers/admin.controller';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { adminAuthenticate } from '../middleware/adminAuth';
import { adminOriginGuard } from '../middleware/adminOriginGuard';
import { rateLimit } from '../middleware/rateLimit';
import { ApiResponseFormatter } from '../utils/response';
import logger from '../utils/logger';

const router = Router();
const authController = new AuthController();
const resumeController = new ResumeController();
const feedbackController = new FeedbackController();
const paymentController = new PaymentController();
const adminController = new AdminController();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF and DOCX files are allowed.'));
    }
  },
});

// Test endpoint
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'API is working!',
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
    },
  });
});

// Public auth routes
const authRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
router.post('/register', authRateLimit, (req, res) => authController.register(req, res));
router.post('/login', authRateLimit, (req, res) => authController.login(req, res));
router.post('/forgot-password', authRateLimit, (req, res) => authController.forgotPassword(req, res));
router.post('/reset-password', authRateLimit, (req, res) => authController.resetPassword(req, res));

// Verify forgot-password route is deployed (GET so you can open in browser)
router.get('/forgot-password', (req, res) => {
  res.json({ ok: true, message: 'Use POST with body: { "email": "your@email.com" }' });
});

// Protected auth routes
router.get('/me', authenticate, (req, res) => authController.me(req, res));
router.post('/logout', authenticate, (req, res) => authController.logout(req, res));

// Resume routes (all protected)
// GET /api/resume - Get current resume
router.get('/resume', authenticate, (req, res) => resumeController.getCurrentResume(req, res));

// POST /api/upload-resume - Upload resume
router.post('/upload-resume', authenticate, (req, res, next) => {
  upload.single('resume')(req, res, (err) => {
    if (err) {
      logger.error('Multer upload error:', {
        error: err.message,
        error_type: err.name,
        error_code: (err as any).code,
      });
      return ApiResponseFormatter.error(
        res,
        err.message || 'File upload error',
        400
      );
    }
    next();
  });
}, (req, res) => resumeController.upload(req, res));

// POST /api/tailor-resume - Tailor resume
router.post('/tailor-resume', authenticate, (req, res) => resumeController.tailor(req, res));

// POST /api/regenerate-resume - Regenerate resume to add missing keywords
router.post('/regenerate-resume', authenticate, (req, res) => resumeController.regenerate(req, res));

// POST /api/download-tailored-resume - Download tailored resume
router.post('/download-tailored-resume', authenticate, (req, res) =>
  resumeController.download(req, res)
);

// POST /api/update-tailored-content - Update tailored content (resume or cover letter)
router.post('/update-tailored-content', authenticate, (req, res) =>
  resumeController.updateTailoredContent(req, res)
);

// GET /api/resumes - Get all resumes for user
router.get('/resumes', authenticate, (req, res) => resumeController.getAllResumes(req, res));

// GET /api/resume-versions - Get all resume versions for user
router.get('/resume-versions', authenticate, (req, res) => resumeController.getAllResumeVersions(req, res));

// POST /api/promote-version-to-main - Promote a resume version to main resume
router.post('/promote-version-to-main', authenticate, (req, res) => resumeController.promoteVersionToMain(req, res));

// POST /api/delete-resume-version - Delete a resume version
router.post('/delete-resume-version', authenticate, (req, res) => resumeController.deleteResumeVersion(req, res));

// GET /api/default-template - Get user's default template preference
router.get('/default-template', authenticate, (req, res) => resumeController.getDefaultTemplate(req, res));

// POST /api/default-template - Set user's default template preference
router.post('/default-template', authenticate, (req, res) => resumeController.setDefaultTemplate(req, res));

// POST /api/set-default-resume - Set default resume
router.post('/set-default-resume', authenticate, (req, res) => resumeController.setDefaultResume(req, res));

// POST /api/update-resume-name - Update resume display name
router.post('/update-resume-name', authenticate, (req, res) => resumeController.updateResumeName(req, res));

// POST /api/delete-resume - Delete resume
router.post('/delete-resume', authenticate, (req, res) => resumeController.deleteResume(req, res));

// Feedback routes
// POST /api/feedback - Submit user feedback (thumbs up/down)
router.post('/feedback', authenticate, (req, res) => feedbackController.submitFeedback(req, res));

// GET /api/feedback - Get user's own feedback
router.get('/feedback', authenticate, (req, res) => feedbackController.getUserFeedback(req, res));

// GET /api/admin/feedback - Get all feedback (admin only)
router.get('/admin/feedback', adminAuthenticate, (req, res) => feedbackController.getAllFeedback(req, res));

// Payment routes
// POST /api/payment/initialize - Initialize a payment
router.post('/payment/initialize', authenticate, (req, res) => paymentController.initialize(req, res));

// POST /api/payment/verify - Verify a payment
router.post('/payment/verify', authenticate, (req, res) => paymentController.verify(req, res));

// GET /api/payment/callback - Payment callback from Paystack (public endpoint)
router.get('/payment/callback', (req, res) => paymentController.callback(req, res));

// GET /api/payment/plans - Get available payment plans
router.get('/payment/plans', authenticate, (req, res) => paymentController.getPlans(req, res));

// GET /api/payment/credits - Get user's credit balance
router.get('/payment/credits', authenticate, (req, res) => paymentController.getCredits(req, res));

// Admin routes
// POST /api/admin/login - Admin login
const adminLoginRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
router.post('/admin/login', adminOriginGuard, adminLoginRateLimit, (req, res) => adminController.login(req, res));

// POST /api/admin/logout - Admin logout
router.post('/admin/logout', adminOriginGuard, adminAuthenticate, (req, res) => adminController.logout(req, res));

// GET /api/admin/stats - Get dashboard statistics
router.get('/admin/stats', adminAuthenticate, (req, res) => adminController.getStats(req, res));

// GET /api/admin/users - Get all users
router.get('/admin/users', adminAuthenticate, (req, res) => adminController.getUsers(req, res));

// GET /api/admin/users/:id - Get user details
router.get('/admin/users/:id', adminAuthenticate, (req, res) => adminController.getUser(req, res));

// PUT /api/admin/users/:id - Update user
router.put('/admin/users/:id', adminOriginGuard, adminAuthenticate, (req, res) => adminController.updateUser(req, res));

// DELETE /api/admin/users/:id - Delete user
router.delete('/admin/users/:id', adminOriginGuard, adminAuthenticate, (req, res) => adminController.deleteUser(req, res));

// GET /api/admin/payment-plans - Get payment plans
router.get('/admin/payment-plans', adminAuthenticate, (req, res) => adminController.getPaymentPlans(req, res));
// GET /api/admin/payments - Get payments
router.get('/admin/payments', adminAuthenticate, (req, res) => adminController.getPayments(req, res));

// GET /api/admin/subscriptions - Get subscriptions
router.get('/admin/subscriptions', adminAuthenticate, (req, res) => adminController.getSubscriptions(req, res));

// POST /api/admin/payment-plans - Create payment plan
router.post('/admin/payment-plans', adminOriginGuard, adminAuthenticate, (req, res) => adminController.createPaymentPlan(req, res));

// PUT /api/admin/payment-plans/:id - Update payment plan
router.put('/admin/payment-plans/:id', adminOriginGuard, adminAuthenticate, (req, res) => adminController.updatePaymentPlan(req, res));

// DELETE /api/admin/payment-plans/:id - Delete payment plan
router.delete('/admin/payment-plans/:id', adminOriginGuard, adminAuthenticate, (req, res) => adminController.deletePaymentPlan(req, res));

// PUT /api/admin/subscriptions/:id - Update subscription
router.put('/admin/subscriptions/:id', adminOriginGuard, adminAuthenticate, (req, res) => adminController.updateSubscription(req, res));

// POST /api/admin/subscriptions/:id/cancel - Cancel subscription
router.post('/admin/subscriptions/:id/cancel', adminOriginGuard, adminAuthenticate, (req, res) => adminController.cancelSubscription(req, res));

// GET /api/admin/email/templates - Get email templates for composer
router.get('/admin/email/templates', adminAuthenticate, (req, res) => adminController.getEmailTemplates(req, res));
// GET /api/admin/email/recipients - Get recipients list (query: filter=all|free_trial_used|no_credits|has_paid)
router.get('/admin/email/recipients', adminAuthenticate, (req, res) => adminController.getEmailRecipients(req, res));
// POST /api/admin/email/send - Send composed email
router.post('/admin/email/send', adminOriginGuard, adminAuthenticate, (req, res) => adminController.sendEmail(req, res));

export default router;
