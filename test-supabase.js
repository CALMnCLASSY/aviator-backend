require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function test() {
    console.log("URL:", process.env.SUPABASE_URL ? "SET" : "UNSET");
    console.log("ROLE_KEY:", process.env.SUPABASE_SERVICE_ROLE_KEY ? "SET" : "UNSET");
    
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
        console.log("NO SERVICE ROLE CONFIG");
        return;
    }

    const supabaseAdmin = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    try {
        console.log("Test upsert profile...");
        const payload = { id: 'test-id', email: 'test@example.com', phone: '12345' };
        const { data, error } = await supabaseAdmin.from('profiles').upsert(payload).select();
        console.log("Upsert result:", data ? "SUCCESS" : "ERROR", error);
    } catch(e) {
        console.error("Crash:", e);
    }
}
test();
