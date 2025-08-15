// routes/chat.js
const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

// Store active chat sessions
const activeChats = new Map();
const chatMessages = new Map();

// Telegram configuration
const telegramBotToken = '7688438027:AAFNnge7_oADfxCwCMm2XZGSH1hG2Q0rZfE';
const telegramChatId = '5900219209';

// Create or get chat session
router.post('/chat/session', async (req, res) => {
    try {
        const { userId, userEmail } = req.body;
        
        if (!userId || !userEmail) {
            return res.status(400).json({
                success: false,
                message: 'User ID and email are required'
            });
        }
        
        const chatId = `CHAT_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const session = {
            id: chatId,
            userId: userId,
            userEmail: userEmail,
            status: 'active',
            createdAt: new Date().toISOString(),
            lastActivity: new Date().toISOString(),
            unreadCount: 0
        };
        
        activeChats.set(chatId, session);
        chatMessages.set(chatId, []);
        
        res.json({
            success: true,
            chatId: chatId,
            session: session
        });
        
    } catch (error) {
        console.error('Create chat session error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create chat session'
        });
    }
});

// Send message to chat (from customer)
router.post('/chat/message', async (req, res) => {
    try {
        const { chatId, message, sender, customerEmail, customerContact } = req.body;
        
        if (!chatId || !message || !sender) {
            return res.status(400).json({
                success: false,
                message: 'Chat ID, message, and sender are required'
            });
        }
        
        // Store the message
        const messageObj = {
            id: `MSG_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            chatId: chatId,
            text: message,
            sender: sender,
            senderType: 'customer',
            timestamp: new Date().toISOString(),
            read: false
        };
        
        const messages = chatMessages.get(chatId) || [];
        messages.push(messageObj);
        chatMessages.set(chatId, messages);
        
        // Send to Telegram with reply buttons
        const telegramMessage = `💬 NEW CUSTOMER MESSAGE

🆔 Chat ID: ${chatId}
👤 Customer: ${customerEmail || customerContact || 'Unknown'}
📝 Message: "${message}"
⏰ Time: ${new Date().toLocaleString()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Click "Reply to Customer" below to respond.`;

        await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: telegramChatId,
                text: telegramMessage,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: '💬 Reply to Customer',
                                callback_data: `chat_reply_${chatId}`
                            },
                            {
                                text: '✅ Mark as Read',
                                callback_data: `chat_read_${chatId}`
                            }
                        ],
                        [
                            {
                                text: '📝 View Chat History',
                                callback_data: `chat_history_${chatId}`
                            }
                        ]
                    ]
                }
            })
        });
        
        console.log('💬 Customer message sent to Telegram with reply buttons');
        
        res.json({
            success: true,
            message: messageObj,
            chatId: chatId
        });
        
    } catch (error) {
        console.error('Send chat message error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to send message'
        });
    }
});

// Send admin reply to customer
router.post('/chat/admin-reply', async (req, res) => {
    try {
        const { chatId, replyMessage, adminName } = req.body;
        
        if (!chatId || !replyMessage) {
            return res.status(400).json({
                success: false,
                message: 'Chat ID and reply message are required'
            });
        }
        
        // Store admin reply
        const messageObj = {
            id: `MSG_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            chatId: chatId,
            text: replyMessage,
            sender: adminName || 'Support Team',
            senderType: 'admin',
            timestamp: new Date().toISOString(),
            read: true
        };
        
        const messages = chatMessages.get(chatId) || [];
        messages.push(messageObj);
        chatMessages.set(chatId, messages);
        
        // Send confirmation to Telegram
        const confirmationMessage = `✅ REPLY SENT TO CUSTOMER

🆔 Chat ID: ${chatId}
👨‍💼 Admin: ${adminName || 'Support Team'}
📝 Reply: "${replyMessage}"
⏰ Time: ${new Date().toLocaleString()}

The customer will see this message in their chat widget.`;

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
            messageObj: messageObj
        });
        
    } catch (error) {
        console.error('Admin reply error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to send admin reply'
        });
    }
});

// Get chat messages for a customer (to display in their chat widget)
router.get('/chat/:chatId/messages', (req, res) => {
    try {
        const { chatId } = req.params;
        const messages = chatMessages.get(chatId) || [];
        
        res.json({
            success: true,
            messages: messages,
            total: messages.length,
            chatId: chatId
        });
        
    } catch (error) {
        console.error('Get chat messages error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get messages'
        });
    }
});

// Get all active chats (for admin)
router.get('/chat/admin/sessions', (req, res) => {
    try {
        const sessions = Array.from(activeChats.values())
            .filter(session => session.status === 'active')
            .map(session => {
                const messages = chatMessages.get(session.id) || [];
                const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
                
                return {
                    id: session.id,
                    userEmail: session.userEmail,
                    lastMessage: lastMessage ? lastMessage.text : 'Chat started',
                    lastMessageTime: lastMessage ? lastMessage.timestamp : session.createdAt,
                    unreadCount: messages.filter(msg => msg.senderType === 'customer' && !msg.read).length,
                    messageCount: messages.length,
                    status: session.status
                };
            })
            .sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));
        
        res.json({
            success: true,
            sessions: sessions,
            totalActive: sessions.length
        });
        
    } catch (error) {
        console.error('Get chat sessions error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get chat sessions'
        });
    }
});

module.exports = router;
