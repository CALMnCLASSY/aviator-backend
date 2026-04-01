const Groq = require("groq-sdk");
require("dotenv").config();

const apiKey = process.env.GROQ_API_KEY;

if (!apiKey) {
    console.warn("⚠️ GROQ_API_KEY is missing from environment variables.");
} else {
    console.log("✅ Groq SDK Initialized");
}

const groq = new Groq({ apiKey: apiKey || 'missing_key' });

module.exports = groq;
