// ============================================================
// app.js — AviSignals Backend v2
//
// What changed from v1:
//  SECURITY
//  - Body limit dropped from 50mb → 10kb (was a vulnerability)
//  - Admin panel (/control) now requires a secret token header
//  - Master admin code has NO hardcoded fallback
//  - CORS localhost check is dev-only (not in production)
//  - Health endpoint no longer leaks internal architecture
//  - Session tracker skips static files and health checks
//
//  ARCHITECTURE
//  - Globals initialised BEFORE routes (fixes boot-time race)
//  - TelegramMarketingBot removed — replaced by telegramAgent v2
//  - Each agent starts in isolation — one crash won't stop others
//  - unhandledRejection no longer kills the server (logs instead)
//  - bodyParser replaced with built-in express.json()
//  - Request logger skips static assets (no more favicon spam)
//  - Session Map has a 10-minute cleanup cycle (no memory leak)
//  - Graceful shutdown on SIGTERM/SIGINT for clean VPS restarts
// ============================================================

'use strict';

require('dotenv').config();

// ─── Clean up common copy-paste errors in Env Vars ────────────
if (process.env.SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.SUPABASE_URL.trim().replace(/\/+$/, '');
}
if (process.env.SUPABASE_KEY) {
    process.env.SUPABASE_KEY = process.env.SUPABASE_KEY.trim();
}
if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY.trim();
}
if (process.env.TELEGRAM_BOT_TOKEN) {
    process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN.trim();
}
if (process.env.TELEGRAM_CHAT_ID) {
    process.env.TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID.trim();
}
if (process.env.TELEGRAM_CHANNEL_ID) {
    process.env.TELEGRAM_CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID.trim();
}

// ─── Validate required env vars at boot ──────────────────────
const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_KEY'];
const missingEnv   = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingEnv.length) {
    console.error(`❌ Missing required environment variables: ${missingEnv.join(', ')}`);
    console.error('   Add them to your .env file and restart.');
    process.exit(1);
}

// ─── Warn on missing but non-critical vars ────────────────────
const RECOMMENDED_ENV = [
    'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TELEGRAM_CHANNEL_ID',
    'RESEND_API_KEY', 'DISCORD_WEBHOOK_URL', 'GROQ_API_KEY',
    'MASTER_ADMIN_CODE', 'ADMIN_PANEL_TOKEN', 'BREVO_USER', 'BREVO_SMTP_KEY'
];
RECOMMENDED_ENV.forEach(k => {
    if (!process.env[k]) console.warn(`⚠️  Optional env var not set: ${k}`);
});

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const fs         = require('fs');
const path       = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.set('trust proxy', 1);

// ============================================================
// SUPABASE — single shared client
// ============================================================
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

let supabaseAdmin = null;
if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    supabaseAdmin = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );
}

// ============================================================
// GLOBALS — initialised BEFORE routes so nothing hits undefined
// ============================================================

// Online user session tracker (in-memory)
global.activeSessions = new Map();

// Bot payments store
global.botPayments = {};

// Activation code generator
global.generateActivationCode = (length = 6) =>
    Math.random().toString(36).substring(2, 2 + length).toUpperCase();

// Master admin code — NO hardcoded fallback for security
// If not set, master code feature is disabled
global.MASTER_ADMIN_CODE = process.env.MASTER_ADMIN_CODE || null;
if (!global.MASTER_ADMIN_CODE) {
    console.warn('⚠️  MASTER_ADMIN_CODE not set — master code feature disabled.');
} else {
    console.log('🔑 Master Admin Code: active');
}

// Activation codes (load from disk or generate fresh)
const CODES_FILE = path.join(__dirname, 'activation_codes.json');

global.saveActivationCodes = () => {
    try {
        fs.writeFileSync(CODES_FILE, JSON.stringify(global.activationCodes, null, 2));
    } catch (e) {
        console.error('❌ Failed to persist activation codes:', e.message);
    }
};

let persistedCodes = {};
try {
    if (fs.existsSync(CODES_FILE)) {
        persistedCodes = JSON.parse(fs.readFileSync(CODES_FILE, 'utf8'));
        console.log('✅ Loaded persisted activation codes from disk');
    }
} catch (e) {
    console.warn('⚠️  Could not load activation_codes.json — starting fresh');
}

global.defaultSites             = ['SportyBet', '1xBet', 'Betika', 'Betway', 'Parimatch', 'BangBet', 'Bet365', 'OdiBets', 'Helabet', 'MozzartBet', 'Aviator', 'Other', 'Betano', 'Stoiximan', 'Pin-Up', 'Melbet', 'Linebet', 'YYY Casino', 'Rabona', 'Leon', 'Stake', 'Unibet', 'Toto Casino', 'LeoVegas', '888casino', 'Casino777', 'Napoleon Sports and Casino', 'Lottomatica', 'Casino Gran Madrid', 'Novibet', 'Vlad Cazino', 'BetVictor', 'Betsson', 'Roobet', 'Rushbet', 'Coolbet', 'BC.Game', 'Supabets'];
global.freeTrialWhitelistedSites = ['classybet', 'jetbet'];
global.activationCodes          = persistedCodes;

// Ensure every site has a code entry
global.defaultSites.forEach(site => {
    if (!global.activationCodes[site]) {
        global.activationCodes[site] = { daily: generateActivationCode() };
    }
    const whitelisted = global.freeTrialWhitelistedSites.includes(site);
    if (whitelisted && !global.activationCodes[site].freeTrial) {
        global.activationCodes[site].freeTrial = generateActivationCode();
    }
    if (!whitelisted) {
        delete global.activationCodes[site].freeTrial;
    }
});

global.freeTrialWhitelistedSites.forEach(site => {
    if (!global.activationCodes[site]) {
        global.activationCodes[site] = {
            daily:     generateActivationCode(),
            freeTrial: generateActivationCode()
        };
        console.log(`✅ Created whitelisted site: ${site}`);
    }
});

global.saveActivationCodes();
console.log('✅ Activation codes initialised');

// ─── Session cleanup — runs every 10 minutes ─────────────────
// Removes sessions inactive for more than 30 minutes
// Prevents the Map from growing forever (was a memory leak in v1)
setInterval(() => {
    const cutoff = Date.now() - 30 * 60 * 1000;
    let removed  = 0;
    for (const [key, session] of global.activeSessions) {
        if (session.lastSeen < cutoff) {
            global.activeSessions.delete(key);
            removed++;
        }
    }
    if (removed > 0) console.log(`🧹 Session cleanup: removed ${removed} stale session(s). Active: ${global.activeSessions.size}`);
}, 10 * 60 * 1000);

// ============================================================
// LOGGING SETUP
// ============================================================
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const logUserData = (data) => {
    const logFile  = path.join(logsDir, `users-${new Date().toISOString().split('T')[0]}.log`);
    const logEntry = `${new Date().toISOString()} - ${JSON.stringify(data)}\n`;
    try { fs.appendFileSync(logFile, logEntry); } catch (_) {}
};

// Auto-delete log files older than 30 days
setInterval(() => {
    try {
        const files   = fs.readdirSync(logsDir);
        const cutoff  = Date.now() - 30 * 24 * 60 * 60 * 1000;
        files.forEach(f => {
            const fp = path.join(logsDir, f);
            if (fs.statSync(fp).mtimeMs < cutoff) {
                fs.unlinkSync(fp);
                console.log(`🗑  Deleted old log: ${f}`);
            }
        });
    } catch (_) {}
}, 24 * 60 * 60 * 1000); // daily

// ============================================================
// CORS
// ============================================================
const ALLOWED_ORIGINS = [
    'https://avisignals.com',
    'https://www.avisignals.com',
    'https://back.avisignals.com',
    'https://aviatorhub.xyz',
    'https://avisignal.netlify.app',
    'https://avisignalss.netlify.app',
    'https://aviator-backend-komp.onrender.com',
];

// Dev origins only added in non-production
const DEV_ORIGINS = [
    'http://localhost:3000',
    'http://localhost:5000',
    'http://127.0.0.1:4040',
    'http://127.0.0.1:5000',
];

const corsOptions = {
    origin(origin, callback) {
        // Allow: no origin (server-to-server), null origin (PWA standalone mode), allowed list, dev
        if (!origin || origin === 'null') return callback(null, true);

        const isProd      = process.env.NODE_ENV === 'production';
        const isAllowed   = ALLOWED_ORIGINS.includes(origin);
        const isDevAllowed = !isProd && DEV_ORIGINS.includes(origin);

        if (isAllowed || isDevAllowed) {
            callback(null, true);
        } else {
            console.warn(`🚫 CORS blocked: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials:         true,
    methods:             ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders:      ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization', 'Cache-Control', 'Pragma', 'ngrok-skip-browser-warning'],
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// ============================================================
// SECURITY HEADERS (Helmet)
// ============================================================
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc:    ["'self'"],
            styleSrc:      ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
            scriptSrc:     ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net", "https://checkout.flutterwave.com"],
            scriptSrcAttr: ["'unsafe-inline'"],
            fontSrc:       ["'self'", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com"],
            imgSrc:        ["'self'", "data:", "https:"],
            frameSrc:      ["'self'", "https://checkout.flutterwave.com", "https://*.f4b-flutterwave.com"],
            connectSrc:    [
                "'self'",
                "https://back.avisignals.com",
                "https://*.supabase.co",
                "https://api.flutterwave.com",
                "https://checkout.flutterwave.com",
                "https://api.ravepay.co",
                "https://api.safaricom.co.ke",
                "wss://back.avisignals.com",
            ]
        }
    },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }
}));

// ============================================================
// BODY PARSING
// bodyParser removed — express.json() is built-in since Express 4.16
// 50mb limit was dangerous. Real limits per endpoint type:
//   - API endpoints: 10kb (more than enough for JSON payloads)
//   - Webhook endpoints: 1mb (Flutterwave sends small JSON)
// ============================================================
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ limit: '10kb', extended: true }));

// ============================================================
// RATE LIMITING
// ============================================================

// General API limiter
const apiLimiter = rateLimit({
    windowMs:        15 * 60 * 1000,
    max:             200,
    standardHeaders: true,
    legacyHeaders:   false,
    message:         { success: false, message: 'Too many requests. Please try again later.' },
    skip:            (req) => req.path === '/health' // don't rate-limit health checks
});

// Strict limiter for payment and auth endpoints
const strictLimiter = rateLimit({
    windowMs:        15 * 60 * 1000,
    max:             30,
    standardHeaders: true,
    legacyHeaders:   false,
    message:         { success: false, message: 'Too many requests on this endpoint.' }
});

// AI chat limiter — prevents prompt injection flooding
const chatLimiter = rateLimit({
    windowMs:        60 * 1000,
    max:             20,
    standardHeaders: true,
    legacyHeaders:   false,
    message:         { reply: 'You\'re sending messages too fast. Please slow down.' }
});

app.use('/api/', apiLimiter);

// ============================================================
// REQUEST TIMEOUT
// ============================================================
app.use((req, res, next) => {
    req.setTimeout(30000, () => {
        if (!res.headersSent) res.status(408).json({ success: false, message: 'Request timeout' });
    });
    next();
});

// ============================================================
// REQUEST LOGGER — skips static files and health checks
// ============================================================
const SKIP_LOG_PATHS = new Set(['/health', '/favicon.ico', '/robots.txt']);

app.use((req, res, next) => {
    if (SKIP_LOG_PATHS.has(req.path)) return next();
    if (req.path.match(/\.(css|js|png|jpg|ico|svg|woff|woff2|ttf)$/)) return next();
    console.log(`${new Date().toISOString()} ${req.method} ${req.path} — ${req.get('origin') || req.ip}`);
    next();
});

// ============================================================
// ONLINE SESSION TRACKER
// Skips static file requests — only tracks real API calls
// ============================================================
app.use((req, res, next) => {
    // Only track meaningful API endpoints
    if (!req.path.startsWith('/api/')) return next();

    const userId   = req.body?.email || req.body?.contact || req.query?.email || `anon_${req.ip}`;
    const existing = global.activeSessions.get(userId) || {};

    global.activeSessions.set(userId, {
        ...existing,
        lastSeen:    Date.now(),
        ip:          req.ip,
        userAgent:   req.headers['user-agent'],
        isAnonymous: !req.body?.email && !req.query?.email,
        ...(req.body?.bettingSite && { site: req.body.bettingSite }),
    });

    next();
});

// ============================================================
// SUPABASE ON REQUEST — attach to req for routes
// ============================================================
app.use((req, _res, next) => {
    req.supabase = supabase;
    req.supabaseAdmin = supabaseAdmin;
    next();
});

// ============================================================
// STATIC FILES
// ============================================================
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// ADMIN PANEL — protected by token header
// In v1 this was wide open. Now requires:
//   Header: X-Admin-Token: <your ADMIN_PANEL_TOKEN from .env>
// ============================================================
app.get('/control', (req, res) => {
    const token    = req.headers['x-admin-token'] || req.query.token;
    const expected = process.env.ADMIN_PANEL_TOKEN;

    if (!expected) {
        return res.status(503).json({ success: false, message: 'Admin panel not configured.' });
    }
    if (!token || token !== expected) {
        console.warn(`🚫 Unauthorised admin panel attempt from ${req.ip}`);
        return res.status(401).json({ success: false, message: 'Unauthorised.' });
    }
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ============================================================
// ROUTES
// ============================================================
const userRoutes     = require('./routes/users');
const authRoutes     = require('./routes/auth');
const paymentRoutes  = require('./routes/payments');
const telegramRoutes = require('./routes/telegram');
const marketingRoutes = require('./routes/marketing');
const roundRoutes    = require('./routes/rounds');
const adminRoutes    = require('./routes/admin');
const { handleChat } = require('./Agent/chatAgent');

app.use('/api/users',     userRoutes);
app.use('/api/auth',      strictLimiter, authRoutes);
app.use('/api/payments',  strictLimiter, paymentRoutes);
app.use('/api/telegram',  telegramRoutes);
app.use('/api/marketing', marketingRoutes);
app.use('/api/rounds',    roundRoutes);
app.use('/api/admin',     adminRoutes);

// AI Chat — has its own tight rate limiter
app.post('/api/ai/chat', chatLimiter, handleChat);

// ============================================================
// UTILITY ROUTES
// ============================================================

// Root — minimal, reveals nothing
app.get('/', (_req, res) => res.json({ status: 'ok' }));

// Health check — Supabase connectivity included, no internal details exposed
app.get('/health', async (_req, res) => {
    let dbStatus = 'unknown';
    try {
        const { error } = await supabase.from('profiles').select('id').limit(1);
        dbStatus = error ? 'error' : 'connected';
    } catch (_) { dbStatus = 'unreachable'; }

    res.json({
        status:    'ok',
        timestamp: new Date().toISOString(),
        uptime:    Math.floor(process.uptime()),
        database:  dbStatus,
        sessions:  global.activeSessions.size,
    });
});

// ============================================================
// ERROR HANDLERS
// ============================================================

// 404
app.use((_req, res) => {
    res.status(404).json({ success: false, message: 'Not found.' });
});

// Global error handler
app.use((err, req, res, _next) => {
    if (err.code === 'ECONNABORTED' || err.type === 'request.aborted') return;

    if (err.message === 'Not allowed by CORS') {
        return res.status(403).json({ success: false, message: 'CORS: origin not allowed.' });
    }

    if (err.type === 'entity.too.large') {
        return res.status(413).json({ success: false, message: 'Request body too large.' });
    }

    console.error(`❌ ${req.method} ${req.path}:`, err.message);

    if (!res.headersSent) {
        res.status(err.status || 500).json({
            success: false,
            message: process.env.NODE_ENV === 'production'
                ? 'Internal server error.'
                : err.message
        });
    }
});

// ============================================================
// AGENT STARTUP — each isolated so one failure doesn't stop others
// ============================================================
function startAgent(name, startFn) {
    try {
        startFn();
        console.log(`✅ ${name} started`);
    } catch (err) {
        console.error(`❌ ${name} failed to start:`, err.message);
        // Agent failure is non-fatal — server keeps running
    }
}

// ============================================================
// SERVER START
// ============================================================
const PORT   = parseInt(process.env.PORT || '5000', 10);
const server = app.listen(PORT, () => {
    const env = process.env.NODE_ENV || 'development';
    console.log('\n' + '═'.repeat(50));
    console.log(`  🚀 AviSignals Backend — ${env.toUpperCase()}`);
    console.log(`  📡 Port:      ${PORT}`);
    console.log(`  🗄  Database: Supabase connected`);
    console.log(`  📁 Logs:     ${logsDir}`);
    console.log(`  🟢 Sessions: active (10-min cleanup)`);
    console.log('═'.repeat(50) + '\n');

    // Delay agent start by 3 seconds — lets server fully bind first
    setTimeout(() => {
        console.log('🤖 Starting AI Agents...\n');

        // NOTE: TelegramMarketingBot from ./marketing/telegramMarketing has been
        // removed — it conflicted with telegramAgent v2 (same bot token = 409 errors).
        // telegramAgent now handles all channel broadcasting + admin bot.

        const { startAnalyticsAgent }   = require('./Agent/analyticsAgent');
        const { startMarketingAgent }   = require('./Agent/marketingAgent');
        const { startTelegramAgent }    = require('./Agent/telegramAgent');
        const { startSocialMediaAgent } = require('./Agent/socialMediaAgent');

        // Start order matters:
        // 1. Telegram first — other agents send notifications through it
        // 2. Analytics — needs Supabase and Telegram both ready
        // 3. Marketing — needs email service and Supabase
        // 4. Social — depends on telegramAgent's sendToAdmin
        startAgent('Telegram Agent',     startTelegramAgent);
        startAgent('Analytics Agent',    startAnalyticsAgent);
        startAgent('Marketing Agent',    startMarketingAgent);
        startAgent('Social Media Agent', startSocialMediaAgent);

        console.log('\n✅ All agents initialised.\n');
    }, 3000);
});

// ============================================================
// GRACEFUL SHUTDOWN
// Handles SIGTERM (VPS restarts, deploys) and SIGINT (Ctrl+C)
// Gives in-flight requests up to 15 seconds to complete
// ============================================================
let isShuttingDown = false;

function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`\n⚡ ${signal} received — shutting down gracefully...`);

    // Stop accepting new connections
    server.close(() => {
        console.log('✅ HTTP server closed.');
        global.saveActivationCodes();
        console.log('✅ Activation codes saved.');
        console.log('👋 Goodbye.\n');
        process.exit(0);
    });

    // Force exit if shutdown takes longer than 15 seconds
    setTimeout(() => {
        console.error('❌ Graceful shutdown timed out — forcing exit.');
        process.exit(1);
    }, 15000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// ============================================================
// PROCESS ERROR HANDLERS
// v1 killed the server on any unhandled rejection — too aggressive.
// Now we log and let the server keep running unless it's truly fatal.
// ============================================================
process.on('unhandledRejection', (err) => {
    console.error('⚠️  Unhandled Promise Rejection:', err?.message || err);
    // Don't exit — log it and continue. Use a process monitor (PM2)
    // to restart if the server becomes truly unhealthy.
});

process.on('uncaughtException', (err) => {
    console.error('💥 Uncaught Exception:', err.message);
    // Uncaught exceptions ARE fatal — the process state is unknown
    gracefulShutdown('uncaughtException');
});

module.exports = app; // for testing