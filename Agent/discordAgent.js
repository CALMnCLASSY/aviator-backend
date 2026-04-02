const fetch = require('node-fetch');

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

/**
 * SEND DISCORD NOTIFICATION
 * @param {Object} embed - Discord Embed Object
 */
async function sendEmbed(embed) {
    if (!DISCORD_WEBHOOK_URL) {
        console.warn('⚠️ No Discord Webhook configured. Logging to console');
        console.log('--- DISCORD NOTIF ---', JSON.stringify(embed, null, 2));
        return;
    }

    try {
        const response = await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                embeds: [embed]
            })
        });

        if (!response.ok) {
            console.error(`❌ Discord Webhook Error: ${response.status}`);
        }
    } catch (error) {
        console.error('❌ Discord Notification Failed:', error.message);
    }
}

/**
 * USER EVENT (Registration, Login, Site Selection)
 */
async function sendUserEvent(type, details) {
    const colors = {
        'REGISTER': 0x00FF00, // Green
        'LOGIN': 0x0080FF,    // Blue
        'SITE_SELECTION': 0xFFD700 // Gold
    };

    const embed = {
        title: `👤 USER EVENT: ${type}`,
        color: colors[type] || 0x808080,
        fields: Object.entries(details).map(([key, value]) => ({
            name: key.toUpperCase(),
            value: `\`${value}\``,
            inline: true
        })),
        timestamp: new Date().toISOString()
    };

    await sendEmbed(embed);
}

/**
 * TRANSACTION EVENT (USDT Orders, Payments)
 */
async function sendPaymentEvent(type, details) {
    const embed = {
        title: `💳 PAYMENT EVENT: ${type}`,
        color: type.includes('VERIFIED') ? 0x2ECC71 : 0xE74C3C,
        fields: Object.entries(details).map(([key, value]) => ({
            name: key.toUpperCase(),
            value: `\`${value}\``,
            inline: true
        })),
        timestamp: new Date().toISOString()
    };

    await sendEmbed(embed);
}

/**
 * BOT EVENT (Activations, Code usage)
 */
async function sendBotEvent(details) {
    const embed = {
        title: `⚡ BOT ACTIVATED`,
        color: 0x9B59B6, // Purple
        fields: Object.entries(details).map(([key, value]) => ({
            name: key.toUpperCase(),
            value: `\`${value}\``,
            inline: true
        })),
        footer: { text: "AviSignals Power System" },
        timestamp: new Date().toISOString()
    };

    await sendEmbed(embed);
}

/**
 * CHAT SESSION SUMMARY
 */
async function sendChatSummary(summary) {
    const embed = {
        title: "🤖 AI CHAT SESSION SUMMARY",
        color: 0xF1C40F, // Yellow
        description: summary.text,
        fields: [
            { name: "USER", value: summary.user || 'Guest', inline: true },
            { name: "LOCATION", value: summary.page || 'None', inline: true }
        ],
        footer: { text: "Generated after 5m inactivity" },
        timestamp: new Date().toISOString()
    };

    await sendEmbed(embed);
}

module.exports = {
    sendUserEvent,
    sendPaymentEvent,
    sendBotEvent,
    sendChatSummary
};
