require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function check() {
  console.log("Checking profiles...");
  const p = await supabase.from('profiles').select('*').limit(1);
  console.log("Profiles:", p.error || "Exists");

  console.log("Checking admin users query...");
  const u = await supabase.from('profiles').select('*, activations(count), payments(count)').limit(1);
  console.log("Admin Users Query:", u.error || "Works!");
}
check();
