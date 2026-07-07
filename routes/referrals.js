const express = require('express');
const router = express.Router();

// Mask emails and phone numbers for promoter privacy
function maskContact(contact) {
    if (!contact || contact === '—' || contact === 'Unknown' || contact === 'Anonymous') return contact;
    const trimmed = String(contact).trim();
    if (trimmed.includes('@')) {
        const [prefix, domain] = trimmed.split('@');
        if (prefix.length <= 2) return `${prefix}***@${domain}`;
        return `${prefix.substring(0, 2)}***@${domain}`;
    } else {
        // Remove spaces and non-digit characters for safety, but keep +
        const clean = trimmed.replace(/[^\d\+]/g, '');
        if (clean.length <= 5) return '***';
        return `${clean.substring(0, 4)}***${clean.substring(clean.length - 3)}`;
    }
}

// CORS middleware for referrals routes
router.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

/**
 * GET AGENT STATS
 * Aggregates and returns statistics for a single referral agent code
 */
router.get('/agent/:code', async (req, res) => {
    try {
        const { code } = req.params;
        if (!code) {
            return res.status(400).json({ success: false, error: 'Referrer code is required' });
        }

        const agentCode = code.trim();

        if (!req.supabaseAdmin) {
            return res.status(503).json({ success: false, error: 'Database admin client not available' });
        }

        // 1. Fetch referral logs matching this referrer code
        const { data: logs, error: logsError } = await req.supabaseAdmin
            .from('logs')
            .select('*')
            .like('event_type', 'referral_%')
            .order('created_at', { ascending: false });

        if (logsError) throw logsError;

        // Filter logs specifically belonging to this promoter code
        const agentLogs = logs.filter(log => {
            const details = log.details || {};
            return (details.referrer || '').trim().toLowerCase() === agentCode.toLowerCase();
        });

        // 2. Fetch referred users from profiles
        const { data: profiles, error: profilesError } = await req.supabaseAdmin
            .from('profiles')
            .select('id, email, phone, created_at, last_seen, full_name')
            .eq('full_name', agentCode)
            .order('created_at', { ascending: false });

        if (profilesError) throw profilesError;

        // 3. Aggregate statistics
        let clicks = 0;
        let submits = 0;
        let signups = profiles.length; // Count from direct profiles
        let purchases = 0;
        let revenue = 0;

        agentLogs.forEach(log => {
            if (log.event_type === 'referral_click') {
                clicks++;
            } else if (log.event_type === 'referral_landing_submit') {
                submits++;
            } else if (log.event_type === 'referral_purchase') {
                purchases++;
                revenue += parseFloat(log.details?.amount || 0);
            }
        });

        // Make sure signup count reflects any log registration triggers too
        const logSignups = agentLogs.filter(l => l.event_type === 'referral_signup').length;
        signups = Math.max(signups, logSignups);

        // Calculate rates
        const clickToSignupRate = clicks > 0 ? parseFloat(((signups / clicks) * 100).toFixed(1)) : 0;
        const signupToPurchaseRate = signups > 0 ? parseFloat(((purchases / signups) * 100).toFixed(1)) : 0;

        // 4. Extract recent activities for the promoter ledger (masking emails/phones)
        const recentActivities = agentLogs.slice(0, 15).map(log => {
            const rawUser = log.details?.email || log.details?.contact || 'Anonymous';
            return {
                id: log.id,
                eventType: log.event_type.replace('referral_', ''),
                user: maskContact(rawUser),
                timestamp: log.created_at,
                amount: log.details?.amount || null,
                page: log.details?.page || null
            };
        });

        res.json({
            success: true,
            stats: {
                code: agentCode,
                clicks,
                submits,
                signups,
                purchases,
                revenue: parseFloat(revenue.toFixed(2)),
                clickToSignupRate,
                signupToPurchaseRate
            },
            activities: recentActivities
        });

    } catch (err) {
        console.error(`❌ Get Agent referrals error for ${req.params.code}:`, err.message);
        res.status(500).json({ success: false, error: 'Failed to query referral data' });
    }
});

module.exports = router;
