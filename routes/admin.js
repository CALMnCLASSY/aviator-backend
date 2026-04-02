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
        const { count: totalUsers } = await req.supabase
            .from('profiles')
            .select('*', { count: 'exact', head: true });

        // 2. Pending Payments
        const { count: pendingPayments } = await req.supabase
            .from('payments')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'pending');

        // 3. Activations Today
        const today = new Date();
        today.setHours(0,0,0,0);
        const { count: activationsToday } = await req.supabase
            .from('activations')
            .select('*', { count: 'exact', head: true })
            .gte('activated_at', today.toISOString());

        // 4. Revenue Today (Verified Payments)
        const { data: paymentsToday } = await req.supabase
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
                onlineCount: await getOnlineCount(req.supabase)
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

async function getOnlineCount(supabase) {
    if (!supabase) return 0;
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const { count } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .gte('last_seen', fiveMinutesAgo.toISOString());
    return count || 0;
}

/**
 * GET PENDING VERIFICATIONS
 */
router.get('/pending-verifications', async (req, res) => {
    try {
        const { data, error } = await req.supabase
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
 * GET ALL USERS
 */
router.get('/users', async (req, res) => {
    try {
        const { data, error } = await req.supabase
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
    const fs = require('fs');
    const path = require('path');
    
    function generateCode() { return Math.random().toString(36).substring(2, 8).toUpperCase(); }
    const sites = ['SportyBet', '1xBet', 'Betika', 'Betway', 'Parimatch', 'BangBet', 'Bet365', 'OdiBets', 'Helabet', 'MozzartBet', 'Aviator', 'Other', 'ClassyBet', '1Win'];
    
    const newCodes = {};
    sites.forEach(s => {
        newCodes[s] = { daily: generateCode() };
        if (s === 'ClassyBet' || s === '1Win') newCodes[s].freeTrial = generateCode();
    });

    global.activationCodes = newCodes;
    fs.writeFileSync(path.join(__dirname, '..', 'activation_codes.json'), JSON.stringify(newCodes, null, 2));

    res.json({ success: true, codes: newCodes });
});

/**
 * GET ALL ACTIVATIONS
 */
router.get('/activations', async (req, res) => {
    try {
        const { data, error } = await req.supabase
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
        const { data, error } = await req.supabase
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
