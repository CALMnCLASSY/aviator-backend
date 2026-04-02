// routes/payments.js - Supabase backed Payment Management
const express = require('express');
const router = express.Router();
const axios = require('axios');
const fetch = require('node-fetch');
const discordAgent = require('../Agent/discordAgent');

const USDT_WALLET_ADDRESS = process.env.USDT_WALLET_ADDRESS || 'TCRwpXHYvcXY3y4FJThLHCc9hHbs9H4ExH';

// Token Library for automated code dispatch
// NOTE: All codes now come from global.activationCodes (rotating system)
// Hardcoded codes have been removed to avoid duplicates
const TOKEN_LIBRARY = {};

const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
const telegramChatId = process.env.TELEGRAM_CHAT_ID;

const sendToTelegram = async (message) => {
  try {
    await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: telegramChatId, text: message, parse_mode: 'HTML' })
    });
  } catch (error) {
    console.error('❌ Telegram Alert Failed:', error.message);
  }
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

    const { data, error } = await req.supabase
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
    const { data, error } = await req.supabase
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
 * ADMIN VERIFY
 * Updates Supabase status and sends alerts
 */
router.post('/admin-verify/:reference', async (req, res) => {
  try {
    const { verified, reason } = req.body;
    const { reference } = req.params;

    const { data, error } = await req.supabase
      .from('payments')
      .update({ status: verified ? 'verified' : 'rejected' })
      .eq('reference', reference)
      .select();

    if (error) throw error;

    // Discord Alert
    discordAgent.sendPaymentEvent(verified ? 'PAYMENT_VERIFIED' : 'PAYMENT_REJECTED', { ref: reference, reason: reason || 'N/A' });

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

    // Insert pending record into Supabase
    const { error: dbError } = await req.supabase
      .from('payments')
      .insert([{
        user_id: customerInfo.contact,
        amount: 75,
        currency: 'USD',
        method: 'Paystack',
        status: 'pending',
        reference: reference,
        created_at: new Date().toISOString()
      }]);

    if (dbError) {
      console.warn('⚠️ Supabase Insert (Non-fatal):', dbError.message);
    }

    // Discord Alert
    discordAgent.sendPaymentEvent('BOT_PAYMENT_INITIATED', { user: customerInfo.contact, site: customerInfo.bettingSite, ref: reference });

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
      discordAgent.sendUserEvent('FREE_CODE_GRANTED', {
        user: user || 'Anonymous',
        site: siteKey,
        code: code,
        timestamp: new Date().toISOString()
      });
    }

    res.json({ success: true, code });
  } catch (err) {
    console.error('❌ Reveal Code Error:', err.message);
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

    // Find or create profile for this user
    let profileId = null;
    if (req.supabase) {
      try {
        // Try to find existing profile
        const { data: existingProfile } = await req.supabase
          .from('profiles')
          .select('id')
          .or(`email.eq.${user},phone.eq.${user}`)
          .single();

        if (existingProfile) {
          profileId = existingProfile.id;
        } else {
          // Create new profile
          const { data: newProfile, error: createErr } = await req.supabase
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
          const { error: activationErr } = await req.supabase
            .from('activations')
            .insert([{
              profile_id: profileId,
              code: code,
              site: site || 'Unknown',
              status: 'used',
              is_free: isFree || false,
              activated_at: new Date().toISOString()
            }]);

          if (activationErr) {
            console.warn('⚠️ Activation record insert error:', activationErr.message);
          } else {
            console.log(`✅ Activation recorded: ${user} used code ${code} on ${site}`);
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

    res.json({ success: true, message: 'Code activation recorded' });
  } catch (err) {
    console.error('❌ Mark Code Used Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;