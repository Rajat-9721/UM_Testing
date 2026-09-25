// Builds the render-ready resume structure (RDoc) from ResumeData + a
// template. The HTML preview, PDF and DOCX renderers all draw this same
// structure, which is what keeps the preview identical to the downloads.

import { DEFAULT_TITLES, getTemplate, type TemplateConfig } from './templates';
import { SKILL_GROUPS, type ResumeData, type SectionId, type SectionSetting, type TemplateId } from './types';

export interface RLink {
  text: string;
  url?: string;
}

export type RBlock =
  | { type: 'text'; text: string }
  | { type: 'bullets'; items: string[] }
  | { type: 'skills'; groups: { label: string; items: string[] }[]; inline: boolean }
  | {
      type: 'entry';
      heading: string;
      subheading?: string;
      meta?: string;
      links?: RLink[];
      text?: string;
      bullets: string[];
    };

export interface RSection {
  id: string;
  kind: SectionId;
  title: string;
  blocks: RBlock[];
}

export interface RDoc {
  cfg: TemplateConfig;
  name: string;
  role: string;
  contacts: RLink[];
  main: RSection[];
  side: RSection[];
  /** True when name/role are placeholders (preview of an empty resume). */
  placeholder: boolean;
}

const clean = (s: string | undefined | null) => (s ?? '').trim();
export const lines = (s: string) =>
  clean(s)
    .split('\n')
    .map((l) => l.trim().replace(/^[•\-*→]\s*/, ''))
    .filter(Boolean);

const range = (a: string, b: string, current = false) => {
  const start = clean(a);
  const end = current ? 'Present' : clean(b);
  if (start && end) return start === end ? start : `${start} – ${end}`;
  return start || end;
};

const displayUrl = (url: string) => url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
const hrefFor = (url: string) => (/^https?:\/\//i.test(url) ? url : `https://${url}`);

/** Order + visibility: the student's own choice, else the template default. */
export function resolveSections(data: ResumeData, cfg: TemplateConfig): SectionSetting[] {
  const defaults = cfg.order;
  if (!data.sections) return defaults.map((id) => ({ id, visible: true }));
  const known = new Set(data.sections.map((s) => s.id));
  return [...data.sections, ...defaults.filter((id) => !known.has(id)).map((id) => ({ id, visible: true }))];
}

function buildSection(kind: SectionId, data: ResumeData, cfg: TemplateConfig): RSection[] {
  const title = cfg.titles?.[kind] ?? DEFAULT_TITLES[kind];
  const one = (blocks: RBlock[]): RSection[] => (blocks.length ? [{ id: kind, kind, title, blocks }] : []);

  switch (kind) {
    case 'summary':
      return one(clean(data.summary) ? [{ type: 'text', text: clean(data.summary) }] : []);

    case 'education':
      return one(
        data.education
          .filter((e) => clean(e.degree) || clean(e.institution))
          .map((e) => ({
            type: 'entry' as const,
            heading: clean(e.degree) || clean(e.institution),
            subheading: clean(e.degree) ? clean(e.institution) : undefined,
            meta: range(e.startYear, e.endYear),
            bullets: [clean(e.score) && `Score: ${clean(e.score)}`, clean(e.coursework) && `Relevant coursework: ${clean(e.coursework)}`].filter(Boolean) as string[],
          })),
      );

    case 'skills': {
      const groups = SKILL_GROUPS.map((g) => ({ label: g.label, items: data.skills[g.key].map(clean).filter(Boolean) })).filter((g) => g.items.length);
      return one(groups.length ? [{ type: 'skills', groups, inline: cfg.skillsStyle === 'inline' }] : []);
    }

    case 'projects':
      return one(
        data.projects
          .filter((p) => clean(p.name) || clean(p.description))
          .map((p) => {
            const links: RLink[] = [];
            if (clean(p.githubUrl)) links.push({ text: displayUrl(clean(p.githubUrl)), url: hrefFor(clean(p.githubUrl)) });
            if (clean(p.liveUrl)) links.push({ text: displayUrl(clean(p.liveUrl)), url: hrefFor(clean(p.liveUrl)) });
            const tech = p.technologies.map(clean).filter(Boolean);
            return {
              type: 'entry' as const,
              heading: clean(p.name) || 'Project',
              subheading: tech.length ? `Technologies: ${tech.join(', ')}` : undefined,
              meta: clean(p.duration),
              links,
              bullets: lines(p.description),
            };
          }),
      );

    case 'experience':
      if (data.noExperience) return [];
      return one(
        data.experience
          .filter((e) => clean(e.company) || clean(e.title))
          .map((e) => ({
            type: 'entry' as const,
            heading: [clean(e.title), clean(e.company)].filter(Boolean).join(' — '),
            subheading: [e.type !== 'Work Experience' ? e.type : '', clean(e.location)].filter(Boolean).join(' · ') || undefined,
            meta: range(e.startDate, e.endDate, e.current),
            bullets: [...lines(e.responsibilities), ...lines(e.achievements)],
          })),
      );

    case 'certifications':
      return one(
        data.certifications
          .filter((c) => clean(c.name))
          .map((c) => ({
            type: 'entry' as const,
            heading: clean(c.name),
            subheading: clean(c.issuer) || undefined,
            meta: clean(c.date),
            links: clean(c.url) ? [{ text: displayUrl(clean(c.url)), url: hrefFor(clean(c.url)) }] : [],
            bullets: lines(c.description),
          })),
      );

    case 'achievements':
      return one(
        data.achievements
          .filter((a) => clean(a.title))
          .map((a) => ({
            type: 'entry' as const,
            heading: clean(a.title),
            subheading: a.category,
            meta: clean(a.date),
            bullets: lines(a.description),
          })),
      );

    case 'custom':
      return data.customSections
        .filter((c) => clean(c.title) && lines(c.content).length)
        .map((c) => ({ id: `custom-${c.id}`, kind: 'custom' as const, title: clean(c.title), blocks: [{ type: 'bullets' as const, items: lines(c.content) }] }));
  }
}

export function buildDoc(data: ResumeData, templateId: TemplateId, opts: { placeholders?: boolean } = {}): RDoc {
  const cfg = getTemplate(templateId);
  const p = data.personal;
  const contacts: RLink[] = [];
  if (clean(p.email)) contacts.push({ text: clean(p.email), url: `mailto:${clean(p.email)}` });
  if (clean(p.phone)) contacts.push({ text: clean(p.phone) });
  if (clean(p.location)) contacts.push({ text: clean(p.location) });
  for (const url of [p.linkedin, p.github, p.portfolio]) {
    if (clean(url)) contacts.push({ text: displayUrl(clean(url)), url: hrefFor(clean(url)) });
  }

  const main: RSection[] = [];
  const side: RSection[] = [];
  for (const s of resolveSections(data, cfg)) {
    if (!s.visible) continue;
    const built = buildSection(s.id, data, cfg);
    const target = cfg.layout === 'sidebar' && cfg.sideSections?.includes(s.id) ? side : main;
    target.push(...built);
  }

  const placeholder = !!opts.placeholders && !clean(p.fullName);
  return {
    cfg,
    name: clean(p.fullName) || (opts.placeholders ? 'Your Name' : ''),
    role: clean(p.targetRole) || (opts.placeholders && !clean(p.fullName) ? 'Target Job Role' : ''),
    contacts: contacts.length || !opts.placeholders ? contacts : [{ text: 'email@example.com' }, { text: 'Phone' }, { text: 'City' }],
    main,
    side,
    placeholder,
  };
}

/** Plain text of the whole resume — used for keyword matching. */
export function resumeText(data: ResumeData): string {
  const skills = Object.values(data.skills).flat();
  return [
    data.personal.targetRole,
    data.summary,
    ...data.education.flatMap((e) => [e.degree, e.institution, e.coursework]),
    ...skills,
    ...data.projects.flatMap((p) => [p.name, p.description, ...p.technologies]),
    ...(data.noExperience ? [] : data.experience.flatMap((e) => [e.title, e.company, e.responsibilities, e.achievements])),
    ...data.certifications.flatMap((c) => [c.name, c.issuer, c.description]),
    ...data.achievements.flatMap((a) => [a.title, a.description]),
    ...data.customSections.flatMap((c) => [c.title, c.content]),
  ]
    .filter(Boolean)
    .join('\n');
}
