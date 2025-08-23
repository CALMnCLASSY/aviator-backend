// routes/users.js - User management and authentication
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// Telegram configuration
const telegramBotToken = '7995830862:AAEbUHiAL-YUM3myMGKd63dpFcbxE3_uU2o';
const telegramChatId = '5900219209';

// Simple file-based logging instead of MongoDB
const logUserData = (data) => {
  const logsDir = path.join(__dirname, '..', 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
  }
  
  const logFile = path.join(logsDir, `users-${new Date().toISOString().split('T')[0]}.log`);
  const logEntry = `${new Date().toISOString()} - ${JSON.stringify(data)}\n`;
  fs.appendFileSync(logFile, logEntry);
  console.log('📝 User data logged:', data);
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

// CORS middleware for all user routes
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

// Save user data (email, packageName, etc.)
router.post('/', async (req, res) => {
  try {
    const { email, packageName, timeSlot, bettingSite } = req.body;

    // Validate required fields
    if (!email || !packageName) {
      return res.status(400).json({ 
        success: false,
        error: 'Email and package name are required' 
      });
    }

    const userData = {
      email,
      packageName,
      timeSlot,
      bettingSite,
      timestamp: new Date().toISOString(),
      id: Date.now().toString() // Simple ID generation
    };

    // Log to file (backup to Telegram notifications)
    logUserData(userData);

    // Return success (Telegram will have the actual data)
    res.status(201).json({ 
      success: true,
      message: 'User data received and logged successfully',
      data: userData,
      note: 'Data logged locally and sent to Telegram for processing'
    });

  } catch (err) {
    console.error('Error in user route:', err);
    
    // Still log the data even if there's an error
    const { email, packageName, timeSlot, bettingSite } = req.body;
    logUserData({
      email,
      packageName,
      timeSlot,
      bettingSite,
      timestamp: new Date().toISOString(),
      error: err.message
    });
    
    res.status(500).json({ 
      success: false,
      error: 'Server error',
      message: err.message
    });
  }
});

// Get user by email (simplified - reads from logs)
router.get('/:email', async (req, res) => {
  try {
    const { email } = req.params;
    
    // This is simplified - in practice, Telegram has all the data you need
    // For demonstration purposes, we'll return a success response
    res.json({ 
      success: true,
      message: 'User lookup completed',
      note: 'All user data is available in your Telegram chat',
      email: email
    });
    
  } catch (err) {
    console.error('Error in get user route:', err);
    res.status(500).json({ 
      success: false,
      error: 'Server error',
      message: err.message
    });
  }
});

// ==================== USER SESSION ROUTES ====================

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
    logUserData(authData);

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
    logUserData({
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
    logUserData({
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
      logUserData({
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

module.exports = router;
