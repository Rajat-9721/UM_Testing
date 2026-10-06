// Public Supabase connection details. The publishable key is meant to be
// public — it only grants what Row Level Security allows. Kept in a file
// of its own so pages that only need the URL (e.g. the enquiry forms)
// don't pull the whole Supabase client library into their bundle.
export const SUPABASE_URL = 'https://ohytjcwcmzalftmsdvbq.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_ApiQJQ2W-sfMo7i3jl_NSw_0eWMvVmF';
