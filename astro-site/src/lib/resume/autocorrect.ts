// Whole-resume autocorrect. Every text field in ResumeData is listed here
// with how carefully it may be corrected (see SpellMode in spell.ts).
// Never touched: the student's own name, email, phone, links, dates,
// scores and pasted job descriptions.

import { spellFix, type SpellMode } from './spell';
import type { ResumeData } from './types';

export interface AutoFix {
  where: string;
  from: string;
  to: string;
}

interface FieldRef {
  where: string;
  mode: SpellMode;
  get: () => string;
  set: (v: string) => void;
}

function fields(d: ResumeData): FieldRef[] {
  const f: FieldRef[] = [];
  const add = (where: string, mode: SpellMode, get: () => string, set: (v: string) => void) => f.push({ where, mode, get, set });
  const p = d.personal;

  add('Target job role', 'title', () => p.targetRole, (v) => (p.targetRole = v));
  add('Location', 'safe', () => p.location, (v) => (p.location = v));
  add('Summary', 'prose', () => d.summary, (v) => (d.summary = v));

  d.education.forEach((e, i) => {
    const n = e.degree || `Education ${i + 1}`;
    add(`${n} — degree`, 'title', () => e.degree, (v) => (e.degree = v));
    add(`${n} — college`, 'safe', () => e.institution, (v) => (e.institution = v));
    add(`${n} — coursework`, 'title', () => e.coursework, (v) => (e.coursework = v));
  });

  for (const key of Object.keys(d.skills) as (keyof typeof d.skills)[]) {
    d.skills[key].forEach((_, i) => add('Skills', 'safe', () => d.skills[key][i], (v) => (d.skills[key][i] = v)));
  }

  d.projects.forEach((pr, i) => {
    const n = pr.name || `Project ${i + 1}`;
    add(`${n} — name`, 'title', () => pr.name, (v) => (pr.name = v));
    add(`${n} — description`, 'prose', () => pr.description, (v) => (pr.description = v));
    pr.technologies.forEach((_, j) => add(`${n} — technologies`, 'safe', () => pr.technologies[j], (v) => (pr.technologies[j] = v)));
  });

  d.experience.forEach((e, i) => {
    const n = e.title || e.company || `Experience ${i + 1}`;
    add(`${n} — job title`, 'title', () => e.title, (v) => (e.title = v));
    add(`${n} — company`, 'safe', () => e.company, (v) => (e.company = v));
    add(`${n} — location`, 'safe', () => e.location, (v) => (e.location = v));
    add(`${n} — responsibilities`, 'prose', () => e.responsibilities, (v) => (e.responsibilities = v));
    add(`${n} — achievements`, 'prose', () => e.achievements, (v) => (e.achievements = v));
  });

  d.certifications.forEach((c, i) => {
    const n = c.name || `Certification ${i + 1}`;
    add(`${n} — name`, 'title', () => c.name, (v) => (c.name = v));
    add(`${n} — issuer`, 'safe', () => c.issuer, (v) => (c.issuer = v));
    add(`${n} — details`, 'prose', () => c.description, (v) => (c.description = v));
  });

  d.achievements.forEach((a, i) => {
    const n = a.title || `Achievement ${i + 1}`;
    add(`${n} — title`, 'title', () => a.title, (v) => (a.title = v));
    add(`${n} — details`, 'prose', () => a.description, (v) => (a.description = v));
  });

  d.customSections.forEach((c, i) => {
    const n = c.title || `Section ${i + 1}`;
    add(`${n} — title`, 'title', () => c.title, (v) => (c.title = v));
    add(`${n} — items`, 'prose', () => c.content, (v) => (c.content = v));
  });

  return f;
}

/**
 * Corrects spelling across the whole resume IN PLACE and returns every
 * change made (for the summary and "Undo all").
 */
export async function autocorrectResume(d: ResumeData): Promise<AutoFix[]> {
  const fixes: AutoFix[] = [];
  for (const field of fields(d)) {
    const before = field.get();
    if (!before?.trim()) continue;
    const { text, fixes: found } = await spellFix(before, { mode: field.mode });
    if (text !== before) {
      field.set(text);
      for (const f of found) fixes.push({ where: field.where, ...f });
    }
  }
  // Skill lists may now contain duplicates ("pyhton" → "Python" next to "Python").
  for (const key of Object.keys(d.skills) as (keyof typeof d.skills)[]) {
    d.skills[key] = d.skills[key].filter((s, i, all) => all.findIndex((x) => x.toLowerCase() === s.toLowerCase()) === i);
  }
  return fixes;
}

/** Corrects a single field's text (used when the student leaves a field). */
export async function autocorrectText(text: string, mode: SpellMode) {
  if (!text.trim()) return { text, fixes: [] as { from: string; to: string }[] };
  return spellFix(text, { mode });
}
