const express = require('express');
const router = express.Router();

// Admin credentials (from user request)
const ADMIN_EMAIL = 'admin@cncavisignals.com';
const ADMIN_PASSWORD = 'thecnccompanybot';

// CORS middleware for admin routes
router.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

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
    if (global.botPayments) {
        Object.values(global.botPayments).forEach(p => {
            if (p.status === 'pending_verification') pendingCount++;
        });
    }
    // Also check other payment globals if needed

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

// Get Pending Verifications
router.get('/pending-verifications', (req, res) => {
    const pendingList = [];

    // 1. Bot Payments
    try {
        if (global.botPayments) {
            Object.values(global.botPayments).forEach(payment => {
                if (payment.status === 'pending_verification') {
                    pendingList.push({
                        id: payment.orderId,
                        type: 'bot_activation',
                        user: payment.customerInfo?.email || 'Unknown',
                        amount: 'Free Trial / Bot',
                        site: 'Aviator Bot',
                        timestamp: payment.createdAt,
                        raw: payment
                    });
                }
            });
        }
    } catch (e) { console.error('Error fetching bot payments', e); }

    // 2. USDT Payments
    try {
        if (global.usdtPayments) {
            Object.values(global.usdtPayments).forEach(payment => {
                if (payment.status === 'pending_verification') {
                    // Find key for this payment
                    const key = Object.keys(global.usdtPayments).find(k => global.usdtPayments[k] === payment);
                    pendingList.push({
                        id: key || 'unknown',
                        type: 'usdt',
                        user: payment.contact,
                        amount: `${payment.priceUsd} USDT`,
                        site: payment.siteName,
                        timestamp: payment.createdAt,
                        raw: payment
                    });
                }
            });
        }
    } catch (e) { console.error('Error fetching usdt payments', e); }

    // 3. Selar/Card Payments (if stored in global.selarPayments)
    try {
        if (global.selarPayments) {
            Object.values(global.selarPayments).forEach(payment => {
                if (payment.status === 'pending_verification') {
                    const key = Object.keys(global.selarPayments).find(k => global.selarPayments[k] === payment);
                    pendingList.push({
                        id: key || 'unknown',
                        type: 'selar',
                        user: payment.email,
                        amount: `${payment.amount} ${payment.currency}`,
                        site: payment.bettingSite,
                        timestamp: payment.createdAt,
                        raw: payment
                    });
                }
            });
        }
    } catch (e) { console.error('Error fetching selar payments', e); }

    // Sort by timestamp desc
    pendingList.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

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
