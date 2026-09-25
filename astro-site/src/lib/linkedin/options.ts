// Form options and the variation set for the LinkedIn Post Generator.
// Kept as plain data so the Astro page renders the selects from it and a
// future student version can reuse the same shared lists.

import type { Variation } from './types';

export const ASSISTANT_PURPOSES = [
  'Student Achievement',
  'Event Promotion',
  'Course Promotion',
  'Workshop Announcement',
  'Academy Update',
  'Student Success Story',
  'Industry Collaboration',
  'Educational Insight',
  'General Announcement',
];

export const STUDENT_POST_TYPES = [
  'Achievement',
  'Certification',
  'Internship',
  'Project',
  'Workshop',
  'Event',
  'Learning',
  'Hackathon',
  'Career Update',
  'General Professional Post',
];

export const TONES = [
  'Professional',
  'Friendly',
  'Inspirational',
  'Storytelling',
  'Confident',
  'Humble',
  'Thought Leadership',
];

export const AUDIENCES = [
  'Recruiters',
  'Industry Professionals',
  'Students',
  'General LinkedIn Audience',
  'Faculty / Mentors',
];

export const LANGUAGES = ['English', 'Hindi', 'Hinglish'] as const;

export const LENGTHS = [
  { value: 'short', label: 'Short' },
  { value: 'medium', label: 'Medium' },
  { value: 'detailed', label: 'Detailed' },
] as const;

// Every generation asks for all of these, in this order. Regenerating one
// card re-sends just that card's variation.
export const VARIATIONS: Variation[] = [
  {
    key: 'professional',
    title: 'Professional Version',
    brief: 'Concise and polished. Lead with the core news in the first line, then the essential context. No fluff.',
  },
  {
    key: 'storytelling',
    title: 'Storytelling Version',
    brief: 'Open on a specific moment or scene from the supplied details, then widen out to what it means. Narrative, human, first person plural for an institution.',
  },
  {
    key: 'engaging',
    title: 'Engaging Version',
    brief: 'Conversational and warm. Open with a question or a surprising observation, and end by inviting the reader to respond.',
  },
  {
    key: 'achievement',
    title: 'Achievement Version',
    brief: 'Put the outcome and the people behind it at the centre. Specific, celebratory but not boastful.',
  },
  {
    key: 'thought-leadership',
    title: 'Thought-Leadership Version',
    brief: 'Use the news as a springboard for one clear, well-argued insight about learning, skills or the industry. The insight must follow from the supplied facts.',
  },
];

export const MAX_TOPIC_LENGTH = 500;
export const MAX_DETAILS_LENGTH = 2000;
export const MAX_KEYWORDS = 10;
/** LinkedIn's limit for a post body. */
export const LINKEDIN_CHAR_LIMIT = 3000;
