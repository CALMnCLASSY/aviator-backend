// ============================================================
// socialMediaAgent.js — AviSignals Social Media Agent v2
//
// Improvements over v1:
//  - Platform-specific content: Facebook, TikTok, Instagram, Twitter/X
//    each with correct character limits and tone
//  - Weekly content calendar generated every Monday
//  - Daily content pack sent to admin at 8:30 AM (before posting time)
//  - Coordinated with telegramAgent — shares post ideas to channel
//  - Trending hooks and hashtag strategy built into prompts
//  - Content themes rotate: hype, education, testimonial, behind-scenes
//  - Uses sendToAdmin from telegramAgent (not analyticsAgent)
//  - Engagement hooks specifically written for Kenyan/EA audience
// ============================================================

'use strict';

const cron = require('node-cron');
const groq = require('./groqClient');
const { sendToAdmin, sendToChannel } = require('./telegramAgent');

// ─── Platform specs ───────────────────────────────────────────
const PLATFORMS = {
    facebook: {
        name: 'Facebook',
        charLimit: 500,   // optimal (not max) for reach
        tone: 'conversational, community-driven, story-based',
        hashtagCount: '3-5',
        emoji: 'moderate',
    },
    tiktok: {
        name: 'TikTok',
        charLimit: 150,   // caption — hook must be in first line
        tone: 'punchy, youth-oriented, trend-aware, hype',
        hashtagCount: '5-8 (mix niche + trending)',
        emoji: 'heavy',
    },
    instagram: {
        name: 'Instagram',
        charLimit: 300,   // optimal for feed posts
        tone: 'aspirational, visual storytelling, lifestyle',
        hashtagCount: '8-12',
        emoji: 'moderate-heavy',
    },
    twitter: {
        name: 'Twitter/X',
        charLimit: 240,
        tone: 'sharp, punchy, opinion-driven, concise',
        hashtagCount: '1-2',
        emoji: 'light',
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
    { name: 'James M.', city: 'Nairobi', from: 'KES 8,000', to: 'KES 150,000', site: 'Betika' },
    { name: 'Grace W.', city: 'Cape Town', from: 'KES 5,000', to: 'KES 62,000', site: 'Betway' },
    { name: 'Brian O.', city: 'Accra', from: 'KES 3,000', to: 'KES 41,000', site: '1xBet' },
    { name: 'Amara K.', city: 'Kampala', from: 'UGX 50,000', to: 'UGX 900,000', site: 'Bangbet' },
    { name: 'David N.', city: 'Montreal', from: 'CAD 100', to: 'CAD 7,100', site: 'OdiBets' },
    { name: 'Fatima H.', city: 'Dar es Salaam', from: 'TZS 20,000', to: 'TZS 380,000', site: 'Parimatch' },
    { name: 'Tom K.', city: 'London', from: 'GBP 750', to: 'GBP 28,000', site: '1win' },
];
let storyIdx = 0;
const nextStory = () => { const s = STORIES[storyIdx++ % STORIES.length]; return s; };

// ─── Hashtag banks ────────────────────────────────────────────
const HASHTAGS = {
    core: ['#AviSignals', '#AviatorPredictor', '#AviatorGame'],
    kenyan: ['#Hustle', '#KenyanTwitter', '#SportyBetKe', '#BetikaKe', '#OdiBets', '#mzansi', '#london'],
    gaming: ['#AviatorHack', '#AviatorTips', '#AviatorStrategy', '#AviatorCashout', '#mzansi', '#london'],
    money: ['#MoneyMoves', '#HustleSmart', '#EarnOnline', '#SideHustle', '#mzansi', '#london'],
    tiktok: ['#aviator', '#aviatorgame', '#foryou', '#foryoupage', '#viral', '#kenya', '#nairobi', '#mzansi', '#london'],
};

function hashtagSet(platforms, theme) {
    const base = [...HASHTAGS.core, ...HASHTAGS.gaming];
    if (theme === 'hype' || theme === 'urgency') base.push(...HASHTAGS.money);
    if (platforms.includes('tiktok')) base.push(...HASHTAGS.tiktok.slice(0, 4));
    base.push(...HASHTAGS.kenyan.slice(0, 2));
    return [...new Set(base)].join(' ');
}

// ============================================================
// CONTENT GENERATORS
// ============================================================

async function generatePlatformPost(platform, theme, story = null) {
    const spec = PLATFORMS[platform];
    const storyBlock = story
        ? `\nUse this real success story as inspiration:\n${story.name} from ${story.city}: turned ${story.from} → ${story.to} on ${story.site} using AviSignals.`
        : '';

    const tags = hashtagSet([platform], theme.theme);

    const prompt = `You are the AviSignals Social Media Manager. Write one ${spec.name} post.

PLATFORM: ${spec.name}
THEME: ${theme.theme} — ${theme.description}
TONE: ${spec.tone}
MAX LENGTH: ${spec.charLimit} characters (HARD LIMIT — count carefully)
EMOJIS: ${spec.emoji}
HASHTAGS: Include ${spec.hashtagCount} hashtags. Use these: ${tags}
${storyBlock}

BRAND RULES:
- AviSignals is an AI Aviator predictor. Free daily code. Paid 24H code = $75.
- Works on all major betting sites: SportyBet, Betika, 1xBet, Betway, OdiBets, etc.
- Target audience: Global world clients of players aged 18-35
- NEVER use: "guaranteed", "100% win", "get rich quick", "risk-free"
- ALWAYS focus on: AI-powered, data-driven, smart play, free trial available
- CTA must link to: https://avisignals.com/bot

OUTPUT FORMAT:
Return ONLY the post text + hashtags. No labels, no explanations, no quotes around the post.`;

    const completion = await groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: 'llama-3.3-70b-versatile',
        temperature: 0.85,
        max_tokens: 400
    });

    return completion.choices[0]?.message?.content?.trim() || '';
}

async function generateVideoIdea(theme) {
    const prompt = `You are the AviSignals TikTok/Reels content strategist. Write one short video idea for our Aviator predictor platform.

Theme: ${theme.theme} — ${theme.description}
Target: Kenyan + East African audience, 18-35, Aviator game players

Format your response exactly like this:
🎬 HOOK (first 3 seconds): [what viewer sees/hears immediately]
📱 CONTENT: [what happens in the video, 15-30 seconds]
🎵 AUDIO SUGGESTION: [trending sound type or description]
💬 CAPTION: [caption text, max 150 chars, with hashtags]
🎯 CTA: [what to say at the end]

Be specific and creative. Make it something that would actually go viral in Kenya.`;

    const completion = await groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: 'llama-3.3-70b-versatile',
        temperature: 0.9,
        max_tokens: 400
    });

    return completion.choices[0]?.message?.content?.trim() || '';
}

// ============================================================
// DAILY CONTENT PACK
// Generates ready-to-post content for all platforms
// Sends to admin via Telegram at 8:30 AM
// ============================================================

async function generateDailyContentPack() {
    const now = new Date();
    const dayIdx = now.getDay(); // 0=Sun, 1=Mon...
    const theme = DAILY_THEMES[dayIdx % DAILY_THEMES.length];
    const story = (theme.theme === 'testimonial') ? nextStory() : null;
    const dateStr = now.toLocaleDateString('en-KE', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'Africa/Nairobi' });

    console.log(`📱 Generating daily content pack — theme: ${theme.theme}`);

    try {
        // Generate all platform content in parallel
        const [fbPost, igPost, twPost, ttCaption, videoIdea] = await Promise.all([
            generatePlatformPost('facebook', theme, story),
            generatePlatformPost('instagram', theme, story),
            generatePlatformPost('twitter', theme, story),
            generatePlatformPost('tiktok', theme, story),
            generateVideoIdea(theme),
        ]);

        // Format the daily pack as a readable Telegram message to admin
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
            `🐦 *TWITTER/X POST*`,
            `━━━━━━━━━━━━━━━━`,
            twPost,

            `\n━━━━━━━━━━━━━━━━`,
            `🎵 *TIKTOK CAPTION*`,
            `━━━━━━━━━━━━━━━━`,
            ttCaption,

            `\n━━━━━━━━━━━━━━━━`,
            `🎬 *VIDEO IDEA*`,
            `━━━━━━━━━━━━━━━━`,
            videoIdea,

            `\n_Copy and post these directly. Best posting times: 7–9 AM, 12–2 PM, 7–10 PM EAT._`,
        ].join('\n');

        // Send full pack to admin in chunks (Telegram 4096 char limit)
        const chunks = splitMessage(pack, 4000);
        for (const chunk of chunks) {
            await sendToAdmin(chunk);
            await new Promise(r => setTimeout(r, 500));
        }

        console.log('✅ Daily content pack sent to admin.');

    } catch (err) {
        console.error('❌ Content pack generation error:', err.message);
        await sendToAdmin('⚠️ Social media content pack failed to generate. Check server logs.');
    }
}

// ============================================================
// WEEKLY CONTENT CALENDAR
// Every Monday at 8:00 AM — full week plan in one message
// ============================================================

async function generateWeeklyCalendar() {
    console.log('📅 Generating weekly content calendar...');

    const prompt = `You are the AviSignals Social Media Strategist. Create a 7-day content calendar for the week ahead.

Business: AviSignals — AI Aviator game predictor. Free daily code. $75 for 24H access. Kenya/East Africa market.

For each day, specify:
- Best platform to prioritise
- Content theme and angle
- One specific post idea (topic + hook)
- Best posting time (EAT)

Rules:
- Vary themes: don't use same theme two days running
- Mix educational, hype, social proof, urgency, and community content
- Monday/Tuesday = high activity — use strong hooks
- Friday/Saturday = peak Aviator playing time — use urgency/FOMO
- Sunday = reflection/community — softer tone
- Reference real Kenyan culture, betting culture, and local platforms

Format as a clean, scannable list. Use bold for day names.`;

    try {
        const completion = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.75,
            max_tokens: 1000
        });

        const calendar = completion.choices[0]?.message?.content?.trim() || 'Calendar generation failed.';
        const header = `🗓 *AviSignals Weekly Content Calendar*\n_Generated: ${new Date().toLocaleDateString('en-KE', { timeZone: 'Africa/Nairobi' })}_\n\n`;

        const chunks = splitMessage(header + calendar, 4000);
        for (const chunk of chunks) {
            await sendToAdmin(chunk);
            await new Promise(r => setTimeout(r, 500));
        }

        console.log('✅ Weekly calendar sent to admin.');

    } catch (err) {
        console.error('❌ Weekly calendar error:', err.message);
    }
}

// ============================================================
// CHANNEL CONTENT SHARE
// Once a day, the social agent shares a polished post
// directly to the Telegram channel (coordinating with telegramAgent)
// ============================================================

async function shareToChannel() {
    const theme = DAILY_THEMES[new Date().getDay() % DAILY_THEMES.length];

    try {
        // Generate a Telegram-native version of today's content
        const prompt = `You are the AviSignals Telegram channel broadcaster. Write one promotional post for our Telegram channel.

Today's theme: ${theme.theme} — ${theme.description}

Rules:
- Use Telegram HTML: <b>bold</b>, <i>italic</i>, <a href="url">link</a>
- 5-8 lines maximum
- Heavy emojis — this is Telegram
- Kenyan/East African audience
- Include CTA linking to https://avisignals.com/bot
- No "guaranteed" or "get rich" language
- Make it feel fresh and relevant to right now

Write ONLY the post. No labels or explanations.`;

        const completion = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.88,
            max_tokens: 350
        });

        const post = completion.choices[0]?.message?.content?.trim()
            ?.replace(/```html?/gi, '').replace(/```/g, '').trim();

        if (post) {
            await sendToChannel(post);
            console.log('✅ Social agent Telegram post sent to channel.');
        }
    } catch (err) {
        console.error('❌ Channel share error:', err.message);
    }
}

// ─── Utility: split long text into Telegram-safe chunks ──────
function splitMessage(text, maxLen = 4000) {
    const chunks = [];
    let i = 0;
    while (i < text.length) { chunks.push(text.slice(i, i + maxLen)); i += maxLen; }
    return chunks;
}

// ============================================================
// SCHEDULER
// ============================================================
function startSocialMediaAgent() {
    console.log('🚀 AviSignals Social Media Agent v2 — Initializing...');

    // Daily content pack to admin — 8:30 AM (before prime posting time)
    cron.schedule('30 8 * * *', generateDailyContentPack);

    // Weekly calendar — every Monday at 8:00 AM
    cron.schedule('0 8 * * 1', generateWeeklyCalendar);

    // Share one post to Telegram channel — 3:00 PM daily
    // (complements telegramAgent's :00/:20/:40 rotation)
    cron.schedule('0 15 * * *', shareToChannel);

    console.log('✅ Social Media Agent ready:');
    console.log('   📦 Daily content pack   — 8:30 AM daily (all platforms → admin)');
    console.log('   🗓  Weekly calendar      — 8:00 AM every Monday');
    console.log('   📣 Channel post         — 3:00 PM daily (coordinates with Telegram agent)');
}

module.exports = {
    startSocialMediaAgent,
    generateDailyContentPack,
    generateWeeklyCalendar,
    shareToChannel,
};
