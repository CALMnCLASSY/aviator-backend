// ============================================================
// marketingAgent.js — AviSignals Drip Campaign Agent v2
//
// Fixes over v1:
//  - diffDays used exact match (case 0, 1, 3, 7, 14) which is fragile:
//    if the cron fires before a user hits exactly 24h, they miss Day 1.
//    Now uses DAY RANGES (1-2 = Day1, 3-4 = Day3, etc.) for reliability.
//  - No deduplication — users got duplicate emails on server restart.
//    Now tracks sent emails in a `drip_emails_sent` column on profiles.
//  - Cron was UTC 10:00 (1PM EAT) — now uses 10:00 EAT timezone.
//  - Added Discord notification on each drip campaign run.
//  - Added error resilience — one failed email doesn't stop the loop.
//  - Runs an initial check 30 seconds after server boot (catches up
//    if the server was down during the scheduled window).
// ============================================================

'use strict';

const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
const emailService = require('./emailService');
const discordAgent = require('./discordAgent');

// Initialize Supabase Client with Service Role (bypasses RLS)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase    = createClient(supabaseUrl, supabaseKey);

/**
 * DRIP SCHEDULE
 * Each entry maps a range of days-since-signup to an email function.
 * Using ranges instead of exact matches prevents missed emails.
 * The `key` is stored in drip_emails_sent to prevent duplicates.
 */
const DRIP_SCHEDULE = [
    { key: 'day1',  minDays: 1,  maxDays: 2,  sendFn: 'sendDay1Email',          label: 'Day 1 (Social Proof)' },
    { key: 'day3',  minDays: 3,  maxDays: 5,  sendFn: 'sendDay3Email',          label: 'Day 3 (Success Story)' },
    { key: 'day7',  minDays: 7,  maxDays: 9,  sendFn: 'sendDay7Email',          label: 'Day 7 (Discount Offer)' },
    { key: 'day14', minDays: 14, maxDays: 20, sendFn: 'sendReengagementEmail',  label: 'Day 14 (Re-engagement)' },
];

/**
 * Main drip campaign runner.
 * Queries all profiles, calculates their age, and sends the right email
 * if they haven't already received it.
 */
async function runDripCampaigns() {
    const startTime = Date.now();
    console.log('\n⏰ ═══════════════════════════════════════════════');
    console.log('⏰ Starting Drip Campaign Check...');
    console.log('⏰ ═══════════════════════════════════════════════\n');

    const stats = { checked: 0, sent: 0, skipped: 0, errors: 0, byType: {} };

    try {
        // Get all profiles with email
        const { data: profiles, error } = await supabase
            .from('profiles')
            .select('id, email, created_at, drip_emails_sent');

        if (error) {
            console.error('❌ Failed to fetch profiles for drip campaigns:', error.message);
            discordAgent.sendAlert('DRIP CAMPAIGN ERROR', `Failed to fetch profiles: ${error.message}`, 'error');
            return;
        }

        if (!profiles || profiles.length === 0) {
            console.log('📭 No profiles found — skipping drip campaigns.');
            return;
        }

        const now = new Date();
        console.log(`📊 Processing ${profiles.length} profiles...\n`);

        for (const profile of profiles) {
            stats.checked++;

            // Skip profiles without email
            if (!profile.email) {
                stats.skipped++;
                continue;
            }

            // Skip profiles without created_at (shouldn't happen, but safety)
            if (!profile.created_at) {
                stats.skipped++;
                continue;
            }

            // Calculate age in days
            const createdDate = new Date(profile.created_at);
            const diffMs      = now - createdDate;
            const diffDays    = Math.floor(diffMs / (1000 * 60 * 60 * 24));

            // Parse already-sent emails (stored as JSON array or null)
            let sentEmails = [];
            try {
                if (profile.drip_emails_sent) {
                    sentEmails = typeof profile.drip_emails_sent === 'string'
                        ? JSON.parse(profile.drip_emails_sent)
                        : profile.drip_emails_sent;
                }
                if (!Array.isArray(sentEmails)) sentEmails = [];
            } catch (_) {
                sentEmails = [];
            }

            // Check each drip stage
            for (const stage of DRIP_SCHEDULE) {
                // Is the user in the right age range for this email?
                if (diffDays < stage.minDays || diffDays > stage.maxDays) continue;

                // Has this email already been sent?
                if (sentEmails.includes(stage.key)) continue;

                // Send the email
                try {
                    const firstName = profile.email.split('@')[0];
                    const sendFn = emailService[stage.sendFn];

                    if (!sendFn) {
                        console.error(`❌ Email function ${stage.sendFn} not found in emailService`);
                        stats.errors++;
                        continue;
                    }

                    console.log(`📧 Sending ${stage.label} to ${profile.email} (${diffDays} days old)...`);
                    const success = await sendFn(profile.email, firstName);

                    if (success) {
                        stats.sent++;
                        stats.byType[stage.key] = (stats.byType[stage.key] || 0) + 1;

                        // Record that this email was sent (prevents duplicates)
                        sentEmails.push(stage.key);
                        await supabase
                            .from('profiles')
                            .update({ drip_emails_sent: sentEmails })
                            .eq('id', profile.id);

                        console.log(`✅ ${stage.label} sent successfully to ${profile.email}`);
                    } else {
                        console.warn(`⚠️  ${stage.label} returned false for ${profile.email} (email service issue)`);
                        stats.errors++;
                    }

                    // Small delay between emails to avoid rate limits
                    await new Promise(r => setTimeout(r, 1500));

                } catch (sendErr) {
                    console.error(`❌ Failed to send ${stage.label} to ${profile.email}:`, sendErr.message);
                    stats.errors++;
                }
            }
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        console.log('\n✅ ═══════════════════════════════════════════════');
        console.log(`✅ Drip Campaign Complete — ${elapsed}s`);
        console.log(`   📊 Checked: ${stats.checked} | Sent: ${stats.sent} | Skipped: ${stats.skipped} | Errors: ${stats.errors}`);
        if (Object.keys(stats.byType).length > 0) {
            console.log(`   📬 Breakdown: ${JSON.stringify(stats.byType)}`);
        }
        console.log('✅ ═══════════════════════════════════════════════\n');

        // Discord summary
        if (stats.sent > 0 || stats.errors > 0) {
            const breakdown = Object.entries(stats.byType).map(([k, v]) => `${k}: ${v}`).join(', ');
            discordAgent.sendAlert(
                '📬 DRIP CAMPAIGN REPORT',
                `**Profiles checked:** ${stats.checked}\n` +
                `**Emails sent:** ${stats.sent}\n` +
                `**Errors:** ${stats.errors}\n` +
                (breakdown ? `**Breakdown:** ${breakdown}\n` : '') +
                `**Duration:** ${elapsed}s`,
                stats.errors > 0 ? 'warning' : 'success'
            );
        }

    } catch (error) {
        console.error('❌ Marketing Agent Critical Error:', error);
        discordAgent.sendAlert('DRIP CAMPAIGN CRITICAL ERROR', error.message, 'error');
    }
}

/**
 * Ensure the drip_emails_sent column exists on profiles.
 * Runs once at startup. If the column doesn't exist, it adds it.
 * Uses a simple test query — if it fails, we try to add the column.
 */
async function ensureDripColumn() {
    try {
        // Test if the column exists by selecting it
        const { error } = await supabase
            .from('profiles')
            .select('drip_emails_sent')
            .limit(1);

        if (error && error.message.includes('drip_emails_sent')) {
            console.log('📋 drip_emails_sent column not found — please add it manually:');
            console.log('   ALTER TABLE profiles ADD COLUMN drip_emails_sent jsonb DEFAULT \'[]\'::jsonb;');
            discordAgent.sendAlert(
                '⚠️ DRIP CAMPAIGN SETUP NEEDED',
                'The `drip_emails_sent` column is missing from the `profiles` table.\n\n' +
                'Run this SQL in Supabase:\n```\nALTER TABLE profiles ADD COLUMN drip_emails_sent jsonb DEFAULT \'[]\'::jsonb;\n```',
                'warning'
            );
            return false;
        }

        console.log('✅ drip_emails_sent column confirmed');
        return true;

    } catch (err) {
        console.warn('⚠️  Could not verify drip_emails_sent column:', err.message);
        return false;
    }
}

function startMarketingAgent() {
    console.log('🚀 Marketing AI Agent Initialized');

    // 1. Check column exists
    ensureDripColumn().then(exists => {
        if (!exists) {
            console.warn('⚠️  Marketing Agent: drip_emails_sent column missing — emails will still send but won\'t deduplicate.');
        }
    });

    // 2. Schedule daily at 10:00 AM EAT (7:00 AM UTC)
    //    Cron: minute=0 hour=7 (UTC) = 10:00 AM EAT
    cron.schedule('0 7 * * *', async () => {
        console.log('⏰ Scheduled drip campaign triggered (10:00 AM EAT)');
        await runDripCampaigns();
    });

    // 3. Also run a second pass at 6:00 PM EAT (3:00 PM UTC) to catch stragglers
    cron.schedule('0 15 * * *', async () => {
        console.log('⏰ Evening drip campaign triggered (6:00 PM EAT)');
        await runDripCampaigns();
    });

    // 4. Catch-up run 30 seconds after server boot
    //    This handles the case where the server was down during the scheduled window
    setTimeout(async () => {
        console.log('⏰ Boot-time drip campaign catch-up running...');
        await runDripCampaigns();
    }, 30000);

    console.log('   📅 Schedule: Daily at 10:00 AM & 6:00 PM EAT + boot catch-up');
}

// Export for manual triggering
module.exports = { startMarketingAgent, runDripCampaigns };
