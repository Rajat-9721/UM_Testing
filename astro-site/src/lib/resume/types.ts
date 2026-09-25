// Resume Generator — data model.
//
// Resume CONTENT (ResumeData) is kept completely separate from resume
// PRESENTATION (TemplateId → TemplateConfig in templates.ts): the same
// ResumeData renders through any template, and switching templates never
// touches the content. This split follows Resumify's architecture
// (MIT, © 2025 M. H. A. Afif — see THIRD_PARTY_NOTICES.md), adapted to
// this portal's fields.

export type TemplateId = 'classic' | 'modern' | 'technical' | 'fresher' | 'dataScience' | 'twoColumn';

export type SectionId =
  | 'summary'
  | 'education'
  | 'skills'
  | 'projects'
  | 'experience'
  | 'certifications'
  | 'achievements'
  | 'custom';

export interface PersonalInfo {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  github: string;
  portfolio: string;
  targetRole: string;
}

export interface EducationEntry {
  id: string;
  degree: string;
  institution: string;
  startYear: string;
  endYear: string;
  score: string; // CGPA / percentage, as typed
  coursework: string;
}

export const SKILL_GROUPS = [
  { key: 'languages', label: 'Programming Languages' },
  { key: 'frameworks', label: 'Frameworks' },
  { key: 'libraries', label: 'Libraries' },
  { key: 'databases', label: 'Databases' },
  { key: 'tools', label: 'Tools' },
  { key: 'cloud', label: 'Cloud Technologies' },
  { key: 'soft', label: 'Soft Skills' },
  { key: 'other', label: 'Other Technical Skills' },
] as const;

export type SkillGroupKey = (typeof SKILL_GROUPS)[number]['key'];
export type Skills = Record<SkillGroupKey, string[]>;

export interface ProjectEntry {
  id: string;
  name: string;
  description: string;
  technologies: string[];
  githubUrl: string;
  liveUrl: string;
  duration: string;
}

export const EXPERIENCE_TYPES = ['Internship', 'Work Experience', 'Freelance', 'Part-time'] as const;
export type ExperienceType = (typeof EXPERIENCE_TYPES)[number];

export interface ExperienceEntry {
  id: string;
  type: ExperienceType;
  company: string;
  title: string;
  location: string;
  startDate: string;
  endDate: string;
  current: boolean;
  /** One responsibility per line. */
  responsibilities: string;
  /** One achievement per line. */
  achievements: string;
}

export interface CertificationEntry {
  id: string;
  name: string;
  issuer: string;
  date: string;
  url: string;
  /** What it covered / skills gained, one point per line. */
  description: string;
}

export const ACHIEVEMENT_CATEGORIES = [
  'Award',
  'Hackathon',
  'Competition',
  'Academic',
  'Leadership',
  'Extracurricular',
] as const;
export type AchievementCategory = (typeof ACHIEVEMENT_CATEGORIES)[number];

export interface AchievementEntry {
  id: string;
  category: AchievementCategory;
  title: string;
  description: string;
  date: string;
}

export interface CustomSection {
  id: string;
  title: string;
  /** One item per line. */
  content: string;
}

export interface SectionSetting {
  id: SectionId;
  visible: boolean;
}

export interface ResumeData {
  personal: PersonalInfo;
  summary: string;
  education: EducationEntry[];
  skills: Skills;
  projects: ProjectEntry[];
  experience: ExperienceEntry[];
  noExperience: boolean;
  certifications: CertificationEntry[];
  achievements: AchievementEntry[];
  customSections: CustomSection[];
  /** Student's own section order/visibility; null = the template's default. */
  sections: SectionSetting[] | null;
  /** Optional job description the resume is optimised for. */
  jobDescription: string;
  /** AI skill suggestions the student dismissed (lower-case). */
  dismissedSuggestions: string[];
}

export interface AtsCategory {
  key: 'keywords' | 'skills' | 'formatting' | 'completeness' | 'quality';
  label: string;
  score: number; // 0–100
}

export interface AtsResult {
  score: number; // 0–100
  categories: AtsCategory[];
  suggestions: string[];
  matchedKeywords: string[];
  missingKeywords: string[];
  computedAt: string;
}

export type ResumeStatus = 'draft' | 'complete';

export interface ResumeRecord {
  id: string;
  name: string;
  template: TemplateId;
  data: ResumeData;
  ats: AtsResult | null;
  status: ResumeStatus;
  created_at: string;
  updated_at: string;
}
