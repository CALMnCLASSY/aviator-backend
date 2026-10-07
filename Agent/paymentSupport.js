// ============================================================
// paymentSupport.js — Payment lookup & code-recovery helpers
// for the Telegram client support bot and admin commands.
//
// Read-only against the payments table EXCEPT adminVerifyPayment,
// which calls the existing /api/payments/admin-verify endpoint
// (the same endpoint used by Telegram verify buttons).
// ============================================================

'use strict';

const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

// Prefer the service-role key (same as telegramAgent.js) so lookups
// are never blocked by RLS; fall back to the shared client.
let supabase = null;
try {
    const url = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '').trim();
    if (url && key) supabase = createClient(url, key);
} catch (_) {}
if (!supabase) {
    try { supabase = require('./supabaseClient'); } catch (_) {}
}

const USDT_WALLET_ADDRESS = process.env.USDT_WALLET_ADDRESS || 'TCRwpXHYvcXY3y4FJThLHCc9hHbs9H4ExH';

const VERIFIED_STATUSES = ['verified', 'success', 'completed'];
const TERMINAL_BAD_STATUSES = ['rejected', 'failed', 'cancelled'];

function isVerifiedStatus(status) {
    return VERIFIED_STATUSES.includes(String(status || '').toLowerCase());
}

function isPendingStatus(status) {
    const s = String(status || '').toLowerCase();
    return !VERIFIED_STATUSES.includes(s) && !TERMINAL_BAD_STATUSES.includes(s);
}

/**
 * Look up a payment by transaction reference OR customer email.
 * Returns { found, payment, all? } — payment always carries .profiles when possible.
 */
async function lookupPayment({ email, reference } = {}) {
    if (!supabase) return { found: false, error: 'db_unavailable' };

    try {
        if (reference) {
            const { data, error } = await supabase
                .from('payments')
                .select('*, profiles(email, phone, full_name, assigned_site)')
                .eq('reference', reference)
                .maybeSingle();
            if (error) return { found: false, error: error.message };
            return data ? { found: true, payment: data } : { found: false };
        }

        if (email) {
            const clean = email.trim().toLowerCase();
            const { data: profiles, error: pErr } = await supabase
                .from('profiles')
                .select('id, email, phone, full_name, assigned_site')
                .ilike('email', clean)
                .limit(1);
            if (pErr) return { found: false, error: pErr.message };
            const profile = profiles && profiles[0];
            if (!profile) return { found: false };

            const { data: payments, error: payErr } = await supabase
                .from('payments')
                .select('*')
                .eq('user_id', profile.id)
                .order('created_at', { ascending: false })
                .limit(5);
            if (payErr) return { found: false, error: payErr.message };
            if (!payments || payments.length === 0) return { found: false };

            payments.forEach(p => { p.profiles = profile; });
            return { found: true, payment: payments[0], all: payments };
        }

        return { found: false };
    } catch (err) {
        return { found: false, error: err.message };
    }
}

/**
 * List payments still awaiting verification (last N hours).
 */
async function listPendingPayments(hours = 24) {
    if (!supabase) return [];
    try {
        const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
        const { data, error } = await supabase
            .from('payments')
            .select('*, profiles(email, phone, full_name, assigned_site)')
            .gte('created_at', cutoff)
            .order('created_at', { ascending: false })
            .limit(50);
        if (error || !data) return [];
        return data.filter(p => isPendingStatus(p.status));
    } catch (_) {
        return [];
    }
}

/**
 * Resolve the activation code for a payment/site.
 * Mirrors the code selection in routes/payments.js fulfillVerifiedPayment.
 */
function getCodeForSite(siteName) {
    const codes = global.activationCodes || {};
    let siteData = siteName ? codes[siteName] : null;
    // Case-insensitive fallback — slots store lowercase site names
    if (!siteData && siteName) {
        const key = Object.keys(codes).find(k => k.toLowerCase() === String(siteName).toLowerCase());
        siteData = key ? codes[key] : null;
    }
    if (!siteData) siteData = codes['Other'] || {};
    return siteData.daily || global.MASTER_ADMIN_CODE || 'OJ204';
}

/**
 * Resend the activation code email for a payment record.
 * Returns { sent, email?, code?, reason? }
 */
async function resendCodeEmail(payment) {
    const email = payment?.profiles?.email || payment?.email;
    if (!email) return { sent: false, reason: 'no_email' };

    const siteName = payment.profiles?.assigned_site || payment.siteName || 'your selected betting site';
    const code = getCodeForSite(payment.profiles?.assigned_site || payment.siteName);

    try {
        const emailService = require('./emailService');
        const ok = await emailService.sendActivationCodeEmail(email, code, siteName);
        return { sent: !!ok, email, code };
    } catch (err) {
        return { sent: false, reason: err.message, email, code };
    }
}

/**
 * Verify a payment through the existing admin endpoint
 * (marks verified in DB + dispatches the activation code email).
 */
async function adminVerifyPayment(reference) {
    const baseUrl = (process.env.BASE_URL || 'https://back.avisignals.com').trim().replace(/\/+$/, '');
    try {
        const res = await fetch(`${baseUrl}/api/payments/admin-verify/${encodeURIComponent(reference)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ verified: true })
        });
        return res.ok;
    } catch (err) {
        console.error('❌ adminVerifyPayment error:', err.message);
        return false;
    }
}

module.exports = {
    lookupPayment,
    listPendingPayments,
    getCodeForSite,
    resendCodeEmail,
    adminVerifyPayment,
    isVerifiedStatus,
    isPendingStatus,
    USDT_WALLET_ADDRESS,
};
