// ============================================================
// analyticsAgent.js — AviSignals AI Analytics Agent v2
// 
// What this does vs the old version:
//   OLD: Ran once/day, used fake random numbers, thin AI prompt
//   NEW: Runs every hour with real Supabase data, deep business
//        context, 4 report types, and actionable growth advice
// ============================================================

'use strict';

const cron = require('node-cron');
const https = require('https');
const groq = require('./groqClient');
const { createClient } = require('@supabase/supabase-js');

// ─── Supabase (using Service Role for full analytics access) ──
const supabase = createClient(
    (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, ''),
    (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
);

// ─── Telegram ────────────────────────────────────────────────
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// ─── Business constants (Nairobi Time / UTC+3) ───────────────
const BUSINESS_CONTEXT = {
    name: 'AviSignals',
    product: 'Aviator game prediction bot',
    market: 'Global',
    freeCodePrice: 0,
    paidCodePrice: 75,      // USD — 24-hour activation
    currency: 'User Specific',
    conversionGoal: 0.15,    // target: 15% of signups convert to paid
    dailySignupGoal: 20,
    monthlyRevenueGoal: 5000, // USD
    primaryChannel: 'Telegram + WhatsApp',
};

// ─── Telegram sender with retry ──────────────────────────────
function sendToTelegram(message, retries = 3) {
    return new Promise((resolve, reject) => {
        if (!BOT_TOKEN || !CHAT_ID) {
            console.warn('⚠️  Telegram credentials missing — logging to console instead.');
            console.log('\n--- ANALYTICS REPORT ---\n', message, '\n---\n');
            return resolve();
        }

        // Telegram has a 4096 char limit per message
        const chunks = splitMessage(message, 4000);

        const sendChunk = async (index) => {
            if (index >= chunks.length) return resolve();

            const data = JSON.stringify({
                chat_id: CHAT_ID,
                text: chunks[index],
                parse_mode: 'Markdown'
            });

            const options = {
                hostname: 'api.telegram.org',
                path: `/bot${BOT_TOKEN}/sendMessage`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data)
                }
            };

            const req = https.request(options, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        sendChunk(index + 1);
                    } else if (res.statusCode === 429 && retries > 0) {
                        const wait = JSON.parse(body)?.parameters?.retry_after ?? 5;
                        console.warn(`⏳ Telegram rate limit — retrying in ${wait}s`);
                        setTimeout(() => sendToTelegram(message, retries - 1).then(resolve).catch(reject), wait * 1000);
                    } else if (res.statusCode === 400 && retries > 0) {
                        // Fallback to plain text if Markdown fails
                        console.warn('⚠️ Telegram Markdown failed — falling back to plain text');
                        const plainData = JSON.stringify({
                            chat_id: CHAT_ID,
                            text: chunks[index]
                        });
                        const plainOptions = { ...options, headers: { ...options.headers, 'Content-Length': Buffer.byteLength(plainData) } };
                        const plainReq = https.request(plainOptions, (r) => resolve());
                        plainReq.write(plainData);
                        plainReq.end();
                    } else {
                        console.error(`❌ Telegram error ${res.statusCode}:`, body);
                        resolve();
                    }
                });
            });

            req.on('error', (e) => {
                console.error('❌ Telegram request error:', e.message);
                resolve();
            });

            req.write(data);
            req.end();
        };

        sendChunk(0);
    });
}

function splitMessage(text, maxLen) {
    const chunks = [];
    let i = 0;
    while (i < text.length) {
        chunks.push(text.slice(i, i + maxLen));
        i += maxLen;
    }
    return chunks;
}

// ============================================================
// DATA LAYER — pulls real metrics from Supabase
// ============================================================

async function fetchMetrics() {
    const now = new Date();
    const hourAgo = new Date(now - 60 * 60 * 1000).toISOString();
    const todayStart = new Date(now.setHours(0, 0, 0, 0)).toISOString();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Run parallel queries
    const [
        signupsToday,
        signupsLastHour,
        signupsThisWeek,
        paymentsToday,
        paymentsThisWeek,
        activeSubscriptions,
        expiringSoon,
        abandonedUsers,
        recentChats,
    ] = await Promise.allSettled([

        // New signups today
        supabase.from('profiles')
            .select('id, email, created_at', { count: 'exact', head: false })
            .gte('created_at', todayStart),

        // New signups in last hour
        supabase.from('profiles')
            .select('id', { count: 'exact', head: true })
            .gte('created_at', hourAgo),

        // Signups this week
        supabase.from('profiles')
            .select('id', { count: 'exact', head: true })
            .gte('created_at', weekAgo),

        // Payments today
        supabase.from('payments')
            .select('amount, currency, method', { count: 'exact', head: false })
            .gte('created_at', todayStart)
            .eq('status', 'success'),

        // Payments this week
        supabase.from('payments')
            .select('amount', { count: 'exact', head: false })
            .gte('created_at', weekAgo)
            .eq('status', 'success'),

        // Active activations right now (within last 24h)
        supabase.from('activations')
            .select('code_type, site', { count: 'exact', head: false })
            .gte('activated_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),

        // Activations expiring in next 24 hours (for those activated > 23h ago)
        supabase.from('activations')
            .select('user_id, activated_at', { count: 'exact', head: false })
            .gte('activated_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
            .lte('activated_at', new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString()),

        // Users who signed up this week but never paid
        supabase.from('profiles')
            .select('id', { count: 'exact', head: true })
            .gte('created_at', weekAgo),

        // Support chats in last hour
        supabase.from('support_chats')
            .select('session_id, sender', { count: 'exact', head: false })
            .gte('created_at', hourAgo)
    ]);

    const val = (r) => r.status === 'fulfilled' ? r.value : { data: null, count: 0, error: r.reason };

    // ── Process payments ───────────────────────────────────────
    const todayPaymentRows = val(paymentsToday).data ?? [];
    const weekPaymentRows = val(paymentsThisWeek).data ?? [];
    const todayRevenue = todayPaymentRows.reduce((s, p) => s + Number(p.amount ?? 0), 0);
    const weekRevenue = weekPaymentRows.reduce((s, p) => s + Number(p.amount ?? 0), 0);
    const mpesaPayments = todayPaymentRows.filter(p => p.method === 'mobile_money').length;
    const cardPayments = todayPaymentRows.filter(p => p.method === 'card').length;

    // ── Process activations ──────────────────────────────────
    const activationsRows = val(activeSubscriptions).data ?? [];
    const planBreakdown = activationsRows.reduce((acc, s) => {
        const type = s.code_type === 'FREE_TRIAL' ? 'Free Trial' : 'Paid 24H';
        acc[type] = (acc[type] || 0) + 1;
        return acc;
    }, {});

    // ── Process chats ──────────────────────────────────────────
    const chatRows = val(recentChats).data ?? [];
    const uniqueChatSessions = new Set(chatRows.map(c => c.session_id)).size;

    // ── Active online sessions ────────────────────────────────
    const onlineNow = global.activeSessions
        ? [...global.activeSessions.values()].filter(
            s => Date.now() - s.lastSeen < 5 * 60 * 1000
        ).length
        : 0;

    // ── Conversion rate ────────────────────────────────────────
    const signupsTodayCount = val(signupsToday).count ?? 0;
    const paymentsTodayCount = val(paymentsToday).count ?? 0;
    const conversionRate = signupsTodayCount > 0
        ? ((paymentsTodayCount / signupsTodayCount) * 100).toFixed(1)
        : '0.0';

    return {
        signupsToday: signupsTodayCount,
        signupsLastHour: val(signupsLastHour).count ?? 0,
        signupsThisWeek: val(signupsThisWeek).count ?? 0,
        recentSignupEmails: (val(signupsToday).data ?? []).slice(-3).map(u => u.email),
        todayRevenue,
        weekRevenue,
        paymentsTodayCount,
        mpesaPayments,
        cardPayments,
        activeSubscriptions: activationsRows.length,
        planBreakdown,
        expiringSoon: val(expiringSoon).count ?? 0,
        conversionRate,
        abandonedThisWeek: val(abandonedUsers).count ?? 0,
        onlineNow,
        chatSessionsLastHour: uniqueChatSessions,
        timestamp: new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' }),
        hour: new Date().getHours()
    };
}

// ============================================================
// AI PROMPT LAYER
// ============================================================

async function runHourlyPulse() {
    let metrics;
    try {
        metrics = await fetchMetrics();
    } catch (err) {
        console.error('❌ Failed to fetch metrics:', err.message);
        metrics = { error: err.message, timestamp: new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' }) };
    }

    // Build structured report — no AI tokens used
    const signupBar = metrics.signupsToday >= BUSINESS_CONTEXT.dailySignupGoal ? '✅' : metrics.signupsToday >= BUSINESS_CONTEXT.dailySignupGoal * 0.5 ? '🟡' : '🔴';
    const convBar = parseFloat(metrics.conversionRate) >= 15 ? '✅' : parseFloat(metrics.conversionRate) >= 8 ? '🟡' : '🔴';

    const report = [
        `⚡ *AviSignals Metrics Hourly Pulse — ${metrics.timestamp}*`,
        ``,
        `📊 *Signups:* ${metrics.signupsLastHour} this hr | ${metrics.signupsToday}/${BUSINESS_CONTEXT.dailySignupGoal} today ${signupBar}`,
        `💰 *Revenue:* $${metrics.todayRevenue?.toFixed(2)} today | $${metrics.weekRevenue?.toFixed(2)} this week`,
        `👥 *Active subs:* ${metrics.activeSubscriptions} | Expiring 24h: ${metrics.expiringSoon}`,
        `📈 *Conversion:* ${metrics.conversionRate}% ${convBar}`,
        `🟢 *Online now:* ${metrics.onlineNow} | Chat sessions/hr: ${metrics.chatSessionsLastHour}`,
        metrics.recentSignupEmails?.length ? `\n📧 *Recent:* ${metrics.recentSignupEmails.join(', ')}` : ''
    ].filter(Boolean).join('\n');

    await sendToTelegram(report);
}


async function runMorningBriefing() {
    let metrics;
    try { metrics = await fetchMetrics(); } catch (err) { metrics = { error: err.message }; }

    const systemPrompt = `You are the Chief Growth Officer for AviSignals. Report to the founder with a strategic morning briefing. TONE: Data-driven, VC-backed startup style.`;
    const userPrompt = `Morning metrics: Signups(Wk): ${metrics.signupsThisWeek}, Active Subs: ${metrics.activeSubscriptions}, Revenue(Wk): $${metrics.weekRevenue?.toFixed(2)}, Conv: ${metrics.conversionRate}%`;

    try {
        const completion = await groq.chat.completions.create({
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.65,
            max_tokens: 800
        });
        const report = completion.choices[0]?.message?.content ?? 'Morning briefing failed.';
        const header = `🌅 *AviSignals Morning Briefing — ${metrics.timestamp}*\n\n`;
        await sendToTelegram(header + report);
    } catch (err) { console.error('❌ Groq morning briefing error:', err.message); }
}

async function runNightlyReport() {
    let metrics;
    try { metrics = await fetchMetrics(); } catch (err) { metrics = { error: err.message }; }

    const systemPrompt = `You are the Lead Analyst for AviSignals. Compile the night's performance report. Analytical and honest.`;
    const userPrompt = `Nightly metrics: Today Signups: ${metrics.signupsToday}, Today Revenue: $${metrics.todayRevenue?.toFixed(2)}, Active Subs: ${metrics.activeSubscriptions}, Conv: ${metrics.conversionRate}%`;

    try {
        const completion = await groq.chat.completions.create({
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.6,
            max_tokens: 900
        });
        const report = completion.choices[0]?.message?.content ?? 'Nightly report failed.';
        const header = `🌙 *AviSignals Nightly Report — ${metrics.timestamp}*\n\n`;
        await sendToTelegram(header + report);
    } catch (err) { console.error('❌ Groq nightly report error:', err.message); }
}

async function runChurnAlert(metrics) {
    if (!metrics.expiringSoon || metrics.expiringSoon < 3) return;
    const impact = metrics.expiringSoon * 75;
    const alert = [
        `🔴 *CHURN ALERT — ${metrics.expiringSoon} subs expiring soon!*`,
        ``,
        `⚠️ *${metrics.expiringSoon}* active subscribers are expiring in the next 24 hours.`,
        `💸 *Potential loss:* ~$${impact} if they don't renew.`,
        ``,
        `*Recommended actions:*`,
        `- Message expiring users with a renewal reminder`,
        `- Post a time-limited promo to the Telegram channel`,
        `- Check if any payments are stuck in pending status`
    ].join('\n');
    await sendToTelegram(alert);
}

// ============================================================
// SCHEDULER (Nairobi Time / UTC+3)
// ============================================================

function startAnalyticsAgent() {
    console.log('🚀 AviSignals Analytics Agent v2 — Initializing...');

    // Hourly pulse: every hour from 6am to 11pm
    cron.schedule('0 6-23 * * *', async () => {
        console.log('⏰ Running hourly pulse...');
        const metrics = await fetchMetrics().catch(() => ({}));
        await runHourlyPulse();
        await runChurnAlert(metrics);
    });

    // Morning briefing: 8:00 AM daily
    cron.schedule('0 8 * * *', () => {
        console.log('🌅 Running morning briefing...');
        runMorningBriefing();
    });

    // Nightly deep report: 10:00 PM daily
    cron.schedule('0 22 * * *', () => {
        console.log('🌙 Running nightly report...');
        runNightlyReport();
    });

    console.log('✅ Analytics Agent v2 Ready (Nairobi Time)');
}

module.exports = {
    startAnalyticsAgent,
    runHourlyPulse,
    runMorningBriefing,
    runNightlyReport,
    runChurnAlert,
    sendToTelegram,
    fetchMetrics
};
