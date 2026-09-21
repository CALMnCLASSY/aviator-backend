// routes/payments.js - Supabase backed Payment Management
const express = require('express');
const router = express.Router();
const axios = require('axios');
const fetch = require('node-fetch');
const discordAgent = require('../Agent/discordAgent');
const journeyAgent = require('../Agent/journeyAgent');
const fs = require('fs');
const path = require('path');

const USDT_WALLET_ADDRESS = process.env.USDT_WALLET_ADDRESS || 'TCRwpXHYvcXY3y4FJThLHCc9hHbs9H4ExH';

// Token Library for automated code dispatch
// NOTE: All codes now come from global.activationCodes (rotating system)
// Hardcoded codes have been removed to avoid duplicates
const TOKEN_LIBRARY = {};

const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
const telegramChatId = process.env.TELEGRAM_CHAT_ID;

const sendToTelegram = async (message) => {
  // Empty stub to prevent Telegram API calls (Discord is used instead)
};

router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

/**
 * CREATE USDT ORDER
 * Inserts record into Supabase payments table
 */
router.post('/usdt/create-order', async (req, res) => {
  try {
    const { user_id, contact, packageName, priceUsd, durationKey } = req.body;
    if (!user_id || !packageName || !priceUsd) return res.status(400).json({ success: false, error: 'Missing fields' });

    const reference = `USDT_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

    const { data, error } = await req.supabaseAdmin
      .from('payments')
      .insert([{
        user_id,
        amount: priceUsd,
        currency: 'USDT',
        method: 'USDT',
        status: 'pending',
        reference,
        created_at: new Date().toISOString()
      }])
      .select();

    if (error) throw error;

    // Discord Alert
    discordAgent.sendPaymentEvent('NEW_USDT_ORDER', { user: contact || 'UID:' + user_id, package: packageName, amount: priceUsd + ' USDT', ref: reference });
    journeyAgent.logEvent(contact || user_id, 'PAYMENT_STARTED', { pkg: packageName });

    res.json({ success: true, reference, walletAddress: USDT_WALLET_ADDRESS });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Helper to ensure a profile exists in Supabase (auth.users + profiles) for user_id constraint
 */
async function getOrCreateProfileId(db, contact, fallbackEmail = null, fallbackPhone = null) {
  if (!db) return null;
  const userContact = contact || fallbackEmail || fallbackPhone;
  if (userContact) {
    try {
      const { data: existingProf } = await db
        .from('profiles')
        .select('id')
        .or(`email.eq.${userContact},phone.eq.${userContact}`)
        .limit(1)
        .single();
      if (existingProf?.id) return existingProf.id;
    } catch (e) {}
  }

  const email = (userContact && userContact.includes('@')) ? userContact : (fallbackEmail || `guest_${Date.now()}@avisignals.com`);
  const phone = (userContact && !userContact.includes('@')) ? userContact : fallbackPhone;
  
  if (db.auth && db.auth.admin) {
    try {
      const crypto = require('crypto');
      const { data: authUser } = await db.auth.admin.createUser({
        email,
        password: crypto.randomBytes(16).toString('hex'),
        email_confirm: true,
        user_metadata: { phone: phone || null }
      });
      if (authUser && authUser.user && authUser.user.id) {
        const userId = authUser.user.id;
        await db.from('profiles').insert([{
          id: userId,
          email,
          phone: phone || null,
          created_at: new Date().toISOString()
        }]);
        return userId;
      }
    } catch (e) {
      console.warn('⚠️ User auth creation note:', e.message);
    }
  }

  try {
    const { data: anyProf } = await db.from('profiles').select('id').limit(1).single();
    if (anyProf?.id) return anyProf.id;
  } catch (e) {}

  return null;
}

/**
 * Helper function to handle full payment verification & activation dispatch
 */
async function fulfillVerifiedPayment(dbClient, reference, flwData = {}) {
  const db = dbClient || global.supabaseAdmin || global.supabase;
  if (!db || !reference) return null;

  try {
    const { data: existing, error: findErr } = await db
      .from('payments')
      .select('*, profiles(email, phone, full_name, assigned_site)')
      .eq('reference', reference)
      .single();

    let payment = existing;

    if (findErr || !existing) {
      console.warn(`⚠️ Payment record for ${reference} not found in DB during fulfillment. Creating record...`);
      const userEmail = flwData.customer?.email || flwData.email;
      const userPhone = flwData.customer?.phone_number || flwData.phone;
      const contact = userEmail || userPhone;
      const profileId = await getOrCreateProfileId(db, contact, userEmail, userPhone);

      const { data: createdPay, error: insertPayErr } = await db
        .from('payments')
        .insert([{
          user_id: profileId,
          amount: flwData.amount || 75,
          currency: flwData.currency || 'USD',
          method: flwData.payment_type || 'Flutterwave',
          status: 'verified',
          reference: reference,
          created_at: new Date().toISOString()
        }])
        .select('*, profiles(email, phone, full_name, assigned_site)')
        .single();

      if (insertPayErr) {
        console.error('❌ Failed to insert fallback payment record:', insertPayErr.message);
      } else {
        payment = createdPay;
      }
    } else {
      if (existing.status === 'verified') {
        return existing;
      }

      const { data: updated, error: updateErr } = await db
        .from('payments')
        .update({ 
          status: 'verified'
        })
        .eq('reference', reference)
        .select('*, profiles(email, phone, full_name, assigned_site)');

      if (updateErr) {
        console.error(`❌ Failed to update payment ${reference} status:`, updateErr.message);
        return null;
      }

      payment = (updated && updated[0]) || existing;
    }

    if (!payment) return null;

    if (global.botPayments && global.botPayments[reference]) {
      global.botPayments[reference].status = 'verified';
    }

    const userEmail = payment.profiles?.email || flwData.customer?.email;
    const userPhone = payment.profiles?.phone || flwData.customer?.phone_number;
    const referrer = payment.profiles?.full_name;
    const siteName = payment.profiles?.assigned_site || 'your selected betting site';

    // Dispatch Email Activation Code
    if (userEmail) {
      try {
        const emailService = require('../Agent/emailService');
        const siteData = (global.activationCodes && global.activationCodes['Other']) || {};
        const codeToReturn = siteData.daily || global.MASTER_ADMIN_CODE || 'OJ204';
        emailService.sendActivationCodeEmail(userEmail, codeToReturn, siteName).catch(e => console.error("Email send err:", e.message));
      } catch (e) {
        console.error("Email service error:", e.message);
      }
    }

    // Referral tracking log & alert
    if (referrer) {
      try {
        await db
          .from('logs')
          .insert([{
            event_type: 'referral_purchase',
            details: {
              email: userEmail || 'Unknown',
              phone: userPhone || 'N/A',
              referrer: referrer,
              amount: payment.amount,
              currency: payment.currency || 'USD',
              reference: payment.reference,
              timestamp: new Date().toISOString()
            }
          }]);
      } catch (dbErr) {
        console.warn('⚠️ Referral purchase log insert error:', dbErr.message);
      }

      discordAgent.sendReferralPurchaseEvent({
        email: userEmail || 'Unknown',
        phone: userPhone || 'N/A',
        referrer: referrer,
        amount: payment.amount,
        currency: payment.currency || 'USD',
        reference: payment.reference
      });
    }

    // Revenue alert to Discord
    discordAgent.sendRevenueAlert({
      email: userEmail || 'Unknown',
      amount: payment.amount,
      currency: payment.currency || 'USD',
      method: payment.method || 'Flutterwave',
      plan: payment.package || '24H Code',
      flutterwaveRef: payment.reference
    });

    journeyAgent.logEvent(userEmail || reference, 'PAYMENT_VERIFIED', { ref: reference, method: 'Flutterwave' });

    console.log(`✅ Payment ${reference} successfully verified & fulfilled!`);
    return payment;
  } catch (err) {
    console.error(`❌ Error in fulfillVerifiedPayment for ${reference}:`, err.message);
    return null;
  }
}

/**
 * FLUTTERWAVE WEBHOOK HANDLER
 * Handles charge.completed events from Flutterwave IPNs
 */
const handleFlutterwaveWebhook = async (req, res) => {
  try {
    const secretHash = process.env.FLUTTERWAVE_SECRET_HASH;
    const signature = req.headers['verif-hash'] || req.headers['Verif-Hash'] || req.headers['x-verif-hash'];

    if (secretHash && signature && signature !== secretHash) {
      console.warn(`⚠️ Flutterwave Webhook signature mismatch: got ${signature}, expected ${secretHash}`);
      return res.status(401).json({ success: false, message: 'Invalid webhook signature' });
    }

    const payload = req.body || {};
    const event = payload.event;
    const data = payload.data || payload;
    const isSuccessful = (event === 'charge.completed' || data.status === 'successful');
    const reference = data.tx_ref || data.reference;

    console.log(`📩 Flutterwave Webhook Received - Event: ${event || 'N/A'}, Status: ${data.status || 'N/A'}, Ref: ${reference || 'N/A'}`);

    if (isSuccessful && reference) {
      const dbClient = req.supabaseAdmin || req.supabase;
      await fulfillVerifiedPayment(dbClient, reference, data);
    } else {
      console.log(`ℹ️ Webhook ignored - Event: ${event}, status: ${data.status}`);
    }

    res.status(200).json({ success: true, message: 'Webhook processed' });
  } catch (err) {
    console.error('❌ Flutterwave Webhook Error:', err.message);
    res.status(200).json({ success: false, error: err.message });
  }
};

router.post('/webhooks/flutterwave', handleFlutterwaveWebhook);
router.post('/webhook/flutterwave', handleFlutterwaveWebhook);
router.post('/flutterwave/webhook', handleFlutterwaveWebhook);
router.post('/flutterwave', handleFlutterwaveWebhook);

/**
 * VERIFY PAYMENT (Status Check)
 */
router.get('/status/:reference', async (req, res) => {
  try {
    const { reference } = req.params;
    const dbClient = req.supabaseAdmin || req.supabase;
    if (!dbClient) {
      return res.status(500).json({ success: false, error: 'Database not initialized' });
    }

    let { data, error } = await dbClient
      .from('payments')
      .select('status, amount, reference')
      .eq('reference', reference)
      .single();

    if (error && !data) {
      return res.json({ success: true, status: 'pending', message: 'Payment in progress' });
    }

    if (data && data.status === 'pending' && process.env.FLUTTERWAVE_SECRET_KEY) {
      try {
        const flwRes = await axios.get(
          `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`,
          {
            headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` },
            timeout: 7000
          }
        );
        if (flwRes.data && flwRes.data.status === 'success' && flwRes.data.data) {
          const txData = flwRes.data.data;
          if (txData.status === 'successful') {
            const fulfilled = await fulfillVerifiedPayment(dbClient, reference, txData);
            if (fulfilled) data.status = 'verified';
          }
        }
      } catch (flwErr) {
        console.warn(`⚠️ Flutterwave status check fallback warning for ${reference}:`, flwErr.message);
      }
    }

    res.json({ success: true, status: data?.status || 'pending', payment: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * BOT PAYMENT STATUS CHECK
 * Check status of bot payment verification
 */
router.get('/bot/status/:reference', async (req, res) => {
  try {
    const { reference } = req.params;
    const dbClient = req.supabaseAdmin || req.supabase;

    // Prevent any caching of status responses — critical for real-time verification
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    
    if (!dbClient) {
      return res.json({ success: true, status: 'pending', message: 'Payment verification in progress' });
    }

    let { data, error } = await dbClient
      .from('payments')
      .select('status, amount, reference, created_at')
      .eq('reference', reference)
      .single();

    if (error || !data) {
      // Check in-memory store as fallback
      if (global.botPayments && global.botPayments[reference]) {
        data = {
          reference,
          amount: global.botPayments[reference].amount || 75,
          status: global.botPayments[reference].status || 'pending',
          created_at: global.botPayments[reference].created_at || new Date().toISOString()
        };
      } else {
        return res.json({ success: true, status: 'pending', message: 'Waiting for payment verification' });
      }
    }

    // Sync in-memory state for BOTH verified AND rejected
    if (global.botPayments && global.botPayments[reference]?.status) {
      const memStatus = global.botPayments[reference].status;
      if (memStatus === 'verified' || memStatus === 'rejected') {
        data.status = memStatus;
      }
    }

    // ACTIVE FALLBACK VERIFICATION IF STILL PENDING
    if (data.status === 'pending' && process.env.FLUTTERWAVE_SECRET_KEY) {
      try {
        const flwRes = await axios.get(
          `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`,
          {
            headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` },
            timeout: 7000
          }
        );

        if (flwRes.data && flwRes.data.status === 'success' && flwRes.data.data) {
          const txData = flwRes.data.data;
          if (txData.status === 'successful') {
            console.log(`⚡ Active polling verified Flutterwave tx_ref: ${reference}`);
            const fulfilled = await fulfillVerifiedPayment(dbClient, reference, txData);
            if (fulfilled) {
              data.status = 'verified';
            }
          }
        }
      } catch (flwErr) {
        console.warn(`⚠️ Flutterwave status check fallback warning for ${reference}:`, flwErr.message);
      }
    }

    let codeToReturn = undefined;
    if (data.status === 'verified') {
        const siteData = (global.activationCodes && global.activationCodes['Other']) || {};
        codeToReturn = siteData.daily || global.MASTER_ADMIN_CODE || 'OJ204';
    }

    res.json({ 
      success: true, 
      status: data.status,
      code: codeToReturn,
      activationCode: codeToReturn,
      payment: {
        reference: data.reference,
        amount: data.amount,
        status: data.status,
        created_at: data.created_at
      }
    });
  } catch (err) {
    console.error('❌ Bot Status Check Error:', err.message);
    res.json({ success: true, status: 'pending', message: 'Checking payment status' });
  }
});

/**
 * ADMIN VERIFICATION HANDLER
 * Handles manual verification/rejection from Admin dashboard or Telegram bot
 */
const handleAdminVerify = async (req, res) => {
  try {
    const { verified, status, reason } = req.body;
    const { reference } = req.params;
    const dbClient = req.supabaseAdmin || req.supabase;

    const isVerified = (verified === true || verified === 'true' || verified === 'verified' || status === 'verified');
    const targetStatus = isVerified ? 'verified' : 'rejected';

    if (!dbClient) {
      return res.status(500).json({ success: false, error: 'Database client not initialized' });
    }

    // Check if record exists
    let { data: existing } = await dbClient
      .from('payments')
      .select('*, profiles(email, phone, full_name, assigned_site)')
      .eq('reference', reference)
      .single();

    let data = null;

    if (existing) {
      const { data: updated, error: updateErr } = await dbClient
        .from('payments')
        .update({ 
          status: targetStatus
        })
        .eq('reference', reference)
        .select('*, profiles(email, phone, full_name, assigned_site)');

      if (updateErr) throw updateErr;
      data = updated;
    } else {
      // Record not found in DB - insert new verified payment record
      const memPayment = (global.botPayments && global.botPayments[reference]) || 
                         (global.selarPayments && global.selarPayments[reference]) || 
                         (global.usdtPayments && global.usdtPayments[reference]) || {};

      const contact = memPayment.contact || memPayment.email || memPayment.phone;
      const profileId = await getOrCreateProfileId(dbClient, contact, memPayment.email, memPayment.phone);

      const { data: inserted, error: insertErr } = await dbClient
        .from('payments')
        .insert([{
          user_id: profileId,
          amount: memPayment.amount || memPayment.priceUsd || 75,
          currency: memPayment.currency || 'USD',
          method: memPayment.paymentType || 'Manual Admin',
          status: targetStatus,
          reference: reference,
          created_at: new Date().toISOString()
        }])
        .select('*, profiles(email, phone, full_name, assigned_site)');

      if (insertErr) console.warn('⚠️ Fallback insert error on verify:', insertErr.message);
      data = inserted;
    }

    // Sync in-memory store if present
    if (global.botPayments && global.botPayments[reference]) {
      global.botPayments[reference].status = targetStatus;
    }

    // Discord Alert & Fulfillment
    const payment = (data && data[0]) || existing;
    if (isVerified && payment) {
        const userEmail = payment.profiles?.email || payment.email;
        const userPhone = payment.profiles?.phone || payment.phone;
        const referrer = payment.profiles?.full_name;
        const siteName = payment.profiles?.assigned_site || 'your selected betting site';

        // Send Email Activation Code
        if (userEmail) {
            try {
                const emailService = require('../Agent/emailService');
                const siteData = (global.activationCodes && global.activationCodes['Other']) || {};
                const codeToReturn = siteData.daily || global.MASTER_ADMIN_CODE || 'OJ204';
                emailService.sendActivationCodeEmail(userEmail, codeToReturn, siteName).catch(e => console.error("Email err", e));
            } catch (e) {
                console.error("Email service error:", e.message);
            }
        }

        // Referral System tracking
        if (referrer) {
            try {
                await dbClient
                    .from('logs')
                    .insert([{
                        event_type: 'referral_purchase',
                        details: {
                            email: userEmail || 'Unknown',
                            phone: userPhone || 'N/A',
                            referrer: referrer,
                            amount: payment.amount,
                            currency: payment.currency || 'USD',
                            reference: payment.reference,
                            timestamp: new Date().toISOString()
                        }
                    }]);
            } catch (dbErr) {
                console.warn('⚠️ Referral purchase log insert error:', dbErr.message);
            }

            discordAgent.sendReferralPurchaseEvent({
                email: userEmail || 'Unknown',
                phone: userPhone || 'N/A',
                referrer: referrer,
                amount: payment.amount,
                currency: payment.currency || 'USD',
                reference: payment.reference
            });
        }

        discordAgent.sendRevenueAlert({
            email: userEmail || 'Unknown', 
            amount: payment.amount,
            currency: payment.currency || 'USD',
            method: payment.method || 'Manual Admin',
            plan: payment.package || '24H Code',
            flutterwaveRef: payment.reference
        });
    } else {
        discordAgent.sendPaymentEvent(isVerified ? 'PAYMENT_VERIFIED' : 'PAYMENT_REJECTED', { 
            ref: reference, 
            reason: reason || 'N/A' 
        });
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('❌ Admin verify error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

router.post('/admin-verify/:reference', handleAdminVerify);
router.post('/bot/verify/:reference', handleAdminVerify);
router.post('/bot/admin-verify/:reference', handleAdminVerify);
router.post('/selar/admin-verify/:reference', handleAdminVerify);
router.post('/usdt/admin-verify/:reference', handleAdminVerify);
router.post('/verify/:reference', handleAdminVerify);

/**
 * CREATE BOT PAYMENT RECORD
 * Insert a pending record to track the start of a Flutterwave transaction
 */
router.post('/bot/create-payment/:reference', async (req, res) => {
  try {
    const { reference } = req.params;
    const { customerInfo } = req.body;
    
    if (!customerInfo || !customerInfo.contact) {
      return res.status(400).json({ success: false, error: 'Customer contact is required' });
    }

    const contact = customerInfo.contact;
    let profileId = null;
    const dbClient = req.supabaseAdmin || req.supabase;

    // Track in memory
    global.botPayments = global.botPayments || {};
    global.botPayments[reference] = {
      contact,
      email: customerInfo.email || (contact.includes('@') ? contact : null),
      packageName: customerInfo.packageName || 'Daily Activation',
      amount: customerInfo.amount || 75,
      site: customerInfo.bettingSite || 'Unknown',
      status: 'pending',
      created_at: new Date().toISOString()
    };

    // Find or create profile to get proper UUID for user_id
    if (dbClient) {
      try {
        profileId = await getOrCreateProfileId(dbClient, contact, customerInfo.email);

        // Insert pending payment record
        const { error: dbError } = await dbClient
          .from('payments')
          .insert([{
            user_id: profileId,
            amount: customerInfo.amount || 75,
            currency: 'USD',
            method: 'Flutterwave',
            status: 'pending',
            reference: reference,
            created_at: new Date().toISOString()
          }]);

        if (dbError) {
          console.warn('⚠️ Supabase Payment Insert (Non-fatal):', dbError.message);
        } else {
          console.log(`✅ Payment record created: ${reference} for user ${contact}`);
        }
      } catch (dbErr) {
        console.error('⚠️ Database operation error (non-fatal):', dbErr.message);
      }
    }

    // Discord Alert
    discordAgent.sendPaymentEvent('FLUTTERWAVE_INITIATED', {
      user: customerInfo.contact,
      package: customerInfo.packageName || 'Daily Activation',
      site: customerInfo.bettingSite || 'Unknown',
      ref: reference
    });
    journeyAgent.logEvent(contact, 'PAYMENT_STARTED', { pkg: customerInfo.packageName || 'Daily Activation' });

    res.json({ success: true });
  } catch (err) {
    console.error('❌ Create Bot Payment Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * REVEAL CODE (Site-specific helper for the bot)
 */
router.post('/bot/reveal-code', async (req, res) => {
  try {
    const { site, user, isFree } = req.body;
    if (!site) return res.status(400).json({ success: false, error: 'Site is required' });

    // Access the global activation codes initialized in app.js
    // We do a case-insensitive search to be safe
    const siteKey = Object.keys(global.activationCodes || {}).find(
      k => k.toLowerCase() === site.toLowerCase()
    ) || 'Other';
    
    const siteData = (global.activationCodes && global.activationCodes[siteKey]) || {};

    // Get the requested code type
    const code = isFree ? siteData.freeTrial : siteData.daily;

    if (!code) {
      // Fallback to 'Other' if specific site code is missing
      const otherCode = isFree ? (global.activationCodes['Other']?.freeTrial) : (global.activationCodes['Other']?.daily);
      if (otherCode) {
        return res.json({ success: true, code: otherCode, note: 'Fallback to default' });
      }
      return res.status(404).json({ success: false, error: 'No code found for this site/type' });
    }

    // Log for admin tracking (visible in server logs)
    console.log(`[REVEAL] User: ${user || 'anon'}, Site: ${siteKey}, Free: ${isFree}, Code: ${code}`);

    // Send Discord notification for free code grant
    if (isFree) {
      discordAgent.sendCodeEvent({
        site: siteKey,
        codeType: 'FREE_TRIAL',
        code: code,
        generatedAt: new Date().toISOString(),
        user: user || 'Anonymous'
      });
      journeyAgent.logEvent(user, 'FREE_CODE_GOTTEN', { site: siteKey });
    }

    res.json({ success: true, code });
  } catch (err) {
    console.error('❌ Reveal Code Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * ACTIVATE CODE (Legacy endpoint for backward compatibility)
 * Alias for mark-code-used
 */
router.post('/bot/activate-code', async (req, res) => {
  try {
    const { user, contact, code, site, isFree } = req.body;
    const trackingUser = user || contact;
    
    if (!trackingUser || !code) {
      return res.status(400).json({ success: false, error: 'User and code are required' });
    }

    // Strict Code Validation
    const siteKey = Object.keys(global.activationCodes || {}).find(k => k.toLowerCase() === (site || '').toLowerCase()) || 'Other';
    const siteData = (global.activationCodes && global.activationCodes[siteKey]) || {};
    
    // Check if the code is valid for this site or default fallback
    const isFreeCode = siteData.freeTrial === code;
    const isPaidCode = siteData.daily === code;
    const fallbackFree = global.activationCodes['Other']?.freeTrial === code;
    const fallbackPaid = global.activationCodes['Other']?.daily === code;

    if (!isFreeCode && !isPaidCode && !fallbackFree && !fallbackPaid) {
      if (code !== global.MASTER_ADMIN_CODE) {
        return res.status(400).json({ success: false, error: 'Invalid or expired activation code' });
      }
    }

    // Determine actual plan based on what matched
    const actualIsFree = isFreeCode || fallbackFree;
    const planName = actualIsFree ? '60 minutes' : '24 hours';
    const planType = actualIsFree ? 'freeTrial' : 'daily';

    // Find or create profile for this user
    let profileId = null;
    if (req.supabaseAdmin) {
      try {
        // Try to find existing profile
        const { data: existingProfile } = await req.supabaseAdmin
          .from('profiles')
          .select('id')
          .or(`email.eq.${trackingUser},phone.eq.${trackingUser}`)
          .single();

        if (existingProfile) {
          profileId = existingProfile.id;
        } else {
          // Create new profile
          const { data: newProfile, error: createErr } = await req.supabaseAdmin
            .from('profiles')
            .insert([{
              email: trackingUser.includes('@') ? trackingUser : null,
              phone: !trackingUser.includes('@') ? trackingUser : null,
              last_seen: new Date().toISOString()
            }])
            .select('id')
            .single();

          if (newProfile) {
            profileId = newProfile.id;
          }
        }

        // Create activation record
        if (profileId) {
          const { error: activationErr } = await req.supabaseAdmin
            .from('activations')
            .insert([{
              user_id: profileId,
              code: code,
              site: site || 'Unknown',
              code_type: planType, // 'freeTrial' or 'daily'
              activated_at: new Date().toISOString()
            }]);

          if (activationErr) {
            console.warn('⚠️ Activation record insert error:', activationErr.message);
          } else {
            console.log(`✅ Activation recorded: ${trackingUser} used code ${code} on ${site}`);
          }
        }
      } catch (dbErr) {
        console.error('⚠️ Activation tracking error:', dbErr.message);
        // Non-fatal - continue anyway
      }
    }

    // Send Discord notification
    discordAgent.sendBotEvent({
      user: trackingUser,
      code: code,
      site: site || 'Unknown',
      type: planType,
      status: 'ACTIVATED',
      timestamp: new Date().toISOString()
    });

    // ROTATION: If a code was successfully used, generate a new one for that site/category
    if (global.activationCodes[siteKey]) {
      if (isFreeCode) {
        global.activationCodes[siteKey].freeTrial = global.generateActivationCode();
        console.log(`🔄 Rotated Free Trial code for ${siteKey}`);
      } else if (isPaidCode) {
        global.activationCodes[siteKey].daily = global.generateActivationCode();
        console.log(`🔄 Rotated Daily code for ${siteKey}`);
      } else if (fallbackFree) {
        global.activationCodes['Other'].freeTrial = global.generateActivationCode();
        console.log(`🔄 Rotated Fallback Free Trial code`);
      } else if (fallbackPaid) {
        global.activationCodes['Other'].daily = global.generateActivationCode();
        console.log(`🔄 Rotated Fallback Daily code`);
      }
      global.saveActivationCodes();
    }

    res.json({ success: true, message: 'Code activation recorded', plan: planName });
  } catch (err) {
    console.error('❌ Activate Code Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * MARK CODE AS USED (Activation tracking)
 * Called when user activates a code - creates activation record in Supabase
 */
router.post('/bot/mark-code-used', async (req, res) => {
  try {
    const { user, code, site, isFree } = req.body;
    if (!user || !code) {
      return res.status(400).json({ success: false, error: 'User and code are required' });
    }

    // Strict Code Validation
    const siteKey = Object.keys(global.activationCodes || {}).find(k => k.toLowerCase() === (site || '').toLowerCase()) || 'Other';
    const siteData = (global.activationCodes && global.activationCodes[siteKey]) || {};
    
    // Check if the code is valid for this site or default fallback
    const isFreeCode = siteData.freeTrial === code;
    const isPaidCode = siteData.daily === code;
    const fallbackFree = global.activationCodes['Other']?.freeTrial === code;
    const fallbackPaid = global.activationCodes['Other']?.daily === code;

    if (!isFreeCode && !isPaidCode && !fallbackFree && !fallbackPaid) {
      if (code !== global.MASTER_ADMIN_CODE) {
        return res.status(400).json({ success: false, error: 'Invalid or expired activation code' });
      }
    }

    const actualIsFree = isFreeCode || fallbackFree;

    // Find or create profile for this user
    let profileId = null;
    if (req.supabaseAdmin) {
      try {
        // Try to find existing profile
        const { data: existingProfile } = await req.supabaseAdmin
          .from('profiles')
          .select('id')
          .or(`email.eq.${user},phone.eq.${user}`)
          .single();

        if (existingProfile) {
          profileId = existingProfile.id;
        } else {
          // Create new profile
          const { data: newProfile, error: createErr } = await req.supabaseAdmin
            .from('profiles')
            .insert([{
              email: user.includes('@') ? user : null,
              phone: !user.includes('@') ? user : null,
              created_at: new Date().toISOString()
            }])
            .select('id')
            .single();

          if (newProfile) {
            profileId = newProfile.id;
          }
        }

        // Create activation record
        if (profileId) {
          const { error: activationErr } = await req.supabaseAdmin
            .from('activations')
            .insert([{
              user_id: profileId,
              code: code,
              site: site || 'Unknown',
              code_type: actualIsFree ? 'freeTrial' : 'daily', // matches DB constraint
              activated_at: new Date().toISOString()
            }]);

          if (activationErr) {
            console.warn('⚠️ Activation record insert error:', activationErr.message);
          } else {
            console.log(`✅ ${user} logged use of code ${code} for site ${site}`);
          }
        }
      } catch (dbErr) {
        console.error('⚠️ Activation tracking error:', dbErr.message);
        // Non-fatal - continue anyway
      }
    }

    // Send Discord notification
    discordAgent.sendBotEvent({
      user: user,
      code: code,
      site: site || 'Unknown',
      type: isFree ? 'FREE_TRIAL' : 'PAID',
      status: 'ACTIVATED',
      timestamp: new Date().toISOString()
    });

    // ROTATION: If a code was successfully used, generate a new one for that site/category
    if (global.activationCodes[siteKey]) {
      if (isFreeCode) {
        global.activationCodes[siteKey].freeTrial = global.generateActivationCode();
        console.log(`🔄 Rotated Free Trial code for ${siteKey}`);
      } else if (isPaidCode) {
        global.activationCodes[siteKey].daily = global.generateActivationCode();
        console.log(`🔄 Rotated Daily code for ${siteKey}`);
      } else if (fallbackFree) {
        global.activationCodes['Other'].freeTrial = global.generateActivationCode();
        console.log(`🔄 Rotated Fallback Free Trial code`);
      } else if (fallbackPaid) {
        global.activationCodes['Other'].daily = global.generateActivationCode();
        console.log(`🔄 Rotated Fallback Daily code`);
      }
      global.saveActivationCodes();
    }

    res.json({ success: true, message: 'Code marked as used' });
  } catch (err) {
    console.error('❌ Mark Code Used Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;