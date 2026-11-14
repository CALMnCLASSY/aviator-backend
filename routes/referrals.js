const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
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

// ============================================================
// MARKETING TOOLS ASSET DISCOVERY
// The asset lists are built from whatever is actually on disk
// in marketing/ — so newly uploaded videos/images show up for
// agents automatically and deleted files never produce 404s.
// Curated titles/categories are kept as overrides by filename.
// ============================================================
const MARKETING_DIR = path.join(__dirname, '..', 'marketing');
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|svg)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov)$/i;

const IMAGE_META = {
    'marketingpic.jpg':  { name: 'Marketing Banner 1', category: 'General Promo' },
    'marketingpic2.jpg': { name: 'Marketing Banner 2', category: 'High Multiplier Win' },
    'marketingpic3.jpg': { name: 'Marketing Banner 3', category: 'AI Predictor Showcase' },
    'marketingpic4.jpg': { name: 'Marketing Banner 4', category: 'Live Proof & Results' },
    'marketingpic5.jpg': { name: 'Marketing Banner 5', category: 'Fast Cashout Alert' },
    'agentprogram.jpg':  { name: 'Agent Program Banner', category: 'Earn Money Promo' },
    'bothomepage.jpg':   { name: 'Bot Dashboard Preview', category: 'Platform Interface' },
    'getfreetrial.jpg':  { name: 'Free Trial Promo Card', category: 'Free Trial Hook' },
};

const VIDEO_META = {
    'howitworks.mp4':      { title: 'Full System Walkthrough', category: 'Tutorial', desc: 'Step-by-step guide on how the AI Predictor works' },
    'botrunning.mp4':      { title: 'Live Bot Prediction Engine', category: 'Live Demo', desc: 'Live demonstration of high odds prediction in real time' },
    'premiumchannel.mp4':  { title: 'VIP Premium Channel Signals', category: 'Live Demo', desc: 'Live video showing continuous VIP signal delivery' },
    'getfreecode.mp4':     { title: 'How to Get Free Trial Code', category: 'Tutorial', desc: 'Walkthrough on claiming 60-min free access' },
    '1winworks.mp4':       { title: '1Win Platform Walkthrough', category: 'Platform Tutorial', desc: 'Live test and cashout tutorial for 1Win Aviator' },
    'stakeworks.mp4':      { title: 'Stake Platform Walkthrough', category: 'Platform Tutorial', desc: 'Connecting to Stake Aviator with live predictions' },
    'sportybetworks.mp4':  { title: 'SportyBet Walkthrough', category: 'Platform Tutorial', desc: 'Live signal delivery on SportyBet Aviator' },
    'fulltutorial.mp4':    { title: 'Full Setup Tutorial', category: 'Tutorial', desc: 'Complete setup guide from signup to first prediction' },
    'freetrialvid.mp4':    { title: 'Free Trial Promo', category: 'Free Trial Hook', desc: 'Short promo explaining the 60-min free trial' },
    'botworking.mp4':      { title: 'Bot Working Live', category: 'Live Demo', desc: 'Real-time prediction demo' },
    'botworking2.mp4':     { title: 'Bot Working Live #2', category: 'Live Demo', desc: 'Real-time prediction demo' },
    'buycode.mp4':         { title: 'How to Buy a Code', category: 'Tutorial', desc: 'Purchase walkthrough for platform codes' },
    'buycode1w.mp4':       { title: 'Buy Code — 1Win', category: 'Tutorial', desc: 'Purchase walkthrough on 1Win' },
    'mozzartworks.mp4':    { title: 'MozzartBet Walkthrough', category: 'Platform Tutorial', desc: 'Live predictions on MozzartBet' },
    'hollywoodworks.mp4':  { title: 'Hollywoodbets Walkthrough', category: 'Platform Tutorial', desc: 'Live predictions on Hollywoodbets' },
    'marketingluckno.mp4': { title: 'Lucky Numbers Promo', category: 'Social Media Reel', desc: 'High energy TikTok / Reels format' },
};

function autoTitle(file, kind) {
    const base = file.replace(/\.[^.]+$/, '');
    const m = base.match(/^(\D+?)(\d+)$/);
    if (kind === 'video' && /^marketingvid/i.test(base)) {
        return `Viral Cashout Reel #${m ? m[2] : ''}`.replace(/ #$/, '');
    }
    if (kind === 'image' && /^marketingpic/i.test(base)) {
        return `Marketing Banner ${m ? m[2] : ''}`.trim();
    }
    return base.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function autoVideoCategory(file) {
    if (/^marketingvid|luckno/i.test(file)) return 'Social Media Reel';
    if (/works\.mp4$/i.test(file)) return 'Platform Tutorial';
    return 'General';
}

function autoImageCategory(file) {
    if (/shot|win|withdr|proof/i.test(file)) return 'Win Proof';
    if (/^marketingpic/i.test(file)) return 'General Promo';
    return 'General';
}

// 5-minute cache — the folder rarely changes
let marketingAssetsCache = { at: 0, images: null, videos: null };

function getMarketingAssets() {
    const now = Date.now();
    if (marketingAssetsCache.images && now - marketingAssetsCache.at < 5 * 60 * 1000) {
        return { images: marketingAssetsCache.images, videos: marketingAssetsCache.videos };
    }

    const baseUrl = (process.env.BASE_URL || 'https://back.avisignals.com').replace(/\/$/, '');
    const assetsUrl = `${baseUrl}/marketing-assets`;

    let videoFiles = [], imageFiles = [];
    try {
        videoFiles = fs.readdirSync(MARKETING_DIR).filter(f => VIDEO_EXT.test(f)).sort();
    } catch (_) {}
    try {
        imageFiles = fs.readdirSync(path.join(MARKETING_DIR, 'images')).filter(f => IMAGE_EXT.test(f)).sort();
    } catch (_) {}

    const videos = videoFiles.map((file, i) => {
        const meta = VIDEO_META[file] || {};
        const url = `${assetsUrl}/${encodeURIComponent(file)}`;
        return {
            id: (file.replace(/\.[^.]+$/, '') || `vid${i}`).toLowerCase(),
            title: meta.title || autoTitle(file, 'video'),
            file,
            category: meta.category || autoVideoCategory(file),
            url,
            downloadUrl: `${url}?download=1`,
            desc: meta.desc || 'Ready-to-share marketing video'
        };
    });

    const images = imageFiles.map((file, i) => {
        const meta = IMAGE_META[file] || {};
        const url = `${assetsUrl}/images/${encodeURIComponent(file)}`;
        return {
            id: (file.replace(/\.[^.]+$/, '') || `img${i}`).toLowerCase(),
            name: meta.name || autoTitle(file, 'image'),
            file,
            category: meta.category || autoImageCategory(file),
            url,
            downloadUrl: `${url}?download=1`
        };
    });

    marketingAssetsCache = { at: now, images, videos };
    return { images, videos };
}

/**
 * GET MARKETING TOOLS & ASSETS
 */
router.get('/marketing-tools', (req, res) => {
    const { images, videos } = getMarketingAssets();

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
