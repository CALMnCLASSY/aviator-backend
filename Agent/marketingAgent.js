const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
const { sendEmail } = require('./emailService');
const groq = require('./groqClient');

// Initialize Supabase Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Drip Campaign Content Generators
const generateDripEmail = async (day, userEmail) => {
    let prompt = "";
    if (day === 0) {
        prompt = `Write a highly persuasive, concise welcome email for a new user (${userEmail}) who just joined AviSignals. Explain how to claim their daily free trial code on the bot page and start winning today. Keep it thrilling but professional. Format as raw HTML.`;
    } else if (day === 1) {
        prompt = `Write a short, punchy email for a user (${userEmail}) who joined yesterday. The subject should be "Look what you missed 💰". Provide a sample of a recent 10x Aviator cashout and urge them to buy a 24-Hour token for $75 to get unrestricted access. Format as raw HTML.`;
    } else if (day === 3) {
        prompt = `Write a concise email for a user (${userEmail}) who joined 3 days ago. Share a success story of an African user turning $100 into $1,500 using the predictor. Create urgency to buy the $75 daily code. Format as raw HTML.`;
    } else if (day === 7) {
        prompt = `Write a short email for a user (${userEmail}) who joined 7 days ago. Ask if they are ready to dominate the Aviator game today. Push them to get their $75 24-Hour continuous activation code. Format as raw HTML.`;
    }

    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            model: "llama-3.3-70b-versatile",
            temperature: 0.8,
        });
        
        // Clean up markdown code blocks if the AI returns them
        let rawHtml = chatCompletion.choices[0]?.message?.content || "";
        rawHtml = rawHtml.replace(/```html/g, "").replace(/```/g, "").trim();
        return rawHtml;
    } catch (error) {
        console.error(`Groq Email Generation Error for Day ${day}:`, error);
        return null;
    }
};

const subjects = {
    0: "Welcome to AviSignals - Claim Your Free Trial! 🚀",
    1: "Look what you missed yesterday... 💰",
    3: "How Mike turned $100 into $1,500 with AviSignals 📈",
    7: "Ready to dominate Aviator today? 🎁"
};

// Main Cron Job Function
function startMarketingAgent() {
    console.log("🚀 Marketing AI Agent Initialized - Running Drip Campaigns daily at 10:00 AM");

    // Run every day at 10:00 AM server time
    cron.schedule('0 10 * * *', async () => {
        console.log("⏰ Starting daily AI marketing checks...");
        
        try {
            // Get all profiles from Supabase
            const { data: profiles, error } = await supabase.from('profiles').select('*');
            if (error) throw error;

            if (!profiles) return;

            const now = new Date();

            for (const profile of profiles) {
                if (!profile.email) continue;

                // Calculate age of profile in days
                const createdDate = new Date(profile.created_at);
                const diffTime = Math.abs(now - createdDate);
                const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

                // Determine if they fall into a drip bucket
                if ([0, 1, 3, 7].includes(diffDays)) {
                    console.log(`🤖 Generating Day ${diffDays} email for ${profile.email}`);
                    const htmlContent = await generateDripEmail(diffDays, profile.email);
                    
                    if (htmlContent) {
                        await sendEmail(profile.email, subjects[diffDays], htmlContent);
                    }
                }
            }
            console.log("✅ Daily AI marketing checks complete.");
        } catch (error) {
            console.error("❌ Marketing Agent Error:", error);
        }
    });
}

module.exports = { startMarketingAgent };
