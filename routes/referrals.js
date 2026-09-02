const express = require('express');
const fetch = require('node-fetch');
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
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

/**
 * REGISTER NEW REFERRAL AGENT
 */
router.post('/register-agent', async (req, res) => {
    try {
        const { code, name, contact } = req.body;
        if (!code || !code.trim()) {
            return res.status(400).json({ success: false, error: 'Agent referral code is required' });
        }

        // Clean and sanitize code (allow letters, numbers, underscores, hyphens, min 3 chars)
        const cleanCode = code.trim().replace(/[^a-zA-Z0-9_\-]/g, '').toLowerCase();
        if (cleanCode.length < 3) {
            return res.status(400).json({ success: false, error: 'Referral code must be at least 3 alphanumeric characters.' });
        }

        const agentName = (name || cleanCode).trim();
        const agentContact = (contact || '—').trim();

        if (req.supabaseAdmin) {
            try {
                await req.supabaseAdmin
                    .from('logs')
                    .insert([{
                        event_type: 'referral_agent_registered',
                        details: {
                            referrer: cleanCode,
                            name: agentName,
                            contact: agentContact,
                            ip: req.ip || 'Unknown',
                            timestamp: new Date().toISOString()
                        }
                    }]);
            } catch (dbErr) {
                console.warn('⚠️ Agent registration log error:', dbErr.message);
            }
        }

        res.json({
            success: true,
            message: 'Agent registered successfully',
            code: cleanCode,
            link: `https://avisignals.com/?ref=${cleanCode}`
        });

    } catch (err) {
        console.error('❌ Register Agent error:', err.message);
        res.status(500).json({ success: false, error: 'Server error during agent registration' });
    }
});

/**
 * TRACK REFERRAL LINK CLICK
 */
router.post('/track-click', async (req, res) => {
    try {
        const { code, page } = req.body;
        if (!code) {
            return res.status(400).json({ success: false, error: 'Referrer code is required' });
        }

        const agentCode = code.trim().toLowerCase();

        if (req.supabaseAdmin) {
            try {
                await req.supabaseAdmin
                    .from('logs')
                    .insert([{
                        event_type: 'referral_click',
                        details: {
                            referrer: agentCode,
                            page: page || 'home',
                            ip: req.ip || 'Unknown',
                            userAgent: req.headers['user-agent'] || 'Unknown',
                            timestamp: new Date().toISOString()
                        }
                    }]);
            } catch (dbErr) {
                console.warn('⚠️ Referral click log error:', dbErr.message);
            }
        }

        res.json({ success: true, message: 'Click tracked' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET MARKETING TOOLS & ASSETS
 */
router.get('/marketing-tools', (req, res) => {
    const baseUrl = process.env.BASE_URL?.replace(/\/$/, '') || 'https://back.avisignals.com';
    const assetsUrl = `${baseUrl}/marketing-assets`;

    const images = [
        { id: 'pic1', name: 'Marketing Banner 1', file: 'marketingpic.jpg', category: 'General Promo', url: `${assetsUrl}/images/marketingpic.jpg` },
        { id: 'pic2', name: 'Marketing Banner 2', file: 'marketingpic2.jpg', category: 'High Multiplier Win', url: `${assetsUrl}/images/marketingpic2.jpg` },
        { id: 'pic3', name: 'Marketing Banner 3', file: 'marketingpic3.jpg', category: 'AI Predictor Showcase', url: `${assetsUrl}/images/marketingpic3.jpg` },
        { id: 'pic4', name: 'Marketing Banner 4', file: 'marketingpic4.jpg', category: 'Live Proof & Results', url: `${assetsUrl}/images/marketingpic4.jpg` },
        { id: 'pic5', name: 'Marketing Banner 5', file: 'marketingpic5.jpg', category: 'Fast Cashout Alert', url: `${assetsUrl}/images/marketingpic5.jpg` },
        { id: 'agentprog', name: 'Agent Program Banner', file: 'agentprogram.jpg', category: 'Earn Money Promo', url: `${assetsUrl}/images/agentprogram.jpg` },
        { id: 'bothome', name: 'Bot Dashboard Preview', file: 'bothomepage.jpg', category: 'Platform Interface', url: `${assetsUrl}/images/bothomepage.jpg` },
        { id: 'freetrial', name: 'Free Trial Promo Card', file: 'getfreetrial.jpg', category: 'Free Trial Hook', url: `${assetsUrl}/images/getfreetrial.jpg` }
    ];

    const videos = [
        { id: 'howitworks', title: 'Full System Walkthrough', file: 'howitworks.mp4', category: 'Tutorial', url: `${assetsUrl}/howitworks.mp4`, desc: 'Step-by-step guide on how the AI Predictor works' },
        { id: 'botrunning', title: 'Live Bot Prediction Engine', file: 'botrunning.mp4', category: 'Live Demo', url: `${assetsUrl}/botrunning.mp4`, desc: 'Live demonstration of high odds prediction in real time' },
        { id: 'premiumchannel', title: 'VIP Premium Channel Signals', file: 'premiumchannel.mp4', category: 'Live Demo', url: `${assetsUrl}/premiumchannel.mp4`, desc: 'Live video showing continuous VIP signal delivery' },
        { id: 'getfreecode', title: 'How to Get Free Trial Code', file: 'getfreecode.mp4', category: 'Tutorial', url: `${assetsUrl}/getfreecode.mp4`, desc: 'Walkthrough on claiming 60-min free access' },
        { id: 'betika', title: 'Betika Platform Walkthrough', file: 'betikaworks.mp4', category: 'Platform Tutorial', url: `${assetsUrl}/betikaworks.mp4`, desc: 'How to predict rounds accurately on Betika' },
        { id: '1win', title: '1Win Platform Walkthrough', file: '1winworks.mp4', category: 'Platform Tutorial', url: `${assetsUrl}/1winworks.mp4`, desc: 'Live test and cashout tutorial for 1Win Aviator' },
        { id: 'stake', title: 'Stake Platform Walkthrough', file: 'stakeworks.mp4', category: 'Platform Tutorial', url: `${assetsUrl}/stakeworks.mp4`, desc: 'Connecting to Stake Aviator with live predictions' },
        { id: 'sportybet', title: 'SportyBet Walkthrough', file: 'sportybetworks.mp4', category: 'Platform Tutorial', url: `${assetsUrl}/sportybetworks.mp4`, desc: 'Live signal delivery on SportyBet Aviator' },
        { id: 'vid2', title: 'Viral Cashout Reel #2', file: 'marketingvid2.mp4', category: 'Social Media Reel', url: `${assetsUrl}/marketingvid2.mp4`, desc: 'High energy TikTok / Reels format' },
        { id: 'vid3', title: 'Viral Cashout Reel #3', file: 'marketingvid3.mp4', category: 'Social Media Reel', url: `${assetsUrl}/marketingvid3.mp4`, desc: 'High energy TikTok / Reels format' },
        { id: 'vid4', title: 'Viral Cashout Reel #4', file: 'marketingvid4.mp4', category: 'Social Media Reel', url: `${assetsUrl}/marketingvid4.mp4`, desc: 'High energy TikTok / Reels format' },
        { id: 'vid5', title: 'Viral Cashout Reel #5', file: 'marketingvid5.mp4', category: 'Social Media Reel', url: `${assetsUrl}/marketingvid5.mp4`, desc: 'High energy TikTok / Reels format' },
        { id: 'vid6', title: 'Viral Cashout Reel #6', file: 'marketingvid6.mp4', category: 'Social Media Reel', url: `${assetsUrl}/marketingvid6.mp4`, desc: 'High energy TikTok / Reels format' },
        { id: 'vid7', title: 'Viral Cashout Reel #7', file: 'marketingvid7.mp4', category: 'Social Media Reel', url: `${assetsUrl}/marketingvid7.mp4`, desc: 'High energy TikTok / Reels format' },
        { id: 'vid8', title: 'Viral Cashout Reel #8', file: 'marketingvid8.mp4', category: 'Social Media Reel', url: `${assetsUrl}/marketingvid8.mp4`, desc: 'High energy TikTok / Reels format' },
        { id: 'vid9', title: 'Viral Cashout Reel #9', file: 'marketingvid9.mp4', category: 'Social Media Reel', url: `${assetsUrl}/marketingvid9.mp4`, desc: 'High energy TikTok / Reels format' },
        { id: 'vid10', title: 'Viral Cashout Reel #10', file: 'marketingvid10.mp4.mp4', category: 'Social Media Reel', url: `${assetsUrl}/marketingvid10.mp4.mp4`, desc: 'High energy TikTok / Reels format' },
        { id: 'vid11', title: 'Viral Cashout Reel #11', file: 'marketingvid11.mp4', category: 'Social Media Reel', url: `${assetsUrl}/marketingvid11.mp4`, desc: 'High energy TikTok / Reels format' },
        { id: 'vid12', title: 'Viral Cashout Reel #12', file: 'marketingvid12.mp4', category: 'Social Media Reel', url: `${assetsUrl}/marketingvid12.mp4`, desc: 'High energy TikTok / Reels format' },
        { id: 'vid13', title: 'Viral Cashout Reel #13', file: 'marketingvid13.mp4', category: 'Social Media Reel', url: `${assetsUrl}/marketingvid13.mp4`, desc: 'High energy TikTok / Reels format' },
        { id: 'vid14', title: 'Viral Cashout Reel #14', file: 'marketingvid14.mp4', category: 'Social Media Reel', url: `${assetsUrl}/marketingvid14.mp4`, desc: 'High energy TikTok / Reels format' },
        { id: 'vid15', title: 'Viral Cashout Reel #15', file: 'marketingvid15.mp4', category: 'Social Media Reel', url: `${assetsUrl}/marketingvid15.mp4`, desc: 'High energy TikTok / Reels format' },
        { id: 'vid16', title: 'Viral Cashout Reel #16', file: 'marketingvid16.mp4', category: 'Social Media Reel', url: `${assetsUrl}/marketingvid16.mp4`, desc: 'High energy TikTok / Reels format' },
        { id: 'vid17', title: 'Viral Cashout Reel #17', file: 'marketingvid17.mp4', category: 'Social Media Reel', url: `${assetsUrl}/marketingvid17.mp4`, desc: 'High energy TikTok / Reels format' },
        { id: 'vid18', title: 'Viral Cashout Reel #18', file: 'marketingvid18.mp4', category: 'Social Media Reel', url: `${assetsUrl}/marketingvid18.mp4`, desc: 'High energy TikTok / Reels format' },
        { id: 'vid19', title: 'Viral Cashout Reel #19', file: 'marketingvid19.mp4', category: 'Social Media Reel', url: `${assetsUrl}/marketingvid19.mp4`, desc: 'High energy TikTok / Reels format' },
        { id: 'vid20', title: 'Viral Cashout Reel #20', file: 'marketingvid20.mp4', category: 'Social Media Reel', url: `${assetsUrl}/marketingvid20.mp4`, desc: 'High energy TikTok / Reels format' }
    ];

    const copywritingTemplates = [
        {
            title: "🔥 High Converting TikTok / Reel Caption",
            channel: "TikTok / Instagram Reels",
            text: "Stop losing on Aviator! 🛑✈️ This AI bot accurately predicts the cash-out round before the plane flies away. Tested on 1Win, Betika & Stake! 🚀\n\n🎁 Test the FREE TRIAL here:\n{{LINK}}\n\n#AviatorSignals #AviatorPredictor #MakeMoneyOnline #CrashGame #BettingTips"
        },
        {
            title: "💬 WhatsApp / Telegram Status Broadcast",
            channel: "WhatsApp & Telegram Groups",
            text: "Guys, if you play Aviator, you NEED to try this AI Predictor bot. 🎯 It tells you exact multipliers and cashout seconds. 📈\n\nThey offer a 60-Minute 100% Free Trial so you can verify the accuracy yourself!\n\n👉 Grab your free trial code here:\n{{LINK}}"
        },
        {
            title: "🚀 Direct Message to Gamblers & Friends",
            channel: "Direct Chat",
            text: "Bro, check out this Aviator bot: {{LINK}}\nIt predicts when the plane crashes with crazy accuracy. You can test it for free with their 60-min trial code before paying anything. Let me know what multiplier you hit! 💸"
        }
    ];

    res.json({
        success: true,
        images,
        videos,
        copywritingTemplates
    });
});

/**
 * INITIATE AGENT WITHDRAWAL (USDT TRC-20)
 */
router.post('/request-withdrawal', async (req, res) => {
    try {
        const { code, amount, walletAddress, contact } = req.body;

        if (!code || !amount || !walletAddress) {
            return res.status(400).json({
                success: false,
                error: 'Agent code, withdrawal amount, and TRC-20 wallet address are required.'
            });
        }

        const agentCode = code.trim().toLowerCase();
        const withdrawAmount = parseFloat(amount);

        if (isNaN(withdrawAmount) || withdrawAmount < 10) {
            return res.status(400).json({
                success: false,
                error: 'Minimum withdrawal amount is $10.00 USDT.'
            });
        }

        const cleanAddress = walletAddress.trim();
        if (!cleanAddress.startsWith('T') || cleanAddress.length !== 34) {
            return res.status(400).json({
                success: false,
                error: 'Please enter a valid USDT TRC-20 wallet address (must start with T and be exactly 34 characters).'
            });
        }

        // 1. Calculate agent's earnings & already requested withdrawals to verify balance
        let totalRevenue = 0;
        let totalWithdrawn = 0;

        if (req.supabaseAdmin) {
            const { data: logs } = await req.supabaseAdmin
                .from('logs')
                .select('*')
                .like('event_type', 'referral_%');

            if (logs) {
                logs.forEach(log => {
                    const details = log.details || {};
                    if ((details.referrer || '').trim().toLowerCase() === agentCode) {
                        if (log.event_type === 'referral_purchase') {
                            totalRevenue += parseFloat(details.amount || 0);
                        } else if (log.event_type === 'referral_withdrawal_request' && details.status !== 'rejected') {
                            totalWithdrawn += parseFloat(details.amount || 0);
                        }
                    }
                });
            }
        }

        const earnedCommission = totalRevenue * 0.30;
        const availableBalance = Math.max(0, earnedCommission - totalWithdrawn);

        // If agent has recorded sales, check balance
        if (earnedCommission > 0 && withdrawAmount > (availableBalance + 0.01)) {
            return res.status(400).json({
                success: false,
                error: `Requested amount ($${withdrawAmount.toFixed(2)}) exceeds your available commission balance ($${availableBalance.toFixed(2)}).`
            });
        }

        const withdrawalRecord = {
            referrer: agentCode,
            amount: withdrawAmount,
            walletAddress: cleanAddress,
            network: 'USDT (TRC-20)',
            contact: contact || '—',
            status: 'pending',
            ip: req.ip || 'Unknown',
            timestamp: new Date().toISOString()
        };

        // 2. Save log to database
        if (req.supabaseAdmin) {
            try {
                await req.supabaseAdmin
                    .from('logs')
                    .insert([{
                        event_type: 'referral_withdrawal_request',
                        details: withdrawalRecord
                    }]);
            } catch (dbErr) {
                console.warn('⚠️ Withdrawal log error:', dbErr.message);
            }
        }

        // 3. Send Telegram Alert to Admin
        const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
        const telegramChatId = process.env.TELEGRAM_CHAT_ID;

        if (telegramBotToken && telegramChatId) {
            const telegramMessage = `💸 <b>AGENT WITHDRAWAL REQUEST (USDT TRC-20)</b>\n\n` +
                `👤 <b>Agent Code:</b> <code>${agentCode}</code>\n` +
                `💰 <b>Amount:</b> <b>$${withdrawAmount.toFixed(2)} USDT</b>\n` +
                `🌐 <b>Network:</b> USDT (TRC-20)\n` +
                `📬 <b>Wallet Address:</b>\n<code>${cleanAddress}</code>\n\n` +
                `📞 <b>Agent Contact:</b> ${contact || 'Not provided'}\n` +
                `📊 <b>Gross Sales Volume:</b> $${totalRevenue.toFixed(2)}\n` +
                `💎 <b>Total 30% Earned:</b> $${earnedCommission.toFixed(2)}\n` +
                `📍 <b>IP:</b> ${req.ip || 'Unknown'}\n` +
                `⏰ <b>Requested At:</b> ${new Date().toLocaleString()}\n\n` +
                `⚠️ <i>Please process manually to the TRC-20 address above.</i>`;

            try {
                await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: telegramChatId,
                        text: telegramMessage,
                        parse_mode: 'HTML'
                    })
                });
                console.log(`✅ Withdrawal request sent to Admin Telegram for agent ${agentCode}`);
            } catch (tgErr) {
                console.error('❌ Failed to send Telegram withdrawal alert:', tgErr.message);
            }
        }

        res.json({
            success: true,
            message: 'Withdrawal request submitted successfully! Admin will process your USDT TRC-20 payout shortly.',
            withdrawal: withdrawalRecord
        });

    } catch (err) {
        console.error('❌ Withdrawal request error:', err.message);
        res.status(500).json({
            success: false,
            error: 'Server error while processing withdrawal request.'
        });
    }
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

        const agentCode = code.trim().toLowerCase();

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
            return (details.referrer || '').trim().toLowerCase() === agentCode;
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
        let withdrawn = 0;

        agentLogs.forEach(log => {
            if (log.event_type === 'referral_click') {
                clicks++;
            } else if (log.event_type === 'referral_landing_submit') {
                submits++;
            } else if (log.event_type === 'referral_purchase') {
                purchases++;
                revenue += parseFloat(log.details?.amount || 0);
            } else if (log.event_type === 'referral_withdrawal_request') {
                if (log.details?.status !== 'rejected') {
                    withdrawn += parseFloat(log.details?.amount || 0);
                }
            }
        });

        // Make sure signup count reflects any log registration triggers too
        const logSignups = agentLogs.filter(l => l.event_type === 'referral_signup').length;
        signups = Math.max(signups, logSignups);

        const earnedCommission = parseFloat((revenue * 0.30).toFixed(2));
        const availableBalance = parseFloat(Math.max(0, earnedCommission - withdrawn).toFixed(2));

        // Calculate rates
        const clickToSignupRate = clicks > 0 ? parseFloat(((signups / clicks) * 100).toFixed(1)) : 0;
        const signupToPurchaseRate = signups > 0 ? parseFloat(((purchases / signups) * 100).toFixed(1)) : 0;

        // 4. Extract recent activities for the promoter ledger (masking emails/phones)
        const recentActivities = agentLogs.slice(0, 30).map(log => {
            const rawUser = log.details?.email || log.details?.contact || log.details?.walletAddress || 'Anonymous';
            return {
                id: log.id,
                eventType: log.event_type.replace('referral_', ''),
                user: maskContact(rawUser),
                timestamp: log.created_at,
                amount: log.details?.amount || null,
                status: log.details?.status || null,
                walletAddress: log.details?.walletAddress ? `${log.details.walletAddress.substring(0, 6)}...${log.details.walletAddress.substring(log.details.walletAddress.length - 4)}` : null,
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
                earnedCommission,
                withdrawn: parseFloat(withdrawn.toFixed(2)),
                availableBalance,
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
