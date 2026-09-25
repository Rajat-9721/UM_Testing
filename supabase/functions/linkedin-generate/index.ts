// Supabase Edge Function: linkedin-generate
//
// POST { input: GeneratorInput, variations: string[] }
//   -> 200 { posts: [{ key, title, content, hashtags, cta, characterCount }] }
//
// 1. Verifies the caller's Supabase session and TRUSTED role
//    (public.current_role(), i.e. profiles.role — never user_metadata).
// 2. Re-validates every input field server-side (the browser is untrusted).
// 3. Calls the configured AI provider — Gemini (default), OpenAI or
//    Claude, see ../_shared/providers.ts — with a key held only in this function's
//    secrets.
//
// Deploy:   supabase functions deploy linkedin-generate
// Secrets (Gemini, the default):
//           supabase secrets set GEMINI_API_KEY=...
// or OpenAI:
//           supabase secrets set LLM_PROVIDER=openai OPENAI_API_KEY=...
// Optional: GEMINI_MODEL / OPENAI_MODEL / ANTHROPIC_MODEL to pick a model.
// SUPABASE_URL and SUPABASE_ANON_KEY are provided automatically.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildUserMessage, schemaFor, SYSTEM_PROMPT, VARIATION_BRIEFS, type CleanInput } from './prompt.ts';
import { generateJson, ProviderError } from '../_shared/providers.ts';

// Roles allowed to use the generator (keep in sync with the RLS policies
// in phase9_linkedin_generator.sql).
const ALLOWED_ROLES = ['assistant', 'student'];

const HOURLY_GENERATION_LIMIT = 30;

const ASSISTANT_PURPOSES = [
  'Student Achievement', 'Event Promotion', 'Course Promotion', 'Workshop Announcement', 'Academy Update',
  'Student Success Story', 'Industry Collaboration', 'Educational Insight', 'General Announcement',
];
const STUDENT_POST_TYPES = [
  'Achievement', 'Certification', 'Internship', 'Project', 'Workshop', 'Event', 'Learning', 'Hackathon',
  'Career Update', 'General Professional Post',
];
const TONES = ['Professional', 'Friendly', 'Inspirational', 'Storytelling', 'Confident', 'Humble', 'Thought Leadership'];
const AUDIENCES = ['Recruiters', 'Industry Professionals', 'Students', 'General LinkedIn Audience', 'Faculty / Mentors'];
const LANGUAGES = ['English', 'Hindi', 'Hinglish'];
const LENGTHS = ['short', 'medium', 'detailed'];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const oneOf = (v: unknown, allowed: string[]) => (typeof v === 'string' && allowed.includes(v) ? v : null);

function cleanInput(raw: any, role: 'assistant' | 'student'): CleanInput | string {
  const topic = str(raw?.topic, 500);
  if (topic.length < 10) return 'Please describe the topic in at least a short sentence.';
  // Each role picks from its own list; the role comes from the trusted
  // profile, never from the request body.
  const purpose = oneOf(raw?.purpose, role === 'student' ? STUDENT_POST_TYPES : ASSISTANT_PURPOSES);
  const tone = oneOf(raw?.tone, TONES);
  const audience = oneOf(raw?.audience, AUDIENCES);
  const language = oneOf(raw?.language, LANGUAGES);
  const length = oneOf(raw?.length, LENGTHS);
  if (!purpose || !tone || !audience || !language || !length) return 'Some of the selected options are invalid.';
  const keywords = Array.isArray(raw?.keywords)
    ? raw.keywords.map((k: unknown) => str(k, 40)).filter(Boolean).slice(0, 10)
    : [];
  return {
    role,
    purpose,
    topic,
    tone,
    audience,
    language,
    length,
    keywords,
    details: str(raw?.details, 2000),
    includeHashtags: raw?.includeHashtags !== false,
    includeCta: raw?.includeCta === true,
    mentionAcademy: raw?.mentionAcademy !== false,
  };
}

const toTag = (word: string) => {
  const camel = word
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => (w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1)))
    .join('');
  return camel.length > 1 ? `#${camel}` : '';
};

/**
 * Cleans the model's hashtags (one "#Word" each, no spaces, no
 * duplicates, max 5) and tops them up to at least 3 from the user's own
 * keywords and the academy tag, so a post never ships with one lone tag.
 */
function normaliseHashtags(raw: unknown, input: CleanInput): string[] {
  const tags = (Array.isArray(raw) ? raw : [])
    .filter((h): h is string => typeof h === 'string')
    .map((h) => toTag(h.replace(/^#+/, '')))
    .filter(Boolean);
  const has = (list: string[], t: string) => list.some((x) => x.toLowerCase() === t.toLowerCase());

  // The model's own choices first (deduplicated, max 5)…
  const out: string[] = [];
  for (const t of tags) if (!has(out, t) && out.length < 5) out.push(t);

  // …then fill up to 3 from the user's keywords and the academy tag.
  const extras = [...input.keywords.map(toTag), input.mentionAcademy ? '#UtkarshMinds' : ''].filter(Boolean);
  for (const t of extras) if (out.length < 3 && !has(out, t)) out.push(t);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  // ---- 1. Authenticate + authorise with the caller's own JWT ----
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Please sign in again.' }, 401);

  // Projects on Supabase's newer API keys may expose the publishable key
  // under a different name; either works for a user-scoped client.
  const publicKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, publicKey!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
  if (userError || !userData?.user) return json({ error: 'Please sign in again.' }, 401);

  const { data: role, error: roleError } = await supabase.rpc('current_role');
  if (roleError || !ALLOWED_ROLES.includes(role)) {
    return json({ error: 'You do not have access to this feature.' }, 403);
  }

  // Withdrawn students are treated as signed out everywhere else in the
  // app (getTrustedSession); the server applies the same rule.
  if (role === 'student') {
    const { data: profile } = await supabase.from('profiles').select('withdrawn_at').eq('id', userData.user.id).single();
    if (!profile || profile.withdrawn_at) return json({ error: 'You do not have access to this feature.' }, 403);
  }

  // ---- 2. Soft rate limit, based on saved generations in the last hour ----
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await supabase
    .from('linkedin_generations')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userData.user.id)
    .gte('created_at', since);
  // A missing history table just means no limit can be computed.
  if (!countError && (count ?? 0) >= HOURLY_GENERATION_LIMIT) {
    return json({ error: 'You have reached the hourly limit for generating posts. Please try again later.' }, 429);
  }

  // ---- 3. Validate the request body ----
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  const input = cleanInput(body?.input, role);
  if (typeof input === 'string') return json({ error: input }, 400);

  const requested: string[] = Array.isArray(body?.variations) ? body.variations : [];
  const variationKeys = Array.from(new Set(requested.filter((k) => typeof k === 'string' && k in VARIATION_BRIEFS))).slice(0, 5);
  if (!variationKeys.length) return json({ error: 'Invalid request.' }, 400);

  // ---- 4. Generate with the configured provider (Gemini / OpenAI / Claude) ----
  const env = (name: string) => Deno.env.get(name);
  const ask = (keys: string[]) =>
    generateJson({ system: SYSTEM_PROMPT, user: buildUserMessage(input, keys), schema: schemaFor(keys.length, input.includeHashtags) }, env);

  const byKey = new Map<string, any>();
  const collect = (parsed: any, keys: string[]) => {
    const list: any[] = Array.isArray(parsed?.posts) ? parsed.posts : [];
    keys.forEach((key, i) => {
      // Match by key; fall back to position only when the counts line up.
      const item = list.find((p) => p?.key === key) ?? (list.length === keys.length ? list[i] : undefined);
      if (item && typeof item.content === 'string' && item.content.trim()) byKey.set(key, item);
    });
  };

  try {
    collect(await ask(variationKeys), variationKeys);
    // Models occasionally return fewer posts than asked — request just the
    // missing variations once.
    const missing = variationKeys.filter((k) => !byKey.has(k));
    if (missing.length && byKey.size) {
      try {
        collect(await ask(missing), missing);
      } catch (error) {
        console.error('linkedin-generate: follow-up for missing variations failed:', error instanceof Error ? error.message : error);
      }
    } else if (missing.length) {
      collect(await ask(missing), missing);
    }
  } catch (error) {
    // Full details go to the function logs only; users get a friendly message.
    console.error('linkedin-generate:', error instanceof Error ? error.message : error);
    const kind = error instanceof ProviderError ? error.kind : 'failed';
    switch (kind) {
      case 'not_configured':
        return json({ error: 'The AI writing service is not configured.' }, 500);
      case 'rate_limited':
        return json({ error: 'The AI writing service is busy right now. Please try again in a minute.' }, 429);
      case 'refused':
        return json({ error: 'This request could not be written up. Please rephrase the topic and try again.' }, 422);
      case 'truncated':
        return json({ error: 'The response was cut short. Please try a shorter length.' }, 502);
      default:
        return json({ error: 'The AI writing service is having trouble right now.' }, 502);
    }
  }

  const posts = variationKeys
    .map((key) => {
      const item = byKey.get(key);
      if (!item) return null;
      const hashtags: string[] = input.includeHashtags ? normaliseHashtags(item.hashtags, input) : [];
      const content = item.content.trim();
      const full = hashtags.length ? `${content}\n\n${hashtags.join(' ')}` : content;
      return {
        key,
        title: VARIATION_BRIEFS[key].title,
        content,
        hashtags,
        cta: input.includeCta && typeof item.cta === 'string' && item.cta.trim() ? item.cta.trim() : null,
        characterCount: full.length,
      };
    })
    .filter(Boolean);

  if (!posts.length) return json({ error: 'The AI returned an unexpected response.' }, 502);
  return json({ posts });
});
