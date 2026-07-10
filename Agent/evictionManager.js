// Agent/evictionManager.js
'use strict';

const cron = require('node-cron');
const https = require('https');
const { createClient } = require('@supabase/supabase-js');
const discordAgent = require('./discordAgent');

const supabase = createClient(
    (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, ''),
    (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
);

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PREMIUM_CHANNEL_ID = process.env.SIGNALS_TELEGRAM_CHANNEL_ID || '-1004392861413';

function telegramRequest(method, payload) {
    return new Promise((resolve) => {
        if (!BOT_TOKEN) return resolve({ ok: false, description: 'Telegram token missing' });

        const body = JSON.stringify(payload);
        const options = {
            hostname: 'api.telegram.org',
            path: `/bot${BOT_TOKEN}/${method}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (_) { resolve({ ok: false }); }
            });
        });

        req.on('error', () => resolve({ ok: false }));
        req.write(body);
        req.end();
    });
}

/**
 * Ban and immediately unban user to evict them from the channel
 */
async function evictUser(telegramUserId, identifier) {
    console.log(`📡 Evicting Telegram User ID: ${telegramUserId} (${identifier})`);
    
    // 1. Kick/Ban member
    const banRes = await telegramRequest('banChatMember', {
        chat_id: PREMIUM_CHANNEL_ID,
        user_id: Number(telegramUserId)
    });

    if (banRes.ok) {
        console.log(`✅ Banned user ${telegramUserId}`);
        
        // 2. Unban member so they can subscribe and rejoin in the future
        await telegramRequest('unbanChatMember', {
            chat_id: PREMIUM_CHANNEL_ID,
            user_id: Number(telegramUserId),
            only_if_banned: true
        });
        
        console.log(`✅ Unbanned user ${telegramUserId} for future access`);
        
        // Discord alerts to all three requested channels
        const messageText = `🚫 Premium Subscription Expired. User evict completed.\n\n👤 User: \`${identifier}\`\n🆔 Telegram ID: \`${telegramUserId}\``;
        
        discordAgent.sendAlert('🔴 SUBSCRIBER EVICTED', messageText, 'warning');
        discordAgent.sendUserEvent('EVICTION', { identifier, telegram_id: telegramUserId, status: 'EVICTED' });
        discordAgent.sendPaymentEvent('SUBSCRIPTION_EXPIRED', { user: identifier, telegram_id: telegramUserId });
        
        return true;
    } else {
        console.error(`❌ Failed to ban user ${telegramUserId}:`, banRes.description);
        return false;
    }
}

/**
 * Webhook handler to link Telegram User IDs to purchase records
 */
async function handleChatMemberUpdate(update) {
    try {
        const chatMember = update.chat_member;
        if (!chatMember) return;

        const chatId = String(chatMember.chat.id);
        if (chatId !== String(PREMIUM_CHANNEL_ID)) return;

        const userId = chatMember.from.id;
        const username = chatMember.from.username || chatMember.from.first_name || 'Anonymous';
        const inviteLink = chatMember.invite_link?.invite_link;

        // If user joined via invite link
        if (chatMember.new_chat_member?.status === 'member' && inviteLink) {
            console.log(`👤 User ${username} (${userId}) joined channel via invite link: ${inviteLink}`);

            // Find matching activation or payment in DB
            const today = new Date();
            const { data: activation, error } = await supabase
                .from('activations')
                .select('id, user_id, profiles(email, phone)')
                .eq('invite_link_used', inviteLink)
                .single();

            if (activation && !error) {
                const userEmail = activation.profiles?.email || activation.profiles?.phone || 'Unknown';
                
                // Link telegram user ID to profiles table
                await supabase
                    .from('profiles')
                    .update({ telegram_id: String(userId), telegram_username: username })
                    .eq('id', activation.user_id);

                console.log(`✅ Linked Telegram ID ${userId} to profile ${userEmail}`);
                
                const joinedText = `🎉 User joined Premium VIP Channel.\n\n👤 Member: \`${userEmail}\`\n🆔 Telegram ID: \`${userId}\` (@${username})`;
                
                discordAgent.sendAlert('🟢 NEW PREMIUM JOINER', joinedText, 'success');
                discordAgent.sendUserEvent('PREMIUM_JOIN', { user: userEmail, telegram_id: userId, invite_link: inviteLink });
            }
        }
    } catch (err) {
        console.error('❌ Error handling chat member update:', err.message);
    }
}

/**
 * Scan database hourly and evict expired users
 */
async function runEvictionScan() {
    console.log('🔍 Running premium subscription eviction scan...');
    try {
        // Query activations where code_type is weekly or premium, expired, and has a linked Telegram ID
        const now = new Date().toISOString();
        
        // Find activations that have expired (weekly premium runs for 7 days)
        const { data: expiredSubs, error } = await supabase
            .from('activations')
            .select('*, profiles(id, telegram_id, email, phone)')
            .eq('code_type', 'premium') // or whatever designation used for premium
            .lt('expires_at', now);

        if (error) throw error;

        for (const sub of (expiredSubs || [])) {
            const telegramId = sub.profiles?.telegram_id;
            const identifier = sub.profiles?.email || sub.profiles?.phone || 'Unknown';
            if (telegramId) {
                const evicted = await evictUser(telegramId, identifier);
                if (evicted) {
                    // Mark activation as processed/evicted in DB
                    await supabase
                        .from('activations')
                        .update({ status: 'expired_evicted' })
                        .eq('id', sub.id);
                }
            }
        }
    } catch (err) {
        console.error('❌ Eviction scan failed:', err.message);
    }
}

function startEvictionManager() {
    console.log('🚀 Starting Telegram Eviction Manager...');
    // Run scan hourly
    cron.schedule('0 * * * *', runEvictionScan);
}

module.exports = {
    startEvictionManager,
    handleChatMemberUpdate,
    runEvictionScan,
    evictUser
};
