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
        this.siteIndex = 0;
    }

    // Rotating footers pushed under result posts — each one names the
    // site the signal was for, with a trackable ?ref=signals link.
    getSignalsFooter(site) {
        const footers = [
            `💎 Want live signals for *${site}*? Get your code: https://avisignals.com/bot?ref=signals`,
            `🔑 *${site}* predictions unlock with a premium code: https://avisignals.com/bot?ref=signals`,
            `🆓 No code yet? Start the FREE 60-min bot trial: https://avisignals.com/bot?ref=signals`,
            `📡 Signals like this run 24/7 for premium members on *${site}*: https://avisignals.com/bot?ref=signals`,
        ];
        this.signalsFooterIndex = (this.signalsFooterIndex || 0) + 1;
        return footers[this.signalsFooterIndex % footers.length];
    }

    processMessage(message, category = null) {
        const activeSite = this.prioritySites[this.siteIndex % this.prioritySites.length];

        // Pre-replace {{site}} with the active site so parent processMessage leaves it intact
        const messageWithSite = message.replace(/{{site}}/g, activeSite);

        let processed = super.processMessage(messageWithSite, category);

        // Site-specific premium footer under win/cancel posts
        if (category === 'win_results' || category === 'cancelled_signals') {
            processed += `\n\n${this.getSignalsFooter(activeSite)}`;
        }

        return processed;
    }

    getImageForCategory(messageType) {
        // Disable images for premium signals channel as requested
        return null;
    }

    async runPremiumSignalsLoop() {
        console.log('📡 [Premium Signals] Starting loop...');
        while (this.isRunning) {
            try {
                const activeSite = this.prioritySites[this.siteIndex % this.prioritySites.length];
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

                // Increment site pointer so next cycle uses a different betting site
                this.siteIndex++;

                // Every ~6th cycle (~13 min), keep the channel engaged with
                // rotating promo/educational content — pushes members toward
                // getting a code for their own site.
                if (this.siteIndex % 6 === 0 && this.isRunning) {
                    await new Promise(resolve => setTimeout(resolve, 30 * 1000));
                    if (!this.isRunning) break;
                    const engaging = ['tips', 'free_trial', 'classy_promos', 'plans_promo'];
                    const pick = engaging[(Math.floor(this.siteIndex / 6)) % engaging.length];
                    await this.sendMessageForType(pick);
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
