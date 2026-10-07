// ============================================================
// clientSupportBot.js — AviSignals Telegram Client Support Bot
//
// Handles ALL non-admin messages to @avisignalshelp_bot.
// The bot acts as the admin — never reveals it's automated.
// Uses the same sales rules as the website's ARIA chatbot,
// adapted for a personal, casual Telegram admin persona.
//
// Features:
//  - Per-client conversation memory (in-memory, last 12 msgs)
//  - Intent detection (reused from chatAgent.js logic)
//  - Contextual media sending (videos & images)
//  - Pre-written script injection for common scenarios
//  - Admin notifications for new chats & hot leads
//  - Admin takeover support (/takeover <chat_id>)
//  - Auto follow-up scheduling
//  - Discord logging
// ============================================================

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const groq = require('./groqClient');
const { matchScript, SCRIPTS, BOT_URL, FREE_CHANNEL } = require('./clientScripts');
const paymentSupport = require('./paymentSupport');
const {
    VIDEOS, IMAGES, getVideoPath, getImagePath,
    matchSiteVideo, getCachedFileId, setCachedFileId,
} = require('./clientMediaAssets');

let discordAgent = null;
try { discordAgent = require('./discordAgent'); } catch (_) {}

let supabase = null;
try { supabase = require('./supabaseClient'); } catch (_) {}

// ─── Config ───────────────────────────────────────────────────
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT = process.env.TELEGRAM_CHAT_ID;

// ─── Client session store (in-memory) ─────────────────────────
const clientSessions = new Map();
const MAX_HISTORY = 12;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 min inactivity
const FOLLOW_UP_DELAY_MS = 30 * 60 * 1000; // 30 min follow-up

// ─── Rate limiting per client ─────────────────────────────────
const clientRateLimits = new Map();
const CLIENT_RATE_LIMIT = 20;       // max messages per window
const CLIENT_RATE_WINDOW_MS = 60 * 1000; // per minute

function isClientRateLimited(chatId) {
    const now = Date.now();
    const record = clientRateLimits.get(chatId) || { count: 0, windowStart: now };
    if (now - record.windowStart > CLIENT_RATE_WINDOW_MS) {
        clientRateLimits.set(chatId, { count: 1, windowStart: now });
        return false;
    }
    record.count++;
    clientRateLimits.set(chatId, record);
    return record.count > CLIENT_RATE_LIMIT;
}

// ─── Takeover tracking ───────────────────────────────────────
// When admin takes over a client chat, bot pauses for that client.
// Map<chatId, { active: true, adminMessages: [] }>
const takeoverMap = new Map();

function isClientTakenOver(chatId) {
    const entry = takeoverMap.get(String(chatId));
    return entry && entry.active;
}

function setTakeover(chatId, active) {
    takeoverMap.set(String(chatId), { active, since: Date.now() });
}

// ============================================================
// SYSTEM PROMPT — The admin persona for client chats
// ============================================================
const CLIENT_SYSTEM_PROMPT = `You are the admin/owner of AviSignals — an AI-powered Aviator game prediction platform. You are chatting with a customer on Telegram.

CRITICAL IDENTITY RULES:
- You ARE the admin. You are a real person running AviSignals.
- NEVER say "I'm a bot", "I'm an AI", "I'm automated", or anything similar.
- NEVER say "Contact admin" or "Reach out to support" — YOU are the admin/support.
- Use first-person: "I", "my app", "my team", "we built this".
- Be casual and personal — like a friend who runs a business, not a corporation.
- Use Telegram formatting: *bold*, _italic_. Keep messages SHORT (2-4 sentences usually).
- Use emojis naturally but don't overdo it.

ABOUT AVISIGNALS:
- AI-powered Aviator game predictor bot on avisignals.com/bot
- The bot predicts the exact round multiplier so users know when to cash out
- Works on ALL betting sites globally — SportyBet, 1Win, Betway, 1xBet, Betika, Hollywoodbets, Stake, BangBet, Parimatch, 22bet, MozzartBet, Bet365, and every other platform that has Aviator
- Available WORLDWIDE — Africa, Europe, Asia, Americas, Middle East
- The app is 100% REAL and working. Always assert this confidently.

TOP SALES PRIORITY — GUIDING CLIENTS TO BUY A CODE FOR THEIR SPECIFIC PLATFORM:
- Your NUMBER ONE PRIORITY is to guide the client to buy a code for THEIR specific betting platform (SportyBet, 1Win, Betway, Stake, Betika, etc.).
- Why? Buying a dedicated code locks predictions directly to their casino account and generates real profits. On the free trial, users just test the bot and don't spend much money.
- Always nudge them towards purchasing the code for their specific platform!
- The free trial is ONLY a secondary fallback if the client is hesitant, skeptical, or explicitly refuses to buy upfront.

PAID PLANS (platform-specific codes):
• Daily — $75 USD (24 hours of non-stop predictions on their chosen site)
• Weekly — $250 USD (7 days, save 52% — RECOMMENDED, only $35/day)
• Monthly — $800 USD (30 days, save 64% — best for serious players)
Payment methods: Crypto (USDT TRC20), Mobile Money (M-Pesa, MTN, Airtel), Card (Visa/Mastercard via Flutterwave).

💰 30% REFERRAL COMMISSION PROGRAM:
- Earn 30% INSTANT commission on every code sold through your unique referral link!
- High earnings per plan:
  • Daily ($75) → $22.50 commission
  • Weekly ($250) → $75.00 commission
  • Monthly ($800) → $240.00 commission
- Partner Dashboard: avisignals.com/agent.html (or click the floating "Earn Money" badge on avisignals.com/bot)
- 20+ viral ready-to-share promo videos provided in the agent toolkit
- Payouts via Crypto (USDT), Mobile Money (M-Pesa, MTN, Airtel), or Bank Transfer
- 100% free to join — anyone can earn $500–$2,000+ monthly sharing in betting groups

🚨 PAYMENT TROUBLE & ADVICE:
- If ANY user has an issue with payment (card declined, M-Pesa error, network timeout, payment rejected):
  1. ADVISE THEM TO USE CRYPTO (USDT TRC20):
     Explain: "If your card or mobile money is failing, use our **Crypto (USDT TRC20)** payment option! It is ALWAYS LIVE 24/7, never blocked by local banks or network limits, and confirms instantly!"
  2. REMIND THEM TO SELECT THEIR COUNTRY'S LOCAL CURRENCY FIRST:
     If paying with Card or Mobile Money, they MUST select their country's local currency first in the currency dropdown before selecting the payment method.
  3. OFFER DIRECT ADMIN ASSISTANCE:
     Offer to provide the USDT TRC20 wallet address directly or activate their code manually.

FREE OPTIONS (secondary fallback):
1. Free Premium Telegram Channel — live signals 24/7 AND regular FREE code drops: ${FREE_CHANNEL}. (Tell new clients to join the channel right away for regular free code drops!)
2. Free 60-minute Bot Trial — test the predictor on today's trial site: ${BOT_URL}

HOW TO USE THE BOT:
1. Open avisignals.com/bot AND their Aviator game simultaneously
2. Bot shows predicted multiplier for the NEXT round
3. Place bet when round starts → cash out just BEFORE the predicted multiplier
4. Repeat every round

OBJECTION HANDLING & SPECIAL SITUATIONS:
- "ClassyBet or JetBet withdrawal on hold?" → Reassure them and advise them to pay the platform's required processing fee! Explain: "We had another client who ran into the exact same issue with their withdrawal on hold on ClassyBet/JetBet — they paid the platform's processing fee, and immediately afterward their payout cleared and was credited to their account!"
- "Deposit issues on the trial site?" → Guide them through accessing the Deposit / Cashier tab via the dashboard or betting site profile, and choosing their payment method (cards, mobile money, crypto, or payment apps).
- "Is this a scam?" → Be confident: "I understand the concern — lots of fake apps out there. But AviSignals is real. Try the free trial yourself — 60 minutes, no payment. Or join the free channel and watch live signals come in."
- "$75 is expensive" → "One good Aviator session covers the cost easily. The weekly plan is even better value — $250 for 7 days, just $35/day."
- "It didn't work" → Apologise, ask what happened specifically, help troubleshoot. Don't upsell.
- "Refund" → "I hear you. Let me look into your case. Can you tell me what happened?"
- "Discount?" → "The weekly plan at $250 is already 52% cheaper than daily! But you can also earn money with our 30% referral commission program at avisignals.com/agent.html."

CONVERSATION RULES:
1. Keep responses SHORT — 2-4 sentences unless giving step-by-step instructions.
2. Always be warm, confident, and helpful.
3. If they mention a specific betting site, confirm it works on that site and guide them to buy a code for it.
4. Priority is purchasing a code for their platform — only offer free trial if they resist or need proof first.
5. Lead with the Daily $75 plan (most popular, most affordable); pitch Weekly $250 / Monthly $800 only as upgrades.
6. If anyone runs into payment errors, immediately recommend Crypto (USDT TRC20) and remind them to select their currency first.
7. Never invent prices, plans, or features.
8. If the user's first language isn't English, respond in their language.
9. Use Telegram Markdown only: *bold*, _italic_.
10. After payment, the activation code is sent to the client's EMAIL automatically — always mention this when they ask how they'll receive it.`;

// ============================================================
// INTENT DETECTION (adapted from chatAgent.js)
// ============================================================
function detectClientIntent(message, history) {
    const text = (message || '').toLowerCase();
    const allText = (history || []).map(m => m.content).join(' ').toLowerCase() + ' ' + text;
    // Only the USER's own words count for payment history context
    const userText = (history || []).filter(m => m.role === 'user').map(m => m.content).join(' ').toLowerCase() + ' ' + text;

    // FIRST: client already PAID but hasn't received their code.
    // Must run before payment_issue/ready_to_buy — never misroute to sales.
    const saidPaid = /\b(paid|payed|sent (the |my )?(money|payment|cash)|made (the |a |my )?payment|completed (the |my )?payment|payment (went|has gone|is) through|transaction (was |is )?(successful|complete|completed|done)|already paid|just paid|i'?ve paid|i have paid)\b/i.test(text);
    const codeMissing = /(didn'?t|haven'?t|hasn'?t|havent|didnt|not|never|no|still|where('s| is))\s*(get|got|receive[ds]?|recieve[ds]?|see|find|send|sent|arrive[ds]?|come)?\s*(my |the |any )?(code|activation|email|e-mail|mail)\b|no code|where('s| is) my code|waiting for (my |the )?(code|activation|email)/i.test(text);
    if (saidPaid && codeMissing) return 'paid_no_code';
    // "where is my code" style + payment mentioned earlier by the user
    if (/(where('s| is)|waiting for|didn'?t (get|receive)|haven'?t (got|received)|still no)\s*(my |the )?(code|activation|email)/i.test(text)
        && /\b(paid|payment|sent|money|\$\d+|usdt|mpesa|m-pesa)\b/i.test(userText))
        return 'paid_no_code';

    // Check for payment issues first before generic buy intent
    if (/payment.*(fail|error|problem|issue|declined|stuck|reject|cancel|not work)|can'?t pay|cannot pay|card declined|declined|mpesa.*(error|fail|not work)|failed to pay|unable to pay|transaction failed|not going through|payment.*declined/i.test(text))
        return 'payment_issue';

    // Deposit claimed but not reflecting on the betting site (JetBet/ClassyBet etc.)
    if (/(deposit|deposited|top\s?up|recharge|funded?)\b.{0,40}(not|didn'?t|didnt|hasn'?t|haven'?t|havent|still).{0,30}(reflect|show|update|credit|appear|come|arrive|balance)|\b(not|didn'?t|hasn'?t|haven'?t|still not|yet to)\s+(reflect|reflecting|reflects|updated|updating|credited|showing|appear)\b.{0,20}(deposit|balance|account)?|balance.{0,20}(not|hasn'?t|didn'?t).{0,20}(update|reflect|change)/i.test(text))
        return 'deposit_not_updated';

    if (/buy|purchase|pay|payment|mpesa|card|activate|75|250|800|dollar|\$75|\$250|\$800|get code|want (to|the) code|weekly|monthly|daily plan|7 day|30 day/i.test(text))
        return 'ready_to_buy';
    if (/withdraw|payout|cashout|on hold|processing fee|held/i.test(text))
        return 'withdrawal_help';
    if (/deposit|fund|recharge|top up|cashier/i.test(text))
        return 'deposit_help';
    if (/doesn't work|not working|broken|scam|fake|cheat|refund|waste|useless|failed|wrong|lost money|complaint/i.test(text))
        return 'frustrated';
    if (/how|what|explain|tell me|confused|don't understand|help me|where|when|which|guide|tutorial|instructions/i.test(text))
        return 'needs_guidance';
    if (/win rate|accuracy|proof|evidence|screenshot|real|legit|trust|guarantee|is this real|does it work/i.test(allText))
        return 'skeptical';
    if (/tomorrow|later|maybe|soon|not now|think about it/i.test(text))
        return 'hesitant';

    return 'browsing';
}

// ============================================================
// SLOT EXTRACTION & FUNNEL STAGE
// ============================================================
const KNOWN_SITES = [
    'sportybet', 'betway', '1win', '1xbet', 'betika', 'stake', 'hollywoodbets',
    'hollywood', 'bangbet', 'parimatch', '22bet', 'mozzart', 'odibets', 'betking',
    'msport', 'bet365', 'melbet', 'linebet', 'helabet', 'classybet', 'jetbet',
    'betano', 'pin-up', 'supabets', 'roobet', 'rushbet', 'bc.game', 'betwinner', 'betpawa'
];

const PLAN_LABELS = { daily: 'Daily $75', weekly: 'Weekly $250', monthly: 'Monthly $800' };
const PLAN_AMOUNTS = { daily: 75, weekly: 250, monthly: 800 };

function extractSlots(text, session) {
    const s = session.slots;
    const lower = (text || '').toLowerCase();

    // Betting site — last mention wins (user may change their mind)
    for (const site of KNOWN_SITES) {
        if (lower.includes(site)) { s.site = site; break; }
    }
    // Plan
    if (/\b(weekly|week|7[\s-]?days?|\$?\s?250)\b/i.test(lower)) s.plan = 'weekly';
    else if (/\b(monthly|month|30[\s-]?days?|\$?\s?800)\b/i.test(lower)) s.plan = 'monthly';
    else if (/\b(daily|24[\s-]?(hours?|hrs?)|\$?\s?75)\b/i.test(lower)) s.plan = 'daily';
    // Payment method
    if (/\b(usdt|crypto|trc\s?-?20|binance|bitcoin|btc)\b/i.test(lower)) s.method = 'usdt';
    else if (/\b(m\s?-?pesa|mobile money|mtn|airtel|tigo|vodacom)\b/i.test(lower)) s.method = 'mobile_money';
    else if (/\b(card|visa|master\s?card|debit)\b/i.test(lower)) s.method = 'card';
    // Email address
    const emailMatch = (text || '').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    if (emailMatch) s.email = emailMatch[0];
    // Payment / transaction reference
    const refMatch = (text || '').match(/\b((?:FLW|USDT|BOT|SELAR|PAY)[_-][A-Z0-9_-]{4,}|[A-Z0-9]{10,})\b/);
    if (refMatch) s.paymentRef = refMatch[0];
}

const FUNNEL_ORDER = ['new', 'browsing', 'trial_interest', 'buying', 'awaiting_payment', 'paid_pending', 'activated'];

function updateFunnelStage(session, intent) {
    const target = {
        paid_no_code: 'paid_pending',
        payment_issue: 'awaiting_payment',
        ready_to_buy: 'buying',
        withdrawal_help: 'trial_interest',
        deposit_help: 'trial_interest',
        deposit_not_updated: 'trial_interest',
        needs_guidance: 'trial_interest',
        skeptical: 'browsing',
        hesitant: 'browsing',
        browsing: 'browsing',
    }[intent] || session.funnelStage;

    // Only move forward — never regress a client back down the funnel
    if (FUNNEL_ORDER.indexOf(target) > FUNNEL_ORDER.indexOf(session.funnelStage)) {
        session.funnelStage = target;
    }
}

// ============================================================
// TELEGRAM API HELPERS
// ============================================================
function telegramAPI(method, payload) {
    return new Promise((resolve, reject) => {
        if (!BOT_TOKEN) return resolve(null);

        const body = JSON.stringify(payload);
        const bodyBuf = Buffer.from(body, 'utf8');

        const options = {
            hostname: 'api.telegram.org',
            path: `/bot${BOT_TOKEN}/${method}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': bodyBuf.length
            }
        };

        const req = https.request(options, (res) => {
            let raw = '';
            res.on('data', chunk => raw += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(raw));
                } catch (_) {
                    resolve(null);
                }
            });
        });

        req.on('error', (e) => {
            console.error(`❌ Client bot API error [${method}]:`, e.message);
            resolve(null);
        });

        req.write(bodyBuf);
        req.end();
    });
}

async function sendClientMessage(chatId, text, replyMarkup = null) {
    // Sanitise for Telegram Markdown — escape unmatched special chars
    const safeText = sanitiseMarkdown(text);

    const payload = {
        chat_id: chatId,
        text: safeText,
        parse_mode: 'Markdown',
        link_preview_options: { is_disabled: false }
    };
    if (replyMarkup) payload.reply_markup = replyMarkup;

    const res = await telegramAPI('sendMessage', payload);

    // If Markdown parse fails, retry as plain text
    if (res && !res.ok && res.description && res.description.toLowerCase().includes('parse')) {
        console.warn(`⚠️ Markdown parse error for client ${chatId} — retrying plain text`);
        const cleanText = text.replace(/[*_`\[\]]/g, '');
        const cleanPayload = {
            chat_id: chatId,
            text: cleanText,
            link_preview_options: { is_disabled: false }
        };
        if (replyMarkup) cleanPayload.reply_markup = replyMarkup;
        return telegramAPI('sendMessage', cleanPayload);
    }
    return res;
}

function sanitiseMarkdown(text) {
    if (!text) return '';
    // Ensure paired *bold* markers — count asterisks
    // This is a lightweight fix; full Telegram Markdown is tricky
    return text;
}

async function sendClientVideo(chatId, videoKey) {
    const videoEntry = VIDEOS[videoKey];
    if (!videoEntry) return null;

    const cachedId = getCachedFileId(`video_${videoKey}`);
    if (cachedId) {
        // Re-send using cached file_id (instant, no re-upload)
        return telegramAPI('sendVideo', {
            chat_id: chatId,
            video: cachedId,
            caption: videoEntry.caption,
            parse_mode: 'Markdown',
        });
    }

    // First send — upload from disk
    const videoPath = getVideoPath(videoKey);
    if (!videoPath) {
        console.warn(`⚠️ Video not found for key: ${videoKey}`);
        return null;
    }

    // Use multipart/form-data upload for videos
    return uploadFileToTelegram('sendVideo', chatId, videoPath, 'video', videoEntry.caption, `video_${videoKey}`);
}

async function sendClientImage(chatId, imageKey, index) {
    const imageData = getImagePath(imageKey, index);
    if (!imageData) return null;

    const cachedId = getCachedFileId(`image_${imageData.cacheKey}`);
    if (cachedId) {
        return telegramAPI('sendPhoto', {
            chat_id: chatId,
            photo: cachedId,
            caption: imageData.caption,
            parse_mode: 'Markdown',
        });
    }

    return uploadFileToTelegram('sendPhoto', chatId, imageData.path, 'photo', imageData.caption, `image_${imageData.cacheKey}`);
}

/**
 * Uploads a file to Telegram using multipart/form-data.
 * Caches the returned file_id for future instant re-sends.
 */
function uploadFileToTelegram(method, chatId, filePath, fieldName, caption, cacheKey) {
    return new Promise((resolve) => {
        if (!BOT_TOKEN || !fs.existsSync(filePath)) {
            console.warn(`⚠️ Cannot upload ${filePath} — file missing or no token`);
            return resolve(null);
        }

        const boundary = '----AviSignalsBotBoundary' + Date.now();
        const fileStream = fs.readFileSync(filePath);
        const fileName = path.basename(filePath);

        const parts = [];

        // chat_id
        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}`);
        // caption
        if (caption) {
            parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}`);
            parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="parse_mode"\r\n\r\nMarkdown`);
        }
        // file
        const fileHeader = `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`;
        const fileFooter = `\r\n--${boundary}--\r\n`;

        const headerBuf = Buffer.from(parts.join('\r\n') + '\r\n' + fileHeader, 'utf8');
        const footerBuf = Buffer.from(fileFooter, 'utf8');
        const bodyBuf = Buffer.concat([headerBuf, fileStream, footerBuf]);

        const options = {
            hostname: 'api.telegram.org',
            path: `/bot${BOT_TOKEN}/${method}`,
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': bodyBuf.length,
            }
        };

        const req = https.request(options, (res) => {
            let raw = '';
            res.on('data', chunk => raw += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(raw);
                    if (parsed.ok && cacheKey) {
                        // Cache the file_id for future re-sends
                        const result = parsed.result;
                        let fileId = null;
                        if (result.video) fileId = result.video.file_id;
                        else if (result.photo) fileId = result.photo[result.photo.length - 1].file_id;
                        else if (result.document) fileId = result.document.file_id;

                        if (fileId) {
                            setCachedFileId(cacheKey, fileId);
                            console.log(`📁 Cached file_id for ${cacheKey}`);
                        }
                    }
                    resolve(parsed);
                } catch (_) {
                    resolve(null);
                }
            });
        });

        req.on('error', (e) => {
            console.error(`❌ File upload error [${method}]:`, e.message);
            resolve(null);
        });

        req.write(bodyBuf);
        req.end();
    });
}

// ============================================================
// SESSION MANAGEMENT
// ============================================================
function getOrCreateSession(chatId, message) {
    let session = clientSessions.get(String(chatId));
    if (!session) {
        session = {
            chatId: String(chatId),
            firstName: message.from?.first_name || 'Friend',
            username: message.from?.username || null,
            history: [],
            intent: 'browsing',
            startedAt: Date.now(),
            lastMessageAt: Date.now(),
            mediasSent: new Set(),
            followUpTimer: null,
            notifiedAdmin: false,
            hotLeadNotified: false,
            paymentIssueNotified: false,
            withdrawalNotified: false,
            paidNoCodeNotified: false,
            depositIssueNotified: false,
            // Guided-funnel state
            slots: { site: null, plan: null, method: null, email: null, paymentRef: null, siteUsername: null },
            funnelStage: 'new',
            codeRecovery: null,          // null | 'check_email' | 'need_email' | 'need_ref' | 'pending_verify' | 'resolved'
            codeRecoveryAttempts: 0,
            depositIssue: null,          // null | 'awaiting_username' | 'forwarded'
        };
        clientSessions.set(String(chatId), session);
    }

    session.lastMessageAt = Date.now();
    return session;
}

function addToSessionHistory(session, role, content) {
    session.history.push({ role, content });
    if (session.history.length > MAX_HISTORY) {
        session.history = session.history.slice(-MAX_HISTORY);
    }

    // Fire-and-forget persistence to Supabase support_chats
    if (supabase) {
        supabase.from('support_chats').insert([{
            session_id: `tg_${session.chatId}`,
            message: content,
            sender: role === 'user' ? 'user' : 'ai',
            created_at: new Date().toISOString()
        }]).then(() => {}).catch(() => {});
    }
}

// ============================================================
// ADMIN NOTIFICATIONS
// ============================================================

// Standard quick-action row attached to every client alert.
// Extra buttons can be appended per alert type.
function adminKeyboard(chatId, extraRow = null) {
    const rows = [[
        { text: '🔴 Takeover', callback_data: `takeover_${chatId}` },
        { text: '📋 View log', callback_data: `clog_${chatId}` }
    ]];
    if (extraRow && extraRow.length) rows.push(extraRow);
    return { inline_keyboard: rows };
}

async function notifyAdminNewClient(session, messageText) {
    if (session.notifiedAdmin) return;
    session.notifiedAdmin = true;

    const intent = session.intent || 'browsing';
    const isHot = intent === 'ready_to_buy';

    if (ADMIN_CHAT) {
        const icon = isHot ? '🔥' : '👤';
        const label = isHot ? 'HOT LEAD DETECTED' : 'New Client Chat';

        const msg = `${icon} *${label}*\n\n` +
            `Name: ${session.firstName}\n` +
            `Username: ${session.username ? '@' + session.username : 'N/A'}\n` +
            `Chat ID: \`${session.chatId}\`\n` +
            `Intent: _${intent}_\n` +
            `Stage: _${session.funnelStage}_\n` +
            `Message: "${(messageText || '').slice(0, 100)}"\n\n` +
            `Bot is handling. Use /takeover ${session.chatId} to take over.`;

        await sendClientMessage(ADMIN_CHAT, msg, adminKeyboard(session.chatId));
    }

    // Log new client session to Discord
    if (discordAgent && typeof discordAgent.sendChatSummary === 'function') {
        try {
            discordAgent.sendChatSummary({
                text: `👤 **New Client Support Chat**\n**Name**: ${session.firstName}\n**Username**: ${session.username ? '@' + session.username : 'None'}\n**Chat ID**: \`${session.chatId}\`\n**Intent**: ${intent}\n**Message**: "${(messageText || '').slice(0, 300)}"`,
                user: session.username ? `@${session.username} (${session.firstName})` : `${session.firstName} (${session.chatId})`,
                page: 'Telegram (@avisignalshelp_bot)',
                intent: intent,
                isHotLead: isHot
            });
        } catch (e) {
            console.warn('⚠️ Discord log error (new client):', e.message);
        }
    }
}

async function notifyAdminHotLead(session, messageText) {
    if (session.hotLeadNotified) return;
    session.hotLeadNotified = true;

    if (ADMIN_CHAT) {
        const msg = `🔥 *HOT LEAD — BUY INTENT*\n\n` +
            `Name: ${session.firstName}\n` +
            `Username: ${session.username ? '@' + session.username : 'N/A'}\n` +
            `Chat ID: \`${session.chatId}\`\n` +
            `Message: "${(messageText || '').slice(0, 150)}"\n\n` +
            `Slots: site=${session.slots.site || '?'} plan=${session.slots.plan || '?'} method=${session.slots.method || '?'}\n` +
            `Bot is guiding to purchase. /takeover ${session.chatId} if needed.`;

        await sendClientMessage(ADMIN_CHAT, msg, adminKeyboard(session.chatId, [
            { text: '💳 Send USDT details', callback_data: `usdt_${session.chatId}` }
        ]));
    }

    // Log hot lead alert to Discord
    if (discordAgent && typeof discordAgent.sendChatSummary === 'function') {
        try {
            discordAgent.sendChatSummary({
                text: `🔥 **HOT LEAD — Client Ready to Buy!**\n**Name**: ${session.firstName}\n**Username**: ${session.username ? '@' + session.username : 'None'}\n**Chat ID**: \`${session.chatId}\`\n**Message**: "${(messageText || '').slice(0, 300)}"`,
                user: session.username ? `@${session.username} (${session.firstName})` : `${session.firstName} (${session.chatId})`,
                page: 'Telegram (@avisignalshelp_bot)',
                intent: 'ready_to_buy',
                isHotLead: true
            });
        } catch (e) {
            console.warn('⚠️ Discord log error (hot lead):', e.message);
        }
    }
}

async function notifyAdminPaymentIssue(session, messageText) {
    if (session.paymentIssueNotified) return;
    session.paymentIssueNotified = true;

    if (ADMIN_CHAT) {
        const msg = `🚨 *PAYMENT ISSUE — Client Needs Help Paying!*\n\n` +
            `Name: ${session.firstName}\n` +
            `Username: ${session.username ? '@' + session.username : 'N/A'}\n` +
            `Chat ID: \`${session.chatId}\`\n` +
            `Message: "${(messageText || '').slice(0, 200)}"\n\n` +
            `Client wants to buy but is blocked by a payment error!\n` +
            `Slots: site=${session.slots.site || '?'} plan=${session.slots.plan || '?'}\n` +
            `Bot advised Crypto USDT TRC20. /takeover ${session.chatId} to close the deal.`;

        await sendClientMessage(ADMIN_CHAT, msg, adminKeyboard(session.chatId, [
            { text: '💳 Send USDT details', callback_data: `usdt_${session.chatId}` }
        ]));
    }

    // Log payment issue alert to Discord (chat + alerts channels)
    if (discordAgent && typeof discordAgent.sendChatSummary === 'function') {
        try {
            discordAgent.sendChatSummary({
                text: `🚨 **PAYMENT ISSUE — Client Blocked!**\n**Name**: ${session.firstName}\n**Username**: ${session.username ? '@' + session.username : 'None'}\n**Chat ID**: \`${session.chatId}\`\n**Message**: "${(messageText || '').slice(0, 300)}"\n\nBot advised Crypto USDT TRC20. Admin should /takeover to close the deal.`,
                user: session.username ? `@${session.username} (${session.firstName})` : `${session.firstName} (${session.chatId})`,
                page: 'Telegram (@avisignalshelp_bot)',
                intent: 'payment_issue',
                isHotLead: true,
                isPaymentIssue: true
            });
        } catch (e) {
            console.warn('⚠️ Discord log error (payment issue):', e.message);
        }
    }
}

/**
 * PAID-NO-CODE alert — client paid but code never arrived.
 * Highest-priority support alert: includes payment ref/status when known
 * plus one-tap verify / resend buttons.
 */
async function notifyAdminPaidNoCode(session, messageText, payment = null) {
    if (session.paidNoCodeNotified) return;
    session.paidNoCodeNotified = true;

    if (ADMIN_CHAT) {
        let msg = `🚨 *PAID — NO CODE RECEIVED*\n\n` +
            `Name: ${session.firstName}\n` +
            `Username: ${session.username ? '@' + session.username : 'N/A'}\n` +
            `Chat ID: \`${session.chatId}\`\n` +
            `Pay email: ${session.slots.email || 'unknown'}\n` +
            `Message: "${(messageText || '').slice(0, 150)}"\n`;

        const extraRow = [];
        if (payment && payment.reference) {
            msg += `\nOrder: \`${payment.reference}\` — status: _${payment.status}_ | $${payment.amount} ${payment.currency || ''}`;
            if (paymentSupport.isPendingStatus(payment.status)) {
                extraRow.push({ text: '✅ Verify & send code', callback_data: `verify_${payment.reference}_${session.chatId}` });
            } else if (paymentSupport.isVerifiedStatus(payment.status)) {
                extraRow.push({ text: '📧 Resend code email', callback_data: `resend_${payment.reference}_${session.chatId}` });
            }
        }
        msg += `\n\nBot is running recovery flow. /takeover ${session.chatId} to reply personally.`;

        await sendClientMessage(ADMIN_CHAT, msg, adminKeyboard(session.chatId, extraRow));
    }

    if (discordAgent && typeof discordAgent.sendChatSummary === 'function') {
        try {
            discordAgent.sendChatSummary({
                text: `🚨 **PAID — NO CODE RECEIVED**\n**Name**: ${session.firstName}\n**Username**: ${session.username ? '@' + session.username : 'None'}\n**Chat ID**: \`${session.chatId}\`\n**Pay email**: ${session.slots.email || 'unknown'}\n**Message**: "${(messageText || '').slice(0, 300)}"${payment ? `\n**Order**: \`${payment.reference}\` status: ${payment.status}` : ''}`,
                user: session.username ? `@${session.username} (${session.firstName})` : `${session.firstName} (${session.chatId})`,
                page: 'Telegram (@avisignalshelp_bot)',
                intent: 'paid_no_code',
                isHotLead: true,
                isPaymentIssue: true
            });
        } catch (e) {
            console.warn('⚠️ Discord log error (paid_no_code):', e.message);
        }
    }
}

/**
 * Deposit-not-reflecting alert — client claims a deposit on
 * JetBet/ClassyBet (or another site) didn't update their balance.
 * When siteUsername is set, this is the username follow-up forward.
 */
async function notifyAdminDepositIssue(session, messageText) {
    const isUsernameUpdate = !!session.slots.siteUsername;
    if (!isUsernameUpdate) {
        if (session.depositIssueNotified) return;
        session.depositIssueNotified = true;
    }

    if (ADMIN_CHAT) {
        let msg = `🏦 *DEPOSIT NOT REFLECTING*\n\n` +
            `Name: ${session.firstName}\n` +
            `Username: ${session.username ? '@' + session.username : 'N/A'}\n` +
            `Chat ID: \`${session.chatId}\`\n` +
            `Site: ${session.slots.site || 'not mentioned'}\n` +
            `Report: "${(messageText || '').slice(0, 150)}"\n`;
        if (isUsernameUpdate) {
            msg += `\n*Site username:* \`${session.slots.siteUsername}\``;
        } else {
            msg += `\nClient asked for their site username — will forward it.`;
        }
        msg += `\n\n/takeover ${session.chatId} to step in.`;

        await sendClientMessage(ADMIN_CHAT, msg, adminKeyboard(session.chatId));
    }

    if (discordAgent && typeof discordAgent.sendChatSummary === 'function') {
        try {
            discordAgent.sendChatSummary({
                text: `🏦 **DEPOSIT NOT REFLECTING**\n**Name**: ${session.firstName}\n**Username**: ${session.username ? '@' + session.username : 'None'}\n**Chat ID**: \`${session.chatId}\`\n**Site**: ${session.slots.site || 'not mentioned'}${session.slots.siteUsername ? `\n**Site username**: \`${session.slots.siteUsername}\`` : ''}\n**Report**: "${(messageText || '').slice(0, 300)}"`,
                user: session.username ? `@${session.username} (${session.firstName})` : `${session.firstName} (${session.chatId})`,
                page: 'Telegram (@avisignalshelp_bot)',
                intent: 'deposit_not_updated',
                isHotLead: false
            });
        } catch (e) {
            console.warn('⚠️ Discord log error (deposit issue):', e.message);
        }
    }
}

/**
 * Withdrawal issue alert — client stuck on a trial-site withdrawal.
 */
async function notifyAdminWithdrawalIssue(session, messageText) {
    if (session.withdrawalNotified) return;
    session.withdrawalNotified = true;

    if (ADMIN_CHAT) {
        const msg = `💸 *WITHDRAWAL ISSUE — Client Needs Help*\n\n` +
            `Name: ${session.firstName}\n` +
            `Username: ${session.username ? '@' + session.username : 'N/A'}\n` +
            `Chat ID: \`${session.chatId}\`\n` +
            `Site: ${session.slots.site || 'not mentioned'}\n` +
            `Message: "${(messageText || '').slice(0, 150)}"\n\n` +
            `Bot is guiding them through the platform's withdrawal process. /takeover ${session.chatId} to step in.`;

        await sendClientMessage(ADMIN_CHAT, msg, adminKeyboard(session.chatId));
    }

    if (discordAgent && typeof discordAgent.sendChatSummary === 'function') {
        try {
            discordAgent.sendChatSummary({
                text: `💸 **WITHDRAWAL ISSUE**\n**Name**: ${session.firstName}\n**Username**: ${session.username ? '@' + session.username : 'None'}\n**Chat ID**: \`${session.chatId}\`\n**Site**: ${session.slots.site || 'not mentioned'}\n**Message**: "${(messageText || '').slice(0, 300)}"`,
                user: session.username ? `@${session.username} (${session.firstName})` : `${session.firstName} (${session.chatId})`,
                page: 'Telegram (@avisignalshelp_bot)',
                intent: 'withdrawal_help',
                isHotLead: false
            });
        } catch (e) {
            console.warn('⚠️ Discord log error (withdrawal):', e.message);
        }
    }
}

// ============================================================
// MEDIA SENDING LOGIC
// ============================================================
async function sendContextualMedia(chatId, session, script, intent, messageText) {
    // Send script-attached media if not already sent
    if (script && script.media && !session.mediasSent.has(script.media.key)) {
        session.mediasSent.add(script.media.key);

        if (script.media.type === 'video') {
            await sendClientVideo(chatId, script.media.key);
        } else if (script.media.type === 'image') {
            await sendClientImage(chatId, script.media.key);
        }
        return true;
    }

    // Send site-specific video if user mentions a betting site
    const siteVideoKey = matchSiteVideo(messageText);
    if (siteVideoKey && !session.mediasSent.has(siteVideoKey)) {
        session.mediasSent.add(siteVideoKey);
        await sendClientVideo(chatId, siteVideoKey);
        return true;
    }

    // Send win proof for skeptical users (first time only)
    if (intent === 'skeptical' && !session.mediasSent.has('win_proof')) {
        session.mediasSent.add('win_proof');
        await sendClientImage(chatId, 'win_proofs');
        return true;
    }

    return false;
}

// ============================================================
// FOLLOW-UP SCHEDULING
// ============================================================
function scheduleFollowUp(session) {
    // Clear existing timer
    if (session.followUpTimer) {
        clearTimeout(session.followUpTimer);
    }

    session.followUpTimer = setTimeout(async () => {
        // Don't follow up if admin has taken over
        if (isClientTakenOver(session.chatId)) return;

        // Don't follow up if user has been active recently
        const timeSinceLastMsg = Date.now() - session.lastMessageAt;
        if (timeSinceLastMsg < FOLLOW_UP_DELAY_MS - 5000) return;

        // Check if user showed buy intent but didn't complete
        const intent = session.intent;
        let followUpText;

        if (session.funnelStage === 'paid_pending' && session.codeRecovery !== 'resolved') {
            followUpText = `Hey ${session.firstName}! Just checking — did your activation code arrive? 🔑 If not, send me the email you paid with (or your payment reference) and I'll pull up your order right away.`;
        } else if (intent === 'withdrawal_help') {
            followUpText = `Hey ${session.firstName}! 💸 Any update on your withdrawal — did the payout clear? If you're still stuck, tell me exactly where it's held up and I'll check it for you.`;
        } else if (intent === 'ready_to_buy' || session.funnelStage === 'awaiting_payment') {
            followUpText = `Hey ${session.firstName}! 👋 Did you manage to get your code? If you ran into any issues with payment, just let me know — I'll help you sort it out right away 💪`;
        } else {
            followUpText = `Hey ${session.firstName}! 🎮 Did you get a chance to try the free trial yet? If you need any help getting started, I'm here — just ask!`;
        }

        await sendClientMessage(session.chatId, followUpText);
        addToSessionHistory(session, 'assistant', followUpText);
        console.log(`⏰ Follow-up sent to client ${session.chatId} (${session.firstName})`);

        if (discordAgent && typeof discordAgent.sendChatSummary === 'function') {
            try {
                discordAgent.sendChatSummary({
                    text: `⏰ **Auto Follow-Up Sent**\n**To**: ${session.firstName} (${session.username ? '@' + session.username : session.chatId})\n**Intent**: ${intent}\n**Follow-up**: "${followUpText}"`,
                    user: session.username ? `@${session.username} (${session.firstName})` : `${session.firstName} (${session.chatId})`,
                    page: 'Telegram (@avisignalshelp_bot)',
                    intent: intent,
                    isHotLead: false
                });
            } catch (_) {}
        }

    }, FOLLOW_UP_DELAY_MS);
}

// ============================================================
// MAIN MESSAGE HANDLER
// ============================================================
async function handleClientMessage(message) {
    const chatId = message.chat.id;
    const text = (message.text || '').trim();
    const fromId = message.from?.id;

    // Ignore empty messages, channels, and group messages
    if (!text || message.chat.type !== 'private') return;

    // Rate limiting
    if (isClientRateLimited(String(chatId))) {
        console.warn(`⚠️ Client ${chatId} rate-limited`);
        return;
    }

    // Check admin takeover
    if (isClientTakenOver(String(chatId))) {
        // Forward message to admin so they can see it
        await sendClientMessage(
            ADMIN_CHAT,
            `📨 *Client ${chatId}* (${message.from?.first_name || 'User'}):\n\n${text}`
        );
        return;
    }

    console.log(`💬 Client message from ${chatId} (${message.from?.first_name || 'User'}): "${text.slice(0, 80)}"`);

    // Get or create session
    const session = getOrCreateSession(chatId, message);

    // Add user message to history
    addToSessionHistory(session, 'user', text);

    // Extract funnel slots (site, plan, method, email, payment ref)
    extractSlots(text, session);

    // Detect intent
    let intent = detectClientIntent(text, session.history);

    // Continue an in-progress code-recovery flow even when the latest
    // message alone doesn't re-trigger the paid_no_code intent
    // (e.g. the client just sends their email address or reference).
    const recovering = session.codeRecovery && session.codeRecovery !== 'resolved';
    if (recovering && intent !== 'payment_issue' && intent !== 'ready_to_buy') {
        intent = 'paid_no_code';
    }

    // Continue an in-progress deposit-issue flow — the reply IS the username
    if (session.depositIssue === 'awaiting_username'
        && !['payment_issue', 'ready_to_buy', 'paid_no_code', 'withdrawal_help'].includes(intent)) {
        intent = 'deposit_not_updated';
    }

    session.intent = intent;
    updateFunnelStage(session, intent);

    // Match conversation script
    const script = matchScript(text);

    // Notify admin about new client or hot lead
    if (!session.notifiedAdmin) {
        await notifyAdminNewClient(session, text);
    }
    if (intent === 'ready_to_buy') {
        await notifyAdminHotLead(session, text);
    }
    if (intent === 'payment_issue') {
        await notifyAdminPaymentIssue(session, text);
    }
    if (intent === 'withdrawal_help') {
        await notifyAdminWithdrawalIssue(session, text);
    }

    // ── Deposit not reflecting: deterministic flow ───────────
    if (intent === 'deposit_not_updated') {
        await handleDepositIssueFlow(chatId, session, text);
        scheduleFollowUp(session);
        return;
    }

    // ── Paid-but-no-code: deterministic recovery flow ─────────
    // Precision beats AI freeform here — run the staged flow.
    if (intent === 'paid_no_code') {
        await handlePaidNoCodeFlow(chatId, session, text);
        scheduleFollowUp(session);
        return;
    }

    // Build system prompt with script context
    let systemPrompt = CLIENT_SYSTEM_PROMPT;

    // Add user context
    systemPrompt += `\n\nCURRENT CONVERSATION CONTEXT:`;
    systemPrompt += `\n- Client name: ${session.firstName}`;
    systemPrompt += `\n- Detected intent: ${intent}`;
    systemPrompt += `\n- Messages exchanged: ${session.history.length}`;
    systemPrompt += `\n- Time in conversation: ${Math.round((Date.now() - session.startedAt) / 60000)} minutes`;

    // Inject matched script context
    if (script && script.context) {
        systemPrompt += `\n\nSCENARIO-SPECIFIC GUIDANCE:\n${script.context}`;
    }

    // Add intent-specific addon
    const intentAddon = getIntentAddon(intent, session);
    if (intentAddon) {
        systemPrompt += `\n\nINTENT-SPECIFIC INSTRUCTIONS:\n${intentAddon}`;
    }

    try {
        // Send "typing" action
        await telegramAPI('sendChatAction', { chat_id: chatId, action: 'typing' });

        // Generate AI response
        const completion = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: systemPrompt },
                ...session.history.map(h => ({ role: h.role, content: h.content }))
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.7,
            max_tokens: 500,
        });

        let reply = completion.choices[0]?.message?.content?.trim();

        if (!reply) {
            reply = `Hey ${session.firstName}! 👋 Thanks for reaching out. How can I help you today? Are you interested in our Aviator prediction bot?`;
        }

        // Clean up any AI self-identification slips
        reply = cleanResponse(reply);

        // Send text response
        await sendClientMessage(chatId, reply);
        addToSessionHistory(session, 'assistant', reply);

        // Send contextual media (if appropriate)
        await sendContextualMedia(chatId, session, script, intent, text);

        // Schedule follow-up
        scheduleFollowUp(session);

        console.log(`✅ Client response sent to ${chatId} (intent: ${intent})`);

    } catch (err) {
        console.error(`❌ Client bot AI error for ${chatId}:`, err.message);

        // Fallback response (no AI needed)
        const fallback = getFallbackResponse(text, session);
        await sendClientMessage(chatId, fallback);
        addToSessionHistory(session, 'assistant', fallback);
    }
}

// ============================================================
// DEPOSIT-NOT-REFLECTING FLOW (JetBet/ClassyBet claims)
// Reassure → collect site username → forward username+site to admin.
// session.depositIssue: null → 'awaiting_username' → 'forwarded'
// ============================================================
async function handleDepositIssueFlow(chatId, session, text) {
    // Stage 2: client replied with their site username
    if (session.depositIssue === 'awaiting_username') {
        session.slots.siteUsername = (text || '').trim().slice(0, 60);
        session.depositIssue = 'forwarded';

        const msg = `Thanks, ${session.firstName}! 🙏\n\n` +
            `I've noted *${session.slots.siteUsername}* on ${session.slots.site || 'the site'} — like I said, deposits normally update after some time. Just be patient and it will reflect automatically.\n\n` +
            `I've also flagged it for a manual check, so if anything is actually stuck we'll catch it ✅`;
        await sendClientMessage(chatId, msg);
        addToSessionHistory(session, 'assistant', msg);
        await notifyAdminDepositIssue(session, text); // forwards username + site
        return;
    }

    // Stage 1: claim received — reassure + ask for site username
    session.depositIssue = 'awaiting_username';
    const siteLabel = session.slots.site || 'the site';
    const msg = `Don't worry, ${session.firstName} — your deposit is safe 🙏\n\n` +
        `Deposits on ${siteLabel} sometimes take a little time to reflect — it updates automatically once the platform finishes processing, so just be patient.\n\n` +
        `Meanwhile, send me your *username on ${siteLabel}* and I'll flag it to be checked on my side ✅`;
    await sendClientMessage(chatId, msg);
    addToSessionHistory(session, 'assistant', msg);
    await notifyAdminDepositIssue(session, text); // initial claim alert
}

// ============================================================
// PAID-NO-CODE RECOVERY FLOW
// Deterministic staged flow — the most sensitive scenario,
// so it runs on templates + real DB lookups, not AI freeform.
// session.codeRecovery stages:
//   check_email → need_email / need_ref → pending_verify → resolved
// ============================================================
async function handlePaidNoCodeFlow(chatId, session, text) {
    // Client found the code on their own — close the loop warmly.
    if (/(found it|got it|i see it|it'?s there|received it|came through|in (my )?spam|in (my )?junk|it arrived)/i.test(text)) {
        session.codeRecovery = 'resolved';
        const msg = `Perfect, glad it landed! 🎉 Enter the code at ${BOT_URL} → *Enter Code* → *Activate* and your plan starts instantly. Enjoy the wins!`;
        await sendClientMessage(chatId, msg);
        addToSessionHistory(session, 'assistant', msg);
        return;
    }

    // Step 1 (per flow): ALWAYS start by having them check their email
    if (!session.codeRecovery) {
        session.codeRecovery = 'check_email';
        const msg = `Thanks for letting me know, ${session.firstName} 🙏\n\n` +
            `First — please check your *email inbox* and also the *spam/junk/promotions* folder for an email titled *"Your AviSignals Activation Code"*. It sometimes lands there.\n\n` +
            `If it's really not there, send me the *email address you paid with* (or your payment/transaction reference) and I'll pull up your order instantly.`;
        await sendClientMessage(chatId, msg);
        addToSessionHistory(session, 'assistant', msg);
        await notifyAdminPaidNoCode(session, text);
        return;
    }

    // We still don't have an email or reference to look up
    if (!session.slots.email && !session.slots.paymentRef) {
        session.codeRecoveryAttempts++;
        session.codeRecovery = 'need_email';

        if (session.codeRecoveryAttempts >= 2) {
            // Asked twice already — escalate rather than loop
            const msg = `No worries — I've flagged your order for a manual check on my side. 🛠️\n\n` +
                `If you can, send a *screenshot of your payment confirmation* or the *transaction reference* — that lets me verify and release your code immediately.`;
            await sendClientMessage(chatId, msg);
            addToSessionHistory(session, 'assistant', msg);
            await notifyAdminPaidNoCode(session, text);
            return;
        }

        const msg = `Got it — what's the *email address* you used when paying? (Or paste the transaction/payment reference.) I'll check your order status right now.`;
        await sendClientMessage(chatId, msg);
        addToSessionHistory(session, 'assistant', msg);
        return;
    }

    // We have an identifier — look the order up in Supabase
    await sendClientMessage(chatId, `Give me a second — checking your order now 🔎`);

    const result = await paymentSupport.lookupPayment({
        email: session.slots.email,
        reference: session.slots.paymentRef
    });

    // ── Branch A: payment found + verified → resend the code ──
    if (result.found && paymentSupport.isVerifiedStatus(result.payment.status)) {
        const payment = result.payment;
        const email = payment.profiles?.email || session.slots.email;
        const sent = await paymentSupport.resendCodeEmail(payment);

        session.codeRecovery = 'resolved';
        session.funnelStage = 'activated';

        let msg;
        if (sent.sent) {
            msg = `Found it — your payment is *confirmed* ✅\n\n` +
                `I've just re-sent your activation code to *${email}*. Check the inbox + spam/junk folder — subject is "Your AviSignals Activation Code".\n\n` +
                `If it still doesn't land in a few minutes, tell me and I'll drop the code right here in chat.`;
        } else {
            // Email delivery failed — deliver the code directly in chat
            const code = paymentSupport.getCodeForSite(payment.profiles?.assigned_site);
            msg = `Your payment is *confirmed* ✅ — the email is being stubborn, so here's your code directly:\n\n` +
                `🔑 *${code}*\n\n` +
                `Enter it at ${BOT_URL} → *Enter Code* → *Activate*. Your plan starts now 🚀`;
        }
        await sendClientMessage(chatId, msg);
        addToSessionHistory(session, 'assistant', msg);
        await notifyAdminPaidNoCode(session, text, payment);
        return;
    }

    // ── Branch B: payment found but still pending ─────────────
    if (result.found) {
        session.codeRecovery = 'pending_verify';
        const payment = result.payment;
        const msg = `Good news — I can see your payment *${payment.reference}* came through ✅\n\n` +
            `It's in the verification queue right now — codes go out automatically the moment it's confirmed, usually within minutes.\n\n` +
            `I've flagged yours for a priority check — sit tight, you'll have it shortly 💪`;
        await sendClientMessage(chatId, msg);
        addToSessionHistory(session, 'assistant', msg);
        await notifyAdminPaidNoCode(session, text, payment);
        return;
    }

    // ── Branch C: nothing found → manual verification needed ──
    session.codeRecovery = 'need_ref';
    const who = session.slots.email ? `*${session.slots.email}*` : 'that reference';
    const msg = `Hmm, I can't find an order under ${who} 🤔\n\n` +
        `Can you send me your *payment reference / transaction ID* or a screenshot of the payment confirmation? I'll verify it manually right now.`;
    await sendClientMessage(chatId, msg);
    addToSessionHistory(session, 'assistant', msg);
    await notifyAdminPaidNoCode(session, text, null);
}

// ============================================================
// INTENT ADDONS (injected into AI prompt based on intent)
// ============================================================
function getIntentAddon(intent, session = null) {
    // Dynamic guided checkout — only ever asks for the NEXT missing slot
    let readyToBuyAddon = `The user is showing BUY INTENT — this is a HOT lead.
→ Present plans leading with the popular pick: *Daily $75* (24hrs — most popular & affordable), then *Weekly $250* (7 days), *Monthly $800* (30 days).
→ Ask which site they play on to personalise.
→ Tell them to go to ${BOT_URL}, click Buy Code, select site and plan, then pay.
→ When they ask how the code is delivered: the code is sent to their EMAIL automatically after payment (check spam/junk too).
→ Keep it SHORT and action-focused.`;

    if (session) {
        const s = session.slots;
        const collected = `Collected so far — site: ${s.site || '?'}, plan: ${s.plan ? PLAN_LABELS[s.plan] : '?'}, method: ${s.method || '?'}`;
        let nextStep;
        if (!s.site) {
            nextStep = `Ask which betting site they play on (one short question — nothing else).`;
        } else if (!s.plan) {
            nextStep = `They play on ${s.site}. Present the plans with prices — lead with Daily $75 (most popular, most affordable), mention Weekly $250 and Monthly $800 as upgrades. Ask which plan they want.`;
        } else if (!s.method) {
            nextStep = `They want ${PLAN_LABELS[s.plan]} for ${s.site}. Ask how they want to pay: Mobile Money, Card, or Crypto (USDT TRC20 — always works 24/7).`;
        } else {
            nextStep = `All details collected (${s.site} + ${PLAN_LABELS[s.plan]} + ${s.method}). Give exact checkout steps: ${BOT_URL} → Buy Code → select ${s.site} → ${PLAN_LABELS[s.plan]} → on the payment modal SELECT THEIR LOCAL CURRENCY FIRST → choose ${s.method}. Remind: the code arrives by EMAIL automatically right after payment (check spam/junk too).`;
        }
        readyToBuyAddon = `The user is showing BUY INTENT — this is a HOT lead. Run the guided checkout.
${collected}
NEXT STEP — do ONLY this, keep it SHORT:
→ ${nextStep}
→ NEVER re-ask for slots already collected. NEVER dump all questions at once.`;
    }

    const addons = {
        ready_to_buy: readyToBuyAddon,

        frustrated: `The user is frustrated. De-escalate first.
→ Start with genuine apology. Don't be defensive.
→ Ask ONE specific question about the problem.
→ Do NOT upsell. Do NOT push any product.
→ Fix the issue first, then follow up later.`,

        needs_guidance: `The user needs step-by-step help.
→ Use numbered steps.
→ Be patient and thorough.
→ Guide them to the free trial first if they're new.`,

        skeptical: `The user doubts legitimacy. Be CONFIDENT, not defensive.
→ "I understand — lots of fake apps out there. AviSignals is different."
→ Offer two zero-risk proof options: free channel + free trial.
→ A win screenshot will be sent automatically.
→ "Try the free trial — play 5 rounds and watch the bot predict them all."`,

        hesitant: `The user is on the fence. Don't pressure.
→ Lower the barrier: free trial, zero payment, 60 minutes.
→ Make it feel like THEIR decision.
→ "Just try it — no commitment, no payment. See for yourself."`,

        browsing: `The user is exploring. Be friendly and informative.
→ Give a clear overview of free options + paid codes.
→ Recommend starting with the free trial.
→ Keep it conversational.`,

        payment_issue: `🚨 URGENT: The user is trying to PAY but is hitting an error! This is a HOT LEAD blocked by payment.
→ IMMEDIATELY recommend *Crypto (USDT TRC20)* — always live 24/7, never blocked by banks.
→ Remind them: "Select your country's local currency FIRST on the payment modal before choosing the payment method."
→ Offer direct help: "If you want, I can send you the USDT wallet address directly or help activate your code manually."
→ Ask which plan and site they want to confirm the order.
→ Be reassuring and fast — don't let this lead drop!`,

        withdrawal_help: `The user has a withdrawal issue. Reassure them.
→ If ClassyBet/JetBet withdrawal on hold: encourage them to pay the processing fee.
→ "We had another client with the exact same issue — they paid the fee and their payout cleared immediately."
→ If they ALREADY paid the fee and are still waiting: reassure the payout is processing, tell them to keep the fee confirmation, check the withdrawal history tab, and offer to check personally — do NOT push another payment.
→ Advise them to follow the platform's cashier instructions.`,

        deposit_help: `The user needs help depositing on the trial betting site.
→ Walk them through: Dashboard → Deposit/Cashier tab → select Card, Mobile Money, Crypto, or Apps.
→ Once funded, launch Aviator and follow the bot's predictions.`,
    };
    return addons[intent] || '';
}

// ============================================================
// RESPONSE CLEANUP
// ============================================================
function cleanResponse(text) {
    if (!text) return text;

    // Remove any AI self-identification
    let cleaned = text
        .replace(/I'm an AI\b/gi, "I'm here to help")
        .replace(/I am an AI\b/gi, "I'm here to help")
        .replace(/as an AI\b/gi, "personally")
        .replace(/I'm a (chat)?bot\b/gi, "I'm here")
        .replace(/I am a (chat)?bot\b/gi, "I'm here")
        .replace(/artificial intelligence/gi, "smart technology")
        .replace(/language model/gi, "")
        .replace(/\bARIA\b/g, "")  // Remove ARIA name if it leaks
        .replace(/contact (the |our )?admin/gi, "let me know")
        .replace(/@Aadmin4cnc/gi, "")  // Remove admin handle — bot IS admin
        .replace(/@avisignalshelp_bot/gi, "");  // Remove bot handle — bot IS the admin

    return cleaned.trim();
}

// ============================================================
// FALLBACK RESPONSES (when AI is unavailable)
// ============================================================
function getFallbackResponse(text, session) {
    const lower = (text || '').toLowerCase();

    // Paid but no code — never send a sales pitch to someone who already paid
    if (session.codeRecovery || /paid.*(but|and).*(no|not|didn'?t|haven'?t).*(code|email)|no code|haven'?t received|didn'?t receive|waiting for.*(code|activation)/i.test(lower)) {
        return `Thanks for letting me know, ${session.firstName} 🙏\n\n` +
            `First — please check your *email inbox* and the *spam/junk* folder for "Your AviSignals Activation Code".\n\n` +
            `If it's not there, send me the *email you paid with* or the *payment reference* and I'll pull up your order right now.`;
    }

    if (lower.includes('price') || lower.includes('cost') || lower.includes('how much') || lower.includes('$75') || lower.includes('buy')) {
        return `Hey ${session.firstName}! 💰 Here are our plans:\n\n` +
            `• *Daily* — $75 (24 hours)\n` +
            `• *Weekly* — $250 (7 days, save 52%!)\n` +
            `• *Monthly* — $800 (30 days, save 64%!)\n\n` +
            `Go to ${BOT_URL} → Click *Buy Code* → Select your site and plan → Pay! 🚀\n\n` +
            `Want to test it first? Grab the free trial — 60 minutes, no payment: ${BOT_URL}`;
    }

    if (lower.includes('free') || lower.includes('trial') || lower.includes('test')) {
        return `Hey ${session.firstName}! 🎮 You have TWO free options:\n\n` +
            `1️⃣ *Free Telegram Channel* — live signals 24/7: ${FREE_CHANNEL}\n` +
            `2️⃣ *Free Bot Trial* — 60 minutes on today's trial site: ${BOT_URL}\n\n` +
            `Try both — they're 100% free! Once you see the bot working, you can get a code for YOUR site.`;
    }

    if (lower.includes('withdraw') || lower.includes('hold') || lower.includes('processing fee') || lower.includes('payout')) {
        return `Hey ${session.firstName}! Regarding withdrawals on platforms like ClassyBet or JetBet: if your withdrawal is on hold for a processing fee, please go ahead and pay the fee to release it.\n\n` +
            `We had another client who ran into the exact same issue with their withdrawal on hold — once they paid the platform's processing fee, their payout cleared and was credited to their account immediately! 💪`;
    }

    if (lower.includes('deposit') || lower.includes('fund') || lower.includes('recharge')) {
        return `Hey ${session.firstName}! To deposit on your betting site:\n\n` +
            `1. Open your betting site dashboard or profile\n` +
            `2. Click on the *Deposit / Cashier* tab\n` +
            `3. Choose Card, Mobile Money (M-Pesa, etc.), Crypto, or Payment Apps\n` +
            `4. Confirm the amount to fund your balance\n\n` +
            `Once funded, launch Aviator and cash out with the bot's signals!`;
    }

    if (lower.includes('real') || lower.includes('scam') || lower.includes('legit')) {
        return `I totally understand the concern, ${session.firstName}. 💯 AviSignals is 100% real — we've been running for over a year with thousands of users worldwide.\n\n` +
            `Try it yourself for FREE:\n` +
            `📡 Free channel: ${FREE_CHANNEL}\n` +
            `🎮 Free trial: ${BOT_URL}\n\n` +
            `No payment needed. See the predictions work live!`;
    }

    return `Hey ${session.firstName}! 👋 Thanks for reaching out! I'm here to help.\n\n` +
        `AviSignals is an AI-powered Aviator predictor bot — it works on ALL betting sites worldwide.\n\n` +
        `Want to try it free?\n` +
        `📡 Join our main channel for regular *FREE code drops* & signals: ${FREE_CHANNEL}\n` +
        `🎮 Free 60-min live bot trial: ${BOT_URL}\n\n` +
        `What site do you play on? I'll help you get started! 🚀`;
}

// ============================================================
// ADMIN INLINE-BUTTON CALLBACKS
// Handles callback_query updates routed from telegramAgent.js
// (buttons attached to client alerts: takeover, log, USDT, verify, resend)
// ============================================================
async function handleAdminCallback(callbackQuery) {
    const data = callbackQuery.data || '';
    const adminChat = callbackQuery.message?.chat?.id;

    const answer = async (text) => {
        await telegramAPI('answerCallbackQuery', {
            callback_query_id: callbackQuery.id,
            text: text || 'Done'
        });
    };

    const toAdmin = async (text) => sendClientMessage(ADMIN_CHAT, text);

    try {
        // ── Takeover ─────────────────────────────────────────
        if (data.startsWith('takeover_')) {
            const targetId = data.replace('takeover_', '');
            setTakeover(targetId, true);
            await answer('Bot paused for this client');
            await toAdmin(`🔴 Bot paused for client \`${targetId}\`.\nTheir messages now forward to you. /reply ${targetId} [msg] to respond, /resume ${targetId} when done.`);
            return;
        }

        // ── View client log ──────────────────────────────────
        if (data.startsWith('clog_')) {
            const targetId = data.replace('clog_', '');
            const log = getClientHistory(targetId);
            await answer();
            if (!log) {
                await toAdmin(`❌ No conversation found for \`${targetId}\`.`);
                return;
            }
            let msg = `📋 *Chat Log — ${log.name}* ${log.username ? '(@' + log.username + ')' : ''}\n` +
                `Intent: _${log.intent}_ | Stage: _${log.funnelStage}_\n` +
                `Slots: site=${log.slots.site || '?'} plan=${log.slots.plan || '?'} method=${log.slots.method || '?'} email=${log.slots.email || '?'} ref=${log.slots.paymentRef || '?'}\n\n`;
            for (const h of log.history.slice(-8)) {
                msg += `${h.role === 'user' ? '👤' : '🤖'} ${h.content.slice(0, 150)}\n\n`;
            }
            await toAdmin(msg.slice(0, 4000));
            return;
        }

        // ── Send USDT payment details to client ───────────────
        if (data.startsWith('usdt_')) {
            const targetId = data.replace('usdt_', '');
            const session = clientSessions.get(String(targetId));
            const amount = session && session.slots.plan ? PLAN_AMOUNTS[session.slots.plan] : 75;
            const planLabel = session && session.slots.plan ? PLAN_LABELS[session.slots.plan] : 'Daily $75';

            const msg = `💳 *Pay via Crypto (USDT TRC20)* — always live 24/7, never blocked by banks.\n\n` +
                `Send *$${amount} USDT* (${planLabel}) to this TRC20 wallet:\n\n` +
                `\`${paymentSupport.USDT_WALLET_ADDRESS}\`\n\n` +
                `⚠️ Make sure the network is *TRC20* — sending on another network loses the funds.\n\n` +
                `Once sent, reply here with the *transaction hash / screenshot* and I'll activate your ${session?.slots?.site || 'site'} code immediately ⚡`;

            const res = await sendClientMessage(targetId, msg);
            if (session) addToSessionHistory(session, 'assistant', msg);
            await answer(res && res.ok ? 'USDT details sent to client' : 'Failed to send');
            await toAdmin(`${res && res.ok ? '✅' : '❌'} USDT details → \`${targetId}\` (${planLabel}).`);
            return;
        }

        // ── Verify payment & dispatch code ────────────────────
        if (data.startsWith('verify_')) {
            const m = data.match(/^verify_(.+)_(-?\d+)$/);
            if (!m) { await answer('Bad callback data'); return; }
            const [, reference, clientChatId] = m;
            await answer('Verifying...');

            const ok = await paymentSupport.adminVerifyPayment(reference);
            if (ok) {
                const session = clientSessions.get(String(clientChatId));
                if (session) { session.codeRecovery = 'resolved'; session.funnelStage = 'activated'; }
                await sendClientMessage(clientChatId,
                    `Great news — your payment is *confirmed* ✅\n\n` +
                    `Your activation code has just been sent to your email (check spam/junk too — subject: "Your AviSignals Activation Code").\n\n` +
                    `Enter it at ${BOT_URL} → *Enter Code* → *Activate*. Enjoy! 🚀`);
                await toAdmin(`✅ Verified \`${reference}\` — code dispatched to client \`${clientChatId}\`.`);
            } else {
                await toAdmin(`❌ Verification call failed for \`${reference}\`. Try /resendcode or check the admin panel.`);
            }
            return;
        }

        // ── Resend code email ─────────────────────────────────
        if (data.startsWith('resend_')) {
            const m = data.match(/^resend_(.+)_(-?\d+)$/);
            if (!m) { await answer('Bad callback data'); return; }
            const [, reference, clientChatId] = m;
            await answer('Resending...');

            const result = await paymentSupport.lookupPayment({ reference });
            if (!result.found) {
                await toAdmin(`❌ Payment \`${reference}\` not found in DB.`);
                return;
            }
            const sent = await paymentSupport.resendCodeEmail(result.payment);
            if (sent.sent) {
                await toAdmin(`✅ Code re-sent to ${sent.email} (ref \`${reference}\`).`);
                const session = clientSessions.get(String(clientChatId));
                if (session) { session.codeRecovery = 'resolved'; }
                await sendClientMessage(clientChatId,
                    `All sorted ✅ Your activation code has been re-sent to your email — check inbox + spam for "Your AviSignals Activation Code". Tell me if it doesn't land!`);
            } else {
                await toAdmin(`❌ Resend failed for \`${reference}\` (${sent.reason || 'email send failed'}).`);
            }
            return;
        }

        await answer('Unknown action');
    } catch (err) {
        console.error('❌ Admin callback error:', err.message);
        try { await answer('Error — check logs'); } catch (_) {}
    }
}

// ============================================================
// ADMIN COMMANDS (exported for telegramAgent.js)
// ============================================================

/**
 * Returns a summary of all active client conversations.
 */
function getActiveClients() {
    const now = Date.now();
    const active = [];

    for (const [chatId, session] of clientSessions.entries()) {
        const ageMin = Math.round((now - session.startedAt) / 60000);
        const lastMin = Math.round((now - session.lastMessageAt) / 60000);
        const takenOver = isClientTakenOver(chatId);

        active.push({
            chatId,
            name: session.firstName,
            username: session.username,
            intent: session.intent,
            funnelStage: session.funnelStage,
            slots: session.slots,
            codeRecovery: session.codeRecovery,
            messages: session.history.length,
            ageMin,
            lastMin,
            takenOver,
        });
    }

    // Sort by most recent
    active.sort((a, b) => a.lastMin - b.lastMin);
    return active;
}

/**
 * Returns conversation history for a specific client.
 */
function getClientHistory(chatId) {
    const session = clientSessions.get(String(chatId));
    if (!session) return null;

    return {
        chatId,
        name: session.firstName,
        username: session.username,
        intent: session.intent,
        funnelStage: session.funnelStage,
        slots: session.slots,
        codeRecovery: session.codeRecovery,
        history: session.history,
    };
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
    handleClientMessage,
    handleAdminCallback,
    sendClientMessage,
    getActiveClients,
    getClientHistory,
    isClientTakenOver,
    setTakeover,
    clientSessions,
};
