// ATS score — calculated with fixed, explainable rules (not by AI), so the
// same resume always gets the same score and every point lost comes with
// a concrete suggestion. It estimates how well an applicant-tracking
// system can read the resume and match it to the role; it is not a
// guarantee from any employer's system.

import { lines, resumeText } from './model';
import { extractKeywords, hasKeyword, roleKeywords } from './suggestions';
import type { AtsCategory, AtsResult, ResumeData } from './types';

const ACTION_VERBS = [
  'achieved', 'analysed', 'analyzed', 'architected', 'automated', 'built', 'collaborated', 'conducted', 'created', 'delivered',
  'deployed', 'designed', 'developed', 'engineered', 'enhanced', 'established', 'evaluated', 'executed', 'implemented',
  'improved', 'increased', 'integrated', 'launched', 'led', 'managed', 'mentored', 'modelled', 'modeled', 'optimised',
  'optimized', 'organised', 'organized', 'performed', 'planned', 'prepared', 'presented', 'processed', 'produced',
  'programmed', 'reduced', 'researched', 'resolved', 'streamlined', 'tested', 'trained', 'visualised', 'visualized',
  'wrote', 'cleaned', 'coordinated', 'documented', 'maintained', 'migrated', 'monitored', 'refactored', 'scraped',
  'spearheaded', 'supported', 'validated', 'contributed', 'applied', 'completed', 'identified', 'initiated',
];

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function computeAts(data: ResumeData): AtsResult {
  const text = resumeText(data);
  const suggestions: string[] = [];
  const p = data.personal;
  const skills = Object.values(data.skills).flat();

  // ---- Keyword optimisation ----
  const jdKeywords = extractKeywords(data.jobDescription);
  const targetKeywords = Array.from(new Set([...roleKeywords(p.targetRole), ...jdKeywords]));
  const matched = targetKeywords.filter((k) => hasKeyword(text, k));
  const missing = targetKeywords.filter((k) => !hasKeyword(text, k));
  let keywords: number;
  if (!targetKeywords.length) {
    keywords = 60;
    suggestions.push('Add a target job role (Personal Information) or paste a job description so keywords can be matched.');
  } else {
    keywords = clamp(45 + 55 * Math.min(1, matched.length / targetKeywords.length / 0.7));
    if (missing.length) {
      suggestions.push(`Relevant keywords not on your resume yet: ${missing.slice(0, 8).join(', ')}. Add only the ones you genuinely have.`);
    }
  }

  // ---- Skills relevance ----
  const relevantSkills = targetKeywords.length ? skills.filter((s) => targetKeywords.some((k) => hasKeyword(s, k) || hasKeyword(k, s))) : [];
  const countPart = Math.min(1, skills.length / 10);
  const relevancePart = targetKeywords.length ? Math.min(1, relevantSkills.length / Math.max(3, Math.min(8, targetKeywords.length * 0.4))) : 0.6;
  const skillsScore = clamp(45 * countPart + 55 * relevancePart);
  if (skills.length < 6) suggestions.push('List at least 6–10 skills you can confidently discuss in an interview.');

  // ---- Formatting (templates are ATS-safe; check length and contact basics) ----
  let formatting = 100;
  if (text.length > 7000) {
    formatting -= 12;
    suggestions.push('Your resume is long — aim for one page (fresher) or two pages at most.');
  }
  if (!p.email.trim()) formatting -= 8;
  if (data.projects.some((pr) => pr.name.trim() && !pr.description.trim())) formatting -= 4;

  // ---- Section completeness ----
  const checks: [boolean, number, string][] = [
    [!!p.fullName.trim(), 12, 'Add your full name.'],
    [!!p.email.trim(), 10, 'Add your email address.'],
    [!!p.phone.trim(), 8, 'Add your phone number.'],
    [!!(p.linkedin.trim() || p.github.trim() || p.portfolio.trim()), 6, 'Add a LinkedIn, GitHub or portfolio link.'],
    [data.summary.trim().length >= 80, 14, 'Add a professional summary (2–4 sentences) — Step 8 can draft one from your details.'],
    [data.education.some((e) => e.degree.trim() || e.institution.trim()), 14, 'Add your education.'],
    [skills.length >= 5, 12, 'List at least 6–10 skills you can confidently discuss in an interview.'],
    [data.projects.some((pr) => pr.name.trim()) || (!data.noExperience && data.experience.some((e) => e.company.trim())), 16, 'Add at least one project or experience entry.'],
    [data.certifications.some((c) => c.name.trim()) || data.achievements.some((a) => a.title.trim()), 8, 'Add certifications or achievements if you have any.'],
  ];
  let completeness = 0;
  for (const [ok, weight, tip] of checks) {
    if (ok) completeness += weight;
    else suggestions.push(tip);
  }
  completeness = clamp(completeness);

  // ---- Content quality ----
  const bulletLines = [
    ...data.projects.flatMap((pr) => lines(pr.description)),
    ...(data.noExperience ? [] : data.experience.flatMap((e) => lines(e.responsibilities))),
  ];
  let quality = 100;
  if (bulletLines.length) {
    const strong = bulletLines.filter((l) => ACTION_VERBS.includes(l.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, ''))).length;
    const ratio = strong / bulletLines.length;
    if (ratio < 0.7) {
      quality -= Math.round((0.7 - ratio) * 50);
      suggestions.push('Start project and experience points with action verbs (Developed, Built, Analysed…). "Improve with AI" can help.');
    }
    const short = bulletLines.filter((l) => l.length < 30).length;
    if (short) {
      quality -= Math.min(15, short * 4);
      suggestions.push('Some descriptions are very short — say what you did, with which tools, and the outcome you know of.');
    }
  } else {
    quality -= 25;
  }
  const firstPerson = /(^|\s)(I|my|me)\s/i;
  if (firstPerson.test(data.summary) || bulletLines.some((l) => firstPerson.test(` ${l}`))) {
    quality -= 10;
    suggestions.push('Avoid first-person words ("I", "my") — resumes use implied first person.');
  }
  const summaryLen = data.summary.trim().length;
  if (summaryLen && (summaryLen < 150 || summaryLen > 750)) {
    quality -= 8;
    suggestions.push('Keep the summary to about 2–4 sentences (150–750 characters).');
  }
  quality = clamp(quality);

  const categories: AtsCategory[] = [
    { key: 'keywords', label: 'Keyword Optimization', score: keywords },
    { key: 'skills', label: 'Skills Relevance', score: skillsScore },
    { key: 'formatting', label: 'Formatting', score: clamp(formatting) },
    { key: 'completeness', label: 'Section Completeness', score: completeness },
    { key: 'quality', label: 'Content Quality', score: quality },
  ];
  const weights = { keywords: 0.25, skills: 0.2, formatting: 0.15, completeness: 0.2, quality: 0.2 };
  const score = clamp(categories.reduce((n, c) => n + c.score * weights[c.key], 0));

  return {
    score,
    categories,
    suggestions: Array.from(new Set(suggestions)).slice(0, 8),
    matchedKeywords: matched,
    missingKeywords: missing,
    computedAt: new Date().toISOString(),
  };
}
