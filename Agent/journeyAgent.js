// ============================================================
// journeyAgent.js — AviSignals User Journey Tracker
//
// Monitors user activities across the platform and sends a
// chronological summary to Discord after 10 minutes of inactivity.
// ============================================================

'use strict';

const discordAgent = require('./discordAgent');

// Map of userIdentifier -> { lastSeen: Date, events: [] }
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

    const journey = existing || { events: [], lastSeen: now };
    
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
function flushJourney(userIdentifier) {
    const journey = userJourneys.get(userIdentifier);
    if (!journey || journey.events.length === 0) {
        userJourneys.delete(userIdentifier);
        return;
    }

    console.log(`🚀 Flushing journey summary for ${userIdentifier} (${journey.events.length} events)`);

    discordAgent.sendJourneySummary({
        user: userIdentifier,
        activities: journey.events
    });

    userJourneys.delete(userIdentifier);
}

module.exports = {
    logEvent
};
