require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function syncAllProfiles() {
    console.log('🔄 Fetching all users from Supabase Auth...');
    
    const { data: { users }, error: authError } = await supabase.auth.admin.listUsers();
    
    if (authError) {
        console.error('❌ Error fetching users:', authError.message);
        return;
    }

    console.log(`✅ Found ${users.length} users. Syncing to 'profiles' table...`);

    for (const user of users) {
        const { error: upsertError } = await supabase
            .from('profiles')
            .upsert({
                id:         user.id,
                email:      user.email,
                last_seen:  new Date().toISOString()
            }, { onConflict: 'email' });

        if (upsertError) {
            console.error(`❌ Sync failed for ${user.email}:`, upsertError.message);
        } else {
            console.log(`✔ Synced ${user.email}`);
        }
    }

    console.log('🏁 Sync complete.');
}

syncAllProfiles();
