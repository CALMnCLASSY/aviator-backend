// routes/marketing.js
const express = require('express');
const router = express.Router();

// Get marketing bot status
router.get('/status', (req, res) => {
    try {
        const marketingBot = req.app.locals.marketingBot;
        
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
        const marketingBot = req.app.locals.marketingBot;
        
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
        const marketingBot = req.app.locals.marketingBot;
        
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
        const marketingBot = req.app.locals.marketingBot;
        
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

module.exports = router;
