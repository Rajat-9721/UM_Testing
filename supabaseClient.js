// Initialize Supabase Client
// You must provide your Supabase URL and Anon Key below

const SUPABASE_URL = 'https://vfgwcuypxdivpydujfij.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_M3hbhKv8pRT35TYu6Nl8yQ_RHvELbwQ';

// Preserve the SDK factory before exposing the configured client globally.
const supabaseSdk = window.supabase;
const supabaseClient = supabaseSdk.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
window.supabaseSdk = supabaseSdk;
window.supabase = supabaseClient;
window.supabaseClient = supabaseClient;
