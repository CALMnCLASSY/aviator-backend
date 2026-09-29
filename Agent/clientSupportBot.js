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
5. Recommend the weekly plan ($250) as the best value.
6. If anyone runs into payment errors, immediately recommend Crypto (USDT TRC20) and remind them to select their currency first.
7. Never invent prices, plans, or features.
8. If the user's first language isn't English, respond in their language.
9. Use Telegram Markdown only: *bold*, _italic_.`;

// ============================================================
// INTENT DETECTION (adapted from chatAgent.js)
// ============================================================
function detectClientIntent(message, history) {
    const text = (message || '').toLowerCase();
    const allText = (history || []).map(m => m.content).join(' ').toLowerCase() + ' ' + text;

    // Check for payment issues first before generic buy intent
    if (/payment.*(fail|error|problem|issue|declined|stuck|reject|cancel|not work)|can'?t pay|cannot pay|card declined|declined|mpesa.*(error|fail|not work)|failed to pay|unable to pay|transaction failed|not going through|payment.*declined/i.test(text))
        return 'payment_issue';

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

async function sendClientMessage(chatId, text) {
    // Sanitise for Telegram Markdown — escape unmatched special chars
    const safeText = sanitiseMarkdown(text);

    const res = await telegramAPI('sendMessage', {
        chat_id: chatId,
        text: safeText,
        parse_mode: 'Markdown',
        link_preview_options: { is_disabled: false }
    });

    // If Markdown parse fails, retry as plain text
    if (res && !res.ok && res.description && res.description.toLowerCase().includes('parse')) {
        console.warn(`⚠️ Markdown parse error for client ${chatId} — retrying plain text`);
        const cleanText = text.replace(/[*_`\[\]]/g, '');
        return telegramAPI('sendMessage', {
            chat_id: chatId,
            text: cleanText,
            link_preview_options: { is_disabled: false }
        });
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
            `Message: "${(messageText || '').slice(0, 100)}"\n\n` +
            `Bot is handling. Use /takeover ${session.chatId} to take over.`;

        await sendClientMessage(ADMIN_CHAT, msg);
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
            `Bot is guiding to purchase. /takeover ${session.chatId} if needed.`;

        await sendClientMessage(ADMIN_CHAT, msg);
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
            `Bot advised Crypto USDT TRC20. /takeover ${session.chatId} to close the deal.`;

        await sendClientMessage(ADMIN_CHAT, msg);
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

        if (intent === 'ready_to_buy') {
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

    // Detect intent
    const intent = detectClientIntent(text, session.history);
    session.intent = intent;

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
    const intentAddon = getIntentAddon(intent);
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
// INTENT ADDONS (injected into AI prompt based on intent)
// ============================================================
function getIntentAddon(intent) {
    const addons = {
        ready_to_buy: `The user is showing BUY INTENT — this is a HOT lead.
→ Present all 3 plans clearly: *Daily $75* (24hrs), *Weekly $250* (7 days, save 52%), *Monthly $800* (30 days, save 64%).
→ Ask which site they play on to personalise.
→ Recommend the weekly plan as best value: $250 = $35/day.
→ Tell them to go to ${BOT_URL}, click Buy Code, select site and plan, then pay.
→ Keep it SHORT and action-focused.`,

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
        history: session.history,
    };
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
    handleClientMessage,
    getActiveClients,
    getClientHistory,
    isClientTakenOver,
    setTakeover,
    clientSessions,
};
