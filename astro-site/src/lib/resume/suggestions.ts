// Course- and role-based skill suggestions, and keyword helpers.
//
// Suggestions are shown as "AI Suggestions" the student may add, edit or
// dismiss — they are never put on the resume automatically, because
// being enrolled in a course doesn't mean the student has the skill.

import type { SkillGroupKey } from './types';

interface Suggestion {
  name: string;
  group: SkillGroupKey;
}

const S = (group: SkillGroupKey, ...names: string[]): Suggestion[] => names.map((name) => ({ name, group }));

// Which skill group a known skill belongs to (for "Add").
const COURSE_SKILLS: { match: RegExp; label: string; skills: Suggestion[] }[] = [
  {
    match: /data\s*science|data\s*analy|analytics/i,
    label: 'Data Science',
    skills: [
      ...S('languages', 'Python', 'SQL'),
      ...S('libraries', 'Pandas', 'NumPy', 'Scikit-learn'),
      ...S('tools', 'Power BI', 'Tableau'),
      ...S('other', 'Statistics', 'Machine Learning', 'Data Analysis', 'Data Visualization'),
    ],
  },
  {
    match: /generative|gen\s*ai|llm/i,
    label: 'Generative AI',
    skills: [...S('languages', 'Python'), ...S('other', 'Generative AI', 'Prompt Engineering', 'Large Language Models', 'NLP'), ...S('frameworks', 'LangChain')],
  },
  {
    match: /artificial intelligence|\bai\b|machine learning|\bml\b|deep learning/i,
    label: 'Artificial Intelligence',
    skills: [
      ...S('languages', 'Python'),
      ...S('other', 'Machine Learning', 'Deep Learning', 'NLP', 'Computer Vision', 'Generative AI', 'Neural Networks'),
      ...S('frameworks', 'TensorFlow', 'PyTorch'),
    ],
  },
  {
    match: /web|full\s*stack|front\s*end|back\s*end|mern|javascript/i,
    label: 'Web Development',
    skills: [
      ...S('languages', 'HTML', 'CSS', 'JavaScript'),
      ...S('frameworks', 'React', 'Node.js'),
      ...S('other', 'REST APIs'),
      ...S('databases', 'MySQL', 'MongoDB'),
      ...S('tools', 'Git', 'GitHub'),
    ],
  },
  {
    match: /cyber|security|ethical hacking/i,
    label: 'Cyber Security',
    skills: [...S('other', 'Network Security', 'Ethical Hacking', 'Cryptography', 'Vulnerability Assessment'), ...S('tools', 'Linux', 'Wireshark')],
  },
  { match: /python/i, label: 'Python', skills: [...S('languages', 'Python'), ...S('libraries', 'Pandas', 'NumPy'), ...S('tools', 'Jupyter')] },
  { match: /\bsql\b|database/i, label: 'SQL', skills: [...S('languages', 'SQL'), ...S('databases', 'MySQL', 'PostgreSQL')] },
  { match: /power\s*bi/i, label: 'Power BI', skills: [...S('tools', 'Power BI', 'Excel'), ...S('other', 'DAX', 'Data Visualization')] },
];

export const TARGET_ROLES = [
  'Data Scientist',
  'Data Analyst',
  'Software Developer',
  'Frontend Developer',
  'Backend Developer',
  'Full Stack Developer',
  'AI/ML Engineer',
  'Cybersecurity Analyst',
];

const ROLE_KEYWORDS: { match: RegExp; keywords: string[] }[] = [
  { match: /data\s*scien/i, keywords: ['Python', 'SQL', 'Machine Learning', 'Statistics', 'Pandas', 'NumPy', 'Scikit-learn', 'Data Visualization', 'Data Analysis', 'Feature Engineering', 'Model Evaluation'] },
  { match: /data\s*analy|business\s*analy/i, keywords: ['SQL', 'Excel', 'Power BI', 'Tableau', 'Python', 'Data Analysis', 'Data Visualization', 'Statistics', 'Dashboards', 'Data Cleaning', 'Reporting'] },
  { match: /\bai\b|\bml\b|machine learning|deep learning/i, keywords: ['Python', 'Machine Learning', 'Deep Learning', 'TensorFlow', 'PyTorch', 'NLP', 'Computer Vision', 'Model Deployment', 'Scikit-learn', 'Neural Networks'] },
  { match: /front\s*end/i, keywords: ['HTML', 'CSS', 'JavaScript', 'TypeScript', 'React', 'Responsive Design', 'REST APIs', 'Git'] },
  { match: /back\s*end/i, keywords: ['Node.js', 'Python', 'Java', 'REST APIs', 'SQL', 'MongoDB', 'Authentication', 'Git', 'Docker'] },
  { match: /full\s*stack/i, keywords: ['HTML', 'CSS', 'JavaScript', 'React', 'Node.js', 'REST APIs', 'SQL', 'MongoDB', 'Git'] },
  { match: /software|developer|engineer|programmer/i, keywords: ['Data Structures', 'Algorithms', 'Object-Oriented Programming', 'Git', 'SQL', 'Problem Solving', 'Testing'] },
  { match: /cyber|security/i, keywords: ['Network Security', 'Linux', 'Vulnerability Assessment', 'Ethical Hacking', 'Cryptography', 'Incident Response', 'Firewalls', 'SIEM'] },
];

// Terms recognised when reading a job description.
const EXTRA_VOCAB = [
  'Excel', 'Communication', 'Problem Solving', 'Teamwork', 'Agile', 'Docker', 'Kubernetes', 'AWS', 'Azure', 'Google Cloud',
  'Java', 'C++', 'C', 'TypeScript', 'R', 'MATLAB', 'PostgreSQL', 'Spark', 'Hadoop', 'ETL', 'A/B Testing', 'Regression',
  'Classification', 'Time Series', 'Data Cleaning', 'Looker', 'CI/CD', 'GraphQL', 'Next.js', 'Angular', 'Vue', 'Spring Boot',
  'Django', 'Flask', 'FastAPI', 'Networking', 'Penetration Testing', 'OWASP', 'Cloud Security', 'LLMs', 'Transformers',
  'Hugging Face', 'OpenCV', 'Keras', 'Matplotlib', 'Seaborn', 'Probability', 'Big Data', 'Data Warehousing', 'Snowflake',
  'Power Query', 'DAX', 'Tableau', 'Jira', 'Linux', 'Git', 'GitHub', 'REST APIs', 'Microservices', 'Unit Testing',
];

const ALIASES: Record<string, string[]> = {
  'Machine Learning': ['ML'],
  'Artificial Intelligence': ['AI'],
  JavaScript: ['JS'],
  'Node.js': ['Node', 'NodeJS'],
  'Scikit-learn': ['sklearn', 'scikit learn'],
  'REST APIs': ['REST API', 'RESTful', 'REST'],
  'Natural Language Processing': ['NLP'],
  NLP: ['Natural Language Processing'],
  'Large Language Models': ['LLM', 'LLMs'],
  'Data Visualization': ['Data Visualisation', 'Visualization', 'Visualisation'],
  Dashboards: ['Dashboard', 'Dashboarding'],
  'Google Cloud': ['GCP'],
  PostgreSQL: ['Postgres'],
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Case-insensitive whole-term match (handles C++, Node.js, A/B Testing). */
export function hasKeyword(text: string, keyword: string): boolean {
  return [keyword, ...(ALIASES[keyword] ?? [])].some((k) => new RegExp(`(^|[^A-Za-z0-9+#])${escape(k)}($|[^A-Za-z0-9+#])`, 'i').test(text));
}

export function roleKeywords(role: string): string[] {
  const r = role.trim();
  if (!r) return [];
  const found = ROLE_KEYWORDS.filter((k) => k.match.test(r)).flatMap((k) => k.keywords);
  return Array.from(new Set(found));
}

const ALL_VOCAB = Array.from(
  new Set([...COURSE_SKILLS.flatMap((c) => c.skills.map((s) => s.name)), ...ROLE_KEYWORDS.flatMap((r) => r.keywords), ...EXTRA_VOCAB]),
);

/** Known skills/keywords mentioned in a job description. */
export function extractKeywords(jobDescription: string): string[] {
  if (!jobDescription.trim()) return [];
  return ALL_VOCAB.filter((k) => k.length > 1 && hasKeyword(jobDescription, k));
}

const GROUP_OF = new Map<string, SkillGroupKey>(COURSE_SKILLS.flatMap((c) => c.skills.map((s) => [s.name.toLowerCase(), s.group] as const)));

/** Best-guess skill group for a keyword the student chooses to add. */
export function groupFor(skill: string): SkillGroupKey {
  return GROUP_OF.get(skill.toLowerCase()) ?? 'other';
}

export interface SkillSuggestion extends Suggestion {
  reason: string;
}

export function suggestSkills(opts: { programs: string[]; targetRole: string; existing: string[]; dismissed: string[] }): SkillSuggestion[] {
  const have = new Set([...opts.existing, ...opts.dismissed].map((s) => s.toLowerCase()));
  const out: SkillSuggestion[] = [];
  const add = (s: Suggestion, reason: string) => {
    const key = s.name.toLowerCase();
    if (have.has(key)) return;
    have.add(key);
    out.push({ ...s, reason });
  };
  for (const program of opts.programs) {
    for (const course of COURSE_SKILLS.filter((c) => c.match.test(program))) {
      course.skills.forEach((s) => add(s, `Common in ${course.label} programs`));
    }
  }
  for (const k of roleKeywords(opts.targetRole)) add({ name: k, group: groupFor(k) }, `Relevant for ${opts.targetRole} roles`);
  return out.slice(0, 18);
}
