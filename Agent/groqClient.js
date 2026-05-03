// Agent/groqClient.js — Groq SDK with daily token budget guard
// ============================================================
// AI is ONLY for: chatAgent (user conversations) + admin briefings
// Everything else uses pre-written templates — no tokens needed.
//
// Daily budget: 90,000 tokens (leaves 10k buffer on free tier)
// When budget is hit: throws TOKEN_BUDGET_EXCEEDED so callers
// can fall back gracefully instead of silently failing.
// ============================================================

const Groq = require('groq-sdk');
require('dotenv').config();

const apiKey = process.env.GROQ_API_KEY;
const DAILY_TOKEN_BUDGET = parseInt(process.env.GROQ_DAILY_BUDGET || '90000', 10);

if (!apiKey) {
    console.warn('⚠️ GROQ_API_KEY is missing from environment variables.');
} else {
    console.log(`✅ Groq SDK Initialized (daily budget: ${DAILY_TOKEN_BUDGET.toLocaleString()} tokens)`);
}

// ─── Token tracker (resets at midnight) ──────────────────────
let tokensUsedToday = 0;
let lastResetDay = new Date().getDate();

function resetIfNewDay() {
    const today = new Date().getDate();
    if (today !== lastResetDay) {
        console.log(`🔄 Groq daily token counter reset (was ${tokensUsedToday.toLocaleString()} tokens)`);
        tokensUsedToday = 0;
        lastResetDay = today;
    }
}

function trackTokens(usageObj) {
    if (!usageObj) return;
    const used = usageObj.total_tokens || (usageObj.prompt_tokens + usageObj.completion_tokens) || 0;
    tokensUsedToday += used;
    const pct = ((tokensUsedToday / DAILY_TOKEN_BUDGET) * 100).toFixed(1);
    console.log(`📊 Groq tokens today: ${tokensUsedToday.toLocaleString()}/${DAILY_TOKEN_BUDGET.toLocaleString()} (${pct}%)`);
    if (tokensUsedToday > DAILY_TOKEN_BUDGET * 0.85) {
        console.warn(`⚠️ Groq token budget at ${pct}% — approaching daily limit`);
    }
}

function checkBudget(estimatedTokens = 600) {
    resetIfNewDay();
    if (tokensUsedToday + estimatedTokens > DAILY_TOKEN_BUDGET) {
        throw new Error(`TOKEN_BUDGET_EXCEEDED: ${tokensUsedToday.toLocaleString()}/${DAILY_TOKEN_BUDGET.toLocaleString()} tokens used today`);
    }
}

// ─── Wrapped Groq client ──────────────────────────────────────
const _groq = new Groq({ apiKey: apiKey || 'missing_key' });

// Wrap chat.completions.create to auto-track usage + enforce budget
const groq = {
    chat: {
        completions: {
            create: async (params) => {
                const estimated = params.max_tokens || 600;
                checkBudget(estimated); // throws if over budget

                const result = await _groq.chat.completions.create(params);
                if (result?.usage) trackTokens(result.usage);
                return result;
            }
        }
    },
    // Expose raw client in case needed
    _raw: _groq,
    getUsage: () => ({ tokensUsedToday, budget: DAILY_TOKEN_BUDGET, resetDay: lastResetDay })
};

module.exports = groq;
