// Initialize Supabase Client
// You must provide your Supabase URL and Anon Key below

const SUPABASE_URL = 'YOUR_SUPABASE_URL_HERE';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY_HERE';

// Create a single supabase client for interacting with your database
const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
