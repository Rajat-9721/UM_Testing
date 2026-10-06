// Calls the lead-otp Edge Function (supabase/functions/lead-otp).
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../supabaseConfig';

const ENDPOINT = `${SUPABASE_URL}/functions/v1/lead-otp`;
const TIMEOUT_MS = 25_000;

export class LeadApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public data: Record<string, any> = {},
  ) {
    super(message);
  }
}

export async function callLeadApi(body: Record<string, unknown>): Promise<Record<string, any>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new LeadApiError(
      "We couldn't reach our server. Please check your internet connection and try again.",
      'network',
    );
  } finally {
    clearTimeout(timer);
  }

  let data: Record<string, any> = {};
  try {
    data = await response.json();
  } catch {
    // Non-JSON error page; fall through to the generic message.
  }
  if (!response.ok) {
    throw new LeadApiError(data.error || 'Something went wrong. Please try again.', data.code || `http_${response.status}`, data);
  }
  return data;
}
