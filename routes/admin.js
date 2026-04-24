const express = require('express');
const router = express.Router();

// Admin credentials (maintained for simple backend access)
const ADMIN_EMAIL = 'admin@cncavisignals.com';
const ADMIN_PASSWORD = 'thecnccompanybot';

// CORS middleware for admin routes
router.use((req, res, next) => {
    const origin = req.headers.origin || 'null';
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// Admin Login
router.post('/login', (req, res) => {
    const { email, password } = req.body;
    if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
        return res.json({
            success: true,
            token: 'admin-session-' + Date.now(),
            admin: { email: ADMIN_EMAIL }
        });
    }
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
});

/**
 * GET DASHBOARD STATS
 * Queries Supabase for live metrics
 */
router.get('/stats', async (req, res) => {
    try {
        // 1. Total Users
        const { count: totalUsers } = await req.supabaseAdmin
            .from('profiles')
            .select('*', { count: 'exact', head: true });

        // 2. Pending Payments
        const { count: pendingPayments } = await req.supabaseAdmin
            .from('payments')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'pending');

        // 3. Activations Today
        const today = new Date();
        today.setHours(0,0,0,0);
        const { count: activationsToday } = await req.supabaseAdmin
            .from('activations')
            .select('*', { count: 'exact', head: true })
            .gte('activated_at', today.toISOString());

        // 4. Revenue Today (Verified Payments)
        const { data: paymentsToday } = await req.supabaseAdmin
            .from('payments')
            .select('amount')
            .eq('status', 'verified')
            .gte('created_at', today.toISOString());
        
        const revenueToday = paymentsToday.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);

        res.json({
            success: true,
            stats: {
                totalUsers: totalUsers || 0,
                pendingVerifications: pendingPayments || 0,
                todayRevenue: revenueToday,
                todayActivations: activationsToday || 0,
                onlineCount: await getOnlineCount(req.supabaseAdmin)
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

async function getOnlineCount(supabase) {
    if (!supabase) return 0;
    // Count users with active sessions (from global.activeSessions in app.js)
    // This reflects real-time online status from heartbeat pings
    const onlineCount = global.activeSessions ? global.activeSessions.size : 0;
    console.log(`👥 Online Users Count: ${onlineCount}`);
    return onlineCount;
}

/**
 * GET PENDING VERIFICATIONS
 */
router.get('/pending-verifications', async (req, res) => {
    try {
        const { data, error } = await req.supabaseAdmin
            .from('payments')
            .select('*, profiles(email, phone)')
            .eq('status', 'pending')
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.json({
            success: true,
            count: data.length,
            verifications: data.map(p => ({
                id: p.reference,
                user: p.profiles?.email || 'Unknown',
                phone: p.profiles?.phone || 'N/A',
                amount: `${p.amount} ${p.currency}`,
                timestamp: p.created_at,
                status: p.status,
                raw: p
            }))
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * CLEAR EXPIRED VERIFICATIONS
 * Deletes or marks as rejected all pending payments older than 24 hours
 */
router.post('/clear-expired-verifications', async (req, res) => {
    try {
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        
        const { data, error } = await req.supabaseAdmin
            .from('payments')
            .delete() // or .update({ status: 'rejected' })
            .eq('status', 'pending')
            .lt('created_at', yesterday)
            .select();

        if (error) throw error;

        res.json({ success: true, message: `Cleared ${data.length} expired verifications`, count: data.length });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET ALL USERS
 */
router.get('/users', async (req, res) => {
    try {
        const { data, error } = await req.supabaseAdmin
            .from('profiles')
            .select('*, activations(count), payments(count)')
            .order('last_seen', { ascending: false, nullsFirst: false });

        if (error) throw error;
        res.json({ success: true, count: data.length, users: data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Keep activation code rotation logic (as requested to maintain platform flow)
router.get('/activation-codes', (req, res) => {
    res.json({ success: true, codes: global.activationCodes || {} });
});

router.post('/rotate-activation-codes', (req, res) => {
    const newCodes = {};
    
    // Rotate Daily Codes for all default sites
    global.defaultSites.forEach(s => {
        newCodes[s] = { daily: global.generateActivationCode() };
    });
    
    // Add/Rotate Free Trial codes for whitelisted sites
    global.freeTrialWhitelistedSites.forEach(s => {
        if (!newCodes[s]) {
            newCodes[s] = { daily: global.generateActivationCode() };
        }
        newCodes[s].freeTrial = global.generateActivationCode();
    });

    global.activationCodes = newCodes;
    global.saveActivationCodes();

    res.json({ success: true, codes: newCodes });
});

/**
 * GET ALL ACTIVATIONS
 */
router.get('/activations', async (req, res) => {
    try {
        const { data, error } = await req.supabaseAdmin
            .from('activations')
            .select('*, profiles(email, phone)')
            .order('activated_at', { ascending: false })
            .limit(50);

        if (error) throw error;
        res.json({ success: true, count: data.length, activations: data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET CHAT SUMMARIES
 */
router.get('/chat-summaries', async (req, res) => {
    try {
        const { data, error } = await req.supabaseAdmin
            .from('logs')
            .select('*')
            .eq('event_type', 'chat_summary')
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) throw error;
        res.json({ success: true, count: data.length, summaries: data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
