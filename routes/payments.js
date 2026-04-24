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
 * VERIFY PAYMENT (Status Check)
 */
router.get('/status/:reference', async (req, res) => {
  try {
    const { data, error } = await req.supabaseAdmin
      .from('payments')
      .select('status, amount, reference')
      .eq('reference', req.params.reference)
      .single();

    if (error) throw error;
    res.json({ success: true, status: data.status, payment: data });
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
    
    if (!req.supabaseAdmin) {
      return res.json({ success: true, status: 'pending', message: 'Payment verification in progress' });
    }

    const { data, error } = await req.supabaseAdmin
      .from('payments')
      .select('status, amount, reference, created_at')
      .eq('reference', reference)
      .single();

    if (error) {
      // Payment record not found yet - still pending
      return res.json({ success: true, status: 'pending', message: 'Waiting for payment verification' });
    }

    let codeToReturn = undefined;
    if (data.status === 'verified') {
        // We use the fallback 'Other' daily code because site isn't tracked in payments DB,
        // and 'Other' code is configured to work on any site.
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
 * ADMIN VERIFY
 * Updates Supabase status and sends alerts
 */
router.post('/admin-verify/:reference', async (req, res) => {
  try {
    const { verified, reason } = req.body;
    const { reference } = req.params;

    const { data, error } = await req.supabaseAdmin
      .from('payments')
      .update({ status: verified ? 'verified' : 'rejected' })
      .eq('reference', reference)
      .select('*, profiles(email)');

    if (error) throw error;

    // Discord Alert
    if (verified && data[0]) {
        const payment = data[0];
        const userEmail = payment.profiles?.email;

        // Send Email
        if (userEmail) {
            const emailService = require('../Agent/emailService');
            const siteData = (global.activationCodes && global.activationCodes['Other']) || {};
            const codeToReturn = siteData.daily || global.MASTER_ADMIN_CODE || 'OJ204';
            emailService.sendActivationCodeEmail(userEmail, codeToReturn).catch(e => console.error("Email err", e));
        }

        discordAgent.sendRevenueAlert({
            email: userEmail || 'Unknown', 
            amount: payment.amount,
            currency: payment.currency || 'USD',
            method: payment.method || 'Unknown',
            plan: payment.package || '24H Code',
            paystackRef: payment.reference
        });
    } else {
        discordAgent.sendPaymentEvent(verified ? 'PAYMENT_VERIFIED' : 'PAYMENT_REJECTED', { 
            ref: reference, 
            reason: reason || 'N/A' 
        });
    }

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * CREATE BOT PAYMENT RECORD
 * Insert a pending record to track the start of a Paystack transaction
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

    // Find or create profile to get proper UUID for user_id
    if (req.supabaseAdmin) {
      try {
        // Try to find existing profile by email or phone
        const { data: existingProfile } = await req.supabaseAdmin
          .from('profiles')
          .select('id')
          .or(`email.eq.${contact},phone.eq.${contact}`)
          .single();

        if (existingProfile) {
          profileId = existingProfile.id;
        } else {
          // Create new profile if doesn't exist
          const { data: newProfile, error: createErr } = await req.supabaseAdmin
            .from('profiles')
            .insert([{
              email: contact.includes('@') ? contact : null,
              phone: !contact.includes('@') ? contact : null,
              created_at: new Date().toISOString()
            }])
            .select('id')
            .single();

          if (newProfile) {
            profileId = newProfile.id;
          } else {
            console.warn('⚠️ Profile creation failed:', createErr?.message);
          }
        }

        // Insert pending payment record with proper UUID
        if (profileId) {
          const { error: dbError } = await req.supabaseAdmin
            .from('payments')
            .insert([{
              user_id: profileId,
              amount: 75,
              currency: 'USD',
              method: 'Paystack',
              status: 'pending',
              reference: reference,
              created_at: new Date().toISOString()
            }]);

          if (dbError) {
            console.warn('⚠️ Supabase Payment Insert (Non-fatal):', dbError.message);
          } else {
            console.log(`✅ Payment record created: ${reference} for user ${contact}`);
          }
        }
      } catch (dbErr) {
        console.error('⚠️ Database operation error (non-fatal):', dbErr.message);
      }
    }

    // Discord Alert
    discordAgent.sendPaymentEvent('PAYSTACK_INITIATED', {
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
    const planName = actualIsFree ? '30 minutes' : '24 hours';
    const planType = actualIsFree ? 'FREE_TRIAL' : 'PAID';

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
              code_type: planType,
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
              profile_id: profileId,
              code: code,
              site: site || 'Unknown',
              status: 'used',
              is_free: actualIsFree,
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