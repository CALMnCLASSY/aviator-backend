// app.js
require('dotenv').config(); // Load environment variables
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

// Initialize Express
const app = express();

// CORS Configuration - Add your frontend domain here
const corsOptions = {
    origin: [
        'https://avisignals.com',
        'https://avisignalss.netlify.app',
        'file://',
        /^file:\/\/.*$/,
        'http://localhost:3000',
        'http://127.0.0.1:4040',
        'null'
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
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
    exposedHeaders: ['Content-Range', 'X-Content-Range']
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Handle preflight requests for all routes
app.options('*', cors(corsOptions));

// Legal Compliance & Security Headers Middleware
app.use((req, res, next) => {
    // Security Headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    
    next();
});

// Additional CORS headers for development and production
app.use((req, res, next) => {
  const origin = req.headers.origin;
  
  // For development: be more permissive with localhost and file:// origins
  // For production: allow specific domains
  if (!origin || 
      origin.includes('localhost') || 
      origin.includes('127.0.0.1') || 
      origin === 'https://avisignals.com' ||
      origin === 'https://avisignalss.netlify.app' ||
      origin === 'null' || // file:// protocol sends null origin
      origin.startsWith('file://')) {
    
    res.header('Access-Control-Allow-Origin', origin || '*');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control, Pragma, ngrok-skip-browser-warning');
  }
  
  next();
});

// Raw body parser for Stripe webhooks (must be before JSON parser)
app.use('/api/payments/stripe/webhook', express.raw({ type: 'application/json' }));

// Parse JSON bodies for all other routes with increased limits and timeout
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

// Additional security headers
app.use((req, res, next) => {
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('X-Frame-Options', 'DENY');
  res.header('X-XSS-Protection', '1; mode=block');
  next();
});

// Log incoming requests (helpful for debugging)
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url} from ${req.get('origin') || 'unknown'}`);
  next();
});

const userRoutes = require('./routes/users');
app.use('/api/users', userRoutes);

const paymentRoutes = require('./routes/payments');
app.use('/api/payments', paymentRoutes);

const telegramRoutes = require('./routes/telegram');
app.use('/api/telegram', telegramRoutes);

const chatRoutes = require('./routes/chat');
app.use('/api', chatRoutes);

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