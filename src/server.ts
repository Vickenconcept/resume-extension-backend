import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import routes from './routes';
import { errorHandler } from './middleware/errorHandler';
import logger from './utils/logger';
import { SubscriptionService } from './services/subscription.service';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
const defaultAllowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3002', // Admin dashboard
  'http://localhost:5173',
  'http://localhost:8000',
  'https://onpagecv.on-forge.com', // Production backend
  'https://resume.phanrise.com', // Admin/marketing domain
];

const extraAllowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = Array.from(new Set([...defaultAllowedOrigins, ...extraAllowedOrigins]));

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) {
      return callback(null, true);
    }

    if (origin.startsWith('chrome-extension://')) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'ngrok-skip-browser-warning',
    'Accept',
    'X-Requested-With',
  ],
  exposedHeaders: ['Content-Type', 'Content-Length'],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Request logging with response timing
app.use((req, res, next) => {
  const startTime = process.hrtime.bigint();
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
    logger.info('Request completed', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: Math.round(durationMs),
    });
  });

  next();
});

// Routes
app.use('/api', routes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handler (must be last)
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

const shouldStartSubscriptionWorker = (process.env.SUBSCRIPTION_WORKER_ENABLED || 'true') === 'true';
if (shouldStartSubscriptionWorker) {
  const subscriptionService = new SubscriptionService();
  subscriptionService.start();
}

export default app;
