
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './.env' });

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function inspectTable(table) {
    const { data, error } = await supabase.from(table).select('*').limit(1);
    if (error) {
         console.log(`❌ Table [${table}] error:`, error.message);
         return;
    }
    if (data && data.length > 0) {
        console.log(`✅ Table [${table}] columns:`, Object.keys(data[0]).join(', '));
    } else {
        // Try to get columns even if empty by selecting a non-existent row
        const { data: cols, error: colError } = await supabase.from(table).select('*').limit(0);
        console.log(`✅ Table [${table}] exists but is empty.`);
    }
}

async function start() {
    await inspectTable('profiles');
    await inspectTable('payments');
    await inspectTable('activations');
    await inspectTable('support_chats');
    await inspectTable('signals');
}

start();
