const { createClient } = require("@supabase/supabase-js");

// Accept either the base project URL or a pasted REST/realtime endpoint and
// normalize to the origin (https://<ref>.supabase.co) that supabase-js expects.
function normalizeSupabaseUrl(raw) {
  if (!raw) return raw;
  try {
    return new URL(raw).origin;
  } catch {
    return raw.replace(/\/+$/, "").replace(/\/(rest|realtime|auth|storage)\/v1.*$/, "");
  }
}

const supabaseUrl = normalizeSupabaseUrl(process.env.SUPABASE_URL);
process.env.SUPABASE_URL = supabaseUrl; // share normalized value with the rest of the app
const supabaseKey = process.env.SUPABASE_ANON_KEY;

let supabase = null;

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    "⚠️ SUPABASE_URL or SUPABASE_ANON_KEY not set. Database features will not work."
  );
} else {
  supabase = createClient(supabaseUrl, supabaseKey);
}

module.exports = supabase;
