// marketing/telegramSignalsMarketing.js
'use strict';

const TelegramMarketingBot = require('./telegramMarketing');

class TelegramSignalsMarketingBot extends TelegramMarketingBot {
    constructor() {
        super();
        this.channelId = process.env.SIGNALS_TELEGRAM_CHANNEL_ID || '-1004392861413';
        this.prioritySites = [
            "1Win", "Betika", "OdiBets", "SportPesa", "Bet365", "1xBet",
            "22Bet", "Betway", "Melbet", "Hollywoodbets", "Parimatch", "Stake"
        ];
    }

    processMessage(message, category = null) {
        const currentHour = new Date().getHours();
        const activeSite = this.prioritySites[currentHour % this.prioritySites.length];
        
        // Pre-replace {{site}} with the active site of the hour so parent processMessage leaves it intact
        const messageWithSite = message.replace(/{{site}}/g, activeSite);
        
        return super.processMessage(messageWithSite, category);
    }

    async runPremiumSignalsLoop() {
        console.log('📡 [Premium Signals] Starting loop...');
        while (this.isRunning) {
            try {
                const currentHour = new Date().getHours();
                const activeSite = this.prioritySites[currentHour % this.prioritySites.length];
                console.log(`📡 [Premium Signals] Starting signal cycle for site: ${activeSite}`);

                // Step 1: Send Signal Confirmation
                await this.sendMessageForType('signal_confirmations');

                // Wait 80 seconds
                await new Promise(resolve => setTimeout(resolve, 80 * 1000));
                if (!this.isRunning) break;

                // Step 2: Send Win Result or Cancellation (90% Win, 10% Cancelled)
                const isWin = Math.random() < 0.90;
                if (isWin) {
                    await this.sendMessageForType('win_results');
                } else {
                    await this.sendMessageForType('cancelled_signals');
                }

                // Wait 50 seconds
                await new Promise(resolve => setTimeout(resolve, 50 * 1000));
            } catch (err) {
                console.error('❌ [Premium Signals] Error in signals loop:', err);
                // Wait 10 seconds before retrying on error
                await new Promise(resolve => setTimeout(resolve, 10 * 1000));
            }
        }
        console.log('🛑 [Premium Signals] Loop stopped.');
    }

    async start() {
        if (this.isRunning) {
            console.log('🤖 Premium Signals bot is already running');
            return;
        }

        console.log('🚀 Starting Telegram Premium Signals Bot...');
        const connected = await this.testConnection();
        if (!connected) {
            console.error('❌ Failed to start premium signals bot');
            return;
        }

        this.isRunning = true;
        this.runPremiumSignalsLoop();
        console.log('✅ Premium Signals bot started successfully');
    }
}

module.exports = TelegramSignalsMarketingBot;
