// Resume AI service — the only module the wizard calls for AI help.
//
// Provider (same switch as the LinkedIn generator):
//   PUBLIC_AI_PROVIDER=supabase (or PUBLIC_LINKEDIN_AI_PROVIDER=supabase)
//     -> the `resume-ai` Supabase Edge Function (Gemini by default).
//   anything else (default) -> the rule-based "template" helpers below:
//     dictionary spell-check + tidy wording, and (expand.ts) extra points
//     describing the typical work — never numbers, results or names.
//
// Contact details (email, phone, links) are never sent to the AI.

import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js';
import { supabase } from '../supabase';
import { cleanText } from '../linkedin/textCleanup';
import { expandPoints, type ExpandContext } from './expand';
import { lines } from './model';
import { spellFix } from './spell';
import { extractKeywords, hasKeyword } from './suggestions';
import { resumeText } from './model';
import type { ResumeData } from './types';

const PROVIDER = (import.meta.env.PUBLIC_AI_PROVIDER || import.meta.env.PUBLIC_LINKEDIN_AI_PROVIDER) === 'supabase' ? 'supabase' : 'template';
export const isTemplateAi = PROVIDER === 'template';

export type ImproveField = 'summary' | 'project' | 'experience' | 'achievement' | 'certification';

export interface EnhanceResult {
  summary: string;
  projects: { id: string; description: string }[];
  experience: { id: string; responsibilities: string }[];
}

export interface JdResult {
  keywords: string[];
  missing: string[];
  suggestions: string[];
}

export class ResumeAiError extends Error {}

/** Resume content for the AI — no contact details. */
function aiPayload(d: ResumeData) {
  return {
    targetRole: d.personal.targetRole,
    summary: d.summary,
    education: d.education.map((e) => ({ degree: e.degree, institution: e.institution, years: [e.startYear, e.endYear].filter(Boolean).join('–'), score: e.score, coursework: e.coursework })),
    skills: Object.values(d.skills).flat(),
    projects: d.projects.map((p) => ({ id: p.id, name: p.name, description: p.description, technologies: p.technologies })),
    experience: d.noExperience ? [] : d.experience.map((e) => ({ id: e.id, type: e.type, title: e.title, company: e.company, responsibilities: e.responsibilities, achievements: e.achievements })),
    certifications: d.certifications.map((c) => ({ name: c.name, issuer: c.issuer, description: c.description })),
    achievements: d.achievements.map((a) => ({ category: a.category, title: a.title, description: a.description })),
  };
}

async function callFunction<T>(body: Record<string, unknown>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new ResumeAiError('You appear to be offline. Reconnect and try again.');
  const { data, error } = await supabase.functions.invoke('resume-ai', { body });
  if (!error) return data as T;
  if (error instanceof FunctionsHttpError) {
    let message = '';
    try {
      message = (await error.context.json())?.error ?? '';
    } catch {
      /* not JSON */
    }
    const status = error.context?.status as number | undefined;
    if (status === 404) throw new ResumeAiError('AI help is not set up yet. Please contact the site administrator.');
    if (status === 401 || status === 403) throw new ResumeAiError('Your session has expired. Please sign in again.');
    throw new ResumeAiError(message || 'AI help is having trouble right now. Please try again.');
  }
  if (error instanceof FunctionsRelayError || error instanceof FunctionsFetchError) {
    throw new ResumeAiError('We could not reach the AI service. Check your connection and try again.');
  }
  throw new ResumeAiError('Something went wrong. Please try again.');
}

// ---------------------------------------------------------------------
// Template (rule-based) helpers — tidy wording only, never add facts.
// ---------------------------------------------------------------------

const VERB_FIXES: [RegExp, string][] = [
  [/^(i|we)\s+/i, ''],
  [/^(have\s+|had\s+)?made\b/i, 'Developed'],
  [/^make\b/i, 'Develop'],
  [/^(have\s+)?did\b/i, 'Completed'],
  [/^(have\s+)?worked on\b/i, 'Worked on'],
  [/^helped\b/i, 'Assisted'],
  [/^(was\s+)?responsible for\b/i, 'Handled'],
  [/^(have\s+)?done\b/i, 'Completed'],
  [/^learnt\b/i, 'Learned'],
  [/^(have\s+)?created\b/i, 'Created'],
  [/^(have\s+)?built\b/i, 'Built'],
  [/^(have\s+)?developed\b/i, 'Developed'],
  [/^(have\s+)?used\b/i, 'Used'],
];

function tidyLine(raw: string): string {
  let line = cleanText(raw).text.trim();
  for (const [re, replacement] of VERB_FIXES) {
    if (re.test(line)) {
      line = line.replace(re, replacement).trim();
      if (replacement === '') continue;
      break;
    }
  }
  line = line.replace(/\bmy\s+/gi, '').replace(/\s{2,}/g, ' ');
  if (!line) return '';
  line = line[0].toUpperCase() + line.slice(1);
  return /[.!?]$/.test(line) ? line : `${line}.`;
}

function tidyBullets(text: string): string {
  // Split long run-on sentences into separate points.
  const parts = lines(text).flatMap((l) => l.split(/(?<=[.!?])\s+(?=[A-Z])/));
  return parts.map(tidyLine).filter(Boolean).join('\n');
}

const humanList = (items: string[]) => (items.length <= 1 ? items[0] ?? '' : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

function templateSummary(d: ResumeData): string {
  const edu = d.education.find((e) => e.degree.trim());
  const year = new Date().getFullYear();
  const studying = edu && (!edu.endYear || Number(edu.endYear) >= year);
  const skills = Object.values(d.skills).flat().slice(0, 5);
  const projects = d.projects.filter((p) => p.name.trim()).slice(0, 2).map((p) => p.name.trim());
  const job = d.noExperience ? undefined : d.experience.find((e) => e.title.trim() && e.company.trim());
  const role = d.personal.targetRole.trim();

  const parts: string[] = [];
  const who = edu ? `${edu.degree.trim()} ${studying ? 'student' : 'graduate'}` : role ? `Aspiring ${role}` : 'Candidate';
  parts.push(skills.length ? `${who} with skills in ${humanList(skills)}.` : `${who}.`);
  if (projects.length) parts.push(`Built projects including ${humanList(projects)}.`);
  if (job) parts.push(`Gained hands-on experience as ${job.title.trim()} at ${job.company.trim()}.`);
  parts.push(role ? `Seeking a ${role} role to apply these skills to real-world problems.` : 'Seeking an opportunity to apply these skills to real-world problems.');
  return parts.join(' ');
}

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------

/** Spell-corrects a title ("Sales Forcasting Dashbord" → "Sales Forecasting Dashboard"). */
export async function correctTitle(title: string): Promise<string> {
  return (await spellFix(title, { mode: 'title' })).text;
}

/** Spell-checks, then tidies each point (template mode). */
async function correctedLines(text: string): Promise<string[]> {
  const { text: fixed } = await spellFix(text);
  return tidyBullets(fixed).split('\n').filter(Boolean);
}

/**
 * "Improve with AI" for one field: fixes spelling and grammar, and — for
 * projects, experience, achievements and certifications — expands the
 * text into fuller points. `context` (title, technologies, category,
 * issuer) lets it write relevant points even from a short or empty text.
 */
export async function improveText(field: ImproveField, text: string, data: ResumeData, context: ExpandContext = {}): Promise<string> {
  if (PROVIDER === 'supabase') {
    const res = await callFunction<{ text: string }>({ action: 'improve', field, text, context, resume: aiPayload(data), jobDescription: data.jobDescription });
    return res.text;
  }
  const started = Date.now();
  let result: string;
  if (field === 'summary') {
    result = text.trim() ? (await correctedLines(text)).join(' ') : templateSummary(data);
  } else {
    const own = text.trim() ? await correctedLines(text) : [];
    const title = context.title ? (await spellFix(context.title, { mode: 'title' })).text : undefined;
    result = expandPoints(field, own, { ...context, title }).join('\n');
  }
  // Keep a short, consistent "working" state so the button feedback is visible.
  await new Promise((r) => setTimeout(r, Math.max(0, 450 - (Date.now() - started))));
  return result;
}

export async function enhanceResume(data: ResumeData): Promise<EnhanceResult> {
  if (PROVIDER === 'supabase') {
    return callFunction<EnhanceResult>({ action: 'enhance', resume: aiPayload(data), jobDescription: data.jobDescription });
  }
  await new Promise((r) => setTimeout(r, 900));
  return {
    summary: data.summary.trim() ? tidyBullets(data.summary).replace(/\n/g, ' ') : templateSummary(data),
    projects: data.projects.filter((p) => p.description.trim()).map((p) => ({ id: p.id, description: tidyBullets(p.description) })),
    experience: data.noExperience ? [] : data.experience.filter((e) => e.responsibilities.trim()).map((e) => ({ id: e.id, responsibilities: tidyBullets(e.responsibilities) })),
  };
}

export async function analyzeJobDescription(data: ResumeData, jobDescription: string): Promise<JdResult> {
  const text = resumeText(data);
  let keywords = extractKeywords(jobDescription);
  let suggestions: string[] = [];
  if (PROVIDER === 'supabase') {
    const res = await callFunction<{ keywords: string[]; suggestions: string[] }>({ action: 'jd', resume: aiPayload(data), jobDescription });
    keywords = Array.from(new Set([...keywords, ...res.keywords]));
    suggestions = res.suggestions;
  } else {
    await new Promise((r) => setTimeout(r, 500));
  }
  const missing = keywords.filter((k) => !hasKeyword(text, k));
  if (!suggestions.length) {
    const present = keywords.filter((k) => hasKeyword(text, k));
    if (present.length) suggestions.push(`Already on your resume: ${present.slice(0, 8).join(', ')}. Make sure your projects show how you used them.`);
    if (missing.length) suggestions.push(`The job also asks for ${missing.slice(0, 8).join(', ')}. Add any you genuinely have to Skills, and mention them in a relevant project.`);
    if (!keywords.length) suggestions.push('No common skill keywords were recognised — check that you pasted the full job description.');
  }
  return { keywords, missing, suggestions };
}
