// routes/payments.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const BASE_PORT = process.env.PORT || 5000;
const SERVER_BASE_URL = (process.env.BASE_URL || `http://localhost:${BASE_PORT}`).replace(/\/$/, '');
const USDT_WALLET_ADDRESS = process.env.USDT_WALLET_ADDRESS || 'TCRwpXHYvcXY3y4FJThLHCc9hHbs9H4ExH';

const TOKEN_LIBRARY = {
  '30min': { code: 'AVS-30M-77DJ', label: '30 Minutes', durationMinutes: 30 },
  '1hour': { code: 'AVS-1H-F28J', label: '1 Hour', durationMinutes: 60 },
  '3hours': { code: 'AVS-3H-8K2L', label: '3 Hours', durationMinutes: 180 },
  '6hours': { code: 'AVS-6H-4P9S', label: '6 Hours', durationMinutes: 360 },
  '24hour': { code: 'AVS-24H-2E1J', label: '24 Hours', durationMinutes: 1440 },
  '72hour': { code: 'AVS-72H-9X2B', label: '72 Hours', durationMinutes: 4320 }
};

const getTokenInfo = (durationKey) => {
  const token = TOKEN_LIBRARY[durationKey];
  if (!token) return null;
  return {
    code: token.code,
    label: token.label,
    durationMinutes: token.durationMinutes
  };
};

// Telegram configuration
const telegramBotToken = '7995830862:AAEbUHiAL-YUM3myMGKd63dpFcbxE3_uU2o';
const telegramChatId = '5900219209';

// Helper function to log payment attempts
const logPaymentData = (data) => {
  const logsDir = path.join(__dirname, '..', 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
  }
  
  const logFile = path.join(logsDir, `payments-${new Date().toISOString().split('T')[0]}.log`);
  const logEntry = `${new Date().toISOString()} - ${JSON.stringify(data)}\n`;
  fs.appendFileSync(logFile, logEntry);
  console.log('💳 Payment data logged:', data);
};

// Helper function to send to Telegram
const sendToTelegram = async (message) => {
  try {
    console.log('📤 Sending to Telegram:', message.substring(0, 100) + '...');
    
    const response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: telegramChatId,
        text: message,
        parse_mode: 'HTML'
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Telegram API error: ${response.status} - ${errorText}`);
      return { success: false, error: `Telegram API error: ${response.status}`, details: errorText };
    }
    
    const result = await response.json();
    console.log('✅ Telegram message sent successfully:', result.message_id);
    return { success: true, result };
    
  } catch (error) {
    console.error('❌ Failed to send to Telegram:', error.message);
    return { success: false, error: error.message };
  }
};

// CORS middleware for all payment routes
router.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, ngrok-skip-browser-warning');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// ==================== USDT PAYMENT ROUTES ====================

router.post('/usdt/create-order', async (req, res) => {
  try {
    const { contact, packageName, siteName, priceUsd, durationKey } = req.body;

    if (!packageName || !priceUsd) {
      return res.status(400).json({ success: false, error: 'Package name and price are required.' });
    }

    const reference = `USDT_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

    global.usdtPayments = global.usdtPayments || {};
    const tokenInfo = getTokenInfo(durationKey);

    global.usdtPayments[reference] = {
      contact: contact || 'Not provided',
      packageName,
      siteName,
      priceUsd,
      durationKey,
      status: 'awaiting_payment',
      createdAt: new Date(),
      tokenInfo
    };

    logPaymentData({
      type: 'usdt_create_order',
      reference,
      packageName,
      priceUsd,
      contact,
      siteName,
      durationKey,
      tokenInfo: tokenInfo?.code || 'manual_dispatch'
    });

    res.json({
      success: true,
      reference,
      walletAddress: USDT_WALLET_ADDRESS
    });
  } catch (error) {
    console.error('USDT create order error:', error);
    res.status(500).json({ success: false, error: 'Failed to create USDT order.' });
  }
});

router.post('/usdt/verify/:reference', async (req, res) => {
  try {
    const { reference } = req.params;
    const paymentData = global.usdtPayments && global.usdtPayments[reference];

    if (!paymentData) {
      return res.status(404).json({ success: false, error: 'Payment reference not found.' });
    }

    if (paymentData.status === 'verified') {
      return res.json({ success: true, status: 'verified', message: 'Payment already verified.' });
    }

    if (paymentData.status === 'pending_verification') {
      return res.json({ success: true, status: 'pending_verification', message: 'Verification already in progress.' });
    }

    paymentData.status = 'pending_verification';
    paymentData.verificationStartTime = new Date();

    setTimeout(async () => {
      try {
        const currentData = global.usdtPayments && global.usdtPayments[reference];
        if (currentData && currentData.status === 'pending_verification') {
          console.log(`⏰ Auto-rejecting USDT payment ${reference} after 30 seconds.`);
          try {
            await axios.post(`${SERVER_BASE_URL}/api/payments/usdt/admin-verify/${reference}`, {
              verified: false,
              autoRejected: true
            });
          } catch (adminError) {
            console.error(`❌ Failed to auto-reject USDT payment ${reference}:`, adminError.message);
            currentData.status = 'rejected';
            currentData.rejectedAt = new Date();
            currentData.autoRejected = true;
          }
        }
      } catch (timeoutError) {
        console.error('❌ USDT auto-rejection error:', timeoutError.message);
      }
    }, 30000);

    const botToken = process.env.TELEGRAM_BOT_TOKEN || telegramBotToken;
    const chatId = process.env.TELEGRAM_CHAT_ID || telegramChatId;

    const telegramMessage = `🔔 <b>USDT payment verification</b>\n` +
      `👤 <b>Contact:</b> ${paymentData.contact || 'Unknown'}\n` +
      `📦 <b>Package:</b> ${paymentData.packageName}\n` +
      `💵 <b>Amount:</b> ${paymentData.priceUsd} USDT\n` +
      `🎯 <b>Site:</b> ${paymentData.siteName || 'Not specified'}\n` +
      `🆔 <b>Reference:</b> ${reference}\n\n` +
      `⚠️ <b>Auto-rejects in 30 seconds if not verified</b>`;

    await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      chat_id: chatId,
      text: telegramMessage,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ VERIFY & RELEASE TOKEN', callback_data: `verify_${reference}` },
            { text: '❌ REJECT PAYMENT', callback_data: `reject_${reference}` }
          ]
        ]
      }
    });

    res.json({ success: true, status: 'pending_verification', reference });
  } catch (error) {
    console.error('USDT manual verification error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/usdt/admin-verify/:reference', async (req, res) => {
  try {
    const { reference } = req.params;
    const { verified } = req.body;
    const paymentData = global.usdtPayments && global.usdtPayments[reference];

    if (!paymentData) {
      return res.status(404).json({ success: false, error: 'Payment reference not found.' });
    }

    if (paymentData.status !== 'pending_verification') {
      return res.status(400).json({ success: false, error: `Payment already ${paymentData.status}` });
    }

    if (verified) {
      paymentData.status = 'verified';
      paymentData.verifiedAt = new Date();
      const tokenDetails = paymentData.tokenInfo || null;
      await sendToTelegram(`✅ <b>USDT payment verified</b> for ${paymentData.contact || 'client'} (${paymentData.packageName})${tokenDetails ? `\n\n🔑 Token: <code>${tokenDetails.code}</code> (${tokenDetails.label})` : ''}`);

      return res.json({ 
        success: true, 
        status: 'verified',
        tokenDetails
      });
    }

    paymentData.status = 'rejected';
    paymentData.rejectedAt = new Date();
    paymentData.autoRejected = Boolean(req.body?.autoRejected);
    await sendToTelegram(`❌ <b>USDT payment rejected</b> for ${paymentData.contact || 'client'} (${paymentData.packageName})`);
    res.json({ success: true, status: 'rejected' });
  } catch (error) {
    console.error('USDT admin verification error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/usdt/status/:reference', async (req, res) => {
  try {
    const { reference } = req.params;
    const paymentData = global.usdtPayments && global.usdtPayments[reference];

    if (!paymentData) {
      return res.status(404).json({ success: false, status: 'not_found', message: 'Payment reference not found.' });
    }

    res.json({
      success: true,
      reference,
      status: paymentData.status,
      packageName: paymentData.packageName,
      priceUsd: paymentData.priceUsd,
      contact: paymentData.contact,
      siteName: paymentData.siteName,
      autoRejected: paymentData.autoRejected || false,
      tokenDetails: paymentData.tokenInfo || null
    });
  } catch (error) {
    console.error('USDT status check error:', error);
    res.status(500).json({ success: false, status: 'error', message: 'Unable to fetch payment status.' });
  }
});

// Bot payment creation endpoint (to initiate bot payment verification)
router.post('/bot/create-payment/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { customerInfo } = req.body; // Optional customer info
    
    console.log(`🤖 Creating bot payment verification for order: ${orderId}`);
    
    // Initialize bot payments storage if it doesn't exist
    global.botPayments = global.botPayments || {};
    
    // Store bot payment data
    global.botPayments[orderId] = {
      status: 'pending_verification',
      createdAt: new Date(),
      orderId,
      customerInfo: customerInfo || {}
    };
    
    // Set auto-rejection timeout (1 minute)
    setTimeout(async () => {
      try {
        // Check if bot payment is still pending verification
        const currentBotPayment = global.botPayments?.[orderId];
        if (currentBotPayment && currentBotPayment.status === 'pending_verification') {
          // Auto-reject the bot payment
          currentBotPayment.status = 'auto_rejected';
          currentBotPayment.autoRejectedAt = new Date();
          
          console.log(`⏰ Auto-rejecting bot payment ${orderId} after 1 minute timeout`);
          
          // Send auto-rejection notification to Telegram
          const autoRejectMsg = `⏰ <b>Auto-rejected bot activation</b> (1min timeout)
          
🤖 Order: ${orderId}
❌ Reason: No admin verification within 1 minute
⏰ Auto-rejected at: ${new Date().toLocaleString()}`;
          
          await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: autoRejectMsg,
            parse_mode: 'HTML'
          });
        }
      } catch (timeoutError) {
        console.error('❌ Bot auto-rejection timeout error:', timeoutError.message);
      }
    }, 60000); // 1 minute = 60,000 milliseconds
    
    // Send verification request to Telegram for admin
    const telegramMessage = `🤖 <b>Bot activation verification needed</b>
    
🔗 Order ID: ${orderId}
👤 Customer: ${customerInfo?.email || 'Not provided'}
⏰ Created: ${new Date().toLocaleString()}

⚠️ <b>Auto-rejects in 1 minute if not verified</b>`;
    
    await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: telegramMessage,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ VERIFY BOT ACTIVATION', callback_data: `bot_verify_${orderId}` },
            { text: '❌ REJECT ACTIVATION', callback_data: `bot_reject_${orderId}` }
          ]
        ]
      }
    });
    
    res.json({ 
      success: true, 
      orderId,
      status: 'pending_verification',
      message: 'Bot payment verification request sent to admin' 
    });
    
  } catch (error) {
    console.error('❌ Bot payment creation error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to create bot payment verification',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Bot activation verification endpoint
router.post('/bot/verify/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { adminId } = req.body;
    
    // Initialize bot payments storage if it doesn't exist
    global.botPayments = global.botPayments || {};
    
    const botPayment = global.botPayments[orderId];
    
    if (!botPayment) {
      return res.status(404).json({ 
        success: false, 
        error: 'Bot payment not found' 
      });
    }
    
    // Check if payment was already auto-rejected
    if (botPayment.status === 'auto_rejected') {
      return res.status(400).json({ 
        success: false, 
        error: 'Cannot verify - bot payment was auto-rejected due to timeout',
        autoRejectedAt: botPayment.autoRejectedAt
      });
    }
    
    if (botPayment.status !== 'pending_verification') {
      return res.status(400).json({ 
        success: false, 
        error: `Bot payment is already ${botPayment.status}` 
      });
    }
    
    // Update bot payment status to verified
    botPayment.status = 'verified';
    botPayment.verifiedAt = new Date();
    botPayment.verifiedBy = adminId;
    
    console.log(`✅ Bot payment ${orderId} verified by admin ${adminId}`);
    
    res.json({ 
      success: true, 
      orderId,
      status: 'verified',
      message: 'Bot activation verified successfully' 
    });
    
  } catch (error) {
    console.error('❌ Bot verification error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Bot verification failed',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Bot payment status endpoint
router.get('/bot/status/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    // Check bot payment status
    const botPayment = global.botPayments?.[orderId];
    
    if (!botPayment) {
      return res.json({ 
        success: false, 
        status: 'not_found',
        message: 'Bot payment not found'
      });
    }
    
    res.json({ 
      success: true, 
      status: botPayment.status,
      orderId,
      processedAt: botPayment.activatedAt || botPayment.rejectedAt
    });
    
  } catch (error) {
    console.error('❌ Bot status check error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to check bot status'
    });
  }
});

// ==================== CARD PAYMENT ROUTES ====================

// Card payment details endpoint
// Payment verification endpoints
router.post('/verify-payment', async (req, res) => {
  try {
    const { 
      contact, 
      packageName, 
      amount, 
      paymentMethod,
      transactionId,
      source,
      timestamp 
    } = req.body;

    // Validate required fields
    if (!contact || !packageName) {
      return res.status(400).json({ 
        success: false,
        error: 'Contact and package name are required' 
      });
    }

    const verificationData = {
      contact,
      packageName,
      amount,
      paymentMethod: paymentMethod || 'Unknown',
      transactionId: transactionId || 'N/A',
      source: source || 'Payment Verification',
      timestamp: timestamp || new Date().toISOString(),
      ip: req.ip || 'Unknown',
      status: 'pending_admin_verification'
    };

    // Log verification request
    logPaymentData(verificationData);

    // Send to Telegram with verification buttons
    const telegramMessage = `💰 <b>PAYMENT VERIFICATION REQUEST</b>

👤 Customer: <code>${contact}</code>
💰 Package: <b>${packageName}</b>
💵 Amount: <b>$${amount || 'N/A'}</b>
💳 Method: <b>${paymentMethod || 'Card Payment'}</b>
🔗 Transaction ID: <code>${transactionId || 'N/A'}</code>
📍 IP: <code>${req.ip || 'Unknown'}</code>
⏰ Time: <code>${new Date().toLocaleString()}</code>
🔗 Source: ${source || 'Payment Verification'}

⚠️ <b>ADMIN ACTION REQUIRED</b>
Please verify this payment and approve/reject access.`;

    await sendToTelegram(telegramMessage);

    // Return success with verification ID
    res.json({ 
      success: true,
      message: 'Payment verification request submitted successfully',
      verificationId: Date.now().toString(),
      status: 'pending_verification',
      estimatedTime: '5-10 minutes'
    });

  } catch (error) {
    console.error('❌ Payment verification error:', error);
    
    // Log error
    logPaymentData({
      error: error.message,
      contact: req.body.contact,
      packageName: req.body.packageName,
      timestamp: new Date().toISOString(),
      action: 'verification_error'
    });

    res.status(500).json({ 
      success: false,
      error: 'Failed to submit payment verification',
      message: 'Please try again or contact support'
    });
  }
});

// Admin payment approval endpoint
router.post('/approve-payment', async (req, res) => {
  try {
    const { 
      contact, 
      packageName, 
      verificationId,
      adminNote,
      timestamp 
    } = req.body;

    const approvalData = {
      contact,
      packageName,
      verificationId,
      adminNote: adminNote || 'Payment approved',
      action: 'payment_approved',
      timestamp: timestamp || new Date().toISOString(),
      ip: req.ip || 'Unknown'
    };

    // Log approval
    logPaymentData(approvalData);

    // Send approval notification to Telegram
    const telegramMessage = `✅ <b>PAYMENT APPROVED</b>

👤 Customer: <code>${contact}</code>
💰 Package: <b>${packageName}</b>
🔗 Verification ID: <code>${verificationId}</code>
📝 Note: ${adminNote || 'Payment approved by admin'}
⏰ Time: <code>${new Date().toLocaleString()}</code>

✅ <b>ACCESS GRANTED</b>
User can now access their package.`;

    await sendToTelegram(telegramMessage);

    res.json({ 
      success: true,
      message: 'Payment approved successfully',
      status: 'approved',
      accessGranted: true
    });

  } catch (error) {
    console.error('❌ Payment approval error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to approve payment'
    });
  }
});

// Admin payment rejection endpoint
router.post('/reject-payment', async (req, res) => {
  try {
    const { 
      contact, 
      packageName, 
      verificationId,
      rejectionReason,
      timestamp 
    } = req.body;

    const rejectionData = {
      contact,
      packageName,
      verificationId,
      rejectionReason: rejectionReason || 'Payment rejected',
      action: 'payment_rejected',
      timestamp: timestamp || new Date().toISOString(),
      ip: req.ip || 'Unknown'
    };

    // Log rejection
    logPaymentData(rejectionData);

    // Send rejection notification to Telegram
    const telegramMessage = `❌ <b>PAYMENT REJECTED</b>

👤 Customer: <code>${contact}</code>
💰 Package: <b>${packageName}</b>
🔗 Verification ID: <code>${verificationId}</code>
📝 Reason: ${rejectionReason || 'Payment rejected by admin'}
⏰ Time: <code>${new Date().toLocaleString()}</code>

❌ <b>ACCESS DENIED</b>
User payment was not verified.`;

    await sendToTelegram(telegramMessage);

    res.json({ 
      success: true,
      message: 'Payment rejected',
      status: 'rejected',
      accessGranted: false
    });

  } catch (error) {
    console.error('❌ Payment rejection error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to reject payment'
    });
  }
});

// Bot payment status check endpoint
router.get('/bot/status/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    
    // Initialize bot payments storage if it doesn't exist
    global.botPayments = global.botPayments || {};
    
    const botPayment = global.botPayments[orderId];
    
    if (!botPayment) {
      return res.status(404).json({ 
        success: false, 
        error: 'Bot payment not found' 
      });
    }
    
    res.json({ 
      success: true, 
      orderId,
      status: botPayment.status,
      message: getBotStatusMessage(botPayment.status),
      createdAt: botPayment.createdAt,
      verifiedAt: botPayment.verifiedAt || null,
      autoRejectedAt: botPayment.autoRejectedAt || null
    });
    
  } catch (error) {
    console.error('❌ Bot status check error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to check bot payment status',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;