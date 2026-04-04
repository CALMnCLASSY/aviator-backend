// ============================================================
// chatAgent.js — AviSignals AI Chat Agent v2
//
// Key improvements over v1:
//  - Deep sales persona with objection handling & upsell triggers
//  - Intent detection (ready_to_buy, frustrated, confused, browsing)
//  - Lead capture: logs buy-intent users to Supabase for follow-up
//  - Per-user rate limiting (prevents API abuse)
//  - History kept at 10 messages (was 5) with smarter trimming
//  - Session summary sent to Discord with intent + lead flag
//  - Saves to correct support_chats table (not missing 'logs' table)
//  - Graceful Groq fallback responses on API errors
// ============================================================

'use strict';

const groq         = require('./groqClient');
const discordAgent = require('./discordAgent');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

// ─── Session store (in-memory) ───────────────────────────────
const chatSessions   = new Map();
const SESSION_TIMEOUT = 6 * 60 * 1000; // 6 min inactivity → trigger summary

// ─── Per-user rate limiting ───────────────────────────────────
const rateLimitMap   = new Map();
const RATE_LIMIT     = 30;       // max messages per window
const RATE_WINDOW_MS = 60 * 1000; // per 1 minute

function isRateLimited(userKey) {
    const now    = Date.now();
    const record = rateLimitMap.get(userKey) || { count: 0, windowStart: now };

    if (now - record.windowStart > RATE_WINDOW_MS) {
        // Reset window
        rateLimitMap.set(userKey, { count: 1, windowStart: now });
        return false;
    }

    record.count++;
    rateLimitMap.set(userKey, record);
    return record.count > RATE_LIMIT;
}

// ============================================================
// INTENT DETECTION
// Classifies what kind of user we're talking to so the AI
// can adjust its approach dynamically.
// ============================================================

function detectIntent(message, history) {
    const text    = message.toLowerCase();
    const allText = history.map(m => m.content).join(' ').toLowerCase() + ' ' + text;

    if (/buy|purchase|pay|payment|mpesa|card|activate|75|dollar|\$75|get code|want (to|the) code/i.test(text))
        return 'ready_to_buy';

    if (/doesn't work|not working|broken|scam|fake|cheat|refund|waste|useless|failed|wrong/i.test(text))
        return 'frustrated';

    if (/how|what|explain|tell me|confused|don't understand|help me|where|when|which/i.test(text))
        return 'needs_guidance';

    if (/win rate|accuracy|proof|evidence|screenshot|real|legit|trust|guarantee/i.test(allText))
        return 'skeptical';

    if (/tomorrow|later|maybe|soon|not now|think about it/i.test(text))
        return 'hesitant';

    return 'browsing';
}

// ============================================================
// SYSTEM PROMPT — The core AI persona
// This is the biggest upgrade. v1 had 9 bullet facts.
// v2 has a full sales persona with intent-aware instructions.
// ============================================================

const BASE_SYSTEM_PROMPT = `
You are ARIA — the AviSignals AI Sales & Support Agent. You are sharp, warm, and results-driven. 
You work for AviSignals, Kenya's most trusted Aviator game prediction platform.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PERSONA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Name: ARIA (AviSignals Real-time Intelligence Assistant)  
- Tone: Confident, friendly, persuasive — like a knowledgeable friend who knows the product inside out
- Never robotic. Never generic. Always specific to where the user is and what they need.
- You care about the user winning. You genuinely want them to succeed with Aviator.
- You are brief. 2-4 sentences per response unless explaining steps.
- You use formatting: **bold** for buttons/actions, bullet points for steps.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PRODUCT KNOWLEDGE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WHAT WE OFFER:
- An AI-powered Aviator game predictor bot on our website (avisignals.com/bot.html)
- The bot predicts the exact round multiplier so users know when to cash out
- We claim 100% accuracy — our AI analyses real-time round patterns

FREE TIER:
- Every registered user gets 1 free daily code
- Unlocks a 30-minute predictor session
- User clicks **FREE CODE** on the bot page → gets assigned a betting site → gets their code → clicks **Use Bot** → enters code → clicks **Activate**

PAID TIER:
- **$75 USD** = 24 hours of continuous uninterrupted predictor access  
- ONE plan only. No weekly, monthly, or other plans. Just the 24H code.
- Payment via **Mobile Money** or **Card** through Paystack (safe & instant)
- After payment, code is activated immediately — no waiting

HOW TO USE THE BOT:
1. Open avisignals.com/bot.html AND your Aviator game on your betting site simultaneously
2. Watch the bot — it shows the predicted multiplier for the NEXT round
3. Wait for that round → place your bet → cash out just BEFORE the shown multiplier
4. Repeat every round for the entire session

SUPPORTED SITES: All major betting platforms — 1win, SportyBet, 1xBet, Betika, Betway, Parimatch, BangBet, Bet365, OdiBets, Helabet, MozzartBet, and more.

REGISTRATION:
- Go to avisignals.com → click **Register** → enter email & password → confirm email → log in → go to Bot page → click **FREE CODE** to start

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SUPPORT CONTACTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Telegram admin (direct): [@Aadmin4cnc](https://t.me/Aadmin4cnc)
- WhatsApp admin: [+44 7400 756162](https://wa.me/447400756162)  
- Free signals Telegram channel: [AviSignals Channel](https://t.me/AviSignalsAviatorPredictorBot)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SALES RULES — READ CAREFULLY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. NEVER push registration to a logged-in user. Context tells you their login state.
2. IF the user has an unused daily code → focus ONLY on helping them use it right now.
3. IF the user's daily code is used up → empathise, then pivot to the $75 24H upgrade.
4. IF the user expresses buy intent → immediately confirm the price ($75), explain Mobile-money/card payment, and tell them exactly where to click (Buy Code button on the bot page after selecting their betting site).
5. NEVER invent prices, plans, or features that don't exist.
6. IF the user doubts accuracy → don't get defensive. Acknowledge the question and point to the free trial as proof: "Try the free session first — see for yourself."
7. IF the user is frustrated → apologise first, then solve. Never argue.
8. IF the user seems hesitant → create gentle urgency: "Slots fill up fast — the free code is already reserved for you."
9. UPSELL TRIGGER: After helping a user with their free code, ALWAYS end with one soft upsell sentence about the 24H plan.
10. NEVER tell a user they can't use the bot on their site. The bot works on ALL sites so they just come back daily to get a new code on a new site.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OBJECTION HANDLING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"Is this a scam?" → "Completely understand the caution — try the free daily session first, no payment required. If it works for you, then consider the upgrade."
"$75 is too expensive" → "That's fair. Consider this: one good Aviator session can return that in minutes. And you have a full 24 hours — unlimited rounds. over $1500 profit"
"It didn't work for me" → "Sorry to hear that. Let's fix it — which betting site were you on and what happened exactly? I'll get you sorted."
"I want a refund" → "I hear you. Please contact our admin directly on WhatsApp for account help: [+44 7400 756162](https://wa.me/447400756162) — they'll assist you right away."
"Can I get a discount?" → "Our pricing is fixed at $75 for the 24H code — it's already very competitive given the returns. But you can always start with the free daily trial first."
`;

// ============================================================
// INTENT-SPECIFIC PROMPT ADDONS
// Injected dynamically based on detected user intent
// ============================================================

const INTENT_ADDONS = {
    ready_to_buy: `
The user is showing BUY INTENT. This is a HOT lead.
→ Confirm price immediately: $75 for 24 hours.
→ Tell them to click **Buy Code** on the bot page (avisignals.com/bot.html).
→ Mention both Mobile-money and card are accepted, even crypto.
→ Emphasise instant activation — they start right after payment.
→ Keep it SHORT and action-focused. Remove all friction.
`,
    frustrated: `
The user is frustrated or unhappy. Your job is to de-escalate first.
→ Start with a genuine apology. Don't be defensive.
→ Ask one specific question to understand the problem.
→ Offer the admin WhatsApp as the fastest human resolution path.
→ Do NOT try to upsell a frustrated user.
`,
    needs_guidance: `
The user needs step-by-step help. Be their guide.
→ Use a numbered list for any process.
→ Confirm which page they're on if relevant.
→ Be patient and thorough — they're learning.
→ End with a soft confirmation: "Does that make sense? Let me know if you get stuck."
`,
    skeptical: `
The user is questioning accuracy or legitimacy. Don't get defensive.
→ Validate their concern — skepticism is smart.
→ Direct them to the FREE daily trial as proof: no risk, no payment.
→ Mention that the bot is used daily by hundreds across Kenya.
→ Suggest they try one session and judge for themselves.
`,
    hesitant: `
The user is on the fence. Create gentle, non-pushy urgency.
→ Remind them the free daily code is already waiting for them.
→ Make the starting step trivially easy: just click FREE CODE.
→ Don't pressure. Make it feel like THEIR decision.
`,
    browsing: `
The user is exploring. Be friendly and informative.
→ Give them a clear picture of what AviSignals offers.
→ Nudge them toward claiming their free daily code — zero commitment.
→ Keep it conversational and light.
`
};

// ============================================================
// SESSION SUMMARY — sent to Discord after inactivity
// ============================================================

async function triggerSessionSummary(userKey) {
    const session = chatSessions.get(userKey);
    if (!session || session.history.length === 0) return;

    try {
        const chatHistoryText = session.history
            .map(m => `${m.role === 'user' ? 'USER' : 'ARIA'}: ${m.content}`)
            .join('\n');

        const summaryPrompt = `You are an analyst reviewing an AviSignals customer support conversation.

User: ${session.userContext || 'Guest'}
Page: ${session.pageLocation || 'Unknown'}
Intent detected: ${session.intent || 'unknown'}

Full conversation:
${chatHistoryText}

Write a concise admin report (3-4 sentences max) covering:
1. Who the user is and what they wanted,include number if available ad if we should call them.
2. Whether they are a potential paying customer (yes/no and why)
3. Was the issue resolved? What was the outcome?
4. Recommended follow-up action for the admin (if any)

Flag as HOT LEAD if the user expressed any interest in buying the $75 code.`;

        const completion = await groq.chat.completions.create({
            messages: [{ role: 'user', content: summaryPrompt }],
            model:       'llama-3.3-70b-versatile',
            temperature: 0.4,
            max_tokens:  300
        });

        const summary   = completion.choices[0]?.message?.content ?? 'Summary unavailable.';
        const isHotLead = session.intent === 'ready_to_buy' ||
                          summary.toLowerCase().includes('hot lead');

        // 1. Send to Discord
        await discordAgent.sendChatSummary({
            text: `${isHotLead ? '🔥 HOT LEAD\n\n' : ''}${summary}`,
            user: session.userContext || 'Guest',
            page: session.pageLocation || 'Unknown'
        });

        // 2. Save full chat to Supabase support_chats table
        if (supabase && session.history.length > 0) {
            const rows = session.history.map(m => ({
                user_id:    session.userId || null,
                session_id: userKey,
                message:    m.content,
                sender:     m.role === 'user' ? 'user' : 'ai',
                created_at: new Date().toISOString()
            }));

            await supabase.from('support_chats').insert(rows)
                .then(({ error }) => {
                    if (error) console.error('⚠️  Chat persist error:', error.message);
                });
        }

        // 3. If hot lead — also log to a leads table for marketing follow-up
        if (isHotLead && session.userContext && session.userContext !== 'anonymous') {
            await supabase.from('email_sequences').insert({
                user_id:       session.userId || null,
                sequence_type: 'hot_lead',
                step:          1,
                channel:       'ai_chat',
                converted:     false
            }).then(({ error }) => {
                if (error) console.error('⚠️  Lead log error:', error.message);
            });
        }

        chatSessions.delete(userKey);

    } catch (err) {
        console.error('❌ Session summary error:', err.message);
    }
}

// ============================================================
// MAIN HANDLER
// ============================================================

async function handleChat(req, res) {
    try {
        const {
            message,
            history       = [],
            userContext,
            pageLocation,
            isLoggedIn    = false,
            sessionStatus = {},
            userId        = null
        } = req.body;

        if (!message || typeof message !== 'string') {
            return res.status(400).json({ error: 'Message is required.' });
        }

        if (message.length > 1000) {
            return res.status(400).json({ error: 'Message too long.' });
        }

        // ── Rate limiting ─────────────────────────────────────
        const userKey = userContext || req.ip || 'anonymous';
        if (isRateLimited(userKey)) {
            return res.status(429).json({
                reply: "You're sending messages very fast! Give me a second to catch up. 😄"
            });
        }

        // ── Detect intent ──────────────────────────────────────
        const intent     = detectIntent(message, history);
        const intentAddon = INTENT_ADDONS[intent] || INTENT_ADDONS.browsing;

        // ── Build user context string ──────────────────────────
        let contextBlock = `\n━━━━━━━━━━━━━━━━━━━━━━━━\nUSER CONTEXT\n━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        contextBlock += `Current page: ${pageLocation || 'unknown'}\n`;
        contextBlock += `Logged in: ${isLoggedIn ? 'YES — do NOT ask them to register or log in again' : 'NO — guide them to register'}\n`;

        if (userContext && userContext !== 'anonymous') {
            contextBlock += `User identifier: ${userContext}\n`;
        }

        // Session status injection
        if (sessionStatus) {
            if (sessionStatus.hasActiveSession) {
                contextBlock += `Bot session: ACTIVE (${sessionStatus.activationType}) — encourage them to be using the bot RIGHT NOW\n`;
            } else if (sessionStatus.hasDailyCode) {
                if (sessionStatus.isCodeUsed) {
                    contextBlock += `Daily code: ALREADY USED today on ${sessionStatus.assignedSite}. Suggest waiting until tomorrow OR buying the $75 24H code.\n`;
                } else {
                    contextBlock += `Daily code: UNUSED — code is ${sessionStatus.dailyCode} for ${sessionStatus.assignedSite}. Guide them to click 'Use Bot', select ${sessionStatus.assignedSite}, enter code, click Activate.\n`;
                }
            } else if (sessionStatus.assignedSite && sessionStatus.assignedSite !== 'none') {
                contextBlock += `Assigned site: ${sessionStatus.assignedSite} — but no code grabbed yet. Tell them to click FREE CODE.\n`;
            } else {
                contextBlock += `No code or session yet. Guide them to click FREE CODE on the bot page.\n`;
            }
        }

        contextBlock += `Detected intent: ${intent}\n`;

        // ── Assemble message array ─────────────────────────────
        const messages = [
            {
                role:    'system',
                content: BASE_SYSTEM_PROMPT + contextBlock + `\nINTENT-SPECIFIC INSTRUCTIONS:\n${intentAddon}`
            }
        ];

        // Keep last 10 messages (was 5) — enough context without token bloat
        const recentHistory = Array.isArray(history) ? history.slice(-10) : [];
        recentHistory.forEach(msg => {
            if (msg.role === 'user' || msg.role === 'assistant') {
                messages.push({ role: msg.role, content: String(msg.content).slice(0, 800) });
            }
        });

        // Add current message if not already the last in history
        const lastMsg = recentHistory[recentHistory.length - 1];
        if (!lastMsg || lastMsg.content !== message) {
            messages.push({ role: 'user', content: message });
        }

        // ── Call Groq ──────────────────────────────────────────
        let reply;
        try {
            const completion = await groq.chat.completions.create({
                messages,
                model:       'llama-3.3-70b-versatile',
                temperature: 0.65,
                max_tokens:  450
            });
            reply = completion.choices[0]?.message?.content?.trim();
        } catch (groqErr) {
            console.error('❌ Groq API error:', groqErr.message);
            // Graceful fallback — don't show a blank error to the user
            reply = `I'm having a brief technical issue. For immediate help, reach our admin on WhatsApp: [+44 7400 756162](https://wa.me/447400756162) or Telegram: [@Aadmin4cnc](https://t.me/Aadmin4cnc).`;
        }

        if (!reply) {
            reply = "Something went wrong on my end. Please try again or contact our admin on WhatsApp.";
        }

        // ── Update session store ───────────────────────────────
        let session = chatSessions.get(userKey) || {
            history:      [],
            timer:        null,
            userContext:  userContext || 'Guest',
            pageLocation: pageLocation || 'Unknown',
            userId:       userId,
            intent:       intent
        };

        // Update intent to the most recent (overwrite if more specific)
        if (intent !== 'browsing') session.intent = intent;

        if (session.timer) clearTimeout(session.timer);

        session.history.push({ role: 'user',      content: message });
        session.history.push({ role: 'assistant', content: reply   });

        // Cap stored history at 20 entries to keep memory usage bounded
        if (session.history.length > 20) {
            session.history = session.history.slice(-20);
        }

        session.timer = setTimeout(() => triggerSessionSummary(userKey), SESSION_TIMEOUT);
        chatSessions.set(userKey, session);

        // ── Respond ────────────────────────────────────────────
        return res.json({
            reply,
            intent // Send intent back so frontend can optionally adjust UI
        });

    } catch (err) {
        console.error('❌ handleChat error:', err);
        return res.status(500).json({
            reply: "I'm having trouble right now. Please contact our admin: [WhatsApp](https://wa.me/447400756162)"
        });
    }
}

module.exports = { handleChat };












/**
 * AviSignals AI Chat — Frontend v2
 *
 * Key improvements over v1:
 *  - Reads auth from Supabase (not localStorage)
 *  - Quick-reply chips so users don't stare at a blank input
 *  - Unread badge on the toggle button
 *  - Smart welcome message based on login state
 *  - Upsell chip appears after AI responses about free code
 *  - Mobile responsive (adapts to small screens)
 *  - Fixed markdown rendering (no broken <ul> wrapping)
 *  - Intent-aware chip sets (changes based on server response)
 *  - Keyboard accessible (Escape closes window)
 *  - No dependency on localStorage for auth state
 */

(function () {
    'use strict';

    // ─── Config ────────────────────────────────────────────────
    const BACKEND_URL = window.location.hostname === 'localhost' ||
                        window.location.hostname === '127.0.0.1'
        ? 'http://localhost:5000/api/ai/chat'
        : 'https://back.avisignals.com/api/ai/chat';

    // Supabase — reads the same client you already init on each page
    // Expects `window.db` to be the Supabase client (set in your HTML head)
    const getSupabaseUser = async () => {
        try {
            if (window.db) {
                const { data: { user } } = await window.db.auth.getUser();
                return user;
            }
        } catch (_) {}
        return null;
    };

    // ─── State ──────────────────────────────────────────────────
    let chatHistory  = [];
    let isOpen       = false;
    let unreadCount  = 0;
    let currentUser  = null;   // Supabase user object
    let sessionId    = 'chat_' + Math.random().toString(36).slice(2, 11);

    // ─── Quick reply chip sets ──────────────────────────────────
    const CHIP_SETS = {
        welcome: [
            'How do I get my free code?',
            'How does the bot work?',
            'How do I pay $75?',
            'Which betting sites work?'
        ],
        after_free_code: [
            'Get 24H unlimited access — $75',
            'How do I use my code?',
            'Contact admin on WhatsApp'
        ],
        after_buy: [
            'How do I pay with M-Pesa?',
            'How do I pay with card?',
            'Contact admin on WhatsApp'
        ],
        general: [
            'Get free daily code',
            'Upgrade to 24H — $75',
            'How to use the bot',
            'Talk to admin'
        ]
    };

    // ─── CSS ───────────────────────────────────────────────────
    const injectStyles = () => {
        const style = document.createElement('style');
        style.innerHTML = `
        #avi-chat-toggle {
            position: fixed; bottom: 25px; right: 25px;
            width: 62px; height: 62px;
            background: linear-gradient(135deg, #f1c40f, #d4ac0d);
            border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            box-shadow: 0 6px 20px rgba(241,196,15,0.45);
            cursor: pointer; z-index: 9999;
            transition: transform 0.25s cubic-bezier(0.175,0.885,0.32,1.275);
            border: 3px solid rgba(255,255,255,0.2);
            animation: avi-pulse 3s infinite ease-in-out;
        }
        #avi-chat-toggle:hover { transform: scale(1.12) translateY(-4px); animation-play-state: paused; }
        #avi-chat-toggle i { font-size: 28px; color: #10152b; }
        @keyframes avi-pulse { 0%,100%{box-shadow:0 6px 20px rgba(241,196,15,0.4)} 50%{box-shadow:0 6px 30px rgba(241,196,15,0.7)} }

        #avi-unread-badge {
            display: none; position: absolute; top: -4px; right: -4px;
            background: #e74c3c; color: #fff; border-radius: 50%;
            width: 22px; height: 22px; font-size: 11px; font-weight: 700;
            align-items: center; justify-content: center;
            border: 2px solid #10152b;
        }
        #avi-unread-badge.show { display: flex; }

        .avi-label {
            position: fixed; bottom: 34px; right: 102px;
            background: #fff; color: #10152b;
            padding: 9px 16px; border-radius: 18px;
            border-bottom-right-radius: 3px;
            font-size: 13px; font-weight: 600;
            white-space: nowrap; box-shadow: 0 4px 14px rgba(0,0,0,0.25);
            z-index: 9998; transition: opacity 0.3s;
            animation: avi-label-bob 4s infinite ease-in-out;
        }
        .avi-label::after {
            content:''; position:absolute; bottom:0; right:-7px;
            width:13px; height:13px; background:#fff;
            clip-path: polygon(0 0, 0% 100%, 100% 100%);
        }
        @keyframes avi-label-bob { 0%,100%{transform:translateX(0)} 50%{transform:translateX(-4px)} }

        #avi-chat-window {
            position: fixed; bottom: 100px; right: 20px;
            width: 370px; max-width: calc(100vw - 20px);
            height: min(560px, calc(100vh - 120px));
            background: rgba(11,13,23,0.97);
            backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
            border: 1px solid rgba(241,196,15,0.35);
            border-radius: 18px;
            display: none; flex-direction: column;
            box-shadow: 0 18px 50px rgba(0,0,0,0.65);
            z-index: 9999; overflow: hidden;
            font-family: 'Outfit','Inter','Segoe UI',Arial,sans-serif;
            transition: opacity 0.25s, transform 0.25s;
            opacity: 0; transform: translateY(20px) scale(0.97);
        }
        #avi-chat-window.open {
            display: flex;
            animation: avi-slide-up 0.25s ease forwards;
        }
        @keyframes avi-slide-up {
            to { opacity:1; transform: translateY(0) scale(1); }
        }

        .avi-header {
            background: linear-gradient(135deg, #f1c40f, #c9a20c);
            padding: 13px 18px;
            display: flex; align-items: center; justify-content: space-between;
            flex-shrink: 0;
        }
        .avi-header-left { display:flex; align-items:center; gap:10px; }
        .avi-avatar {
            width: 36px; height: 36px; border-radius: 50%;
            background: #10152b;
            display: flex; align-items: center; justify-content: center;
            font-size: 18px;
        }
        .avi-header-name { font-weight: 700; font-size: 15px; color: #10152b; }
        .avi-header-status { font-size: 11px; color: #1a2a0a; opacity: 0.75; margin-top:1px; }
        .avi-close {
            background: none; border: none;
            font-size: 22px; color: #10152b;
            cursor: pointer; opacity: 0.65; line-height: 1;
            transition: opacity 0.2s;
        }
        .avi-close:hover { opacity: 1; }

        .avi-messages {
            flex: 1; overflow-y: auto;
            padding: 14px 14px 6px;
            display: flex; flex-direction: column; gap: 10px;
            background: #0a0c18;
        }
        .avi-messages::-webkit-scrollbar { width: 4px; }
        .avi-messages::-webkit-scrollbar-track { background: transparent; }
        .avi-messages::-webkit-scrollbar-thumb { background: rgba(241,196,15,0.3); border-radius: 4px; }

        .avi-bubble {
            max-width: 82%; padding: 10px 13px;
            border-radius: 14px; font-size: 13.5px;
            line-height: 1.45; word-wrap: break-word; hyphens: auto;
        }
        .avi-bubble.ai {
            background: #161c35; color: #e8e8e8;
            align-self: flex-start;
            border-bottom-left-radius: 4px;
            border: 1px solid rgba(241,196,15,0.12);
        }
        .avi-bubble.user {
            background: #2ecc71; color: #0b1a0f;
            align-self: flex-end;
            border-bottom-right-radius: 4px;
            font-weight: 500;
        }
        .avi-bubble.ai a { color: #f1c40f; font-weight: 600; }
        .avi-bubble.ai strong { color: #f1c40f; font-weight: 700; }
        .avi-bubble.ai ul { margin: 6px 0 2px; padding-left: 18px; }
        .avi-bubble.ai li { margin-bottom: 3px; }
        .avi-bubble.ai ol { margin: 6px 0 2px; padding-left: 18px; }

        .avi-typing {
            display: flex; gap: 4px; padding: 10px 13px;
            background: #161c35; border-radius: 14px;
            border-bottom-left-radius: 4px; align-self: flex-start;
            align-items: center;
            border: 1px solid rgba(241,196,15,0.12);
        }
        .avi-typing span {
            width: 6px; height: 6px;
            background: #f1c40f; border-radius: 50%;
            animation: avi-dot 1.4s infinite ease-in-out both;
        }
        .avi-typing span:nth-child(1) { animation-delay: -0.32s; }
        .avi-typing span:nth-child(2) { animation-delay: -0.16s; }
        @keyframes avi-dot { 0%,80%,100%{transform:scale(0)} 40%{transform:scale(1)} }

        .avi-chips {
            display: flex; flex-wrap: wrap; gap: 6px;
            padding: 8px 14px 6px; flex-shrink: 0;
            background: #0a0c18; border-top: 1px solid rgba(255,255,255,0.05);
        }
        .avi-chip {
            background: rgba(241,196,15,0.1);
            border: 1px solid rgba(241,196,15,0.3);
            color: #f1c40f; border-radius: 99px;
            padding: 5px 12px; font-size: 12px;
            cursor: pointer; transition: background 0.2s, transform 0.15s;
            white-space: nowrap;
        }
        .avi-chip:hover { background: rgba(241,196,15,0.2); transform: translateY(-1px); }
        .avi-chip:active { transform: scale(0.97); }

        .avi-input-row {
            display: flex; gap: 8px; padding: 10px 12px;
            background: #10152b; border-top: 1px solid rgba(255,255,255,0.08);
            flex-shrink: 0; align-items: flex-end;
        }
        #avi-input {
            flex: 1; padding: 9px 13px;
            border-radius: 18px;
            border: 1px solid rgba(255,255,255,0.1);
            background: #0a0c18; color: #fff;
            outline: none; font-size: 13.5px;
            font-family: inherit; resize: none;
            min-height: 38px; max-height: 90px;
            transition: border-color 0.2s;
            line-height: 1.4;
        }
        #avi-input::placeholder { color: rgba(255,255,255,0.35); }
        #avi-input:focus { border-color: rgba(241,196,15,0.6); }
        #avi-send {
            background: #f1c40f; color: #10152b;
            border: none; width: 38px; height: 38px;
            border-radius: 50%; cursor: pointer;
            display: flex; align-items: center; justify-content: center;
            flex-shrink: 0; transition: background 0.2s, transform 0.15s;
        }
        #avi-send:hover { background: #d4ac0d; transform: scale(1.08); }
        #avi-send:active { transform: scale(0.95); }
        #avi-send i { font-size: 15px; }

        @media (max-width: 430px) {
            #avi-chat-window { right: 8px; width: calc(100vw - 16px); bottom: 90px; }
            .avi-label { right: 88px; font-size: 12px; padding: 7px 13px; }
            #avi-chat-toggle { bottom: 18px; right: 18px; width: 55px; height: 55px; }
        }
        `;
        document.head.appendChild(style);
    };

    // ─── HTML ───────────────────────────────────────────────────
    const injectHTML = () => {
        const wrap = document.createElement('div');
        wrap.innerHTML = `
        <div class="avi-label" id="avi-label">👋 Need help with predictions?</div>

        <div id="avi-chat-toggle" role="button" aria-label="Open chat" tabindex="0">
            <i class="fas fa-comment-dots"></i>
            <div id="avi-unread-badge">0</div>
        </div>

        <div id="avi-chat-window" role="dialog" aria-label="AviSignals Support Chat">
            <div class="avi-header">
                <div class="avi-header-left">
                    <div class="avi-avatar">🤖</div>
                    <div>
                        <div class="avi-header-name">ARIA — AviSignals</div>
                        <div class="avi-header-status">● Online • Instant replies</div>
                    </div>
                </div>
                <button class="avi-close" id="avi-close" aria-label="Close chat">&times;</button>
            </div>

            <div class="avi-messages" id="avi-messages"></div>

            <div class="avi-chips" id="avi-chips"></div>

            <div class="avi-input-row">
                <textarea id="avi-input" placeholder="Ask me anything..." rows="1"></textarea>
                <button id="avi-send" aria-label="Send message"><i class="fas fa-paper-plane"></i></button>
            </div>
        </div>
        `;
        document.body.appendChild(wrap);
    };

    // ─── Markdown renderer ──────────────────────────────────────
    // Fixed version — processes block elements before inline ones
    // to avoid the broken <ul> wrapping bug in v1
    function renderMarkdown(text) {
        if (!text) return '';

        const lines   = text.split('\n');
        const output  = [];
        let inList    = false;
        let listType  = null;

        const flushList = () => {
            if (inList) {
                output.push(`</${listType}>`);
                inList = false; listType = null;
            }
        };

        lines.forEach(line => {
            // Ordered list item
            if (/^\d+\.\s+/.test(line)) {
                if (!inList || listType !== 'ol') { flushList(); output.push('<ol>'); inList = true; listType = 'ol'; }
                output.push(`<li>${inlineMarkdown(line.replace(/^\d+\.\s+/, ''))}</li>`);
                return;
            }
            // Unordered list item
            if (/^[-*]\s+/.test(line)) {
                if (!inList || listType !== 'ul') { flushList(); output.push('<ul>'); inList = true; listType = 'ul'; }
                output.push(`<li>${inlineMarkdown(line.replace(/^[-*]\s+/, ''))}</li>`);
                return;
            }
            // Normal line
            flushList();
            if (line.trim() === '') {
                output.push('<br>');
            } else {
                output.push(`<span>${inlineMarkdown(line)}</span><br>`);
            }
        });

        flushList();
        // Clean up double <br> at end
        return output.join('').replace(/(<br>)+$/, '');
    }

    function inlineMarkdown(text) {
        return text
            // Markdown links [text](url)
            .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
            // Bold **text**
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            // Italic *text*
            .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
            // Bare URLs (not already in an href)
            .replace(/(?<!href=")(https?:\/\/[^\s<"]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    }

    // ─── UI helpers ─────────────────────────────────────────────
    function addMessage(sender, text) {
        const messages = document.getElementById('avi-messages');
        const bubble   = document.createElement('div');
        bubble.className = `avi-bubble ${sender}`;

        if (sender === 'ai') {
            bubble.innerHTML = renderMarkdown(text);
        } else {
            // User messages: plain text only for safety
            bubble.textContent = text;
        }

        messages.appendChild(bubble);
        bubble.scrollIntoView({ behavior: 'smooth', block: 'end' });

        // Unread badge when window is closed
        if (!isOpen && sender === 'ai') {
            unreadCount++;
            const badge = document.getElementById('avi-unread-badge');
            badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
            badge.classList.add('show');
        }

        return bubble;
    }

    function showTyping() {
        const messages = document.getElementById('avi-messages');
        const dot      = document.createElement('div');
        dot.className  = 'avi-typing';
        dot.id         = 'avi-typing';
        dot.innerHTML  = '<span></span><span></span><span></span>';
        messages.appendChild(dot);
        dot.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }

    function hideTyping() {
        const dot = document.getElementById('avi-typing');
        if (dot) dot.remove();
    }

    function setChips(chips) {
        const container = document.getElementById('avi-chips');
        container.innerHTML = '';
        chips.forEach(label => {
            const btn    = document.createElement('button');
            btn.className = 'avi-chip';
            btn.textContent = label;
            btn.onclick  = () => sendMessage(label);
            container.appendChild(btn);
        });
    }

    function openChat() {
        const win = document.getElementById('avi-chat-window');
        const lbl = document.getElementById('avi-label');
        win.style.display = 'flex';
        requestAnimationFrame(() => win.classList.add('open'));
        if (lbl) lbl.style.display = 'none';
        isOpen = true;
        // Clear unread badge
        unreadCount = 0;
        const badge = document.getElementById('avi-unread-badge');
        badge.textContent = '0';
        badge.classList.remove('show');
        document.getElementById('avi-input').focus();
    }

    function closeChat() {
        const win = document.getElementById('avi-chat-window');
        const lbl = document.getElementById('avi-label');
        win.classList.remove('open');
        setTimeout(() => { win.style.display = 'none'; }, 250);
        if (lbl) lbl.style.display = 'block';
        isOpen = false;
    }

    // ─── Session status (now reads from Supabase + localStorage fallback) ──
    async function getSessionStatus() {
        let status = {
            isLoggedIn:       false,
            hasActiveSession: false,
            assignedSite:     'none',
            hasDailyCode:     false,
            dailyCode:        '',
            isCodeUsed:       false,
            activationType:   'none'
        };

        // 1. Auth state — prefer Supabase, fall back to localStorage
        if (currentUser) {
            status.isLoggedIn = true;
        } else {
            const localContact = localStorage.getItem('aviator_contact');
            if (localContact && localContact !== 'Unknown User') {
                status.isLoggedIn = true;
            }
        }

        // 2. Bot session state (still in localStorage for now — migrate when bot page updates)
        try {
            const sessionRaw = localStorage.getItem('avisignals_session_state_v1');
            if (sessionRaw) {
                const session = JSON.parse(sessionRaw);
                if (session?.expiry > Date.now()) {
                    status.hasActiveSession = true;
                    status.activationType   = session.reason || 'active';
                }
            }

            const activationRaw = localStorage.getItem('avisignals_daily_activation_v1');
            if (activationRaw) {
                const act   = JSON.parse(activationRaw);
                const today = new Date().toISOString().slice(0, 10);
                if (act?.lastActivatedDate === today) {
                    status.assignedSite   = act.site    || 'none';
                    status.hasDailyCode   = !!act.code;
                    status.dailyCode      = act.code    || '';
                    status.isCodeUsed     = !!act.codeUsed;
                    if (!status.activationType || status.activationType === 'none') {
                        status.activationType = act.activationType || 'none';
                    }
                }
            }

            if (status.assignedSite === 'none') {
                status.assignedSite = localStorage.getItem('selectedSite') || 'none';
            }
        } catch (_) {}

        return status;
    }

    // ─── Core send function ─────────────────────────────────────
    async function sendMessage(text) {
        text = (text || '').trim();
        if (!text) return;

        // Clear input
        const input = document.getElementById('avi-input');
        input.value = '';
        input.style.height = 'auto';

        // Clear chips while waiting
        setChips([]);

        addMessage('user', text);
        chatHistory.push({ role: 'user', content: text });
        showTyping();

        const sessionStatus = await getSessionStatus();

        try {
            const body = {
                sessionId,
                message:       text,
                history:       chatHistory.slice(-10),
                userContext:   currentUser?.email?.split('@')[0] || localStorage.getItem('aviator_contact') || 'anonymous',
                userId:        currentUser?.id || null,
                pageLocation:  window.location.pathname.split('/').pop() || 'index.html',
                isLoggedIn:    sessionStatus.isLoggedIn,
                sessionStatus
            };

            const res  = await fetch(BACKEND_URL, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(body),
                signal:  AbortSignal.timeout(15000)
            });

            const data = await res.json();
            hideTyping();

            const reply  = data?.reply || "I'm having trouble right now. Try again or WhatsApp us.";
            const intent = data?.intent || 'browsing';

            addMessage('ai', reply);
            chatHistory.push({ role: 'assistant', content: reply });

            // Show relevant chips based on intent
            if      (intent === 'ready_to_buy')   setChips(CHIP_SETS.after_buy);
            else if (intent === 'needs_guidance')  setChips(CHIP_SETS.after_free_code);
            else                                   setChips(CHIP_SETS.general);

        } catch (err) {
            hideTyping();
            console.error('AI Chat error:', err);
            const msg = err.name === 'TimeoutError'
                ? "That took too long. Please check your connection and try again."
                : "Network error. Make sure you're connected and try again.";
            addMessage('ai', msg);
            setChips(CHIP_SETS.general);
        }
    }

    // ─── Welcome message (personalised) ────────────────────────
    async function showWelcome() {
        currentUser = await getSupabaseUser();
        const sessionStatus = await getSessionStatus();
        let msg;

        if (currentUser || sessionStatus.isLoggedIn) {
            const name = currentUser?.user_metadata?.full_name?.split(' ')[0]
                      || currentUser?.email?.split('@')[0]
                      || 'there';

            if (sessionStatus.hasActiveSession) {
                msg = `Welcome back, **${name}**! 🎯 Your predictor session is active right now — head to the bot and start playing!`;
            } else if (sessionStatus.hasDailyCode && !sessionStatus.isCodeUsed) {
                msg = `Hey **${name}**! 👋 Your free daily code is ready and waiting. Click **Use Bot**, select **${sessionStatus.assignedSite}**, enter your code, and hit **Activate**. Need help?`;
            } else {
                msg = `Welcome back, **${name}**! 🚀 Click **FREE CODE** on the bot page to grab today's prediction code — it's already reserved for you.`;
            }
        } else {
            msg = `Hello! I'm **ARIA**, your AviSignals assistant. 👋\n\nI can help you get predictions, activate your bot, or answer any questions.\n\nWhat can I help you with?`;
        }

        addMessage('ai', msg);
        setChips(CHIP_SETS.welcome);
    }

    // ─── Auto-resize textarea ───────────────────────────────────
    const autoResize = (el) => {
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 90) + 'px';
    };

    // ─── Init ───────────────────────────────────────────────────
    const init = () => {
        injectStyles();
        injectHTML();

        const toggle = document.getElementById('avi-chat-toggle');
        const close  = document.getElementById('avi-close');
        const input  = document.getElementById('avi-input');
        const send   = document.getElementById('avi-send');
        const label  = document.getElementById('avi-label');

        toggle.addEventListener('click', () => { isOpen ? closeChat() : openChat(); });
        toggle.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); isOpen ? closeChat() : openChat(); }});

        close.addEventListener('click', closeChat);
        label.addEventListener('click', openChat);

        send.addEventListener('click', () => sendMessage(input.value));
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input.value); }
        });
        input.addEventListener('input', () => autoResize(input));

        // Escape key closes
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen) closeChat(); });

        // Show welcome after short delay
        setTimeout(showWelcome, 900);

        // Show label greeting, hide after 8s
        setTimeout(() => {
            const lbl = document.getElementById('avi-label');
            if (lbl && !isOpen) { lbl.style.opacity = '0'; setTimeout(() => lbl.remove(), 400); }
        }, 8000);
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();