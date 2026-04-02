const groq = require('./groqClient');
const discordAgent = require('./discordAgent');
const supabase = require('./supabaseClient');

// In-memory session tracking for Discord summaries
const chatSessions = new Map();
const SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes of inactivity

/**
 * GENERATE AND SEND CHAT SUMMARY
 */
async function triggerSessionSummary(userKey) {
    const session = chatSessions.get(userKey);
    if (!session || session.history.length === 0) return;

    try {
        const chatHistoryText = session.history
            .map(m => `${m.role.toUpperCase()}: ${m.content}`)
            .join('\n');

        const prompt = `Summarize this customer support chat.
        Identify: 1. User details (${session.userContext}). 2. Core inquiry/problem. 3. Final outcome.
        Conversation:
        ${chatHistoryText}
        Output a professional 2-3 sentence report for the admin.`;

        const chatCompletion = await groq.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            model: "llama-3.3-70b-versatile",
            temperature: 0.5,
        });

        const summary = chatCompletion.choices[0]?.message?.content || "No summary available.";

        // 1. Send to Discord
        await discordAgent.sendChatSummary({
            text: summary,
            user: session.userContext || 'Guest / Unlogged',
            page: session.pageLocation || 'Bot Page'
        });

        // 2. Persist to Supabase (for Admin Dashboard)
        if (supabase) {
            try {
                await supabase
                    .from('logs')
                    .insert([{
                        event_type: 'chat_summary',
                        details: {
                            user: session.userContext,
                            summary: summary,
                            page: session.pageLocation
                        },
                        created_at: new Date().toISOString()
                    }]);
            } catch (dbErr) {
                console.error('⚠️ Chat log persistence failed:', dbErr.message);
            }
        }

        // Clean up
        chatSessions.delete(userKey);
    } catch (err) {
        console.error('❌ Chat Summarization Error:', err.message);
    }
}

// Central Knowledge Base & Persona
const SYSTEM_PROMPT = `
You are the official AviSignals AI Assistant. Your goal is to provide world-class, confident, and persuasive customer support for the Aviator Predictor Platform.

# Critical Persona Rules
1. **BE CONCISE**: Keep your answers extremely short (1-5 sentences maximum per point).
2. **Formatting**: Always use **bold text** for important names, buttons, or links (e.g., "Click **FREE CODE**"). Use bullet points for steps.
3. **Context Aware**: I will pass you the user's login state and current page. Tell them exactly what to click next based on where they are.
4. **No Registration Pitch**: If they are already logged in (isLoggedIn = true), do NOT ask them to register.

# System Knowledge
1. **Accuracy**: The bot guarantees **100% accuracy**. Countless clients have turned $100 into over $1,500 rapidly.
2. **Free Code Structure**: The Predictor Bot is free to use daily! Users MUST click **FREE CODE** on the Bot page to get their code.
3. **Extra Paid Token**: The ONLY payment plan we offer is a **24-Hour continuous activation code** for exactly **$75**. NO OTHER PLANS.
4. **Using the Bot**: Once a user has a code, they click **Use Bot**, select their site, enter the code, and click **Activate**.
5. **Support**: For complex issues, contact Admin on **Telegram (@Aadmin4cnc)https://t.me/Aadmin4cnc** or **WhatsApp (+44 7400 756162)https://wa.me/447400756162**.
6. **Telegram Channel**: Subscribe to our [Telegram Channel](https://t.me/AviSignalsAviatorPredictorBot) for daily free signals and tips on aviator.
7. **How to Play**: Open the bot app and your aviator game in your betting site at the same time, check the bot on when the plane will fly away then wait for that round and place your bet then cashout before the shown multiplier
`;

async function handleChat(req, res) {
    try {
        const { message, history, userContext, pageLocation, isLoggedIn, sessionStatus } = req.body;

        if (!message) {
            return res.status(400).json({ error: "Message is required" });
        }

        // Prepare the message array for Groq
        const messages = [
            { role: "system", content: SYSTEM_PROMPT }
        ];

        // Add context if known
        let userIdentityPrompt = `The user is currently on the ${pageLocation || 'website'} page. `;
        if (isLoggedIn) {
            userIdentityPrompt += `They ARE logged into their account. DO NOT ask them to register or login again. `;
        } else {
            userIdentityPrompt += `They are NOT logged into their account yet. You should guide them to register on the Bot Page. `;
        }

        if (userContext && userContext !== 'anonymous') {
            userIdentityPrompt += `Their username/identifier is: ${userContext}. Address them using this name. `;
        }

        // Detailed Session Status Injection
        if (sessionStatus) {
            if (sessionStatus.hasActiveSession) {
                userIdentityPrompt += `They have an ACTIVE bot session (Type: ${sessionStatus.activationType}). They should be using the predictor right now. `;
            } else if (sessionStatus.hasDailyCode) {
                if (sessionStatus.isCodeUsed) {
                    userIdentityPrompt += `They have already USED their daily code for today on ${sessionStatus.assignedSite}. They need to wait until tomorrow or buy a $75 24H code. `;
                } else {
                    userIdentityPrompt += `They have an UNUSED daily code (${sessionStatus.dailyCode}) for the site ${sessionStatus.assignedSite}. Tell them to click 'Use Bot', select ${sessionStatus.assignedSite}, and enter their code. `;
                }
            } else if (sessionStatus.assignedSite !== 'none') {
                userIdentityPrompt += `They have been assigned to ${sessionStatus.assignedSite} but haven't grabbed their code yet. Tell them to click 'FREE CODE'. `;
            }
        }

        messages.push({
            role: "system",
            content: userIdentityPrompt
        });

        // Add recent history to maintain context (last 5 messages to avoid token bloat)
        if (history && Array.isArray(history)) {
            const recentHistory = history.slice(-5);
            recentHistory.forEach(msg => {
                // Ensure roles are valid ('user' or 'assistant')
                if (msg.role === 'user' || msg.role === 'assistant') {
                    messages.push({ role: msg.role, content: msg.content });
                }
            });
        }

        // Finally, add the current user message (if not already the last item in history)
        const lastHistoryMsg = history && history.length > 0 ? history[history.length - 1] : null;
        if (!lastHistoryMsg || lastHistoryMsg.content !== message) {
            messages.push({ role: "user", content: message });
        }

        // Call Groq AI
        // Using llama3-70b-8192 for high-quality persuasive reasoning
        const chatCompletion = await groq.chat.completions.create({
            messages: messages,
            model: "llama-3.3-70b-versatile",
            temperature: 0.7, // Balances creativity with professionalism
            max_tokens: 500,
        });

        const reply = chatCompletion.choices[0]?.message?.content || "I'm sorry, I encountered an internal error processing that.";

        // Session Tracking for Discord Summary
        const userKey = userContext || 'anonymous';
        let session = chatSessions.get(userKey);
        
        if (!session) {
            session = { 
                history: [], 
                timer: null, 
                userContext: userContext || 'Guest', 
                pageLocation: pageLocation || 'Bot Page' 
            };
        }

        // Reset inactivity timer
        if (session.timer) clearTimeout(session.timer);
        
        session.history.push({ role: 'user', content: message });
        session.history.push({ role: 'assistant', content: reply });
        
        session.timer = setTimeout(() => {
            triggerSessionSummary(userKey);
        }, SESSION_TIMEOUT);

        chatSessions.set(userKey, session);

        return res.json({ reply });

    } catch (error) {
        console.error("Groq Chat Error:", error);
        return res.status(500).json({ error: "Failed to generate AI response." });
    }
}

module.exports = { handleChat };
