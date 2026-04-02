const cron = require('node-cron');
const groq = require('./groqClient');
const https = require('https');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = "@AviSignalsAviatorPredictorBot"; // Standard channel name

function sendToChannel(message) {
    if (!BOT_TOKEN) return;

    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const data = JSON.stringify({
        chat_id: CHANNEL_ID,
        text: message,
        parse_mode: 'HTML' // Safe for channel links
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
            console.error(`❌ Telegram Channel Post Error: ${res.statusCode}`);
        }
    });

    req.write(data);
    req.end();
}

async function runChannelPost() {
    const prompt = `As the Marketing Bot for AviSignals, write a 1-paragraph promotional broadcast for our Telegram Channel.
    Include a hook, a mention of 100% prediction accuracy, and a call-to-action link pointing to: https://avisignals.com/bot.html.
    Format as purely raw HTML without markdown code fences. Keep it exciting! Use emojis.`;

    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            model: "llama-3.3-70b-versatile",
            temperature: 0.75,
        });

        const postBody = chatCompletion.choices[0]?.message?.content || "No post generated.";
        const cleanBody = postBody.replace(/```html/g, "").replace(/```/g, "").trim();

        sendToChannel(cleanBody);
        console.log("📢 AI Telegram Channel broadcast sent.");
    } catch (err) {
        console.error("Groq Channel Post Error:", err);
    }
}

function startTelegramAgent() {
    console.log("🚀 Telegram Bot AI Initialized - Running every 3 hours");

    // Broadcast every 3 hours
    cron.schedule('0 */3 * * *', runChannelPost);
}

module.exports = { startTelegramAgent, runChannelPost };
