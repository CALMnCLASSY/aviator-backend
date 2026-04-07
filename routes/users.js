// routes/users.js - Supabase backed User & Activation management
const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const discordAgent = require('../Agent/discordAgent');

// Telegram configuration (Fallback or analytics)
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
const telegramChatId = process.env.TELEGRAM_CHAT_ID;

// Helper function to send to Telegram (Professional Alert System)
const sendToTelegram = async (message) => {
  try {
    const response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramChatId,
        text: message,
        parse_mode: 'HTML'
      })
    });
    return await response.json();
  } catch (error) {
    console.error('❌ Telegram Alert Failed:', error.message);
    return { success: false, error: error.message };
  }
};

// CORS middleware
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

/**
 * SYNC PROFILE
 * Syncs user auth data with the profiles table
 */
router.post('/sync-profile', async (req, res) => {
  try {
    const { id, email, phone } = req.body;
    if (!id || !email) return res.status(400).json({ success: false, error: 'Missing req fields' });

    if (!req.supabaseAdmin) {
      return res.status(503).json({ success: false, error: 'Database admin client not available' });
    }

    const { data, error } = await req.supabaseAdmin
      .from('profiles')
      .upsert({ id, email, phone, last_seen: new Date().toISOString() });

    if (error) throw error;

    res.json({ success: true, data });
  } catch (err) {
    console.error('❌ Sync Profile Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * LOG ACTIVATION
 * Records when a user uses an activation code
 */
router.post('/log-activation', async (req, res) => {
  try {
    const { user_id, email, code, code_type, site } = req.body;
    if (!user_id || !code) return res.status(400).json({ success: false, error: 'Missing fields' });

    const { data, error } = await req.supabaseAdmin
      .from('activations')
      .insert([{ user_id, code, code_type, site }]);

    if (error) throw error;

    // Discord Alert
    await discordAgent.sendAlert('ACTIVATION_LOG', `User action logged: ACTIVATION_LOG\nDetails: ${JSON.stringify({ user: email, code, code_type, site })}`, 'info');

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET PROFILE
 */
router.get('/:id', async (req, res) => {
  try {
    const { data, error } = await req.supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    res.status(404).json({ success: false, error: 'Profile not found' });
  }
});

module.exports = router;
