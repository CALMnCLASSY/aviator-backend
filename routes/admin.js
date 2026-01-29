const express = require('express');
const router = express.Router();

// Admin credentials (from user request)
const ADMIN_EMAIL = 'admin@cncavisignals.com';
const ADMIN_PASSWORD = 'thecnccompanybot';

// CORS middleware for admin routes
router.use((req, res, next) => {
    // Allow file:// access (origin: null) and all other origins
    const origin = req.headers.origin || 'null';
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');

    console.log(`Admin route accessed from origin: ${origin}`);

    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Admin Login
router.post('/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email and password required' });
    }

    if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
        return res.json({
            success: true,
            message: 'Login successful',
            token: 'admin-session-' + Date.now(), // Simple session token
            admin: { email: ADMIN_EMAIL }
        });
    }

    return res.status(401).json({ success: false, message: 'Invalid credentials' });
});

// Get Dashboard Stats
router.get('/stats', (req, res) => {
    // Calculate stats from globals
    const onlineUsers = global.activeSessions ? global.activeSessions.size : 0;

    let pendingCount = 0;

    // Count pending from all sources
    if (global.botPayments) {
        Object.values(global.botPayments).forEach(p => {
            if (p.status === 'pending_verification') pendingCount++;
        });
    }

    if (global.usdtPayments) {
        Object.values(global.usdtPayments).forEach(p => {
            if (p.status === 'pending_verification') pendingCount++;
        });
    }

    if (global.selarPayments) {
        Object.values(global.selarPayments).forEach(p => {
            if (p.status === 'pending_verification') pendingCount++;
        });
    }

    // Revenue mock (in real app, this would query DB)
    const todayRevenue = 0; // consistent with current in-memory structure

    res.json({
        success: true,
        stats: {
            onlineUsers,
            pendingVerifications: pendingCount,
            todayRevenue,
            todayActivations: 0 // Mock for now
        }
    });
});

// Get Pending Verifications (SIMPLIFIED - Only Bot Activations)
router.get('/pending-verifications', (req, res) => {
    console.log('📊 Admin panel requesting pending verifications');
    const pendingList = [];

    // Only Bot Payments (1-hour activations)
    try {
        if (global.botPayments) {
            console.log(`📦 Checking ${Object.keys(global.botPayments).length} bot payments`);
            Object.entries(global.botPayments).forEach(([orderId, payment]) => {
                console.log(`  - ${orderId}: status=${payment.status}`);
                if (payment.status === 'pending_verification') {
                    pendingList.push({
                        id: orderId,
                        type: 'bot_activation',
                        user: payment.customerInfo?.email || payment.customerInfo?.contact || 'Unknown',
                        amount: 'Free Trial / Bot Activation',
                        site: payment.customerInfo?.bettingSite || 'Aviator Bot',
                        timestamp: payment.createdAt || new Date(),
                        packageName: payment.customerInfo?.packageName || '1 Hour Trial',
                        duration: '1 hour',
                        raw: payment
                    });
                }
            });
        } else {
            console.log('⚠️ global.botPayments is not initialized');
        }
    } catch (e) {
        console.error('❌ Error fetching bot payments:', e);
    }

    // Sort by timestamp desc
    pendingList.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    console.log(`✅ Returning ${pendingList.length} pending verifications to admin panel`);
    res.json({
        success: true,
        count: pendingList.length,
        verifications: pendingList
    });
});

// Get Online Users
router.get('/online-users', (req, res) => {
    const users = [];

    if (global.activeSessions) {
        const now = Date.now();
        // Clean up expired sessions (older than 5 mins)
        for (const [key, session] of global.activeSessions.entries()) {
            if (now - session.lastSeen > 5 * 60 * 1000) {
                global.activeSessions.delete(key);
            } else {
                users.push({
                    id: key,
                    ...session,
                    status: 'online'
                });
            }
        }
    }

    res.json({
        success: true,
        count: users.length,
        users: users
    });
});

module.exports = router;
