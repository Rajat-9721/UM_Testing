
// Initialize Supabase Client
// You must provide your Supabase URL and Anon Key below

const SUPABASE_URL = "https://ohytjcwcmzalftmsdvbq.supabase.co";
const SUPABASE_ANON_KEY = 'sb_publishable_ApiQJQ2W-sfMo7i3jl_NSw_0eWMvVmF';

// Preserve the SDK factory before exposing the configured client globally.
const supabaseSdk = window.supabase;
const supabaseClient = supabaseSdk.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
window.supabaseSdk = supabaseSdk;
window.supabase = supabaseClient;
window.supabaseClient = supabaseClient;
