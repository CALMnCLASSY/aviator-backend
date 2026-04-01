// routes/users.js - Supabase backed User & Activation management
const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');

// Telegram configuration
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

    const { data, error } = await req.supabase
      .from('profiles')
      .upsert({ id, email, phone, updated_at: new Date().toISOString() });

    if (error) throw error;

    // Async alert
    sendToTelegram(`👤 <b>PROFILE SYNC</b>\nEmail: <code>${email}</code>\nPhone: <code>${phone || 'N/A'}</code>`);

    res.json({ success: true, data });
  } catch (err) {
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

    const { data, error } = await req.supabase
      .from('activations')
      .insert([{ user_id, code, code_type, site }]);

    if (error) throw error;

    // Professional Alert
    sendToTelegram(`⚡ <b>BOT ACTIVATED</b>\nUser: <code>${email}</code>\nCode: <code>${code}</code>\nSite: ${site}\nType: ${code_type}`);

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
    const { data, error } = await req.supabase
      .from('profiles')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
