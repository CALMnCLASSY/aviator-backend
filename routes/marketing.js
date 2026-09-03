// routes/marketing.js
const express = require('express');
const router = express.Router();
const { shareToChannel, generateDailyContentPack, generateWeeklyCalendar } = require('../Agent/socialMediaAgent');

function getMarketingBot(req) {
    return req.app.locals.marketingBot || global.marketingBotInstance;
}

// Get marketing bot status
router.get('/status', (req, res) => {
    try {
        const marketingBot = getMarketingBot(req);
        
        if (!marketingBot) {
            return res.status(404).json({
                success: false,
                message: 'Marketing bot not initialized'
            });
        }
        
        const status = marketingBot.getStatus();
        
        res.json({
            success: true,
            status: {
                ...status,
                lastPostTime: status.lastPostTime ? new Date(status.lastPostTime).toLocaleString() : 'Never'
            }
        });
    } catch (error) {
        console.error('Error getting marketing bot status:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Start marketing bot
router.post('/start', (req, res) => {
    try {
        const marketingBot = getMarketingBot(req);
        
        if (!marketingBot) {
            return res.status(404).json({
                success: false,
                message: 'Marketing bot not initialized'
            });
        }
        
        marketingBot.start();
        
        res.json({
            success: true,
            message: 'Marketing bot started successfully'
        });
    } catch (error) {
        console.error('Error starting marketing bot:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Stop marketing bot
router.post('/stop', (req, res) => {
    try {
        const marketingBot = getMarketingBot(req);
        
        if (!marketingBot) {
            return res.status(404).json({
                success: false,
                message: 'Marketing bot not initialized'
            });
        }
        
        marketingBot.stop();
        
        res.json({
            success: true,
            message: 'Marketing bot stopped successfully'
        });
    } catch (error) {
        console.error('Error stopping marketing bot:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Send test message
router.post('/test', async (req, res) => {
    try {
        const marketingBot = getMarketingBot(req);
        
        if (!marketingBot) {
            return res.status(404).json({
                success: false,
                message: 'Marketing bot not initialized'
            });
        }
        
        await marketingBot.sendMarketingPost();
        
        res.json({
            success: true,
            message: 'Test message sent successfully'
        });
    } catch (error) {
        console.error('Error sending test message:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Send free code tutorial
router.post('/tutorial', async (req, res) => {
    try {
        const marketingBot = getMarketingBot(req);
        
        if (!marketingBot) {
            return res.status(404).json({
                success: false,
                message: 'Marketing bot not initialized'
            });
        }
        
        await marketingBot.sendFreeCodeTutorial();
        
        res.json({
            success: true,
            message: 'Free code tutorial sent successfully'
        });
    } catch (error) {
        console.error('Error sending free code tutorial:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Debug endpoint to check bot state
router.get('/debug', (req, res) => {
    try {
        const marketingBot = getMarketingBot(req);
        
        if (!marketingBot) {
            return res.status(404).json({
                success: false,
                message: 'Marketing bot not initialized'
            });
        }
        
        res.json({
            success: true,
            debug: {
                isRunning: marketingBot.isRunning,
                lastPostTime: marketingBot.lastPostTime,
                currentFlow: marketingBot.currentFlow,
                flowStep: marketingBot.flowStep,
                botToken: marketingBot.botToken ? 'Present' : 'Missing',
                channelId: marketingBot.channelId,
                messagesLoaded: Object.keys(marketingBot.messagePool || {}).length
            }
        });
    } catch (error) {
        console.error('Error getting debug info:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Send premium video promo (premiumchannel.mp4)
router.post('/broadcast-premium-video', async (req, res) => {
    try {
        const marketingBot = getMarketingBot(req);
        
        if (!marketingBot) {
            return res.status(404).json({
                success: false,
                message: 'Marketing bot not initialized'
            });
        }
        
        const sent = await marketingBot.sendPremiumPromotion();
        
        res.json({
            success: sent !== false,
            message: 'Premium channel video promotion sent to Telegram channel'
        });
    } catch (error) {
        console.error('Error broadcasting premium video promo:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// Send agent referral program promo (agentprogram.jpg)
router.post('/broadcast-agent-promo', async (req, res) => {
    try {
        const marketingBot = getMarketingBot(req);
        
        if (!marketingBot) {
            return res.status(404).json({
                success: false,
                message: 'Marketing bot not initialized'
            });
        }
        
        const sent = await marketingBot.sendAgentProgramPromotion();
        
        res.json({
            success: sent !== false,
            message: 'Agent program promotion message with agentprogram.jpg sent to Telegram channel'
        });
    } catch (error) {
        console.error('Error broadcasting agent promo:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

// ─── SOCIAL MEDIA AGENT ENDPOINTS ─────────────────────────────

// Manually broadcast social media post directly to Telegram channel
router.post('/broadcast-social-post', async (req, res) => {
    try {
        const result = await shareToChannel();
        res.json({
            success: result?.success !== false,
            message: 'Social media content broadcast triggered to Telegram channel',
            details: result
        });
    } catch (error) {
        console.error('Error broadcasting social post:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to broadcast social post',
            error: error.message
        });
    }
});

// Manually trigger daily social media content pack generation to Admin
router.post('/broadcast-social-pack', async (req, res) => {
    try {
        const result = await generateDailyContentPack();
        res.json({
            success: result?.success !== false,
            message: 'Daily social media content pack generated and dispatched',
            details: result
        });
    } catch (error) {
        console.error('Error generating daily content pack:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate content pack',
            error: error.message
        });
    }
});

module.exports = router;
