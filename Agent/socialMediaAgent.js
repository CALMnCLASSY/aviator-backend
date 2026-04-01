const cron = require('node-cron');
const groq = require('./groqClient');
const { sendToTelegram } = require('./analyticsAgent');

async function generateSocialContent() {
    const prompt = `As the Social Media Manager for AviSignals, write 3 unique, engaging, and compliant posts (Facebook & TikTok ideas) promoting our Aviator Predictor bot. 
    Rule 1: ABSOLUTELY NO SPAM or ban-able words (avoid "guaranteed money", "get rich quick").
    Rule 2: Focus on "smart analysis", "consistent wins", "free trials", and "data-driven 100% accuracy predictions".
    Rule 3: Include appropriate emojis and hashtags.
    Rule 4: Keep them under 300 characters for easy reading.`;

    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            model: "llama-3.3-70b-versatile", // Excellent creative writer
            temperature: 0.85,
        });

        const report = chatCompletion.choices[0]?.message?.content || "No content generated.";
        const fullMessage = `📱 *Daily Social Media Ideas*\n\nHere are some safe, high-conversion posts for today:\n\n${report}`;
        
        sendToTelegram(fullMessage);
        console.log("📱 Social Media content sent to Admin.");
    } catch (err) {
        console.error("Groq Social Media Error:", err);
    }
}

function startSocialMediaAgent() {
    console.log("🚀 Social Media AI Agent Initialized - Running daily at 9:00 AM");
    
    // Run every day at 09:00 AM
    cron.schedule('0 9 * * *', generateSocialContent);
}

module.exports = { startSocialMediaAgent, generateSocialContent };
