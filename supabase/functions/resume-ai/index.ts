// Supabase Edge Function: resume-ai
//
// POST { action: 'improve', field, text, context, resume } -> { text }  (fixes spelling; expands into points)
// POST { action: 'enhance', resume }               -> { summary, projects[{id,description}], experience[{id,responsibilities}] }
// POST { action: 'jd', resume, jobDescription }    -> { keywords[], suggestions[] }
//
// Students only (trusted profiles.role; withdrawn students refused).
// Uses the same AI provider setup as linkedin-generate (Gemini by
// default — see ../_shared/providers.ts); keys live only in secrets.
// The browser never sends contact details — only resume content.
//
// Deploy:   supabase functions deploy resume-ai

import { createClient } from 'npm:@supabase/supabase-js@2';
import { generateJson, ProviderError } from '../_shared/providers.ts';
import { ENHANCE_SCHEMA, enhanceMessage, IMPROVE_SCHEMA, improveMessage, JD_SCHEMA, jdMessage, SYSTEM_PROMPT } from './prompt.ts';

const HOURLY_LIMIT = 60;
const FIELDS = ['summary', 'project', 'experience', 'achievement', 'certification'];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// Keeps only resume content, bounded in size. Contact details are never
// needed by the AI and are dropped even if a client sends them.
function cleanResume(raw: any) {
  const list = (v: unknown, max: number) => (Array.isArray(v) ? v.slice(0, max) : []);
  const s = (v: unknown, max = 600) => str(v, max);
  return {
    targetRole: s(raw?.targetRole, 80),
    summary: s(raw?.summary, 1200),
    education: list(raw?.education, 6).map((e: any) => ({ degree: s(e?.degree, 150), institution: s(e?.institution, 150), years: s(e?.years, 40), score: s(e?.score, 40), coursework: s(e?.coursework, 300) })),
    skills: list(raw?.skills, 60).map((k: unknown) => s(k, 50)).filter(Boolean),
    projects: list(raw?.projects, 10).map((p: any) => ({ id: s(p?.id, 20), name: s(p?.name, 150), description: s(p?.description, 1500), technologies: list(p?.technologies, 20).map((t: unknown) => s(t, 50)) })),
    experience: list(raw?.experience, 10).map((e: any) => ({ id: s(e?.id, 20), type: s(e?.type, 40), title: s(e?.title, 120), company: s(e?.company, 120), responsibilities: s(e?.responsibilities, 1500), achievements: s(e?.achievements, 800) })),
    certifications: list(raw?.certifications, 15).map((c: any) => ({ name: s(c?.name, 150), issuer: s(c?.issuer, 120), description: s(c?.description, 600) })),
    achievements: list(raw?.achievements, 15).map((a: any) => ({ category: s(a?.category, 40), title: s(a?.title, 200), description: s(a?.description, 400) })),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  // ---- 1. Authenticate: signed-in, non-withdrawn student ----
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Please sign in again.' }, 401);
  const publicKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, publicKey!, { global: { headers: { Authorization: authHeader } } });

  const { data: userData, error: userError } = await supabase.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
  if (userError || !userData?.user) return json({ error: 'Please sign in again.' }, 401);
  const userId = userData.user.id;

  const { data: role } = await supabase.rpc('current_role');
  if (role !== 'student') return json({ error: 'You do not have access to this feature.' }, 403);
  const { data: profile } = await supabase.from('profiles').select('withdrawn_at').eq('id', userId).single();
  if (!profile || profile.withdrawn_at) return json({ error: 'You do not have access to this feature.' }, 403);

  // ---- 2. Validate ----
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  const action = body?.action;
  if (!['improve', 'enhance', 'jd'].includes(action)) return json({ error: 'Invalid request.' }, 400);
  const resume = cleanResume(body?.resume);
  const jobDescription = str(body?.jobDescription, 6000);

  // ---- 3. Hourly limit (skipped if the usage table isn't set up yet) ----
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await supabase
    .from('resume_ai_usage')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', since);
  if (!countError && (count ?? 0) >= HOURLY_LIMIT) {
    return json({ error: 'You have used AI help a lot in the last hour. Please try again a little later.' }, 429);
  }
  if (!countError) await supabase.from('resume_ai_usage').insert({ user_id: userId, action });

  // ---- 4. Generate ----
  const env = (name: string) => Deno.env.get(name);
  try {
    if (action === 'improve') {
      const field = FIELDS.includes(body?.field) ? body.field : null;
      if (!field) return json({ error: 'Invalid request.' }, 400);
      const text = str(body?.text, 2000);
      const c = body?.context ?? {};
      const context = {
        title: str(c.title, 200),
        technologies: (Array.isArray(c.technologies) ? c.technologies : []).slice(0, 20).map((t: unknown) => str(t, 50)).filter(Boolean),
        category: str(c.category, 40),
        issuer: str(c.issuer, 120),
        role: str(c.role, 120),
      };
      if (!text && !context.title && field !== 'summary') return json({ error: 'Add a title or a short description first.' }, 400);
      const out: any = await generateJson({ system: SYSTEM_PROMPT, user: improveMessage(field, text, context, resume, resume.targetRole, jobDescription), schema: IMPROVE_SCHEMA }, env);
      const improved = str(out?.text, 2500);
      if (!improved) return json({ error: 'The AI returned an empty result. Please try again.' }, 502);
      return json({ text: improved });
    }

    if (action === 'enhance') {
      if (!resume.projects.length && !resume.experience.length && !resume.education.length && !resume.skills.length) {
        return json({ error: 'Add some details first — education, skills or projects.' }, 400);
      }
      const out: any = await generateJson({ system: SYSTEM_PROMPT, user: enhanceMessage(resume, resume.targetRole, jobDescription), schema: ENHANCE_SCHEMA }, env);
      const projectIds = new Set(resume.projects.map((p) => p.id));
      const experienceIds = new Set(resume.experience.map((e) => e.id));
      return json({
        summary: str(out?.summary, 1200),
        projects: (Array.isArray(out?.projects) ? out.projects : []).filter((p: any) => projectIds.has(p?.id)).map((p: any) => ({ id: p.id, description: str(p.description, 2000) })),
        experience: (Array.isArray(out?.experience) ? out.experience : []).filter((e: any) => experienceIds.has(e?.id)).map((e: any) => ({ id: e.id, responsibilities: str(e.responsibilities, 2000) })),
      });
    }

    // action === 'jd'
    if (jobDescription.length < 40) return json({ error: 'Paste the full job description first.' }, 400);
    const out: any = await generateJson({ system: SYSTEM_PROMPT, user: jdMessage(resume, jobDescription), schema: JD_SCHEMA }, env);
    const clean = (v: unknown, max: number, len: number) =>
      (Array.isArray(v) ? v : []).filter((x) => typeof x === 'string' && x.trim()).map((x: string) => x.trim().slice(0, len)).slice(0, max);
    return json({ keywords: clean(out?.keywords, 25, 60), suggestions: clean(out?.suggestions, 8, 300) });
  } catch (error) {
    console.error('resume-ai:', error instanceof Error ? error.message : error);
    const kind = error instanceof ProviderError ? error.kind : 'failed';
    if (kind === 'not_configured') return json({ error: 'The AI writing service is not configured.' }, 500);
    if (kind === 'rate_limited') return json({ error: 'The AI writing service is busy right now. Please try again in a minute.' }, 429);
    if (kind === 'refused') return json({ error: 'This text could not be processed. Please rephrase it and try again.' }, 422);
    return json({ error: 'The AI writing service is having trouble right now.' }, 502);
  }
});
