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

const groq = require('./groqClient');
const discordAgent = require('./discordAgent');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── Session store (in-memory) ───────────────────────────────
const chatSessions = new Map();
const SESSION_TIMEOUT = 6 * 60 * 1000; // 6 min inactivity → trigger summary

// ─── Per-user rate limiting ───────────────────────────────────
const rateLimitMap = new Map();
const RATE_LIMIT = 30;       // max messages per window
const RATE_WINDOW_MS = 60 * 1000; // per 1 minute

function isRateLimited(userKey) {
    const now = Date.now();
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
    const text = message.toLowerCase();
    const allText = history.map(m => m.content).join(' ').toLowerCase() + ' ' + text;

    if (/buy|purchase|pay|payment|mpesa|card|activate|75|250|1500|dollar|\$75|\$250|\$1500|get code|want (to|the) code|weekly|monthly|7 day|30 day/i.test(text))
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
You work for AviSignals, Europe's most trusted Aviator game prediction platform.

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
- Unlocks a 60-minute predictor session
- User clicks **FREE CODE** on the bot page → gets assigned a betting site → gets their code → clicks **Use Bot** → enters code → clicks **Activate**

PAID TIERS (3 plans available):
- **Daily Plan — $39 USD** = 24 hours of continuous uninterrupted predictor access
- **Weekly Plan — $149 USD** = 7 full days of predictor access (save 45% vs buying daily!)
- **Monthly Plan — $499 USD** = 30 days of premium predictor access (best value for serious players)
- All plans: user selects whatever betting site they want to play on
- Payment via **Mobile Money**, **Card** (Flutterwave), or **Crypto** (USDT TRC20) — safe & instant
- After payment, activation code is delivered immediately — no waiting
- The code lasts the full duration of the purchased plan

HOW TO USE THE BOT:
1. Open avisignals.com/bot AND your Aviator game on your betting site simultaneously
2. Watch the bot — it shows the predicted multiplier for the NEXT round
3. Wait for that round → place your bet → cash out just BEFORE the shown multiplier
4. Repeat every round for the entire session

SUPPORTED SITES: All major betting platforms — 1win, SportyBet, 1xBet, Betika, Betway, Parimatch, BangBet, Bet365, OdiBets, Helabet, MozzartBet, ClassyBet, 22bet, Hollywoodbet and more.

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
3. IF the user's daily code is used up → empathise, then pivot to the paid plans. Start with $39 daily, and mention weekly ($149) and monthly ($499) for better value.
4. IF the user expresses buy intent → immediately confirm the 3 available plans, explain payment methods, and tell them exactly where to click (Buy Code button on the bot page after selecting their betting site). Guide them to select a plan in the payment modal.
5. NEVER invent prices, plans, or features that don't exist. Only the 3 plans above exist.
6. IF the user doubts accuracy → don't get defensive. Acknowledge the question and point to the free trial as proof: "Try the free session first — see for yourself."
7. IF the user is frustrated → apologise first, then solve. Never argue.
8. IF the user seems hesitant → create gentle non-pushy urgency: "Slots fill up fast — the free code is already reserved for you."
9. UPSELL TRIGGER: After helping a user with their free code, ALWAYS end with one soft upsell sentence about the paid plans. Mention the weekly plan as great value.
10. NEVER tell a user they can't use the bot on their site. The bot works on ALL sites so they just come back the next day to get a new code on a new site.
11. If a client want a code for a specific site clarify distinction on Free Code and Paid tier and tell them to come back the next day for their luck to get a code on their site, but if they want a specidic one and don't want to wait the next day they have to pay.
12. If they seem to be a hot lead and are having trouble making payment ask them for their contact(best way to reach out to them) and provide admin details
13. When upselling from daily, always mention the weekly plan saves 45% — it's the sweet spot for most users.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OBJECTION HANDLING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"Is this a scam?" → "Completely understand the caution — try the free daily session first, no payment required. If it works for you, then consider upgrading."
"$39 is too expensive" → "That's fair. Consider this: one good Aviator session can return that in minutes. And you have a full 24 hours — unlimited rounds, over $500 profit potential. Or go weekly at $149 for 7 days — that's just $21/day!"
"$149 or $499 is too much" → "Start with the $39 daily plan — prove it to yourself in one session. When you see the results, the weekly and monthly plans will make total sense."
"It didn't work for me" → "Sorry to hear that. Let's fix it — which betting site were you on and what happened exactly? I'll get you sorted."
"I want a refund" → "I hear you. Please contact our admin directly on WhatsApp for account help: [+44 7400 756162](https://wa.me/447400756162) — they'll assist you right away."
"Can I get a discount?" → "Our weekly plan at $149 is already 45% cheaper than buying daily! That's the best deal we offer. But you can always start with the free daily trial first."
`;

// ============================================================
// INTENT-SPECIFIC PROMPT ADDONS
// Injected dynamically based on detected user intent
// ============================================================

const INTENT_ADDONS = {
    ready_to_buy: `
The user is showing BUY INTENT. This is a HOT lead.
→ Present all 3 plans clearly: **Daily $39** (24hrs), **Weekly $149** (7 days, save 45%), **Monthly $499** (30 days).
→ Recommend the weekly plan as the best value for most users.
→ Tell them to click **Buy Code** on the bot page (avisignals.com/bot), then select their preferred plan in the payment modal.
→ Mention Mobile-money, card, and crypto (USDT) are all accepted.
→ Emphasise instant activation — they start right after payment with a code that lasts the full purchased duration.
→ Keep it SHORT and action-focused. Remove all friction.
→ Remind them it works for all the major betting platforms shown on the bot page so they select which one they want.
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

Write a concise admin report (4-5 sentences max) covering:
1. Who the user is and what they wanted,include number if available and if we should call them.
2. Whether they are a potential paying customer (yes/no and why)
3. Was the issue resolved? What was the outcome?
4. Recommended follow-up action for the admin (if any)

Flag as HOT LEAD if the user expressed any interest in buying any plan ($39 daily, $149 weekly, or $499 monthly).`;

        const completion = await groq.chat.completions.create({
            messages: [{ role: 'user', content: summaryPrompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.4,
            max_tokens: 300
        });

        const summary = completion.choices[0]?.message?.content ?? 'Summary unavailable.';
        const isHotLead = session.intent === 'ready_to_buy' ||
            summary.toLowerCase().includes('hot lead');

        // 1. Send to Discord
        await discordAgent.sendChatSummary({
            text: summary,
            user: session.userContext || 'Guest',
            page: session.pageLocation || 'Unknown',
            intent: session.intent || 'unknown',
            isHotLead: isHotLead
        });

        // 2. Save full chat to Supabase support_chats table
        if (supabase && session.history.length > 0) {
            const rows = session.history.map(m => ({
                user_id: session.userId || null,
                session_id: userKey,
                message: m.content,
                sender: m.role === 'user' ? 'user' : 'ai',
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
                user_id: session.userId || null,
                sequence_type: 'hot_lead',
                step: 1,
                channel: 'ai_chat',
                converted: false
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
            history = [],
            userContext,
            contact,
            pageLocation,
            isLoggedIn = false,
            sessionStatus = {},
            userId = null
        } = req.body;

        if (!message || typeof message !== 'string') {
            return res.status(400).json({ error: 'Message is required.' });
        }

        if (message.length > 1000) {
            return res.status(400).json({ error: 'Message too long.' });
        }

        // ── Rate limiting & Session Tracking ──────────────────
        const userKey = contact || userContext || req.ip || 'anonymous';
        if (isRateLimited(userKey)) {
            return res.status(429).json({
                reply: "You're sending messages very fast! Give me a second to catch up. 😄"
            });
        }

        if (!chatSessions.has(userKey)) {
            chatSessions.set(userKey, {
                history: [],
                intent: 'browsing',
                userContext: userContext,
                contact: contact,
                pageLocation: pageLocation,
                userId: userId,
                timer: null
            });
        }
        const session = chatSessions.get(userKey);
        session.userContext = userContext;
        session.contact = contact;
        session.pageLocation = pageLocation;
        session.userId = userId;

        // ── Detect Intent & History ──────────────────────────
        const recentHistory = Array.isArray(history) ? history.slice(-10) : [];
        const intent = detectIntent(message, recentHistory);
        const intentAddon = INTENT_ADDONS[intent] || INTENT_ADDONS.browsing;

        // ── Build user context string ──────────────────────────
        let contextBlock = `\n━━━━━━━━━━━━━━━━━━━━━━━━\nUSER CONTEXT\n━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        contextBlock += `Current page: ${pageLocation || 'unknown'}\n`;
        contextBlock += `Logged in: ${isLoggedIn ? 'YES — do NOT ask them to register or log in again' : 'NO — guide them to register'}\n`;

        if (contact || userContext) {
            contextBlock += `User identifier: ${contact || userContext}\n`;
        }

        // Session status injection
        if (sessionStatus) {
            if (sessionStatus.hasActiveSession) {
                contextBlock += `Bot session: ACTIVE (${sessionStatus.activationType}) — encourage them to be using the bot RIGHT NOW\n`;
            } else if (sessionStatus.hasDailyCode) {
                if (sessionStatus.isCodeUsed) {
                    contextBlock += `Daily code: ALREADY USED today on ${sessionStatus.assignedSite}. Suggest waiting until tomorrow OR buying the $39 24H code.\n`;
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
                role: 'system',
                content: BASE_SYSTEM_PROMPT + contextBlock + `\nINTENT-SPECIFIC INSTRUCTIONS:\n${intentAddon}`
            }
        ];

        // Keep last 10 messages (was 5) — enough context without token bloat
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
                model: 'llama-3.3-70b-versatile',
                temperature: 0.65,
                max_tokens: 450
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
        // Session was already fetched/initialized at the start of handleChat

        // Update intent to the most recent (overwrite if more specific)
        if (intent !== 'browsing') session.intent = intent;

        if (session.timer) clearTimeout(session.timer);

        session.history.push({ role: 'user', content: message });
        session.history.push({ role: 'assistant', content: reply });

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
