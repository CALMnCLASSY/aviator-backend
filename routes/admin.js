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

/**
 * GET REFERRAL STATS
 * Aggregates clicks, signups, and purchases from logs and profiles
 */
router.get('/referrals', async (req, res) => {
    try {
        if (!req.supabaseAdmin) {
            return res.status(503).json({ success: false, error: 'Database admin client not available' });
        }

        // 1. Fetch all referral logs
        const { data: logs, error: logsError } = await req.supabaseAdmin
            .from('logs')
            .select('*')
            .like('event_type', 'referral_%')
            .order('created_at', { ascending: false });

        if (logsError) throw logsError;

        // 2. Fetch all referred users
        const { data: profiles, error: profilesError } = await req.supabaseAdmin
            .from('profiles')
            .select('id, email, phone, full_name, created_at, last_seen')
            .not('full_name', 'is', null)
            .order('created_at', { ascending: false });

        if (profilesError) throw profilesError;

        // 3. Process aggregations
        const referrers = {}; // Key: referrer code

        // Helper to initialize referrer object
        const initReferrer = (code) => {
            if (!referrers[code]) {
                referrers[code] = {
                    code,
                    clicks: 0,
                    submits: 0,
                    signups: 0,
                    purchases: 0,
                    revenue: 0,
                    users: []
                };
            }
        };

        // Populate from profiles (users)
        profiles.forEach(p => {
            const code = p.full_name.trim();
            if (!code) return;
            initReferrer(code);
            referrers[code].users.push({
                email: p.email || 'N/A',
                phone: p.phone || 'N/A',
                created_at: p.created_at,
                last_seen: p.last_seen
            });
            referrers[code].signups++; // Profile count is signups count
        });

        // Populate from logs (clicks, submits, purchases)
        logs.forEach(log => {
            const details = log.details || {};
            const code = (details.referrer || '').trim();
            if (!code) return;
            initReferrer(code);

            if (log.event_type === 'referral_click') {
                referrers[code].clicks++;
            } else if (log.event_type === 'referral_landing_submit') {
                referrers[code].submits++;
            } else if (log.event_type === 'referral_signup') {
                // Keep signups counts synchronized. If log says signup, but profile sync didn't complete, count it here.
                // We'll use the max of profile signups or log signups to be robust.
            } else if (log.event_type === 'referral_purchase') {
                referrers[code].purchases++;
                referrers[code].revenue += parseFloat(details.amount || 0);
            }
        });

        // Format final list and calculate rates
        const list = Object.values(referrers).map(r => {
            // Recalculate signup count as max between profile users length and logs signup count
            const logSignups = logs.filter(l => l.event_type === 'referral_signup' && (l.details?.referrer || '').trim() === r.code).length;
            r.signups = Math.max(r.signups, logSignups);

            const clickToSignup = r.clicks > 0 ? ((r.signups / r.clicks) * 100).toFixed(1) : '0.0';
            const signupToPurchase = r.signups > 0 ? ((r.purchases / r.signups) * 100).toFixed(1) : '0.0';

            return {
                code: r.code,
                clicks: r.clicks,
                submits: r.submits,
                signups: r.signups,
                purchases: r.purchases,
                revenue: parseFloat(r.revenue.toFixed(2)),
                clickToSignupRate: parseFloat(clickToSignup),
                signupToPurchaseRate: parseFloat(signupToPurchase),
                usersCount: r.users.length,
                recentUsers: r.users.slice(0, 10) // last 10 users
            };
        });

        // 4. Extract recent referral activities for the ledger
        const recentLogs = logs.slice(0, 20).map(log => ({
            id: log.id,
            eventType: log.event_type.replace('referral_', ''),
            referrer: log.details?.referrer || 'Unknown',
            user: log.details?.email || log.details?.contact || 'Anonymous',
            timestamp: log.created_at,
            amount: log.details?.amount || null,
            page: log.details?.page || null
        }));

        res.json({
            success: true,
            referrers: list,
            activities: recentLogs
        });

    } catch (err) {
        console.error('❌ Get Referrals Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
