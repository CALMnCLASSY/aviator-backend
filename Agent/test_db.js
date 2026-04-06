
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../.env' });

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testQueries() {
    console.log('Testing Supabase Queries...');
    
    const tables = ['users', 'payments', 'subscriptions', 'support_chats', 'signals'];
    
    for (const table of tables) {
        const { data, count, error } = await supabase.from(table).select('*', { count: 'exact', head: true }).limit(1);
        if (error) {
            console.log(`❌ Table [${table}] error:`, error.message);
        } else {
            console.log(`✅ Table [${table}] exists. Count: ${count}`);
            // Let's see one row to check column names if count > 0
            const { data: row } = await supabase.from(table).select('*').limit(1);
            if (row && row.length > 0) {
                console.log(`   Columns in [${table}]:`, Object.keys(row[0]).join(', '));
            }
        }
    }
}

testQueries();
