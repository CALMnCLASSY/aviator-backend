// routes/support.js
const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

// Store active support chats
const activeSupportChats = new Map();

// Telegram configuration
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN || '7995830862:AAEbUHiAL-YUM3myMGKd63dpFcbxE3_uU2o';
const telegramChatId = process.env.TELEGRAM_CHAT_ID || '5900219209';

// Send support message to admin
router.post('/send-message', async (req, res) => {
    try {
        const { chatId, message, userEmail, userAgent, page } = req.body;
        
        console.log('📞 New support message:', { chatId, userEmail, messageLength: message?.length });
        
        if (!message || !chatId) {
            return res.status(400).json({
                success: false,
                error: 'Message and chat ID are required'
            });
        }
        
        // Store chat session
        activeSupportChats.set(chatId, {
            userEmail: userEmail || 'Anonymous',
            startTime: new Date(),
            lastActivity: new Date(),
            messages: []
        });
        
        // Format message for Telegram
        const telegramMessage = `💬 NEW SUPPORT CHAT MESSAGE

👤 User: ${userEmail || 'Anonymous User'}
🆔 Chat ID: ${chatId}
⏰ Time: ${new Date().toLocaleString()}
📱 Page: ${page || 'Aviator Bot'}
🌐 User Agent: ${userAgent || 'Unknown'}

📝 Message:
"${message}"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 ADMIN REPLY: Send a message in this format:
/reply ${chatId} Your response message here

🔗 Or use the Support Admin Panel for easier replies.`;

        // Send to Telegram with reply buttons
        const telegramOptions = {
            chat_id: telegramChatId,
            text: telegramMessage,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: '💬 Quick Reply',
                            callback_data: `support_reply_${chatId}`
                        },
                        {
                            text: '🔧 View All Chats',
                            callback_data: `support_view_all`
                        }
                    ],
                    [
                        {
                            text: '✅ Mark Resolved',
                            callback_data: `support_resolve_${chatId}`
                        }
                    ]
                ]
            }
        };
        
        const response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(telegramOptions)
        });
        
        const result = await response.json();
        
        if (result.ok) {
            console.log('✅ Support message sent to Telegram');
            res.json({
                success: true,
                message: 'Support message sent successfully',
                chatId: chatId
            });
        } else {
            console.error('❌ Telegram API error:', result);
            res.status(500).json({
                success: false,
                error: 'Failed to send message to support team'
            });
        }
        
    } catch (error) {
        console.error('Support message error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error sending support message'
        });
    }
});

// Reply to support chat
router.post('/reply', async (req, res) => {
    try {
        const { chatId, replyMessage, adminName } = req.body;
        
        if (!chatId || !replyMessage) {
            return res.status(400).json({
                success: false,
                error: 'Chat ID and reply message are required'
            });
        }
        
        const chat = activeSupportChats.get(chatId);
        if (!chat) {
            return res.status(404).json({
                success: false,
                error: 'Chat session not found'
            });
        }
        
        // Store the reply
        chat.messages.push({
            from: 'admin',
            message: replyMessage,
            timestamp: new Date(),
            adminName: adminName || 'Support Team'
        });
        
        chat.lastActivity = new Date();
        activeSupportChats.set(chatId, chat);
        
        // Here you would implement the actual delivery to the user
        // For now, we'll just log it and send confirmation
        console.log(`📤 Admin reply to ${chatId}:`, replyMessage);
        
        // Send confirmation to Telegram
        const confirmationMessage = `✅ REPLY SENT

🆔 Chat ID: ${chatId}
👤 User: ${chat.userEmail}
👨‍💼 Admin: ${adminName || 'Support Team'}
⏰ Time: ${new Date().toLocaleString()}

📝 Reply Sent:
"${replyMessage}"

The user will receive this message in their chat widget.`;

        await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: telegramChatId,
                text: confirmationMessage,
                parse_mode: 'HTML'
            })
        });
        
        res.json({
            success: true,
            message: 'Reply sent successfully',
            chatId: chatId
        });
        
    } catch (error) {
        console.error('Support reply error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error sending reply'
        });
    }
});

// Get active support chats
router.get('/active-chats', (req, res) => {
    try {
        const chats = Array.from(activeSupportChats.entries()).map(([chatId, chat]) => ({
            chatId,
            userEmail: chat.userEmail,
            startTime: chat.startTime,
            lastActivity: chat.lastActivity,
            messageCount: chat.messages.length,
            status: (new Date() - chat.lastActivity) < 300000 ? 'active' : 'idle' // 5 minutes
        }));
        
        res.json({
            success: true,
            chats: chats.sort((a, b) => b.lastActivity - a.lastActivity)
        });
        
    } catch (error) {
        console.error('Get chats error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error getting chats'
        });
    }
});

// Get chat history
router.get('/chat/:chatId', (req, res) => {
    try {
        const { chatId } = req.params;
        const chat = activeSupportChats.get(chatId);
        
        if (!chat) {
            return res.status(404).json({
                success: false,
                error: 'Chat not found'
            });
        }
        
        res.json({
            success: true,
            chat: {
                chatId,
                userEmail: chat.userEmail,
                startTime: chat.startTime,
                lastActivity: chat.lastActivity,
                messages: chat.messages
            }
        });
        
    } catch (error) {
        console.error('Get chat error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error getting chat'
        });
    }
});

// Mark chat as resolved
router.post('/resolve/:chatId', (req, res) => {
    try {
        const { chatId } = req.params;
        const { adminName } = req.body;
        
        const chat = activeSupportChats.get(chatId);
        if (chat) {
            chat.status = 'resolved';
            chat.resolvedBy = adminName || 'Support Team';
            chat.resolvedAt = new Date();
            activeSupportChats.set(chatId, chat);
        }
        
        res.json({
            success: true,
            message: 'Chat marked as resolved'
        });
        
    } catch (error) {
        console.error('Resolve chat error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error resolving chat'
        });
    }
});

module.exports = router;
