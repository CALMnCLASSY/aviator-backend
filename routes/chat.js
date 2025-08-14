const express = require('express');
const router = express.Router();

// In-memory storage for chat sessions (in production, use database)
let chatSessions = new Map();
let chatMessages = new Map();

// Create or get chat session
router.post('/chat/session', (req, res) => {
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
        
        chatSessions.set(chatId, session);
        
        // Initialize messages array for this chat
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

// Get all active chat sessions (for admin panel)
router.get('/chat/sessions', (req, res) => {
    try {
        const sessions = Array.from(chatSessions.values())
            .filter(session => session.status === 'active')
            .map(session => {
                const messages = chatMessages.get(session.id) || [];
                const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
                
                return {
                    id: session.id,
                    user: session.userEmail,
                    lastMessage: lastMessage ? lastMessage.text : 'Chat started',
                    time: lastMessage ? new Date(lastMessage.timestamp).toLocaleTimeString() : 
                          new Date(session.createdAt).toLocaleTimeString(),
                    unread: session.unreadCount || 0,
                    status: session.status
                };
            })
            .sort((a, b) => new Date(b.time) - new Date(a.time));
        
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

// Send message to chat
router.post('/chat/message', (req, res) => {
    try {
        const { chatId, message, sender, senderType } = req.body;
        
        if (!chatId || !message || !sender || !senderType) {
            return res.status(400).json({
                success: false,
                message: 'Chat ID, message, sender, and sender type are required'
            });
        }
        
        const session = chatSessions.get(chatId);
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
            sender: sender,
            senderType: senderType, // 'customer' or 'admin'
            timestamp: new Date().toISOString(),
            read: false
        };
        
        // Add message to chat
        const messages = chatMessages.get(chatId) || [];
        messages.push(messageObj);
        chatMessages.set(chatId, messages);
        
        // Update session activity
        session.lastActivity = new Date().toISOString();
        
        // Increment unread count if message is from customer
        if (senderType === 'customer') {
            session.unreadCount = (session.unreadCount || 0) + 1;
        }
        
        chatSessions.set(chatId, session);
        
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

// Get messages for a specific chat
router.get('/chat/:chatId/messages', (req, res) => {
    try {
        const { chatId } = req.params;
        const { limit = 50, offset = 0 } = req.query;
        
        const session = chatSessions.get(chatId);
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
        
        res.json({
            success: true,
            messages: paginatedMessages,
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

// Mark chat messages as read (admin side)
router.post('/chat/:chatId/read', (req, res) => {
    try {
        const { chatId } = req.params;
        
        const session = chatSessions.get(chatId);
        if (!session) {
            return res.status(404).json({
                success: false,
                message: 'Chat session not found'
            });
        }
        
        // Reset unread count
        session.unreadCount = 0;
        chatSessions.set(chatId, session);
        
        // Mark messages as read
        const messages = chatMessages.get(chatId) || [];
        messages.forEach(msg => {
            if (msg.senderType === 'customer') {
                msg.read = true;
            }
        });
        chatMessages.set(chatId, messages);
        
        res.json({
            success: true,
            chatId: chatId
        });
        
    } catch (error) {
        console.error('Mark chat as read error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to mark chat as read'
        });
    }
});

// Close chat session
router.post('/chat/:chatId/close', (req, res) => {
    try {
        const { chatId } = req.params;
        
        const session = chatSessions.get(chatId);
        if (!session) {
            return res.status(404).json({
                success: false,
                message: 'Chat session not found'
            });
        }
        
        session.status = 'closed';
        session.closedAt = new Date().toISOString();
        chatSessions.set(chatId, session);
        
        res.json({
            success: true,
            chatId: chatId,
            message: 'Chat session closed'
        });
        
    } catch (error) {
        console.error('Close chat session error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to close chat session'
        });
    }
});

// Get chat statistics
router.get('/chat/stats', (req, res) => {
    try {
        const activeSessions = Array.from(chatSessions.values())
            .filter(session => session.status === 'active');
        
        const totalUnread = activeSessions
            .reduce((sum, session) => sum + (session.unreadCount || 0), 0);
        
        const totalMessages = Array.from(chatMessages.values())
            .reduce((sum, messages) => sum + messages.length, 0);
        
        res.json({
            success: true,
            stats: {
                activeSessions: activeSessions.length,
                totalSessions: chatSessions.size,
                totalUnread: totalUnread,
                totalMessages: totalMessages
            }
        });
        
    } catch (error) {
        console.error('Get chat stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get chat statistics'
        });
    }
});

module.exports = router;
