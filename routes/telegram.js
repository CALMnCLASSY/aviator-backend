// routes/telegram.js
const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

// Telegram configuration
const telegramBotToken = '7688438027:AAFNnge7_oADfxCwCMm2XZGSH1hG2Q0rZfE';
const telegramChatId = '5900219209';

// Store pending crypto payments for verification
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

        // Store payment data if provided with orderId
        if (orderId && paymentData) {
            console.log('💾 Storing payment data for verification:', { orderId, paymentData });
            
            // Store in global.cryptoPayments for all payment types
            global.cryptoPayments = global.cryptoPayments || {};
            global.cryptoPayments[orderId] = {
                ...paymentData,
                status: 'pending_verification',
                timestamp: new Date(),
                storedAt: new Date().toISOString()
            };
            
            // Also store in pendingPayments Map for paybill compatibility
            if (orderId.startsWith('PAYBILL_') || orderId.startsWith('BOT_MPESA_') || orderId.startsWith('BOT_CRYPTO_')) {
                pendingPayments.set(orderId, {
                    ...paymentData,
                    status: 'pending_verification',
                    timestamp: new Date()
                });
            }
            
            console.log('✅ Payment data stored successfully for orderId:', orderId);
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
        
        // Handle text messages (for /reply commands)
        if (update.message && update.message.text) {
            const text = update.message.text;
            const chatId = update.message.chat.id;
            const messageId = update.message.message_id;
            
            console.log('Received message:', text);
            
            // Handle /reply CHAT_ID message format
            if (text.startsWith('/reply ')) {
                const parts = text.split(' ');
                if (parts.length >= 3) {
                    const customerChatId = parts[1];
                    const replyMessage = parts.slice(2).join(' ');
                    await handleTelegramChatReply(customerChatId, replyMessage, chatId, messageId);
                } else {
                    await sendTelegramMessage(chatId, '❌ Invalid format. Use: /reply CHAT_ID_HERE Your message here');
                }
            }
        }
        
        // Handle callback queries (button clicks)
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
            } else if (data.startsWith('chat_reply_')) {
                const chatSessionId = data.replace('chat_reply_', '');
                await handleChatReply(chatSessionId, chatId, messageId);
            } else if (data.startsWith('chat_read_')) {
                const chatSessionId = data.replace('chat_read_', '');
                await handleChatRead(chatSessionId, chatId, messageId);
            } else if (data.startsWith('chat_history_')) {
                const chatSessionId = data.replace('chat_history_', '');
                await handleChatHistory(chatSessionId, chatId, messageId);
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
        // Get payment data from both sources (fallback to global if pendingPayments doesn't have it)
        let payment = pendingPayments.get(orderId);
        
        // If not found in pendingPayments, try to get from global.cryptoPayments
        if (!payment && global.cryptoPayments && global.cryptoPayments[orderId]) {
            const globalPayment = global.cryptoPayments[orderId];
            payment = {
                email: globalPayment.email,
                packageName: globalPayment.packageName,
                amount: globalPayment.amount,
                currency: globalPayment.currency,
                timeSlot: globalPayment.timeSlot,
                bettingSite: globalPayment.bettingSite
            };
        }
        
        if (!payment) {
            await updateMessage(chatId, messageId, `❌ Order ${orderId} not found or already processed.`);
            return;
        }
        
        if (action === 'verified') {
            // Update payment status to verified in both crypto and paybill payments
            if (global.cryptoPayments && global.cryptoPayments[orderId]) {
                global.cryptoPayments[orderId].status = 'verified';
                global.cryptoPayments[orderId].verifiedAt = new Date();
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
                package: payment.packageName 
            });
                
            // Send verification request to complete purchase
            const response = await fetch(`${process.env.BASE_URL}/api/payments/crypto/personal/verify/${orderId}`, {
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
                    `🆔 Order: ${orderId}\n\n` +
                    `🎯 Predictions have been sent to customer!`
                );
                pendingPayments.delete(orderId);
                    
                console.log(`✅ Customer ${payment.email} will now see predictions revealed!`);
            } else {
                const errorText = await response.text();
                console.error('Verification failed:', errorText);
                await updateMessage(chatId, messageId, `❌ Failed to verify payment for order ${orderId}: ${errorText}`);
            }
        } else if (action === 'rejected') {
            // Update payment status to rejected in both crypto and paybill payments
            if (global.cryptoPayments && global.cryptoPayments[orderId]) {
                global.cryptoPayments[orderId].status = 'rejected';
                global.cryptoPayments[orderId].rejectedAt = new Date();
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
                package: payment.packageName 
            });
            
            // Send rejection request
            const response = await fetch(`${process.env.BASE_URL}/api/payments/crypto/personal/verify/${orderId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ verified: false })
            });
            
            await updateMessage(chatId, messageId, 
                `❌ Payment REJECTED!\n\n` +
                `📧 Customer: ${payment.email}\n` +
                `📦 Package: ${payment.packageName}\n` +
                `💰 Amount: ${payment.amount} ${payment.currency}\n` +
                `🆔 Order: ${orderId}\n\n` +
                `Customer has been notified.`
            );
            pendingPayments.delete(orderId);
        }
    } catch (error) {
        console.error('Error handling payment verification:', error);
        await updateMessage(chatId, messageId, `❌ Error processing ${action} for order ${orderId}: ${error.message}`);
    }
}

// Handle customer reply
async function handleCustomerReply(orderId, chatId, messageId) {
    try {
        // Try to get payment data first
        let customerData = pendingPayments.get(orderId);
        let messageType = 'payment';
        
        // If not found in payments, check if it's a support message
        if (!customerData && global.supportMessages && global.supportMessages[orderId]) {
            customerData = global.supportMessages[orderId];
            messageType = 'support';
        }
        
        if (!customerData) {
            await updateMessage(chatId, messageId, `❌ Order/Support ${orderId} not found.`);
            return;
        }
        
        let replyMessage;
        if (messageType === 'support') {
            replyMessage = `💬 Reply to Customer Support Message\n\n` +
                `📧 Email: ${customerData.email}\n` +
                `❓ Question: ${customerData.message}\n` +
                `🆔 Support ID: ${orderId}\n\n` +
                `Type your reply in this chat and I'll forward it to the customer.`;
        } else {
            replyMessage = `💬 Reply to Customer\n\n` +
                `📧 Email: ${customerData.email}\n` +
                `📦 Package: ${customerData.packageName}\n` +
                `🆔 Order: ${orderId}\n\n` +
                `Type your reply in this chat and I'll forward it to the customer.`;
        }
        
        await updateMessage(chatId, messageId, replyMessage);
    } catch (error) {
        console.error('Error handling customer reply:', error);
    }
}

// Update existing message
async function updateMessage(chatId, messageId, text) {
    try {
        await fetch(`https://api.telegram.org/bot${telegramBotToken}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                message_id: messageId,
                text: text,
                parse_mode: 'HTML'
            })
        });
    } catch (error) {
        console.error('Error updating message:', error);
    }
}

// Store pending payment for verification
router.post('/store-payment', (req, res) => {
    const { orderId, paymentData } = req.body;
    pendingPayments.set(orderId, paymentData);
    res.json({ success: true, message: 'Payment stored for verification' });
});

// Store support message for reply tracking
router.post('/store-support', (req, res) => {
    const { orderId, supportData } = req.body;
    
    // Initialize global.supportMessages if it doesn't exist
    if (!global.supportMessages) {
        global.supportMessages = {};
    }
    
    global.supportMessages[orderId] = supportData;
    res.json({ success: true, message: 'Support message stored for reply tracking' });
});

// Set webhook for Telegram bot (call this once to enable button callbacks)
router.post('/set-webhook', async (req, res) => {
    try {
        const webhookUrl = `${process.env.BASE_URL}/api/telegram/webhook`;
        
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

// Chat reply handlers
async function handleChatReply(chatSessionId, chatId, messageId) {
    try {
        await updateMessage(chatId, messageId, 
            `💬 REPLYING TO CUSTOMER

🆔 Chat ID: ${chatSessionId}

Please type your reply message in this chat and I'll send it to the customer.

Format: Just type your message normally and send it.
Example: "Hello! I'll help you with your question..."`
        );
        
        // Store the chat session ID for the next message
        global.awaitingChatReply = global.awaitingChatReply || {};
        global.awaitingChatReply[chatId] = chatSessionId;
        
    } catch (error) {
        console.error('Error handling chat reply:', error);
    }
}

async function handleChatRead(chatSessionId, chatId, messageId) {
    try {
        await updateMessage(chatId, messageId, 
            `✅ CHAT MARKED AS READ

🆔 Chat ID: ${chatSessionId}
⏰ Time: ${new Date().toLocaleString()}

This chat has been marked as read.`
        );
        
    } catch (error) {
        console.error('Error handling chat read:', error);
    }
}

async function handleChatHistory(chatSessionId, chatId, messageId) {
    try {
        // Get chat history from the chat route
        const response = await fetch(`${process.env.BASE_URL}/api/chat/${chatSessionId}/messages`);
        
        if (response.ok) {
            const result = await response.json();
            const messages = result.messages || [];
            
            let historyText = `📝 CHAT HISTORY - ${chatSessionId}\n\n`;
            
            if (messages.length === 0) {
                historyText += 'No messages in this chat yet.';
            } else {
                messages.slice(-10).forEach(msg => { // Last 10 messages
                    const time = new Date(msg.timestamp).toLocaleTimeString();
                    const sender = msg.senderType === 'customer' ? '👤 Customer' : '👨‍💼 Admin';
                    historyText += `${sender} (${time}): ${msg.text}\n\n`;
                });
            }
            
            await updateMessage(chatId, messageId, historyText);
        } else {
            await updateMessage(chatId, messageId, `❌ Could not load chat history for ${chatSessionId}`);
        }
        
    } catch (error) {
        console.error('Error handling chat history:', error);
        await updateMessage(chatId, messageId, `❌ Error loading chat history: ${error.message}`);
    }
}

// Handle Telegram /reply commands for chat
async function handleTelegramChatReply(customerChatId, replyMessage, adminTelegramId, messageId) {
    try {
        console.log(`📞 TELEGRAM CHAT REPLY:`, { customerChatId, replyMessage });
        
        // Send the reply via the chat API
        const response = await fetch(`${process.env.BASE_URL || 'http://localhost:5000'}/api/chat/${customerChatId}/reply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: replyMessage,
                adminName: 'Telegram Admin'
            })
        });
        
        if (response.ok) {
            const result = await response.json();
            await sendTelegramMessage(adminTelegramId, `✅ Reply sent to customer successfully!\n\n📝 Message: "${replyMessage}"`);
        } else {
            const errorText = await response.text();
            await sendTelegramMessage(adminTelegramId, `❌ Failed to send reply: ${errorText}`);
        }
        
    } catch (error) {
        console.error('Telegram chat reply error:', error);
        await sendTelegramMessage(adminTelegramId, `❌ Error sending reply: ${error.message}`);
    }
}

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

module.exports = router;
