// ============================================================
// trialSite.js — Daily free-trial site rotation + admin override
//
// The frontend bot historically alternated the free-trial site
// (ClassyBet / JetBet) in the browser using day-of-year % 2.
// This service moves the decision to the server so:
//   - every client sees the SAME site for the day
//   - the admin can override today's site from the panel when
//     one site is down
//   - the override is keyed to today's date, so it expires
//     automatically at midnight and normal rotation resumes
//     (no cron needed)
//
// Day boundary uses a fixed timezone (TRIAL_TZ env, default
// Africa/Nairobi) so server and clients agree on "today".
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');

const OVERRIDE_FILE = path.join(__dirname, '..', 'trial_site_override.json');
const TRIAL_TZ = (process.env.TRIAL_TZ || 'Africa/Nairobi').trim();

const SITES = {
    classybet: {
        name: 'ClassyBet',
        key: 'classybet',
        url: 'https://classybetaviator.com/?ref=AVISIGNAL',
        displayName: 'ClassyBet'
    },
    jetbet: {
        name: 'JetBet',
        key: 'jetbet',
        url: 'https://jetbetaviator.com',
        displayName: 'JetBet'
    }
};

const ROTATION_ORDER = ['classybet', 'jetbet']; // index 0 = even day-of-year

// ─── Date helpers ────────────────────────────────────────────

// "Today" (and tomorrow) in the trial timezone, as YYYY-MM-DD
function dateKeyInTz(date = new Date(), tz = TRIAL_TZ) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    const get = (t) => parts.find(p => p.type === t).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
}

function tomorrowDate(date = new Date()) {
    return new Date(date.getTime() + 24 * 60 * 60 * 1000);
}

// Same formula the frontend used: day-of-year % 2
function getRotationSiteKey(date = new Date()) {
    const dayOfYear = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400000);
    return ROTATION_ORDER[dayOfYear % ROTATION_ORDER.length];
}

function getRotationSite(date = new Date()) {
    return SITES[getRotationSiteKey(date)];
}

// ─── Override persistence ────────────────────────────────────

function readOverride() {
    try {
        if (!fs.existsSync(OVERRIDE_FILE)) return null;
        const data = JSON.parse(fs.readFileSync(OVERRIDE_FILE, 'utf8'));
        if (!data || typeof data !== 'object' || !SITES[data.site]) return null;
        return data;
    } catch (_) {
        return null;
    }
}

function writeOverride(override) {
    try {
        if (override) {
            fs.writeFileSync(OVERRIDE_FILE, JSON.stringify(override, null, 2));
        } else if (fs.existsSync(OVERRIDE_FILE)) {
            fs.unlinkSync(OVERRIDE_FILE);
        }
    } catch (e) {
        console.error('❌ Failed to persist trial-site override:', e.message);
    }
}

function setOverride(siteKey, setBy = 'admin') {
    if (!SITES[siteKey]) return null;
    const override = {
        site: siteKey,
        date: dateKeyInTz(),          // override valid for today only
        timezone: TRIAL_TZ,
        setAt: new Date().toISOString(),
        setBy
    };
    writeOverride(override);
    console.log(`🔧 Trial-site override set: ${siteKey} for ${override.date} (${TRIAL_TZ}) by ${setBy}`);
    return override;
}

function clearOverride() {
    writeOverride(null);
}

// ─── Resolution ──────────────────────────────────────────────

/**
 * Returns which site new users get today.
 * {
 *   site, key, source: 'rotation'|'override', rotationSite,
 *   tomorrowSite, override: {...}|null, overrideActive, date, timezone
 * }
 */
function getTodaySite(date = new Date()) {
    const today = dateKeyInTz(date);
    const rotationSite = getRotationSite(date);
    const override = readOverride();
    const overrideActive = !!(override && override.date === today);

    const site = overrideActive ? SITES[override.site] : rotationSite;

    return {
        site,
        key: site.key,
        source: overrideActive ? 'override' : 'rotation',
        rotationSite,
        tomorrowSite: getRotationSite(tomorrowDate(date)),
        override,
        overrideActive,
        date: today,
        timezone: TRIAL_TZ
    };
}

module.exports = {
    SITES,
    TRIAL_TZ,
    dateKeyInTz,
    getRotationSite,
    getRotationSiteKey,
    getTodaySite,
    setOverride,
    clearOverride,
    readOverride
};
