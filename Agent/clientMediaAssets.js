// ============================================================
// clientMediaAssets.js — Media asset registry for Telegram client bot
//
// Maps contextual triggers to video/image files in the marketing/
// directory. Telegram file_ids are cached after first upload so
// subsequent sends are instant (no re-upload).
// ============================================================

'use strict';

const path = require('path');
const fs = require('fs');

const MARKETING_DIR = path.join(__dirname, '..', 'marketing');
const IMAGES_DIR = path.join(MARKETING_DIR, 'images');

// ─── File ID Cache (in-memory) ───────────────────────────────
// After the first sendVideo/sendPhoto, Telegram returns a file_id.
// We cache it here so all future sends for the same asset are instant.
const fileIdCache = new Map();

function getCachedFileId(key) {
    return fileIdCache.get(key) || null;
}

function setCachedFileId(key, fileId) {
    fileIdCache.set(key, fileId);
}

// ─── Video Assets ────────────────────────────────────────────
// Each entry: { file, caption }
// 'file' is relative to marketing/ directory
const VIDEOS = {
    welcome: {
        file: 'howitworks.mp4',
        caption: '👋 Welcome! Here\'s a quick look at how AviSignals works. Watch this — it takes 2 minutes and will change how you play Aviator.'
    },
    tutorial: {
        file: 'fulltutorial.mp4',
        caption: '📖 Full Tutorial — Step by step: how to register, activate your code, and start winning with the AviSignals bot.'
    },
    free_trial: {
        file: 'freetrialvid.mp4',
        caption: '🎮 How to get your FREE 60-minute trial code and start using the bot right now — no payment needed!'
    },
    get_free_code: {
        file: 'getfreecode.mp4',
        caption: '🆓 Watch how to claim your free trial code in under 30 seconds.'
    },
    buy_code: {
        file: 'buycode.mp4',
        caption: '💳 How to buy your Premium Code — pick your site, choose your plan, pay, and activate. Simple!'
    },
    buy_code_1w: {
        file: 'buycode1w.mp4',
        caption: '🔑 Buying a code for 1Win — full walkthrough from purchase to activation.'
    },
    bot_running: {
        file: 'botrunning.mp4',
        caption: '🤖 The AviSignals bot running LIVE — watch it predict rounds in real time!'
    },
    bot_working: {
        file: 'botworking.mp4',
        caption: '✅ Proof: the bot calling signals correctly, round after round.'
    },
    bot_working2: {
        file: 'botworking2.mp4',
        caption: '🎯 Another live session — the bot nailing predictions. This is what you get with your code.'
    },
    premium_channel: {
        file: 'premiumchannel.mp4',
        caption: '📡 Our FREE Premium Telegram Channel sends live signals 24/7. Join: https://t.me/avisignalspremium'
    },

    // ── Site-specific proof videos ──────────────────────────
    sportybet: {
        file: 'sportybetworks.mp4',
        caption: '🏆 AviSignals working LIVE on SportyBet — real predictions, real wins.'
    },
    betway: {
        file: 'betwayworks.mp4',
        caption: '🏆 AviSignals working LIVE on Betway — watch the bot predict every round.'
    },
    '1win': {
        file: '1winworks.mp4',
        caption: '🏆 AviSignals working LIVE on 1Win — exact predictions, real money.'
    },
    hollywood: {
        file: 'hollywoodworks.mp4',
        caption: '🏆 AviSignals working LIVE on Hollywoodbets — see the accuracy yourself.'
    },
    stake: {
        file: 'stakeworks.mp4',
        caption: '🏆 AviSignals working LIVE on Stake — predictions hitting round after round.'
    },
    mozzart: {
        file: 'mozzartworks.mp4',
        caption: '🏆 AviSignals working LIVE on MozzartBet — real results, real proof.'
    },

    // ── Marketing clips ─────────────────────────────────────
    marketing_luck: {
        file: 'marketingluckno.mp4',
        caption: '🎯 Stop relying on luck — use data. AviSignals AI predicts the exact multiplier.'
    }
};

// ─── Image Assets ────────────────────────────────────────────
// Win proof screenshots, UI screenshots, etc.
const IMAGES = {
    // Win proof screenshots (rotated randomly for variety)
    win_proofs: [
        { file: 'chatwinshot1.jpg', caption: '💰 Real member win — using AviSignals predictions.' },
        { file: 'chatwinshot3.jpg', caption: '🏆 Another member cashing out big with our signals.' },
        { file: 'chatwinshot6.jpg', caption: '🎯 Consistent wins — this is what the bot delivers.' },
        { file: 'withdrawalwinshot.jpg', caption: '💸 Real withdrawal — member cashed out their AviSignals winnings.' },
        { file: 'sportywithdr1.jpg', caption: '🏆 SportyBet withdrawal — real money from real predictions.' },
        { file: 'hollywithdraw1.jpg', caption: '💰 Hollywoodbets withdrawal — AviSignals at work.' },
        { file: 'hollywithdraw2.jpg', caption: '🎯 Another Hollywoodbets cash out — proof the bot works.' },
        { file: 'stakewithdr1.jpg', caption: '💸 Stake withdrawal — member profited using our signals.' },
    ],

    // UI screenshots
    bot_page: { file: 'avisignalsbotpage.jpg', caption: '🤖 The AviSignals Bot page — go here to start: avisignals.com/bot' },
    home_page: { file: 'avisignalsmainhome.jpg', caption: '🏠 AviSignals — AI-powered Aviator predictions: avisignals.com' },
    bot_summary: { file: 'botsummary.jpg', caption: '📊 How the AviSignals prediction system works.' },
    select_site: { file: 'selectbettingsite.jpg', caption: '🎮 Choose your betting site — we support ALL major platforms worldwide.' },
    payment_methods: { file: 'paymentmethods.jpg', caption: '💳 Payment methods: Mobile Money, Card (Visa/Mastercard), and Crypto (USDT).' },
    enter_code: { file: 'entercode.jpg', caption: '🔑 Enter your activation code here to start the bot.' },
    free_trial_ui: { file: 'getfreetrial.jpg', caption: '🆓 Click "Free Trial" to get your 60-minute trial code — no payment!' },
    daily_predictions: { file: 'dailypredictions.jpg', caption: '📡 Daily prediction accuracy — our AI tracks every round.' },
    agent_program: { file: 'agentprogram.jpg', caption: '💼 Earn 30% commission as an AviSignals Agent — share and earn!' },
    email_example: { file: 'emailexample.jpg', caption: '📧 This is how your activation code email looks — it lands in your inbox instantly after payment (check spam/junk too).' },

    // Site-specific screenshots
    sportybet_shot: { file: 'sportyngrshot1.jpg', caption: '🏆 SportyBet session — bot predictions hitting accurately.' },
    hollywood_shot1: { file: 'hollywoodshot1.jpg', caption: '🎯 Hollywoodbets — AviSignals predictions in action.' },
    hollywood_shot2: { file: 'hollywoodshot2.jpg', caption: '💰 Another Hollywoodbets win session.' },
    betika_shot: { file: 'betikawinshot1.jpg', caption: '🏆 Betika — live predictions from the AviSignals bot.' },
    '1xbet_shot': { file: '1xbetshot1.jpg', caption: '🎯 1xBet — AviSignals bot working live.' },
    stake_shot: { file: 'stakeusshot1.jpg', caption: '🏆 Stake — accurate predictions, real results.' },
};

// ─── Site name normalization ─────────────────────────────────
// Maps common user inputs to our asset keys
const SITE_VIDEO_MAP = {
    sportybet: 'sportybet', sportybe: 'sportybet', sporty: 'sportybet',
    betway: 'betway',
    '1win': '1win', onewin: '1win',
    hollywoodbets: 'hollywood', hollywood: 'hollywood', hollywoodbet: 'hollywood',
    stake: 'stake', 'stake.com': 'stake',
    mozzart: 'mozzart', mozzartbet: 'mozzart',
};

/**
 * Resolves a video key to its full file path.
 * Returns null if the file doesn't exist on disk.
 */
function getVideoPath(key) {
    const entry = VIDEOS[key];
    if (!entry) return null;
    const fullPath = path.join(MARKETING_DIR, entry.file);
    if (!fs.existsSync(fullPath)) {
        console.warn(`⚠️ Video file not found: ${fullPath}`);
        return null;
    }
    return fullPath;
}

/**
 * Resolves an image key to its full file path.
 * For win_proofs, pass an index or let it pick randomly.
 */
function getImagePath(key, index = null) {
    const entry = IMAGES[key];
    if (!entry) return null;

    // Handle arrays (like win_proofs)
    if (Array.isArray(entry)) {
        const idx = index !== null ? index : Math.floor(Math.random() * entry.length);
        const item = entry[idx % entry.length];
        const fullPath = path.join(IMAGES_DIR, item.file);
        return fs.existsSync(fullPath) ? { path: fullPath, caption: item.caption, cacheKey: `${key}_${idx}` } : null;
    }

    const fullPath = path.join(IMAGES_DIR, entry.file);
    return fs.existsSync(fullPath) ? { path: fullPath, caption: entry.caption, cacheKey: key } : null;
}

/**
 * Given a user's message mentioning a betting site, returns the
 * matching video key (if we have a demo for that site).
 */
function matchSiteVideo(text) {
    const lower = (text || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
    for (const [pattern, videoKey] of Object.entries(SITE_VIDEO_MAP)) {
        if (lower.includes(pattern)) {
            return videoKey;
        }
    }
    return null;
}

module.exports = {
    VIDEOS,
    IMAGES,
    SITE_VIDEO_MAP,
    getVideoPath,
    getImagePath,
    matchSiteVideo,
    getCachedFileId,
    setCachedFileId,
};
