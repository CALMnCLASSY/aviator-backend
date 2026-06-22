// Agent/groqClient.js — Groq SDK with daily token budget guard and multi-key rotation
// ============================================================
// AI is ONLY for: chatAgent (user conversations) + admin briefings
// Everything else uses pre-written templates — no tokens needed.
//
// Daily budget: 90,000 tokens per key.
// Automatically rotates API keys if one key hits its budget limit or encounters rate-limits.
// ============================================================

const Groq = require('groq-sdk');
require('dotenv').config();

// Parse multiple keys if provided as a comma-separated list
const apiKeys = (process.env.GROQ_API_KEY || '').split(',').map(k => k.trim()).filter(Boolean);
const DAILY_TOKEN_BUDGET = parseInt(process.env.GROQ_DAILY_BUDGET || '90000', 10);

let currentKeyIndex = 0;
// Track tokens used today per key index
const tokensUsedTodayPerKey = {};
let lastResetDay = new Date().getDate();

if (apiKeys.length === 0) {
    console.warn('⚠️ GROQ_API_KEY is missing from environment variables.');
} else {
    console.log(`✅ Groq SDK Initialized with ${apiKeys.length} API key(s) (budget: ${DAILY_TOKEN_BUDGET.toLocaleString()} tokens per key)`);
}

function resetIfNewDay() {
    const today = new Date().getDate();
    if (today !== lastResetDay) {
        console.log(`🔄 Groq daily token counter reset for all keys`);
        for (const idx in tokensUsedTodayPerKey) {
            tokensUsedTodayPerKey[idx] = 0;
        }
        lastResetDay = today;
    }
}

function getActiveKey() {
    if (apiKeys.length === 0) return 'missing_key';
    return apiKeys[currentKeyIndex];
}

function rotateKey() {
    if (apiKeys.length <= 1) {
        console.warn('⚠️ No alternative Groq API keys available for rotation.');
        return false;
    }
    const prevIndex = currentKeyIndex;
    currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
    console.log(`🔄 Groq client rotated from key index ${prevIndex} to index ${currentKeyIndex} (Key ends with: ...${getActiveKey().slice(-6)})`);
    return true;
}

function trackTokens(usageObj) {
    if (!usageObj) return;
    const used = usageObj.total_tokens || (usageObj.prompt_tokens + usageObj.completion_tokens) || 0;
    
    tokensUsedTodayPerKey[currentKeyIndex] = (tokensUsedTodayPerKey[currentKeyIndex] || 0) + used;
    const currentTokens = tokensUsedTodayPerKey[currentKeyIndex];
    
    const pct = ((currentTokens / DAILY_TOKEN_BUDGET) * 100).toFixed(1);
    console.log(`📊 Groq key index ${currentKeyIndex} tokens today: ${currentTokens.toLocaleString()}/${DAILY_TOKEN_BUDGET.toLocaleString()} (${pct}%)`);
    if (currentTokens > DAILY_TOKEN_BUDGET * 0.85) {
        console.warn(`⚠️ Groq token budget for key index ${currentKeyIndex} at ${pct}% — approaching limit`);
    }
}

function checkBudget(estimatedTokens = 600) {
    resetIfNewDay();
    const activeKeyTokens = tokensUsedTodayPerKey[currentKeyIndex] || 0;
    
    if (activeKeyTokens + estimatedTokens > DAILY_TOKEN_BUDGET) {
        console.warn(`⚠️ Groq key index ${currentKeyIndex} budget exceeded (${activeKeyTokens}/${DAILY_TOKEN_BUDGET}). Attempting rotation...`);
        if (rotateKey()) {
            // Check budget recursively for the newly selected key
            return checkBudget(estimatedTokens);
        } else {
            throw new Error(`TOKEN_BUDGET_EXCEEDED: All Groq API keys exhausted today (${activeKeyTokens}/${DAILY_TOKEN_BUDGET})`);
        }
    }
}

// Cache of instantiated Groq SDK clients
const clientInstances = {};

function getClientInstance() {
    if (!clientInstances[currentKeyIndex]) {
        const key = getActiveKey();
        clientInstances[currentKeyIndex] = new Groq({ apiKey: key });
    }
    return clientInstances[currentKeyIndex];
}

// Wrap chat.completions.create to auto-track usage + enforce budget + handle rotation
const groq = {
    chat: {
        completions: {
            create: async (params) => {
                const estimated = params.max_tokens || 600;
                
                // throws if budget is hit across all keys
                checkBudget(estimated);

                const client = getClientInstance();
                
                try {
                    const result = await client.chat.completions.create(params);
                    if (result?.usage) {
                        trackTokens(result.usage);
                    }
                    return result;
                } catch (err) {
                    console.error(`❌ Groq error on key index ${currentKeyIndex}:`, err.message);
                    
                    // Rotate and retry once if it is a rate limit or auth error
                    const isRateLimit = err.message.includes('rate_limit') || err.message.includes('limit_exceeded') || err.status === 429;
                    const isAuthError = err.status === 401 || err.message.includes('API key');
                    
                    if ((isRateLimit || isAuthError) && rotateKey()) {
                        console.log('🔄 Key rotated successfully. Retrying Groq API request...');
                        return await groq.chat.completions.create(params);
                    }
                    
                    throw err;
                }
            }
        }
    },
    // Expose raw active client
    get _raw() {
        return getClientInstance();
    },
    getUsage: () => {
        const activeKeyTokens = tokensUsedTodayPerKey[currentKeyIndex] || 0;
        return {
            tokensUsedToday: activeKeyTokens,
            budget: DAILY_TOKEN_BUDGET,
            resetDay: lastResetDay,
            currentKeyIndex,
            totalKeys: apiKeys.length
        };
    }
};

module.exports = groq;
