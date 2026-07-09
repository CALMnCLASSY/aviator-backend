// marketing/telegramAgentMarketing.js
'use strict';

const TelegramMarketingBot = require('./telegramMarketing');
const { translateToAgent } = require('./translator');

class TelegramAgentMarketingBot extends TelegramMarketingBot {
    constructor() {
        super();
        this.channelId = process.env.AGENT_TELEGRAM_CHANNEL_ID || '-1003823107911';
    }

    processMessage(message, category = null) {
        const processed = super.processMessage(message, category);
        return translateToAgent(processed);
    }

    async sendToChannel(messageData) {
        // If it's an object with persona signatures, extract the main message to prevent signatures
        let messageText = typeof messageData === 'string' ? messageData : messageData.message;
        messageText = translateToAgent(messageText);
        return super.sendToChannel(messageText);
    }

    async sendImageToChannel(imagePath, caption) {
        // Strip out the persona suffix so it looks like a natural post from a user
        let cleanCaption = caption || '';
        if (this.personas) {
            for (const key in this.personas) {
                const signature = `\n\n${this.personas[key].emoji} ${this.personas[key].name}`;
                cleanCaption = cleanCaption.replace(signature, '');
            }
        }
        return super.sendImageToChannel(imagePath, cleanCaption);
    }

    async sendVideoToChannel(videoPath, caption) {
        // Strip out the persona suffix so it looks like a natural post from a user
        let cleanCaption = caption || '';
        if (this.personas) {
            for (const key in this.personas) {
                const signature = `\n\n${this.personas[key].emoji} ${this.personas[key].name}`;
                cleanCaption = cleanCaption.replace(signature, '');
            }
        }
        return super.sendVideoToChannel(videoPath, cleanCaption);
    }
}

module.exports = TelegramAgentMarketingBot;
