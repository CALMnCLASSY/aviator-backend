// routes/payments.js - Supabase backed Payment Management
const express = require('express');
const router = express.Router();
const axios = require('axios');
const fetch = require('node-fetch');

const USDT_WALLET_ADDRESS = process.env.USDT_WALLET_ADDRESS || 'TCRwpXHYvcXY3y4FJThLHCc9hHbs9H4ExH';

// Token Library for automated code dispatch
const TOKEN_LIBRARY = {
  '24hour': { code: 'AVS-24H-2E1J', label: '24 Hours', durationMinutes: 1440 }
};

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

    // Async Alert
    sendToTelegram(`💳 <b>NEW USDT ORDER</b>\nUser: <code>${contact || 'UID:' + user_id}</code>\nPkg: ${packageName}\nAmt: ${priceUsd} USDT\nRef: <code>${reference}</code>`);

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

    const statusMsg = verified ? '✅ VERIFIED' : '❌ REJECTED';
    sendToTelegram(`⚖️ <b>PAYMENT ${statusMsg}</b>\nRef: <code>${reference}</code>\nReason: ${reason || 'N/A'}`);

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;