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

// Send message to chat (this is what the frontend calls)
router.post('/messages', async (req, res) => {
    try {
        const { message, userEmail, userAgent, page, chatId } = req.body;
        
        if (!message) {
            return res.status(400).json({
                success: false,
                message: 'Message is required'
            });
        }
        
        const userContact = userEmail || 'anonymous@user.com';
        
        // If no chatId, create one or find existing
        let finalChatId = chatId;
        if (!finalChatId) {
            // Check if user already has an active session
            for (const [existingChatId, session] of activeChats.entries()) {
                if (session.userEmail === userContact && session.status === 'active') {
                    finalChatId = existingChatId;
                    break;
                }
            }
            
            // If still no chatId, create new session
            if (!finalChatId) {
                finalChatId = `CHAT_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                
                const session = {
                    id: finalChatId,
                    userEmail: userContact,
                    status: 'active',
                    createdAt: new Date().toISOString(),
                    lastActivity: new Date().toISOString(),
                    unreadCount: 0,
                    userAgent: userAgent || 'Unknown',
                    page: page || 'Unknown'
                };
                
                activeChats.set(finalChatId, session);
                chatMessages.set(finalChatId, []);
            }
        }
        
        const session = activeChats.get(finalChatId);
        if (!session) {
            return res.status(404).json({
                success: false,
                message: 'Chat session not found'
            });
        }
        
        const messageObj = {
            id: `MSG_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            chatId: finalChatId,
            text: message,
            sender: userContact,
            senderType: 'customer',
            timestamp: new Date().toISOString(),
            read: false
        };
        
        // Add message to chat storage
        const messages = chatMessages.get(finalChatId) || [];
        messages.push(messageObj);
        chatMessages.set(finalChatId, messages);
        
        // Update session activity and unread count
        session.lastActivity = new Date().toISOString();
        session.unreadCount = (session.unreadCount || 0) + 1;
        session.page = page || session.page;
        session.userAgent = userAgent || session.userAgent;
        activeChats.set(finalChatId, session);
        
        console.log(`💬 NEW CHAT MESSAGE STORED:`, {
            chatId: finalChatId,
            userEmail: userContact,
            message: message,
            page: page,
            totalMessages: messages.length
        });
        
        // Send to Telegram with enhanced formatting
        const telegramMessage = `💬 NEW CUSTOMER MESSAGE

👤 User: ${userContact}
🆔 Chat ID: ${finalChatId}
⏰ Time: ${new Date().toLocaleString()}
📱 Page: ${page || 'Unknown'}
🌐 User Agent: ${userAgent || 'Unknown'}

📝 Message:
"${message}"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 ADMIN REPLY: Use the Admin Chat Panel to reply instantly!
🔗 Check: admin-chat.html

Or reply via Telegram: /reply ${finalChatId} Your message here`;

        // Send to Telegram
        try {
            const telegramResponse = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: telegramChatId,
                    text: telegramMessage,
                    parse_mode: 'HTML'
                })
            });
            
            if (!telegramResponse.ok) {
                console.warn('Failed to send message to Telegram:', await telegramResponse.text());
            } else {
                console.log('✅ Message sent to Telegram successfully');
            }
        } catch (telegramError) {
            console.warn('Telegram notification failed:', telegramError.message);
        }
        
        res.json({
            success: true,
            message: messageObj,
            chatId: finalChatId
        });
        
    } catch (error) {
        console.error('Send chat message error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to send message'
        });
    }
});

// Get all active chat sessions (for admin panel)
router.get('/sessions', (req, res) => {
    try {
        const sessions = Array.from(activeChats.values())
            .filter(session => session.status === 'active')
            .map(session => {
                const messages = chatMessages.get(session.id) || [];
                const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
                
                return {
                    id: session.id,
                    userEmail: session.userEmail,
                    page: session.page || 'Unknown',
                    lastMessage: lastMessage ? lastMessage.text : 'Chat started',
                    lastMessageTime: lastMessage ? lastMessage.timestamp : session.createdAt,
                    unreadCount: session.unreadCount || 0,
                    status: session.status,
                    isOnline: (new Date() - new Date(session.lastActivity)) < 300000 // 5 minutes
                };
            })
            .sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));
        
        console.log(`📋 ADMIN PANEL REQUEST: Returning ${sessions.length} active chat sessions`);
        
        res.json({
            success: true,
            sessions: sessions,
            count: sessions.length
        });
        
    } catch (error) {
        console.error('Get chat sessions error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get chat sessions'
        });
    }
});

// Get messages for a specific chat (for admin panel)
router.get('/:chatId/messages', (req, res) => {
    try {
        const { chatId } = req.params;
        const { limit = 50, offset = 0 } = req.query;
        
        const session = activeChats.get(chatId);
        if (!session) {
            return res.status(404).json({
                success: false,
                message: 'Chat session not found'
            });
        }
        
        const messages = chatMessages.get(chatId) || [];
        const startIndex = Math.max(0, messages.length - limit - offset);
        const endIndex = messages.length - offset;
        const paginatedMessages = messages.slice(startIndex, endIndex);
        
        console.log(`📖 LOADING CHAT MESSAGES: ${chatId} - ${paginatedMessages.length} messages`);
        
        res.json({
            success: true,
            messages: paginatedMessages,
            total: messages.length,
            chatId: chatId,
            session: session
        });
        
    } catch (error) {
        console.error('Get chat messages error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get messages'
        });
    }
});

// Admin reply to customer
router.post('/:chatId/reply', async (req, res) => {
    try {
        const { chatId } = req.params;
        const { message, adminName } = req.body;
        
        if (!message) {
            return res.status(400).json({
                success: false,
                message: 'Reply message is required'
            });
        }
        
        const session = activeChats.get(chatId);
        if (!session) {
            return res.status(404).json({
                success: false,
                message: 'Chat session not found'
            });
        }
        
        const messageObj = {
            id: `MSG_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            chatId: chatId,
            text: message,
            sender: adminName || 'Support Team',
            senderType: 'admin',
            timestamp: new Date().toISOString(),
            read: true
        };
        
        // Add message to chat storage
        const messages = chatMessages.get(chatId) || [];
        messages.push(messageObj);
        chatMessages.set(chatId, messages);
        
        // Update session activity and reset unread count
        session.lastActivity = new Date().toISOString();
        session.unreadCount = 0; // Reset unread count since admin replied
        activeChats.set(chatId, session);
        
        console.log(`📤 ADMIN REPLY SENT:`, {
            chatId: chatId,
            customer: session.userEmail,
            admin: adminName || 'Support Team',
            message: message
        });
        
        // Send confirmation to Telegram
        const confirmationMessage = `✅ REPLY SENT TO CUSTOMER

🆔 Chat ID: ${chatId}
👤 Customer: ${session.userEmail}
👨‍💼 Admin: ${adminName || 'Support Team'}
⏰ Time: ${new Date().toLocaleString()}

📝 Reply Sent:
"${message}"

The customer will see this message in their chat widget.`;

        try {
            await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: telegramChatId,
                    text: confirmationMessage,
                    parse_mode: 'HTML'
                })
            });
        } catch (telegramError) {
            console.warn('Telegram confirmation failed:', telegramError.message);
        }
        
        res.json({
            success: true,
            message: messageObj,
            chatId: chatId
        });
        
    } catch (error) {
        console.error('Admin reply error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to send reply'
        });
    }
});
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
