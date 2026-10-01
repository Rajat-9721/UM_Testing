// Resume templates — presentation only.
//
// A template is a small settings object; one renderer per output (HTML
// preview, PDF, DOCX) reads it, so every template looks the same on
// screen and in both downloads. Adding a template = adding an entry here.
// The registry shape (id / name / description / layout / fonts) is
// adapted from Resumify's TEMPLATE_CONFIGS (MIT, © 2025 M. H. A. Afif).
//
// ATS rules every template follows: real text only (no images, icons,
// charts or skill bars), standard section headings, simple structure,
// common fonts.

import type { SectionId, TemplateId } from './types';

export type HeadingStyle = 'rule' | 'bar' | 'caps' | 'underline';

export interface TemplateConfig {
  id: TemplateId;
  name: string;
  description: string;
  /** 'sidebar' = a narrow left column for the listed sideSections. */
  layout: 'single' | 'sidebar';
  font: 'serif' | 'sans';
  /** Hex colour for headings and rules. */
  accent: string;
  headerAlign: 'left' | 'center';
  headingStyle: HeadingStyle;
  nameUppercase: boolean;
  /** Default section order (the student can reorder). */
  order: SectionId[];
  sideSections?: SectionId[];
  skillsStyle: 'grouped' | 'inline';
  titles?: Partial<Record<SectionId, string>>;
}

export const TEMPLATES: TemplateConfig[] = [
  {
    id: 'classic',
    name: 'Classic Professional',
    description: 'Simple, clean and suitable for corporate roles.',
    layout: 'single',
    font: 'serif',
    accent: '#1f2937',
    headerAlign: 'center',
    headingStyle: 'rule',
    nameUppercase: true,
    order: ['summary', 'experience', 'projects', 'education', 'skills', 'certifications', 'achievements', 'custom'],
    skillsStyle: 'grouped',
  },
  {
    id: 'modern',
    name: 'Modern Minimal',
    description: 'Airy layout with a subtle accent for any role.',
    layout: 'single',
    font: 'sans',
    accent: '#2b5246',
    headerAlign: 'left',
    headingStyle: 'bar',
    nameUppercase: false,
    order: ['summary', 'skills', 'experience', 'projects', 'education', 'certifications', 'achievements', 'custom'],
    skillsStyle: 'inline',
  },
  {
    id: 'technical',
    name: 'Technical',
    description: 'Skills and projects up front for engineering roles.',
    layout: 'single',
    font: 'sans',
    accent: '#1e3a5f',
    headerAlign: 'left',
    headingStyle: 'caps',
    nameUppercase: false,
    order: ['summary', 'skills', 'projects', 'experience', 'education', 'certifications', 'achievements', 'custom'],
    skillsStyle: 'grouped',
    titles: { skills: 'Technical Skills' },
  },
  {
    id: 'fresher',
    name: 'Fresher / Student',
    description: 'Education, projects and achievements first for freshers.',
    layout: 'single',
    font: 'sans',
    accent: '#3e6b5c',
    headerAlign: 'center',
    headingStyle: 'underline',
    nameUppercase: false,
    order: ['summary', 'education', 'skills', 'projects', 'certifications', 'achievements', 'experience', 'custom'],
    skillsStyle: 'grouped',
    titles: { summary: 'Career Objective' },
  },
  {
    id: 'dataScience',
    name: 'Data Science / AI',
    description: 'Highlights tools, models and data projects.',
    layout: 'single',
    font: 'sans',
    accent: '#1b3d34',
    headerAlign: 'left',
    headingStyle: 'rule',
    nameUppercase: false,
    order: ['summary', 'skills', 'projects', 'experience', 'education', 'certifications', 'achievements', 'custom'],
    skillsStyle: 'grouped',
    titles: { skills: 'Technical Skills', projects: 'Data Science Projects' },
  },
  {
    id: 'twoColumn',
    name: 'Professional Two-Column',
    description: 'Compact sidebar for skills, education and certifications.',
    layout: 'sidebar',
    font: 'sans',
    accent: '#334155',
    headerAlign: 'left',
    headingStyle: 'caps',
    nameUppercase: false,
    order: ['summary', 'experience', 'projects', 'achievements', 'custom', 'skills', 'education', 'certifications'],
    sideSections: ['skills', 'education', 'certifications'],
    skillsStyle: 'grouped',
  },
];

export const DEFAULT_TEMPLATE: TemplateId = 'classic';

export function getTemplate(id: string | null | undefined): TemplateConfig {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}

export const DEFAULT_TITLES: Record<SectionId, string> = {
  summary: 'Professional Summary',
  education: 'Education',
  skills: 'Skills',
  projects: 'Projects',
  experience: 'Experience',
  certifications: 'Certifications',
  achievements: 'Achievements',
  custom: 'Additional',
};

export const SECTION_LABELS: Record<SectionId, string> = {
  summary: 'Summary',
  education: 'Education',
  skills: 'Skills',
  projects: 'Projects',
  experience: 'Experience',
  certifications: 'Certifications',
  achievements: 'Achievements',
  custom: 'Additional sections',
};
