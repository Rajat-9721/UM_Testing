import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://utkarshminds.com',
  output: 'static',
  compressHTML: true,
  vite: {
    server: {
      fs: {
        // The enquiry-form rules are shared with the lead-otp Edge Function
        // and live next to it (see src/lib/leads/rules.ts).
        allow: ['.', '../supabase/functions/lead-otp'],
      },
    },
  },
});
