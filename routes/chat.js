// routes/chat.js
const express = require('express');
const router = express.Router();

// Store chat sessions in memory (you can later move this to a database)
global.chatSessions = global.chatSessions || {};

// Get chat messages for a specific session
router.get('/:chatSessionId/messages', (req, res) => {
    try {
        const { chatSessionId } = req.params;
        
        console.log(`📥 Getting chat messages for session: ${chatSessionId}`);
        
        if (!global.chatSessions[chatSessionId]) {
            global.chatSessions[chatSessionId] = {
                messages: [],
                createdAt: new Date(),
                lastActivity: new Date()
            };
        }
        
        const session = global.chatSessions[chatSessionId];
        
        res.json({
            success: true,
            chatSessionId: chatSessionId,
            messages: session.messages,
            lastActivity: session.lastActivity
        });
        
    } catch (error) {
        console.error('Error getting chat messages:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving chat messages',
            error: error.message
        });
    }
});

// Send admin reply to customer chat
router.post('/:chatSessionId/reply', async (req, res) => {
    try {
        const { chatSessionId } = req.params;
        const { message, adminName = 'Support Team' } = req.body;
        
        console.log(`📤 Admin reply to chat ${chatSessionId}:`, message);
        
        if (!message) {
            return res.status(400).json({
                success: false,
                message: 'Reply message is required'
            });
        }
        
        // Initialize chat session if it doesn't exist
        if (!global.chatSessions[chatSessionId]) {
            global.chatSessions[chatSessionId] = {
                messages: [],
                createdAt: new Date(),
                lastActivity: new Date()
            };
        }
        
        // Add admin reply to chat session
        const adminMessage = {
            id: Date.now().toString(),
            text: message,
            sender: adminName,
            senderType: 'admin',
            timestamp: new Date().toISOString(),
            read: false
        };
        
        global.chatSessions[chatSessionId].messages.push(adminMessage);
        global.chatSessions[chatSessionId].lastActivity = new Date();
        
        // Also store the reply for real-time updates to frontend
        global.latestChatReplies = global.latestChatReplies || {};
        global.latestChatReplies[chatSessionId] = adminMessage;
        
        console.log(`✅ Admin reply stored for chat session: ${chatSessionId}`);
        
        res.json({
            success: true,
            message: 'Reply sent successfully',
            chatSessionId: chatSessionId,
            adminMessage: adminMessage
        });
        
    } catch (error) {
        console.error('Error sending admin reply:', error);
        res.status(500).json({
            success: false,
            message: 'Error sending reply',
            error: error.message
        });
    }
});

// Add customer message to chat session
router.post('/:chatSessionId/message', (req, res) => {
    try {
        const { chatSessionId } = req.params;
        const { message, customerEmail, customerName = 'Customer' } = req.body;
        
        console.log(`📥 Customer message in chat ${chatSessionId}:`, message);
        
        if (!message) {
            return res.status(400).json({
                success: false,
                message: 'Message is required'
            });
        }
        
        // Initialize chat session if it doesn't exist
        if (!global.chatSessions[chatSessionId]) {
            global.chatSessions[chatSessionId] = {
                messages: [],
                createdAt: new Date(),
                lastActivity: new Date(),
                customerEmail: customerEmail
            };
        }
        
        // Add customer message to chat session
        const customerMessage = {
            id: Date.now().toString(),
            text: message,
            sender: customerName,
            senderType: 'customer',
            timestamp: new Date().toISOString(),
            read: false,
            customerEmail: customerEmail
        };
        
        global.chatSessions[chatSessionId].messages.push(customerMessage);
        global.chatSessions[chatSessionId].lastActivity = new Date();
        if (customerEmail) {
            global.chatSessions[chatSessionId].customerEmail = customerEmail;
        }
        
        console.log(`✅ Customer message stored for chat session: ${chatSessionId}`);
        
        res.json({
            success: true,
            message: 'Message received successfully',
            chatSessionId: chatSessionId,
            customerMessage: customerMessage
        });
        
    } catch (error) {
        console.error('Error storing customer message:', error);
        res.status(500).json({
            success: false,
            message: 'Error storing message',
            error: error.message
        });
    }
});

// Get latest admin reply for a chat session (for frontend polling)
router.get('/:chatSessionId/latest-reply', (req, res) => {
    try {
        const { chatSessionId } = req.params;
        
        const latestReply = global.latestChatReplies && global.latestChatReplies[chatSessionId];
        
        if (latestReply) {
            // Mark as delivered and remove from pending
            delete global.latestChatReplies[chatSessionId];
            
            res.json({
                success: true,
                hasReply: true,
                reply: latestReply
            });
        } else {
            res.json({
                success: true,
                hasReply: false
            });
        }
        
    } catch (error) {
        console.error('Error getting latest reply:', error);
        res.status(500).json({
            success: false,
            message: 'Error checking for replies',
            error: error.message
        });
    }
});

// Get all active chat sessions (for admin dashboard)
router.get('/sessions/active', (req, res) => {
    try {
        const sessions = Object.keys(global.chatSessions || {}).map(sessionId => {
            const session = global.chatSessions[sessionId];
            return {
                sessionId: sessionId,
                customerEmail: session.customerEmail,
                messageCount: session.messages.length,
                lastActivity: session.lastActivity,
                createdAt: session.createdAt,
                hasUnreadMessages: session.messages.some(msg => !msg.read && msg.senderType === 'customer')
            };
        });
        
        // Sort by last activity (most recent first)
        sessions.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
        
        res.json({
            success: true,
            sessions: sessions,
            totalSessions: sessions.length
        });
        
    } catch (error) {
        console.error('Error getting active sessions:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving active sessions',
            error: error.message
        });
    }
});

// Mark chat session as read
router.post('/:chatSessionId/mark-read', (req, res) => {
    try {
        const { chatSessionId } = req.params;
        
        if (global.chatSessions[chatSessionId]) {
            global.chatSessions[chatSessionId].messages.forEach(msg => {
                if (msg.senderType === 'customer') {
                    msg.read = true;
                }
            });
            
            console.log(`✅ Chat session ${chatSessionId} marked as read`);
        }
        
        res.json({
            success: true,
            message: 'Chat marked as read'
        });
        
    } catch (error) {
        console.error('Error marking chat as read:', error);
        res.status(500).json({
            success: false,
            message: 'Error marking chat as read',
            error: error.message
        });
    }
});

// Get pending reply for a customer email
router.get('/pending-replies/:customerEmail', (req, res) => {
    try {
        const { customerEmail } = req.params;
        
        const pendingReply = global.pendingReplies && global.pendingReplies[customerEmail];
        
        if (pendingReply) {
            // Mark as delivered and remove from pending
            delete global.pendingReplies[customerEmail];
            
            res.json({
                success: true,
                hasPendingReply: true,
                reply: pendingReply
            });
        } else {
            res.json({
                success: true,
                hasPendingReply: false
            });
        }
        
    } catch (error) {
        console.error('Error getting pending reply:', error);
        res.status(500).json({
            success: false,
            message: 'Error checking for pending replies',
            error: error.message
        });
    }
});

module.exports = router;
