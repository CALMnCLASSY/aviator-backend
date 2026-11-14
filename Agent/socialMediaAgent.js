// ============================================================
// socialMediaAgent.js — AviSignals Social Media Agent v3
//
// Features:
//  - Platform-specific content: Facebook & Instagram only
//  - Weekly content calendar generated every Monday
//  - Daily content pack sent to admin at 8:30 AM
//  - Direct channel broadcasting: posts 2x daily (11:00 AM & 3:00 PM) to Telegram channel
//  - Multi-tiered AI + Zero-Token Template Fallbacks (never fails if Groq is down/limited)
//  - Automatic translation & posting to Agent Telegram channel
//  - Direct programmatic & HTTP broadcast methods
// ============================================================

'use strict';

const cron = require('node-cron');
const groq = require('./groqClient');
const { sendToAdmin, sendToChannel } = require('./telegramAgent');
const { translateToAgent } = require('../marketing/translator');

// ─── Platform specs — Facebook & Instagram only ──────────────
const PLATFORMS = {
    facebook: {
        name: 'Facebook',
        charLimit: 500,
        tone: 'conversational, community-driven, story-based',
        hashtagCount: '3-5',
        emoji: 'moderate',
    },
    instagram: {
        name: 'Instagram',
        charLimit: 300,
        tone: 'aspirational, visual storytelling, lifestyle',
        hashtagCount: '8-12',
        emoji: 'moderate-heavy',
    }
};

// ─── Content themes — rotates daily ──────────────────────────
const DAILY_THEMES = [
    { theme: 'hype', description: 'Big win energy, FOMO, excitement about results' },
    { theme: 'education', description: 'Teach something useful about Aviator or the predictor' },
    { theme: 'testimonial', description: 'Real member success story, social proof' },
    { theme: 'behind_scenes', description: 'How the AI predictor works, mystery and trust-building' },
    { theme: 'urgency', description: 'Daily code resets, limited time, act now messaging' },
    { theme: 'community', description: 'Join the AviSignals family, Telegram channel growth push' },
    { theme: 'comparison', description: 'Playing Aviator without a predictor vs with one' },
];

// ─── Success stories pool ─────────────────────────────────────
const STORIES = [
    { name: 'James M.', city: 'Sydney', from: 'AUD 100', to: 'AUD 3,200', site: '1xBet' },
    { name: 'Grace W.', city: 'Mombasa', from: 'KES 2,000', to: 'KES 84,000', site: 'Betika' },
    { name: 'Brian O.', city: 'Cape Town', from: 'ZAR 500', to: 'ZAR 28,000', site: 'Betway' },
    { name: 'Amara K.', city: 'Kampala', from: 'UGX 50,000', to: 'UGX 900,000', site: 'Bangbet' },
    { name: 'David N.', city: 'London', from: 'GBP 50', to: 'GBP 2,400', site: '1win' },
    { name: 'Fatima H.', city: 'Dubai', from: 'AED 200', to: 'AED 6,500', site: 'Parimatch' },
    { name: 'Collin P.', city: 'Madrid', from: 'EUR 50', to: 'EUR 1,850', site: 'Stake' },
];
let storyIdx = 0;
const nextStory = () => STORIES[storyIdx++ % STORIES.length];

// ─── Hashtag banks ────────────────────────────────────────────
const HASHTAGS = {
    core: ['#AviSignals', '#AviatorPredictor', '#AviatorGame', '#CrashGame'],
    global: ['#Stake', '#1win', '#1xbet', '#Betway', '#Betika', '#SportyBet'],
    gaming: ['#AviatorHack', '#AviatorTips', '#AviatorStrategy', '#AviatorCashout'],
    money: ['#PassiveIncome', '#SideHustle', '#MakeMoneyOnline', '#CryptoWins'],
};

function hashtagSet(platform, themeName) {
    const base = [...HASHTAGS.core, ...HASHTAGS.global.slice(0, 2)];
    if (themeName === 'hype' || themeName === 'urgency') base.push(...HASHTAGS.money.slice(0, 2));
    return [...new Set(base)].join(' ');
}

// ─── FALLBACK TEMPLATE POOLS (Zero Groq Tokens Required) ───────
const FALLBACK_TEMPLATES = {
    facebook: [
        `✈️ Still playing Aviator relying on pure luck? 🎯\n\nOur AI analyzes live round patterns across SportyBet, 1Win, Stake, and Betika to signal the precise multiplier before it flies away.\n\n✅ 60-Minute FREE TRIAL on assigned trial site\n✅ 24-Hour dedicated platform codes from $75\n✅ Live 24/7 Signals in our community channel\n\n👉 Test the bot free today: https://avisignals.com/bot\n\n#AviSignals #AviatorPredictor #AviatorGame #1Win #Stake`,
        `💰 Real Results from Real Aviator Players!\n\nYesterday over 180 members took home massive profits by cashing out on our high-confidence green rounds.\n\n🚀 No more guessing when the plane will crash.\n1️⃣ Try the free bot trial: https://avisignals.com/bot\n2️⃣ Get dedicated signals for YOUR site\n\n#AviSignals #AviatorPredictor #MakeMoneyOnline #CrashGame`,
        `💡 Pro Aviator Strategy: Consistency always beats greedy bets!\n\nWhen AviSignals indicates lower confidence, cash out at 1.8x - 2.5x. When a super green round is detected, ride the multiplier all the way up. 📈\n\nTest the bot with a 60-minute Free Trial: https://avisignals.com/bot\n\n#AviatorStrategy #AviatorTips #AviSignals #Betway #1xBet`
    ],
    instagram: [
        `Turning Aviator into a calculated strategy. 📈✈️\n\nStop losing your bankroll on sudden 1.00x crashes. AviSignals uses machine learning to signal the safest cashout multipliers in real-time.\n\n🔥 60-Min Free Trial available right now!\n🔗 Tap the link in bio or visit: avisignals.com/bot\n\n#AviSignals #AviatorPredictor #AviatorGame #CryptoWins #Stake #1win #CrashGame`,
        `Another day of calculated wins! 💎✨\n\nMembers in our community are locking in steady profits on 1Win, Betika & Stake.\n\n✅ Live AI Signals\n✅ 60-min Free Bot Trial\n✅ Instant 24H Activation Codes\n\nStart now: https://avisignals.com/bot\n\n#AviatorPredictor #AviSignals #MakeMoneyOnline #PassiveIncome #Aviator`
    ],
    telegram_channel: [
        `🚀 <b>STOP GUESSING. START PREDICTING.</b> ✈️\n\nWhy risk your funds on Aviator when you can follow real-time algorithmic predictions?\n\n🟢 <b>Free 60-Minute Bot Trial:</b> <a href="https://avisignals.com/bot">avisignals.com/bot</a>\n🔑 <b>Dedicated Platform Codes:</b> Available from $75 for 24-hour non-stop access!\n\n💡 <i>Works seamlessly on Stake, 1Win, SportyBet, Betika, 1xBet & more.</i>\n\n👉 <a href="https://avisignals.com/bot"><b>TEST THE BOT 100% FREE HERE</b></a>`,
        `💎 <b>AI SIGNAL HIGHLIGHT — WIN WITH CONFIDENCE</b> 🎯\n\nOur algorithm detected high-multiplier clusters earlier today, allowing members to safely lock in 8.5x and 14.2x profits!\n\n⚡ <b>How to get started:</b>\n1️⃣ Open the bot: <a href="https://avisignals.com/bot">avisignals.com/bot</a>\n2️⃣ Start your 60-minute Free Trial\n3️⃣ Upgrade to dedicated platform signals when you're ready!\n\n👑 <i>Join 3,200+ active players today.</i>`,
        `💼 <b>DID YOU KNOW? EARN 30% PASSIVE INCOME AS AN AGENT</b> 💰\n\nShare AviSignals with your friends or audience and earn a <b>30% instant commission</b> on every single activation code purchased!\n\n✅ 30% Lifetime Revenue Share\n✅ Instant USDT TRC-20 Payouts\n✅ Free Marketing Videos & Images Toolkit provided\n\n🔗 <b>Register as an Agent in 30s:</b> <a href="https://avisignals.com/agent.html">avisignals.com/agent.html</a>\n💬 Support: @avisignalshelp_bot`
    ]
};

function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

// ============================================================
// CONTENT GENERATORS (AI with Automatic Fallback)
// ============================================================

async function generatePlatformPost(platform, theme, story = null) {
    const spec = PLATFORMS[platform];
    const tags = hashtagSet(platform, theme.theme);

    const storyBlock = story
        ? `\nUse this real success story as inspiration:\n${story.name} from ${story.city}: turned ${story.from} → ${story.to} on ${story.site} using AviSignals.`
        : '';

    const prompt = `You are the AviSignals Social Media Manager. Write one ${spec.name} post.

PLATFORM: ${spec.name}
THEME: ${theme.theme} — ${theme.description}
TONE: ${spec.tone}
MAX LENGTH: ${spec.charLimit} characters (HARD LIMIT)
EMOJIS: ${spec.emoji}
HASHTAGS: Include ${spec.hashtagCount} hashtags. Use these: ${tags}
${storyBlock}

BRAND RULES:
- AviSignals is an AI Aviator predictor. Free 60-min trial session. Dedicated codes from $75.
- Works on major betting sites: SportyBet, Betika, 1xBet, Betway, Stake, 1Win.
- Target audience: Global players 18+
- NEVER use: "guaranteed", "100% win", "get rich quick"
- ALWAYS focus on: AI-powered, data-driven, free trial available
- CTA must link to: https://avisignals.com/bot

OUTPUT FORMAT:
Return ONLY the post text + hashtags. No labels, no explanations.`;

    try {
        const completion = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.85,
            max_tokens: 400
        });

        const generated = completion.choices[0]?.message?.content?.trim();
        if (generated && generated.length > 20) {
            return generated;
        }
    } catch (err) {
        console.warn(`⚠️ Groq unavailable for ${platform} (${err.message}) — using fallback template.`);
    }

    return pickRandom(FALLBACK_TEMPLATES[platform] || FALLBACK_TEMPLATES.facebook);
}

// ============================================================
// EXISTING ASSET SUGGESTIONS
// We no longer create new videos — each daily pack suggests
// ready-made media already on the CDN for the admin to attach.
// ============================================================
const fs = require('fs');
const path = require('path');
const ASSETS_DIR = path.join(__dirname, '..', 'marketing');
const ASSETS_BASE_URL = (process.env.BASE_URL || 'https://back.avisignals.com').replace(/\/+$/, '') + '/marketing-assets';

function pickAssetSuggestion() {
    try {
        const videos = fs.readdirSync(ASSETS_DIR)
            .filter(f => f.toLowerCase().endsWith('.mp4'));
        const images = fs.readdirSync(path.join(ASSETS_DIR, 'images'))
            .filter(f => /\.(jpe?g|png|webp)$/i.test(f));

        if (!videos.length && !images.length) return '_No media files found in marketing-assets._';

        const video = videos[Math.floor(Math.random() * videos.length)];
        const picked = [...images].sort(() => Math.random() - 0.5).slice(0, 2);

        const lines = [];
        if (video) lines.push(`🎬 Video: ${ASSETS_BASE_URL}/${video}`);
        picked.forEach(i => lines.push(`🖼 Image: ${ASSETS_BASE_URL}/images/${i}`));
        return lines.join('\n');
    } catch (err) {
        console.warn('⚠️ Asset suggestion error:', err.message);
        return '_Attach any video or image from the marketing-assets library._';
    }
}

// ============================================================
// DAILY CONTENT PACK
// Generates ready-to-post content for all platforms
// Sends to admin via Telegram at 8:30 AM
// ============================================================

async function generateDailyContentPack() {
    const now = new Date();
    const dayIdx = now.getDay();
    const theme = DAILY_THEMES[dayIdx % DAILY_THEMES.length];
    const story = (theme.theme === 'testimonial') ? nextStory() : null;
    const dateStr = now.toLocaleDateString('en-KE', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'Africa/Nairobi' });

    console.log(`📱 Generating daily content pack — theme: ${theme.theme}`);

    try {
        const [fbPost, igPost] = await Promise.all([
            generatePlatformPost('facebook', theme, story),
            generatePlatformPost('instagram', theme, story),
        ]);
        const assets = pickAssetSuggestion();

        const pack = [
            `📅 *Content Pack — ${dateStr}*`,
            `🎨 Today's theme: *${theme.theme.replace(/_/g, ' ').toUpperCase()}*`,
            `_${theme.description}_\n`,

            `━━━━━━━━━━━━━━━━`,
            `📘 *FACEBOOK POST*`,
            `━━━━━━━━━━━━━━━━`,
            fbPost,

            `\n━━━━━━━━━━━━━━━━`,
            `📸 *INSTAGRAM POST*`,
            `━━━━━━━━━━━━━━━━`,
            igPost,

            `\n━━━━━━━━━━━━━━━━`,
            `📁 *SUGGESTED MEDIA (from our library — just download & attach)*`,
            `━━━━━━━━━━━━━━━━`,
            assets,

            `\n_Copy and post these directly. Best posting times: 7–9 AM, 12–2 PM, 7–10 PM EAT._`,
        ].join('\n');

        const chunks = splitMessage(pack, 4000);
        for (const chunk of chunks) {
            await sendToAdmin(chunk, 'Markdown');
            await new Promise(r => setTimeout(r, 500));
        }

        console.log('✅ Daily content pack sent to admin.');
        return { success: true, theme: theme.theme, chunks: chunks.length };

    } catch (err) {
        console.error('❌ Content pack generation error:', err.message);
        await sendToAdmin('⚠️ Social media content pack failed to generate. Check server logs.');
        return { success: false, error: err.message };
    }
}

// ============================================================
// WEEKLY CONTENT CALENDAR
// Every Monday at 8:00 AM — full week plan in one message
// ============================================================

async function generateWeeklyCalendar() {
    console.log('📅 Generating weekly content calendar...');

    const prompt = `You are the AviSignals Social Media Strategist. Create a 7-day content calendar for the week ahead.
Business: AviSignals — AI Aviator game predictor. Free trial session. Dedicated codes from $75. Global market.
PLATFORMS: Facebook and Instagram ONLY — do not schedule TikTok, X/Twitter, or any other platform.
For each day, specify: platform (Facebook or Instagram), theme, post hook idea, and posting time.`;

    try {
        let calendar = '';
        try {
            const completion = await groq.chat.completions.create({
                messages: [{ role: 'user', content: prompt }],
                model: 'llama-3.3-70b-versatile',
                temperature: 0.75,
                max_tokens: 1000
            });
            calendar = completion.choices[0]?.message?.content?.trim() || '';
        } catch (e) {
            console.warn('⚠️ Groq weekly calendar fallback:', e.message);
        }

        if (!calendar) {
            calendar = `*Monday:* Instagram (Hype/Win Hook) at 8:00 AM\n*Tuesday:* Facebook (Algorithm Explanation) at 1:00 PM\n*Wednesday:* Instagram (Success Story) at 7:00 PM\n*Thursday:* Facebook (Early Cashout Tips) at 12:00 PM\n*Friday:* Instagram Reels (Weekend Rush & Urgency) at 6:00 PM\n*Saturday:* Facebook (Community/Live Signal Showcase) at 3:00 PM\n*Sunday:* Instagram (Weekly Recap & Free Trial Promo) at 7:00 PM`;
        }

        const header = `🗓 *AviSignals Weekly Content Calendar*\n_Generated: ${new Date().toLocaleDateString('en-KE', { timeZone: 'Africa/Nairobi' })}_\n\n`;

        const chunks = splitMessage(header + calendar, 4000);
        for (const chunk of chunks) {
            await sendToAdmin(chunk, 'Markdown');
            await new Promise(r => setTimeout(r, 500));
        }

        console.log('✅ Weekly calendar sent to admin.');
        return { success: true };

    } catch (err) {
        console.error('❌ Weekly calendar error:', err.message);
        return { success: false, error: err.message };
    }
}

// ============================================================
// CHANNEL CONTENT SHARE
// Shares a polished social media post directly to Telegram channel
// ============================================================

async function shareToChannel() {
    const theme = DAILY_THEMES[new Date().getDay() % DAILY_THEMES.length];
    console.log(`📢 Social Media Agent broadcasting to Telegram channel (Theme: ${theme.theme})...`);

    let post = '';

    // Attempt AI Generation if available
    try {
        const prompt = `You are the AviSignals Telegram channel broadcaster. Write one promotional post for our Telegram channel.
Today's theme: ${theme.theme} — ${theme.description}
Rules:
- Use Telegram HTML: <b>bold</b>, <i>italic</i>, <a href="https://avisignals.com/bot">link text</a>
- 5-8 lines maximum
- Heavy emojis
- Include CTA linking to https://avisignals.com/bot
- No "guaranteed" language
Return ONLY the formatted post.`;

        const completion = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.88,
            max_tokens: 350
        });

        post = completion.choices[0]?.message?.content?.trim()
            ?.replace(/```html?/gi, '').replace(/```/g, '').trim();

    } catch (err) {
        console.warn(`⚠️ Groq AI channel post error (${err.message}) — using high-converting template.`);
    }

    // Fallback if AI returned empty or failed
    if (!post) {
        post = pickRandom(FALLBACK_TEMPLATES.telegram_channel);
    }

    try {
        // Send to main Telegram channel (auto-detects HTML)
        const result = await sendToChannel(post);
        if (result?.ok) {
            console.log('✅ Social Media Agent post delivered to Telegram channel.');
        } else {
            console.error('❌ Social Media Agent channel post failed:', result?.description);
        }

        // Also broadcast to Agent channel if configured
        const AGENT_CHANNEL_ID = process.env.AGENT_TELEGRAM_CHANNEL_ID;
        if (AGENT_CHANNEL_ID) {
            const translatedText = translateToAgent(post);
            await sendToChannel(translatedText, AGENT_CHANNEL_ID);
            console.log('✅ Social Media Agent post delivered to Agent channel.');
        }

        return { success: true, message: 'Social post sent to channel', post };

    } catch (sendErr) {
        console.error('❌ Social Media sendToChannel error:', sendErr.message);
        return { success: false, error: sendErr.message };
    }
}

// ─── Utility: split long text into Telegram-safe chunks ──────
function splitMessage(text, maxLen = 4000) {
    const chunks = [];
    let i = 0;
    while (i < text.length) {
        chunks.push(text.slice(i, i + maxLen));
        i += maxLen;
    }
    return chunks;
}

// ============================================================
// SCHEDULER
// ============================================================
function startSocialMediaAgent() {
    console.log('🚀 AviSignals Social Media Agent v3 — Initializing...');

    // 1. Daily content pack to admin — 8:30 AM EAT
    cron.schedule('30 8 * * *', generateDailyContentPack);

    // 2. Weekly calendar to admin — every Monday at 8:00 AM EAT
    cron.schedule('0 8 * * 1', generateWeeklyCalendar);

    // 3. Share to Telegram channel — 11:00 AM and 3:00 PM EAT
    cron.schedule('0 11,15 * * *', shareToChannel);

    console.log('✅ Social Media Agent ready:');
    console.log('   📦 Daily content pack   — 8:30 AM daily (Facebook + Instagram → admin)');
    console.log('   🗓  Weekly calendar      — 8:00 AM every Monday');
    console.log('   📣 Channel posts        — 11:00 AM & 3:00 PM daily (to Telegram channel)');
}

module.exports = {
    startSocialMediaAgent,
    generateDailyContentPack,
    generateWeeklyCalendar,
    shareToChannel,
    generatePlatformPost,
};
