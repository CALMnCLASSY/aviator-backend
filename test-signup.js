require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

async function test() {
    console.log("Attempting test signup...");
    const email = 'test_signup_' + Date.now() + '@example.com';
    const { data, error } = await supabaseClient.auth.signUp({
        email: email,
        password: 'Password123!',
        options: {
            data: { phone: '123456789' }
        }
    });

    if (error) {
         console.error("❌ Auth Error:", error.message, error.status, error.code);
    } else {
         console.log("✅ Signup successful for", email);
    }
}
test();
