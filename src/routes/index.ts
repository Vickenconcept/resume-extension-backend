import { Router } from 'express';
import multer from 'multer';
import { AuthController } from '../controllers/auth.controller';
import { ResumeController } from '../controllers/resume.controller';
import { FeedbackController } from '../controllers/feedback.controller';
import { authenticate } from '../middleware/auth';
import { ApiResponseFormatter } from '../utils/response';
import logger from '../utils/logger';

const router = Router();
const authController = new AuthController();
const resumeController = new ResumeController();
const feedbackController = new FeedbackController();

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
router.post('/register', (req, res) => authController.register(req, res));
router.post('/login', (req, res) => authController.login(req, res));

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

// POST /api/set-default-resume - Set default resume
router.post('/set-default-resume', authenticate, (req, res) => resumeController.setDefaultResume(req, res));

// POST /api/update-resume-name - Update resume display name
router.post('/update-resume-name', authenticate, (req, res) => resumeController.updateResumeName(req, res));

// POST /api/delete-resume - Delete resume
router.post('/delete-resume', authenticate, (req, res) => resumeController.deleteResume(req, res));

// POST /api/submit-feedback - Submit user feedback
router.post('/submit-feedback', authenticate, (req, res) => feedbackController.submitFeedback(req, res));

export default router;
