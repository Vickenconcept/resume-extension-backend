import { Router } from 'express';
import multer from 'multer';
import { ResumeController } from '../controllers/resume.controller';

const router = Router();
const resumeController = new ResumeController();

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

router.get('/', (req, res) => resumeController.getCurrentResume(req, res));
router.post('/upload-resume', upload.single('resume'), (req, res) =>
  resumeController.upload(req, res)
);
router.post('/tailor-resume', (req, res) => resumeController.tailor(req, res));
router.post('/regenerate-resume', (req, res) => resumeController.regenerate(req, res));
router.post('/download-tailored-resume', (req, res) => resumeController.download(req, res));
router.post('/update-tailored-content', (req, res) => resumeController.updateTailoredContent(req, res));
router.post('/correct-parsed-content', (req, res) => resumeController.correctParsedContent(req, res));

export default router;
