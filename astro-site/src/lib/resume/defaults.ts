// Empty and sample resume data, ids, and profile prefill.

import type {
  AchievementEntry,
  CertificationEntry,
  CustomSection,
  EducationEntry,
  ExperienceEntry,
  ProjectEntry,
  ResumeData,
  Skills,
} from './types';

export function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
}

export const emptySkills = (): Skills => ({
  languages: [],
  frameworks: [],
  libraries: [],
  databases: [],
  tools: [],
  cloud: [],
  soft: [],
  other: [],
});

export const newEducation = (): EducationEntry => ({
  id: uid(), degree: '', institution: '', startYear: '', endYear: '', score: '', coursework: '',
});
export const newProject = (): ProjectEntry => ({
  id: uid(), name: '', description: '', technologies: [], githubUrl: '', liveUrl: '', duration: '',
});
export const newExperience = (): ExperienceEntry => ({
  id: uid(), type: 'Internship', company: '', title: '', location: '', startDate: '', endDate: '', current: false,
  responsibilities: '', achievements: '',
});
export const newCertification = (): CertificationEntry => ({ id: uid(), name: '', issuer: '', date: '', url: '', description: '' });
export const newAchievement = (): AchievementEntry => ({ id: uid(), category: 'Award', title: '', description: '', date: '' });
export const newCustomSection = (): CustomSection => ({ id: uid(), title: '', content: '' });

export function emptyResume(): ResumeData {
  return {
    personal: { fullName: '', email: '', phone: '', location: '', linkedin: '', github: '', portfolio: '', targetRole: '' },
    summary: '',
    education: [],
    skills: emptySkills(),
    projects: [],
    experience: [],
    noExperience: false,
    certifications: [],
    achievements: [],
    customSections: [],
    sections: null,
    jobDescription: '',
    dismissedSuggestions: [],
  };
}

/**
 * Fills in anything missing from stored data (older drafts, partial rows)
 * so the rest of the code can rely on every field existing.
 */
export function normaliseResume(raw: any): ResumeData {
  const base = emptyResume();
  if (!raw || typeof raw !== 'object') return base;
  return {
    ...base,
    ...raw,
    personal: { ...base.personal, ...(raw.personal ?? {}) },
    skills: { ...base.skills, ...(raw.skills ?? {}) },
    education: Array.isArray(raw.education) ? raw.education : [],
    projects: Array.isArray(raw.projects) ? raw.projects.map((p: any) => ({ ...newProject(), ...p, technologies: p?.technologies ?? [] })) : [],
    experience: Array.isArray(raw.experience) ? raw.experience.map((e: any) => ({ ...newExperience(), ...e })) : [],
    certifications: Array.isArray(raw.certifications) ? raw.certifications.map((c: any) => ({ ...newCertification(), ...c })) : [],
    achievements: Array.isArray(raw.achievements) ? raw.achievements : [],
    customSections: Array.isArray(raw.customSections) ? raw.customSections : [],
    sections: Array.isArray(raw.sections) ? raw.sections : null,
    dismissedSuggestions: Array.isArray(raw.dismissedSuggestions) ? raw.dismissedSuggestions : [],
    jobDescription: typeof raw.jobDescription === 'string' ? raw.jobDescription : '',
  };
}

export const cloneResume = (data: ResumeData): ResumeData => JSON.parse(JSON.stringify(data));

/** True when the student hasn't entered anything meaningful yet. */
export function isMostlyEmpty(d: ResumeData): boolean {
  const skillCount = Object.values(d.skills).reduce((n, list) => n + list.length, 0);
  return !d.personal.fullName && !d.summary && !d.education.length && !d.projects.length && !d.experience.length && skillCount === 0;
}

export interface ProfileSeed {
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  /** Titles of the programs the student is enrolled in. */
  programs?: string[];
}

/** Pre-fills a new resume from the student's portal profile (all editable). */
export function seedFromProfile(seed: ProfileSeed): ResumeData {
  const data = emptyResume();
  data.personal.fullName = seed.fullName?.trim() ?? '';
  data.personal.email = seed.email?.trim() ?? '';
  data.personal.phone = seed.phone?.trim() ?? '';
  for (const program of seed.programs ?? []) {
    if (!program) continue;
    data.education.push({ ...newEducation(), degree: program, institution: 'Utkarsh Minds' });
  }
  return data;
}

/** Illustrative content for template thumbnails and previews of an empty resume. */
export function sampleResume(): ResumeData {
  const d = emptyResume();
  d.personal = {
    fullName: 'Aarav Sharma',
    email: 'aarav.sharma@email.com',
    phone: '+91 98765 43210',
    location: 'Mumbai, India',
    linkedin: 'linkedin.com/in/aaravsharma',
    github: 'github.com/aaravsharma',
    portfolio: '',
    targetRole: 'Data Analyst',
  };
  d.summary =
    'Data Science student with hands-on experience in Python, SQL and machine learning. Built end-to-end projects in customer churn prediction and sales forecasting, and enjoys turning data into clear business insights.';
  d.education = [
    { id: 's1', degree: 'B.Tech in Computer Engineering', institution: 'Sardar Patel Institute of Technology', startYear: '2022', endYear: '2026', score: 'CGPA 8.4', coursework: 'Data Structures, DBMS, Statistics' },
    { id: 's2', degree: 'Data Science Program', institution: 'Utkarsh Minds', startYear: '2025', endYear: '2025', score: '', coursework: '' },
  ];
  d.skills = {
    ...emptySkills(),
    languages: ['Python', 'SQL'],
    libraries: ['Pandas', 'NumPy', 'Scikit-learn'],
    tools: ['Power BI', 'Git', 'Jupyter'],
    soft: ['Communication', 'Teamwork'],
  };
  d.projects = [
    { id: 'p1', name: 'Customer Churn Prediction', description: 'Developed a classification model to predict customer churn using Python and XGBoost.\nPerformed data preprocessing, feature engineering and model evaluation.', technologies: ['Python', 'XGBoost', 'Pandas'], githubUrl: 'github.com/aaravsharma/churn', liveUrl: '', duration: '2025' },
    { id: 'p2', name: 'Sales Forecasting Dashboard', description: 'Built a Power BI dashboard to visualise monthly sales trends and forecasts.', technologies: ['Power BI', 'SQL'], githubUrl: '', liveUrl: '', duration: '2025' },
  ];
  d.experience = [
    { id: 'e1', type: 'Internship', company: 'Analytics Labs', title: 'Data Analyst Intern', location: 'Mumbai', startDate: 'Jun 2025', endDate: 'Aug 2025', current: false, responsibilities: 'Cleaned and analysed sales data using SQL and Python.\nPrepared weekly reports for the business team.', achievements: '' },
  ];
  d.certifications = [{ id: 'c1', name: 'Data Science Certification', issuer: 'Utkarsh Minds', date: '2025', url: '', description: '' }];
  d.achievements = [{ id: 'a1', category: 'Hackathon', title: 'Finalist, College Hackathon', description: '', date: '2024' }];
  return d;
}
