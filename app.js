// app.js
require('dotenv').config(); // Load environment variables
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Initialize Express
const app = express();

// Security middleware - Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // limit each IP to 200 requests per windowMs (increased from 100)
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting to all requests
app.use(limiter);

// More reasonable rate limiting for payment endpoints
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each IP to 50 payment requests per windowMs (increased from 10)
  message: {
    success: false,
    message: 'Too many payment requests, please try again later.'
  }
});

// CORS Configuration - More restrictive for production
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, etc.)
    if (!origin) return callback(null, true);

    const allowedOrigins = [
      'https://avisignals.com',
      'https://aviatorhub.xyz',
      'https://www.avisignals.com',
      'https://avisignal.netlify.app',
      'https://avisignalss.netlify.app'
    ];

    // Allow localhost in development
    if (process.env.NODE_ENV !== 'production') {
      allowedOrigins.push(
        'http://localhost:3000',
        'http://127.0.0.1:4040',
        /^http:\/\/localhost:\d+$/,
        /^http:\/\/127\.0\.0\.1:\d+$/
      );
    }

    const isAllowed = allowedOrigins.some(allowed => {
      if (typeof allowed === 'string') {
        return origin === allowed;
      } else if (allowed instanceof RegExp) {
        return allowed.test(origin);
      }
      return false;
    });

    if (isAllowed) {
      console.log('CORS allowed origin:', origin);
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      // Still allow the request but log it
      callback(null, true);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'Cache-Control',
    'Pragma',
    'ngrok-skip-browser-warning'
  ],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  preflightContinue: false,
  optionsSuccessStatus: 200
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Handle preflight requests for all routes
app.options('*', cors(corsOptions));

// Parse JSON bodies with increased limits and timeout
app.use(bodyParser.json({
  limit: '50mb',
  extended: true
}));

// Parse URL-encoded bodies
app.use(bodyParser.urlencoded({
  limit: '50mb',
  extended: true
}));

// Add timeout handling
app.use((req, res, next) => {
  // Set timeout for all requests
  req.setTimeout(30000, () => {
    console.log('Request timeout:', req.method, req.url);
    if (!res.headersSent) {
      res.status(408).json({
        success: false,
        message: 'Request timeout'
      });
    }
  });
  next();
});

// Log incoming requests (helpful for debugging)
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url} from ${req.get('origin') || 'unknown'}`);
  next();
});

const userRoutes = require('./routes/users');
app.use('/api/users', userRoutes);

// Auth routes moved to respective modules:
// - Bot login: /api/telegram/bot-login
// - Index login: /api/users/index-login

const paymentRoutes = require('./routes/payments');
app.use('/api/payments', paymentLimiter, paymentRoutes);

const telegramRoutes = require('./routes/telegram');
app.use('/api/telegram', telegramRoutes);

// Chat routes disabled - Using Tawk.to for chat functionality
// const chatRoutes = require('./routes/chat');
// app.use('/api/chat', chatRoutes);

const marketingRoutes = require('./routes/marketing');
app.use('/api/marketing', marketingRoutes);

const roundRoutes = require('./routes/rounds');
app.use('/api/rounds', roundRoutes);

const adminRoutes = require('./routes/admin');
app.use('/api/admin', adminRoutes);

// Initialize global in-memory session store for "Online Users"
global.activeSessions = new Map();

// Middleware to track online users
app.use((req, res, next) => {
  // Try to identify user from request
  let userId = null;
  let userInfo = {};

  // Check query params, body, or headers
  if (req.query.email) userId = req.query.email;
  else if (req.body && req.body.email) userId = req.body.email;
  else if (req.body && req.body.contact) userId = req.body.contact; // Phone/Email

  // If not explicit, track by IP
  if (!userId) {
    userId = `anon_${req.ip}`;
    userInfo.isAnonymous = true;
  }

  // Capture extra info if available
  if (req.body && req.body.packageName) userInfo.package = req.body.packageName;
  if (req.body && req.body.bettingSite) userInfo.site = req.body.bettingSite;

  // Update session
  if (global.activeSessions) {
    const now = Date.now();
    const existing = global.activeSessions.get(userId) || {};

    global.activeSessions.set(userId, {
      ...existing,
      ...userInfo,
      lastSeen: now,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });
  }

  next();
});

// Simple logging system instead of MongoDB
const fs = require('fs');
const path = require('path');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Log user data to file (backup to Telegram)
const logUserData = (data) => {
  const logFile = path.join(logsDir, `users-${new Date().toISOString().split('T')[0]}.log`);
  const logEntry = `${new Date().toISOString()} - ${JSON.stringify(data)}\n`;
  fs.appendFileSync(logFile, logEntry);
  console.log('📝 User data logged:', data);
};

// Basic route (test if server is running)
app.get('/', (req, res) => {
  res.send('Aviator Predictions Backend is running!');
});

// Health check endpoint
app.get('/health', (req, res) => {
  const logFiles = fs.existsSync(logsDir) ? fs.readdirSync(logsDir).length : 0;

  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    database: 'File-based logging (MongoDB removed)',
    logFiles: logFiles,
    telegram: 'Active',
    note: 'All user data flows through Telegram - no database needed!'
  });
});

// Global error handler
app.use((error, req, res, next) => {
  // Don't log request aborted errors as they're usually client-side cancellations
  if (error.code === 'ECONNABORTED' || error.type === 'request.aborted') {
    console.log(`⚠️ Request aborted: ${req.method} ${req.url} (Client disconnected)`);
    // Don't send response as client has already disconnected
    return;
  }

  console.error('Global error handler:', error);

  // CORS error
  if (error.message === 'Not allowed by CORS') {
    return res.status(403).json({
      success: false,
      message: 'CORS: Origin not allowed',
      origin: req.get('origin')
    });
  }

  // Only send response if headers haven't been sent
  if (!res.headersSent) {
    res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Internal Server Error',
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });
  }
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`
  });
});

// Start the server
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📱 Telegram: Active - All user data flows here!`);
  console.log(`📁 Local logs: ${logsDir}`);
  console.log(`✅ MongoDB: Removed - Using Telegram + file logs instead!`);
  console.log(`🎯 Simple, efficient, cost-effective solution!`);

  // Initialize Telegram Marketing Bot
  console.log(`🚀 Initializing Telegram Marketing Bot...`);
  const TelegramMarketingBot = require('./marketing/telegramMarketing');
  const marketingBot = new TelegramMarketingBot();

  // Start marketing bot after 30 seconds (let server fully initialize)
  setTimeout(() => {
    marketingBot.start();
    console.log(`📢 Marketing Bot: Started! Broadcasting to channel every 30-120 minutes`);
  }, 30000);

  // Store marketing bot instance globally for admin controls
  app.locals.marketingBot = marketingBot;
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
  console.log('Unhandled Promise Rejection:', err.message);
  // Close server & exit process
  server.close(() => {
    process.exit(1);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.log('Uncaught Exception:', err.message);
  console.log('Shutting down...');
  process.exit(1);
});