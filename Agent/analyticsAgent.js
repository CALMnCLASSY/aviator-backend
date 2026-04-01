const cron = require('node-cron');
const groq = require('./groqClient');
const https = require('https');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function sendToTelegram(message) {
    if (!BOT_TOKEN || !CHAT_ID) {
        console.warn("⚠️ Telegram credentials missing. Cannot send analytics.");
        return;
    }

    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const data = JSON.stringify({
        chat_id: CHAT_ID,
        text: message,
        parse_mode: 'Markdown'
    });

    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': data.length
        }
    };

    const req = https.request(url, options, (res) => {
        if (res.statusCode !== 200) {
            console.error(`❌ Telegram Analytics Error: ${res.statusCode}`);
        }
    });

    req.on('error', (e) => {
        console.error('❌ Telegram request error:', e);
    });

    req.write(data);
    req.end();
}

async function runDailyAnalytics() {
    // Collect daily stats (Mocked for now since DB structure is minimal/logging based)
    // In the future, this can query Supabase for signups, rounds, active sessions
    const activeSessionsCount = global.activeSessions ? global.activeSessions.size : "Unknown";
    const newSignups = Math.floor(Math.random() * 10) + 5; // Placeholder
    
    const prompt = `As the Lead Analyst for AviSignals, review today's metrics: ${activeSessionsCount} active sessions and ${newSignups} new signups. Write a short, bulleted actionable daily summary for the CEO. Include 1 specific piece of advice to boost conversion tomorrow.`;

    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            model: "llama-3.3-70b-versatile",
            temperature: 0.6,
        });

        const report = chatCompletion.choices[0]?.message?.content || "No report generated.";
        const fullMessage = `📊 *Daily AI Analytics Report*\n\n${report}`;
        
        sendToTelegram(fullMessage);
        console.log("📈 Daily Analytics sent to Admin.");
    } catch (err) {
        console.error("Groq Analytics Error:", err);
    }
}

function startAnalyticsAgent() {
    console.log("🚀 Analytics AI Agent Initialized - Running daily at 11:45 PM");
    
    // Run every day at 23:45 (11:45 PM)
    cron.schedule('45 23 * * *', runDailyAnalytics);
}

module.exports = { startAnalyticsAgent, runDailyAnalytics, sendToTelegram };
