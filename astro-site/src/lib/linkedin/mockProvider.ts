// TEMPLATE PROVIDER — structured LinkedIn drafts without an AI model.
//
// Used until the `linkedin-generate` Supabase Edge Function is deployed
// (PUBLIC_LINKEDIN_AI_PROVIDER=supabase switches to real AI, which truly
// rewrites the text). This writer builds proper LinkedIn-style posts —
// hooks, highlights, tone-matched reflections, audience closers and
// relevant hashtags — around the facts the user supplied.
//
// Ground rule, same as the AI prompt: never invent facts. Everything
// added here is framing (hooks, transitions, reflections, questions),
// never numbers, names, outcomes or claims the user didn't give.
// Output is English only; Hindi/Hinglish need the AI provider.

import type { GeneratedPost, GeneratorInput, Variation } from './types';

const ACADEMY = 'Utkarsh Minds';

// ---------- Text helpers ----------

const SKILL_TERMS: [RegExp, string][] = [
  [/\bgenerative ai\b|\bgen ?ai\b/i, 'Generative AI'],
  [/\bmachine learning\b|\bml\b/i, 'Machine Learning'],
  [/\bdeep learning\b/i, 'Deep Learning'],
  [/\bdata science\b/i, 'Data Science'],
  [/\bdata analy(tics|sis)\b/i, 'Data Analytics'],
  [/\bartificial intelligence\b|\bai\b/i, 'AI'],
  [/\bpython\b/i, 'Python'],
  [/\bsql\b/i, 'SQL'],
  [/\bpower ?bi\b/i, 'Power BI'],
  [/\btableau\b/i, 'Tableau'],
  [/\bexcel\b/i, 'Excel'],
  [/\bnlp\b|natural language processing/i, 'NLP'],
  [/\bcomputer vision\b/i, 'Computer Vision'],
  [/\bprompt engineering\b/i, 'Prompt Engineering'],
  [/\bstatistics\b/i, 'Statistics'],
  [/\bcloud\b/i, 'Cloud Computing'],
  [/\bchurn\b|\bforecast|\bprediction\b|\bpredictive\b/i, 'Predictive Analytics'],
  [/\bdashboard/i, 'Data Visualization'],
  [/\bxgboost\b/i, 'XGBoost'],
  [/\btensorflow\b/i, 'TensorFlow'],
  [/\bpytorch\b/i, 'PyTorch'],
  [/\bpandas\b/i, 'Pandas'],
  [/\bscikit-?learn\b/i, 'Scikit-learn'],
];

const CONTEXT_TAGS: [RegExp, string][] = [
  [/hackathon/i, '#Hackathon'],
  [/internship/i, '#Internship'],
  [/placement|placed|hired|job offer/i, '#Placements'],
  [/workshop/i, '#Workshop'],
  [/certif/i, '#Certification'],
  [/capstone|project/i, '#RealWorldProjects'],
  [/webinar|seminar|talk/i, '#Seminar'],
  [/bootcamp/i, '#Bootcamp'],
  [/research|journal|paper/i, '#Research'],
];

interface PurposeFrame {
  emoji: string;
  headline: string;
  tags: string[];
  story: string;
  insight: string;
}

const PURPOSES: Record<string, PurposeFrame> = {
  'Student Achievement': {
    emoji: '🎉',
    headline: 'A proud moment for our learners',
    tags: ['#StudentSuccess', '#ProudMoment'],
    story: 'It always starts the same way: a first class, a lot of questions and the decision to keep going.',
    insight: 'progress comes from consistent practice, good guidance and real problems to solve.',
  },
  'Student Success Story': {
    emoji: '🌟',
    headline: 'A success story worth sharing',
    tags: ['#SuccessStory', '#StudentSuccess'],
    story: 'Some journeys deserve to be told from the very beginning.',
    insight: 'success is rarely one big leap — it’s many small steps taken consistently.',
  },
  'Event Promotion': {
    emoji: '📅',
    headline: 'Save the date',
    tags: ['#Event', '#LearningTogether'],
    story: 'The best learning moments rarely happen alone.',
    insight: 'people learn fastest when they learn together.',
  },
  'Workshop Announcement': {
    emoji: '🛠️',
    headline: 'Hands-on learning is coming up',
    tags: ['#Workshop', '#HandsOnLearning'],
    story: 'Some skills can’t be learned by reading about them — you have to build.',
    insight: 'the best learning happens when you build, break and fix things yourself.',
  },
  'Course Promotion': {
    emoji: '🚀',
    headline: 'A new opportunity to grow your skills',
    tags: ['#Upskilling', '#CareerGrowth'],
    story: 'Every career shift starts with one decision: to learn something new.',
    insight: 'the right structure and guidance turn curiosity into capability.',
  },
  'Industry Collaboration': {
    emoji: '🤝',
    headline: 'Bringing industry and learning closer',
    tags: ['#IndustryConnect', '#Collaboration'],
    story: 'Learning gets real the moment it meets the industry.',
    insight: 'when industry and education work together, learners win.',
  },
  'Educational Insight': {
    emoji: '💡',
    headline: 'A thought worth sharing',
    tags: ['#LearningEveryday', '#Education'],
    story: 'Here’s something we keep noticing in our classrooms.',
    insight: 'small, consistent steps compound into real expertise.',
  },
  'Academy Update': {
    emoji: '📢',
    headline: 'An update from the academy',
    tags: ['#Education', '#Update'],
    story: 'Growth doesn’t always make noise — but it’s worth pausing to notice.',
    insight: 'every step forward is built on the ones before it.',
  },
  'General Announcement': {
    emoji: '📢',
    headline: 'We have some news to share',
    tags: ['#Announcement', '#Education'],
    story: 'Some updates deserve more than a one-line announcement.',
    insight: 'every step forward is worth sharing.',
  },
};

const TONE_LINES: Record<string, string> = {
  Professional: 'Consistent effort, applied learning and the right guidance — that’s what makes progress like this possible.',
  Friendly: 'Moments like these make all the hard work worth it. 😊',
  Inspirational: 'Every expert was once a beginner. Keep learning, keep building — the next milestone is closer than it looks.',
  Storytelling: 'Every milestone has a story behind it — and this one’s worth telling.',
  Confident: 'This is what focused, practical learning looks like.',
  Humble: 'We’re grateful to be a small part of this journey.',
  'Thought Leadership': 'Skills are built by doing, not just by watching.',
};

// Announcements of things that haven't happened yet need forward-looking
// closings rather than "look what we achieved" ones.
const FORWARD_PURPOSES = new Set(['Event Promotion', 'Workshop Announcement', 'Course Promotion']);

const FORWARD_TONE_LINES: Record<string, string> = {
  Professional: 'Practical, guided and built around real work — that’s how skills stick.',
  Friendly: 'Come curious, leave with something you built. 😊',
  Inspirational: 'Every expert was once a beginner — this could be your first step.',
  Storytelling: 'Every skill has a first day. This could be yours.',
  Confident: 'This is what focused, practical learning looks like.',
  Humble: 'We’re looking forward to learning alongside you.',
  'Thought Leadership': 'Skills are built by doing, not just by watching.',
};

function toneLine(input: GeneratorInput): string {
  const lines = FORWARD_PURPOSES.has(input.purpose) ? FORWARD_TONE_LINES : TONE_LINES;
  return lines[input.tone] ?? lines.Professional;
}

function audienceLine(audience: string, skills: string): string {
  switch (audience) {
    case 'Recruiters':
      return skills
        ? `For hiring teams: these are learners who’ve been building real skills in ${skills}.`
        : 'For hiring teams: this is what committed, skill-focused learners look like.';
    case 'Students':
      return skills
        ? `If you’ve been thinking about learning ${skills}, let this be your nudge to start.`
        : 'If you’ve been waiting for a sign to start learning something new — this is it.';
    case 'Industry Professionals':
      return skills
        ? `Practical skills in ${skills} matter more every year — and they’re built one project at a time.`
        : 'The gap between learning and doing gets smaller with every hands-on project.';
    case 'Faculty / Mentors':
      return 'Moments like these are a reminder of how much good mentorship matters.';
    default:
      return '';
  }
}

function closingQuestion(audience: string): string {
  switch (audience) {
    case 'Recruiters':
      return 'Hiring managers — which skills are you prioritising this year? We’d love to hear.';
    case 'Students':
      return 'What’s the one skill you want to master next? Tell us in the comments. 👇';
    case 'Industry Professionals':
      return 'How is your team approaching upskilling? Share your thoughts below.';
    case 'Faculty / Mentors':
      return 'Educators — what has worked best in your classrooms? We’d love to learn from you.';
    default:
      return 'What’s your take? Share your thoughts in the comments. 👇';
  }
}

function purposeCta(input: GeneratorInput): string {
  const follow = input.mentionAcademy ? `Follow ${ACADEMY} for more updates.` : 'Stay tuned for more updates.';
  switch (input.purpose) {
    case 'Event Promotion':
    case 'Workshop Announcement':
      return 'Want to be part of it? Drop a comment or send us a message and we’ll share the details.';
    case 'Course Promotion':
      return 'Curious whether this program is right for you? Send us a message — we’re happy to help.';
    case 'Student Achievement':
    case 'Student Success Story':
      return 'Join us in congratulating them in the comments! 👏';
    case 'Industry Collaboration':
      return 'Interested in collaborating with us? Let’s connect.';
    case 'Educational Insight':
      return 'What’s your take? Share your thoughts in the comments.';
    default:
      return follow;
  }
}

const COMMON_LEADS = new Set(['our', 'the', 'a', 'an', 'we', 'this', 'these', 'students', 'learners', 'team', 'today', 'all']);

function sentence(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t) return '';
  const capped = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

/** Topic phrased to follow "…: " mid-sentence. */
function inline(text: string): string {
  const s = sentence(text);
  const first = s.split(' ')[0].toLowerCase();
  return COMMON_LEADS.has(first) ? s[0].toLowerCase() + s.slice(1) : s;
}

// Abbreviations whose full stop doesn't end a sentence ("Dr. Anupama").
const NO_SPLIT = /\b(Dr|Mr|Mrs|Ms|Prof|St|Sr|Jr|vs|etc|e\.g|i\.e|No)\.\s+/gi;
const DOT = '\u0000';

function splitSentences(text: string): string[] {
  return text
    .replace(NO_SPLIT, (m) => m.replace('.', DOT))
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replaceAll(DOT, '.').trim())
    .filter((s) => s.length > 2);
}

function bullet(text: string, mark = '→'): string {
  return `${mark} ${sentence(text).replace(/\.$/, '')}`;
}

function humanList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function toTag(word: string): string {
  const cleaned = word
    .replace(/&/g, 'And')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => (w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1)))
    .join('');
  return cleaned.length > 1 ? `#${cleaned}` : '';
}

// Restates a common topic shape as a short, rhythmic opener using only
// words already in the topic, e.g.
//   "24 learners completed our 6-week Data Science program with a
//    capstone project showcase"
//   -> "24 learners. One 6-week Data Science program. And a capstone
//       project showcase to cap it off."
function punchy(topic: string): string | null {
  const m = topic
    .trim()
    .replace(/[.!]+$/, '')
    .match(
      /^(\d+\+?)\s+(learners|students|participants|interns|trainees|members)\s+(?:have\s+|successfully\s+)*(?:completed|finished|graduated from|wrapped up)\s+(?:our|the|a)\s+(.+?)(?:\s+(?:with|including)\s+(?:a|an|the)?\s*(.+))?$/i,
    );
  if (!m) return null;
  const [, count, who, program, extra] = m;
  const parts = [`${count} ${who}.`, `One ${program}.`];
  if (extra) parts.push(`And ${/^[aeiou]/i.test(extra) ? 'an' : 'a'} ${extra} to cap it off.`);
  return parts.join(' ');
}

function thanksLine(a: Analysis): string {
  return a.thanks.map((t) => sentence(t)).join(' ');
}

// ---------- Analysis of the input ----------

interface Analysis {
  skills: string[];
  skillsText: string;
  /** Detail sentences that describe what happened (highlights). */
  details: string[];
  /** Detail sentences that thank someone — used as a closing, not a bullet. */
  thanks: string[];
  /** A punchier restatement of the topic, when its shape is recognised. */
  punchyTopic: string | null;
  mentors: boolean;
  frame: PurposeFrame;
  academy: boolean;
  tagPool: string[];
}

function analyse(input: GeneratorInput): Analysis {
  const text = `${input.topic} ${input.details}`;
  let detected = SKILL_TERMS.filter(([re]) => re.test(text)).map(([, label]) => label);
  // "Generative AI" also matches the bare "AI" pattern — keep the specific one.
  if (detected.includes('Generative AI')) detected = detected.filter((d) => d !== 'AI');
  // User keywords first (their words), then anything detected in the text.
  const skills = Array.from(new Set([...input.keywords, ...detected])).slice(0, 4);
  const frame: PurposeFrame =
    input.role === 'student'
      ? STUDENT_FRAMES[input.purpose] ?? STUDENT_FRAMES['General Professional Post']
      : PURPOSES[input.purpose] ?? PURPOSES['General Announcement'];
  const academy = input.mentionAcademy;

  const skillTags = skills.map(toTag).filter(Boolean);
  const contextTags = CONTEXT_TAGS.filter(([re]) => re.test(text)).map(([, t]) => t);
  const tagPool = Array.from(new Set([...skillTags, ...contextTags, ...frame.tags]));

  const sentences = splitSentences(input.details);
  const isThanks = (d: string) => /\b(thank|thanks|grateful|gratitude|shout-?out)\b/i.test(d);

  return {
    skills,
    skillsText: humanList(skills.slice(0, 3)),
    details: sentences.filter((d) => !isThanks(d)).slice(0, 4),
    thanks: sentences.filter(isThanks).slice(0, 2),
    punchyTopic: punchy(input.topic),
    mentors: /mentor|faculty|trainer|teacher|instructor|guide/i.test(text),
    frame,
    academy,
    tagPool,
  };
}

// Each variation leads with different tags so the five posts don't all
// carry an identical block. #UtkarshMinds is added only when the
// academy is being mentioned.
function hashtagsFor(input: GeneratorInput, a: Analysis, variationIndex: number): string[] {
  if (!input.includeHashtags) return [];
  const pool = a.tagPool;
  const limit = a.academy ? 4 : 5;
  const skillCount = Math.min(2, pool.length);
  const head = pool.slice(0, skillCount);
  const rest = pool.slice(skillCount);
  const shift = rest.length ? variationIndex % rest.length : 0;
  const rotated = [...rest.slice(shift), ...rest.slice(0, shift)];
  const tags = [...head, ...rotated].slice(0, limit);
  if (a.academy) tags.push('#UtkarshMinds');
  return Array.from(new Set(tags));
}

// ---------- Student voice (first person) ----------

interface StudentFrame extends PurposeFrame {
  cheer: string;
  cta: string;
}

const STUDENT_FRAMES: Record<string, StudentFrame> = {
  Achievement: {
    emoji: '🎉',
    headline: 'A milestone I’m proud of',
    tags: ['#Achievement', '#Milestone'],
    story: 'Some milestones take longer than you expect — and mean more because of it.',
    insight: 'consistency beats intensity, every single time.',
    cheer: 'Grateful for the journey, and excited for what’s next.',
    cta: 'If you’re working towards something similar, I’d love to connect and swap notes.',
  },
  Certification: {
    emoji: '🎓',
    headline: 'Officially certified',
    tags: ['#Certification', '#ContinuousLearning'],
    story: 'A certificate is the easy part to share. The learning behind it is the real story.',
    insight: 'a certificate opens the door — practice is what keeps it open.',
    cheer: 'On to applying everything I’ve learned.',
    cta: 'Considering the same certification? Feel free to reach out — happy to share my experience.',
  },
  Internship: {
    emoji: '💼',
    headline: 'An update on my internship journey',
    tags: ['#Internship', '#CareerGrowth'],
    story: 'There’s a big difference between learning something and doing it for real.',
    insight: 'real-world work teaches what no classroom can on its own.',
    cheer: 'Excited for everything this experience will teach me.',
    cta: 'I’d love to connect with others working in this space.',
  },
  Project: {
    emoji: '🚀',
    headline: 'A project I’m proud to share',
    tags: ['#BuildInPublic', '#Portfolio'],
    story: 'Every project starts with a problem worth solving.',
    insight: 'you only really understand a concept once you’ve built something with it.',
    cheer: 'Excited to keep building.',
    cta: 'I’d love your feedback — what would you improve?',
  },
  Workshop: {
    emoji: '🛠️',
    headline: 'Hands-on learning at a workshop',
    tags: ['#Workshop', '#HandsOnLearning'],
    story: 'Some skills only click when you try them yourself.',
    insight: 'the best learning happens when you build, break and fix things yourself.',
    cheer: 'Leaving with new skills and plenty of ideas to try.',
    cta: 'Attended a similar workshop? I’d love to hear your takeaways.',
  },
  Event: {
    emoji: '📍',
    headline: 'Takeaways from an event I attended',
    tags: ['#Networking', '#Events'],
    story: 'The best conversations often happen between the sessions.',
    insight: 'every room you walk into is a chance to learn something new.',
    cheer: 'Grateful for the conversations and the ideas.',
    cta: 'Were you there too? Let’s connect!',
  },
  Learning: {
    emoji: '📚',
    headline: 'Learning something new',
    tags: ['#LearningEveryday', '#ContinuousLearning'],
    story: 'Every expert was once a beginner — and I’m enjoying being one again.',
    insight: 'small, consistent steps compound into real expertise.',
    cheer: 'The journey continues.',
    cta: 'What should I learn next? Recommendations welcome!',
  },
  Hackathon: {
    emoji: '💡',
    headline: 'Hackathon diaries',
    tags: ['#Hackathon', '#Innovation'],
    story: 'Limited time, one problem and a lot of ideas.',
    insight: 'constraints bring out the most creative solutions.',
    cheer: 'Already looking forward to the next one.',
    cta: 'Taken part in a hackathon recently? Share your experience below!',
  },
  'Career Update': {
    emoji: '🌱',
    headline: 'A career update',
    tags: ['#CareerUpdate', '#NewBeginnings'],
    story: 'Every career has a few moments that change its direction.',
    insight: 'growth happens just outside your comfort zone.',
    cheer: 'Excited for this next chapter.',
    cta: 'I’d love to connect with people in this field — let’s talk!',
  },
  'General Professional Post': {
    emoji: '💬',
    headline: 'Something I’ve been thinking about',
    tags: ['#ProfessionalGrowth', '#Learning'],
    story: 'Here’s something I’ve been reflecting on lately.',
    insight: 'every step forward is worth sharing.',
    cheer: 'Thanks for reading!',
    cta: 'What’s your take? I’d love to hear your thoughts.',
  },
};

const STUDENT_TONE_LINES: Record<string, string> = {
  Professional: 'Consistent effort and the right guidance make all the difference.',
  Friendly: 'Honestly, moments like these make all the hard work worth it. 😊',
  Inspirational: 'If you’re just starting out: begin where you are. Every expert was once a beginner.',
  Storytelling: 'Every milestone has a story behind it — this is mine.',
  Confident: 'This is just the beginning.',
  Humble: 'Still learning every day, and grateful for the chance to.',
  'Thought Leadership': 'Skills are built by doing, not just by watching.',
};

function studentAudienceLine(audience: string, skills: string): string {
  switch (audience) {
    case 'Recruiters':
      return skills
        ? `I’m continuing to build my skills in ${skills} and would love to connect with people working in this space.`
        : 'I’d love to connect with people working in this space.';
    case 'Students':
      return skills
        ? `If you’re starting out with ${skills}, my advice: start small and stay consistent.`
        : 'If you’re starting out: start small and stay consistent.';
    case 'Industry Professionals':
      return skills
        ? `I’d love to learn how teams apply ${skills} in the real world.`
        : 'I’d love to learn how teams approach this in the real world.';
    case 'Faculty / Mentors':
      return 'Good mentorship makes all the difference — and I’m grateful for it.';
    default:
      return '';
  }
}

function studentClosingQuestion(audience: string): string {
  switch (audience) {
    case 'Recruiters':
      return 'Recruiters and hiring managers — which skills do you value most in early-career talent?';
    case 'Students':
      return 'What are you learning right now? Tell me in the comments. 👇';
    case 'Industry Professionals':
      return 'What’s one skill you wish you had learned earlier in your career?';
    case 'Faculty / Mentors':
      return 'Educators — what advice would you give students who are just starting out?';
    default:
      return 'What’s your take? Let me know in the comments. 👇';
  }
}

// ---------- Voice: everything that differs between roles ----------

interface Voice {
  headline: string;
  emoji: string;
  story: string;
  insight: string;
  toneLine: string;
  audienceLine: string;
  closingQuestion: string;
  cta: string;
  achievementClose: string;
  engagingHook: string;
  engagingBridge: string;
  storyBridge: string;
  mattersTo: string;
  highlightsLabel: string;
  skillsLabel: string;
  takeawayLabel: string;
  mentorLine: string;
  /** Student posts mention the academy in a line of their own. */
  academyLine: string;
}

const at = (a: Analysis) => (a.academy ? ` at ${ACADEMY}` : '');

function assistantVoice(input: GeneratorInput, a: Analysis): Voice {
  const forward = FORWARD_PURPOSES.has(input.purpose);
  const aboutStudents = input.purpose.startsWith('Student');
  const engagingHook = aboutStudents
    ? a.skillsText
      ? `What does it take to get genuinely good at ${a.skillsText}?`
      : 'What does real progress look like?'
    : input.purpose === 'Course Promotion'
      ? `Thinking about building skills in ${a.skillsText || 'a new area'}?`
      : input.purpose === 'Event Promotion' || input.purpose === 'Workshop Announcement'
        ? `Looking for a way to learn ${a.skillsText || 'something new'} alongside others?`
        : 'Here’s some news we’re genuinely excited about.';
  return {
    headline: `${aboutStudents ? 'Proud moment' : a.frame.headline}${at(a)}`,
    emoji: a.frame.emoji,
    story: a.frame.story,
    insight: a.frame.insight,
    toneLine: toneLine(input),
    audienceLine: audienceLine(input.audience, a.skillsText),
    closingQuestion: closingQuestion(input.audience),
    cta: purposeCta(input),
    achievementClose: aboutStudents
      ? input.includeCta
        ? 'Every one of them earned this.'
        : 'Congratulations to every learner who made this happen — this is well deserved.'
      : forward
        ? 'We can’t wait to see you there.'
        : 'Proud of everyone who helped make this happen.',
    engagingHook,
    engagingBridge: aboutStudents ? 'Our learners just showed us 👇' : 'Here’s what’s happening 👇',
    storyBridge: aboutStudents && !forward ? 'That journey led here' : 'That’s the idea behind this',
    mattersTo: 'That’s why this matters to us',
    highlightsLabel: 'Here’s what stood out:',
    skillsLabel: 'Skills in focus:',
    takeawayLabel: 'Our takeaway:',
    mentorLine: 'Behind every milestone like this are mentors who guide, challenge and encourage.',
    academyLine: '',
  };
}

function studentVoice(input: GeneratorInput, a: Analysis): Voice {
  const frame = STUDENT_FRAMES[input.purpose] ?? STUDENT_FRAMES['General Professional Post'];
  return {
    headline: frame.headline,
    emoji: frame.emoji,
    story: frame.story,
    insight: frame.insight,
    toneLine: STUDENT_TONE_LINES[input.tone] ?? STUDENT_TONE_LINES.Professional,
    audienceLine: studentAudienceLine(input.audience, a.skillsText),
    closingQuestion: studentClosingQuestion(input.audience),
    cta: frame.cta,
    achievementClose: frame.cheer,
    engagingHook: a.skillsText ? `What does it actually take to learn ${a.skillsText}?` : 'What does real progress look like?',
    engagingBridge: 'Here’s my story 👇',
    storyBridge: 'That led me here',
    mattersTo: 'That’s why this one matters to me',
    highlightsLabel: 'What stood out for me:',
    skillsLabel: 'Skills I worked on:',
    takeawayLabel: 'My takeaway:',
    mentorLine: 'None of this happens without mentors who guide, challenge and encourage.',
    academyLine: a.academy ? `Grateful to be learning with ${ACADEMY}.` : '',
  };
}

const voiceFor = (input: GeneratorInput, a: Analysis): Voice =>
  input.role === 'student' ? studentVoice(input, a) : assistantVoice(input, a);

// ---------- Variations ----------

type Builder = (input: GeneratorInput, a: Analysis, v: Voice) => string[];

// Bold is used sparingly: the opening line and section labels only.
// Markers become <strong> on the page and Unicode bold when copied.
const bold = (text: string) => (text ? `**${text}**` : '');

const BUILDERS: Record<string, Builder> = {
  professional: (input, a, v) => [
    bold(a.punchyTopic ?? `${v.headline}.`),
    a.punchyTopic ? `${v.headline}.` : sentence(input.topic),
    a.details.length ? a.details.slice(0, 2).map((d) => sentence(d)).join(' ') : '',
    '@medium:' + thanksLine(a),
    '@medium:' + v.academyLine,
    '@detailed:' + v.audienceLine,
    v.toneLine,
  ],

  storytelling: (input, a, v) => [
    bold(v.story),
    `${v.storyBridge}: ${inline(input.topic)}`,
    a.details.length ? a.details.map((d) => sentence(d)).join(' ') : '',
    a.mentors ? '@medium:' + v.mentorLine : '',
    '@medium:' + thanksLine(a),
    '@detailed:' + v.academyLine,
    v.toneLine,
  ],

  engaging: (input, a, v) => [
    bold(v.engagingHook),
    // Bridge + topic stay one block so short posts never drop the topic.
    `${v.engagingBridge}\n\n${sentence(input.topic)}`,
    a.details.length ? a.details.map((d) => bullet(d)).join('\n') : '',
    '@detailed:' + thanksLine(a),
    '@detailed:' + v.audienceLine,
    input.includeCta ? '' : v.toneLine,
  ],

  achievement: (input, a, v) => [
    `${v.emoji} ${bold(`${v.headline}!`)}`,
    a.punchyTopic ?? sentence(input.topic),
    a.details.length ? `${bold(v.highlightsLabel)}\n${a.details.map((d) => bullet(d, '•')).join('\n')}` : '',
    a.skills.length >= 2 ? `@medium:${bold(v.skillsLabel)} ${a.skills.join(' · ')}` : '',
    '@medium:' + thanksLine(a),
    '@medium:' + v.academyLine,
    v.achievementClose,
  ],

  'thought-leadership': (input, a, v) => [
    bold(
      a.skills.length
        ? `Knowing ${a.skills[0]} is one thing. Applying it to real problems is another.`
        : 'Learning sticks when it’s applied.',
    ),
    `${v.mattersTo}: ${inline(input.topic)}`,
    a.details.length ? a.details.slice(0, 3).map((d) => sentence(d)).join(' ') : '',
    `${bold(v.takeawayLabel)} ${v.insight}`,
  ],
};

// Lines prefixed "@medium:" appear from medium length up, "@detailed:"
// only in detailed posts. Short posts keep the first two lines plus the
// closing line.
function applyLength(lines: string[], length: GeneratorInput['length']): string[] {
  const rank = { short: 0, medium: 1, detailed: 2 }[length];
  const kept = lines
    .map((line) => {
      if (line.startsWith('@detailed:')) return rank >= 2 ? line.slice(10) : '';
      if (line.startsWith('@medium:')) return rank >= 1 ? line.slice(8) : '';
      return line;
    })
    .filter((l) => l.trim());
  if (rank === 0 && kept.length > 3) return [...kept.slice(0, 2), kept[kept.length - 1]];
  return kept;
}

export function mockVariation(input: GeneratorInput, variation: Variation, index = 0): GeneratedPost {
  const a = analyse(input);
  const v = voiceFor(input, a);
  const build = BUILDERS[variation.key] ?? BUILDERS.professional;
  const paragraphs = applyLength(build(input, a, v), input.length);

  let cta: string | null = null;
  if (input.includeCta) {
    cta = variation.key === 'engaging' || variation.key === 'thought-leadership' ? v.closingQuestion : v.cta;
    paragraphs.push(cta);
  }

  const hashtags = hashtagsFor(input, a, index);
  const content = paragraphs.join('\n\n');
  const full = hashtags.length ? `${content}\n\n${hashtags.join(' ')}` : content;
  return {
    key: variation.key,
    title: variation.title,
    content,
    hashtags,
    cta,
    characterCount: full.length,
  };
}

// Regenerating a single card in template mode shuffles which tags lead,
// so the user sees a fresh take on the same structure.
let regenerateSeed = 0;

export async function mockGenerate(input: GeneratorInput, variations: Variation[]): Promise<GeneratedPost[]> {
  // Simulated latency so loading states behave as they will with the real API.
  await new Promise((resolve) => setTimeout(resolve, 1400));
  if (variations.length === 1) return [mockVariation(input, variations[0], ++regenerateSeed)];
  return variations.map((v, i) => mockVariation(input, v, i));
}
