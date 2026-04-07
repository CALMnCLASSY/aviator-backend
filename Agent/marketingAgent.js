const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
const emailService = require('./emailService');

// Initialize Supabase Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase    = createClient(supabaseUrl, supabaseKey);

/**
 * MARKETING AI AGENT — AviSignals v2
 * 
 * Automatically sends branded drip campaigns to users based on signup age.
 * Uses the high-conversion templates defined in emailService.js.
 */

async function runDripCampaigns() {
    console.log("⏰ Starting daily AI marketing checks...");
    
    try {
        // Get all profiles from Supabase
        const { data: profiles, error } = await supabase.from('profiles').select('*');
        if (error) throw error;
        if (!profiles) return;

        const now = new Date();

        for (const profile of profiles) {
            if (!profile.email) continue;

            // Calculate age of profile in days
            const createdDate = new Date(profile.created_at);
            const diffTime = Math.abs(now - createdDate);
            const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

            // Determine which email to send
            try {
                switch(diffDays) {
                    case 0:
                        // Note: Welcome email is usually triggered immediately on auth event, 
                        // but this serves as a backup if that failed.
                        console.log(`🤖 Backup Welcome email for ${profile.email}`);
                        await emailService.sendWelcomeEmail(profile.email);
                        break;
                    
                    case 1:
                        console.log(`🤖 Day 1 email (Proof) for ${profile.email}`);
                        await emailService.sendDay1Email(profile.email);
                        break;
                    
                    case 3:
                        console.log(`🤖 Day 3 email (Story) for ${profile.email}`);
                        await emailService.sendDay3Email(profile.email);
                        break;
                    
                    case 7:
                        console.log(`🤖 Day 7 email (Discount) for ${profile.email}`);
                        await emailService.sendDay7Email(profile.email);
                        break;

                    case 14:
                        console.log(`🤖 Day 14 email (Re-engagement) for ${profile.email}`);
                        await emailService.sendReengagementEmail(profile.email);
                        break;
                }
            } catch (sendErr) {
                console.error(`❌ Failed to send Day ${diffDays} email to ${profile.email}:`, sendErr.message);
            }
        }
        console.log("✅ Daily AI marketing checks complete.");
    } catch (error) {
        console.error("❌ Marketing Agent Error:", error);
    }
}

function startMarketingAgent() {
    console.log("🚀 Marketing AI Agent Initialized - Running Drip Campaigns daily at 10:00 AM");

    // Run every day at 10:00 AM
    cron.schedule('0 10 * * *', async () => {
        await runDripCampaigns();
    });
}

// Export for manual triggering
module.exports = { startMarketingAgent, runDripCampaigns };
