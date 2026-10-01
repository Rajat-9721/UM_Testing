// Template-mode "Improve with AI": expands a short description into 3–5
// resume points. The student's own points are kept first (spell-checked
// and tidied); extra points describe the TYPICAL work for that kind of
// project/role/achievement, written with the technologies the student
// listed. Added points never contain numbers, results, ranks, companies
// or people — the student reviews every point before accepting.

export interface ExpandContext {
  title?: string;
  technologies?: string[];
  category?: string; // achievement category
  issuer?: string; // certification issuer
  role?: string; // experience job title
}

const humanList = (items: string[]) => (items.length <= 1 ? items[0] ?? '' : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

interface Kind {
  match: RegExp;
  points: (tech: string) => string[];
}

const PROJECT_KINDS: Kind[] = [
  {
    match: /chat\s*bot|chatbot|assistant|conversational|llm|gpt|gen(erative)?\s*ai|rag\b/i,
    points: (t) => [
      'Designed the conversation flow to handle common user queries end to end.',
      `Implemented the core logic${t ? ` using ${t}` : ''} to understand user input and generate relevant responses.`,
      'Tested the chatbot with sample conversations and refined its responses based on the results.',
    ],
  },
  {
    match: /image|vision|opencv|cnn|detect(ion)?|recogni[sz]|yolo|face/i,
    points: (t) => [
      'Collected and preprocessed the image dataset, applying resizing and augmentation.',
      `Built and trained a model${t ? ` using ${t}` : ''} to recognise the target objects or patterns.`,
      'Evaluated results on unseen test images and refined the model to reduce errors.',
    ],
  },
  {
    match: /dashboard|power\s*bi|tableau|visuali[sz]|report(ing)?|kpi/i,
    points: (t) => [
      'Cleaned and modelled the source data to support accurate reporting.',
      `Designed interactive visuals and KPIs${t ? ` in ${t}` : ''} to track the key metrics.`,
      'Summarised insights so trends are easy to understand for decision-makers.',
    ],
  },
  {
    match: /predict|classif|regress|forecast|machine learning|\bml\b|model|churn|recommend|cluster|sentiment/i,
    points: (t) => [
      'Collected and preprocessed the dataset, handling missing values, outliers and feature encoding.',
      'Performed exploratory data analysis to identify key patterns and relationships in the data.',
      `Trained and compared machine learning models${t ? ` using ${t}` : ''} to select the best-performing approach.`,
      'Evaluated the model with appropriate metrics and tuned hyperparameters to improve performance.',
    ],
  },
  {
    match: /web|website|app\b|application|react|node|django|flask|frontend|backend|full\s*stack|portal|e-?commerce|api/i,
    points: (t) => [
      `Designed a responsive user interface${t ? ` using ${t}` : ''}.`,
      'Implemented the core features and connected the interface with backend APIs and data storage.',
      'Tested functionality across devices and browsers, fixing issues before deployment.',
    ],
  },
  {
    match: /scrap|automat|script|bot\b|workflow/i,
    points: (t) => [
      `Automated a repetitive task${t ? ` with ${t}` : ''} to reduce manual effort.`,
      'Handled errors and edge cases so the process runs reliably.',
      'Documented how to set up and run the tool.',
    ],
  },
  {
    match: /analy[sz]|sql|excel|eda|insight|data/i,
    points: (t) => [
      `Cleaned and analysed the data${t ? ` using ${t}` : ''} to answer the key questions.`,
      'Identified trends and patterns and summarised the findings clearly.',
      'Presented the results with simple charts and recommendations.',
    ],
  },
];

const GENERIC_PROJECT: Kind['points'] = (t) => [
  'Planned the project scope and broke the work into clear milestones.',
  `Implemented the solution${t ? ` using ${t}` : ''}, focusing on clean and maintainable code.`,
  'Tested the result and documented the approach and possible improvements.',
];

const ACHIEVEMENT_POINTS: Record<string, string[]> = {
  Hackathon: ['Built a working prototype within the hackathon time limit.', 'Presented the solution and its approach to the judges.'],
  Competition: ['Solved problems under time pressure while competing against other participants.', 'Demonstrated strong analytical and problem-solving skills.'],
  Award: ['Recognised for consistent effort and quality of work.'],
  Academic: ['Demonstrated consistent academic performance and strong subject knowledge.'],
  Leadership: ['Coordinated team members and planned activities to meet deadlines.', 'Communicated with stakeholders to ensure smooth execution.'],
  Extracurricular: ['Contributed actively to planning and running activities.', 'Developed teamwork and communication skills.'],
};

const EXPERIENCE_POINTS = (t: string) => [
  `Worked on day-to-day tasks${t ? ` involving ${t}` : ''} under the guidance of the team.`,
  'Collaborated with team members to deliver tasks on schedule.',
  'Documented work and shared regular progress updates.',
];

// Words that, if already present, mean an added point would repeat the student.
const THEMES: [RegExp, RegExp][] = [
  [/preprocess|clean/i, /preprocess|clean/i],
  [/exploratory|eda|pattern/i, /exploratory|eda|pattern|trend/i],
  [/train|model/i, /train/i],
  [/evaluat|metric|accuracy|tun/i, /evaluat|metric|accuracy|tun/i],
  [/test/i, /test/i],
  [/interface|ui\b|frontend|design/i, /interface|ui\b|frontend|design/i],
  [/deploy/i, /deploy/i],
  [/document/i, /document/i],
  [/present/i, /present/i],
  [/dashboard|visual|kpi/i, /visual|kpi|dashboard/i],
];

function repeats(point: string, existing: string): boolean {
  return THEMES.some(([inPoint, inExisting]) => inPoint.test(point) && inExisting.test(existing));
}

/** Detected tool/tech names in free text, for when none were listed. */
const TECH_WORDS = /\b(Python|SQL|Excel|Power BI|Tableau|Pandas|NumPy|Scikit-learn|TensorFlow|PyTorch|Keras|XGBoost|OpenCV|React|Node\.js|Django|Flask|JavaScript|HTML|CSS|Java|C\+\+|MongoDB|MySQL|Firebase|LangChain|NLTK|spaCy)\b/gi;

export function expandPoints(field: 'project' | 'experience' | 'achievement' | 'certification', ownLines: string[], ctx: ExpandContext): string[] {
  const own = ownLines.filter(Boolean);
  const context = [ctx.title, ...own, ...(ctx.technologies ?? [])].join(' ');
  const detected = Array.from(new Set((context.match(TECH_WORDS) ?? []).map((w: string) => w.replace(/^./, (c: string) => c.toUpperCase()))));
  const techList = (ctx.technologies?.length ? ctx.technologies : detected).slice(0, 3);
  const tech = humanList(techList);
  const existing = own.join(' ');

  let extra: string[] = [];
  if (field === 'project') {
    // The project title is the strongest signal ("Sales Forecasting
    // Dashboard" is a dashboard); fall back to the whole description.
    const kind = PROJECT_KINDS.find((k) => ctx.title && k.match.test(ctx.title)) ?? PROJECT_KINDS.find((k) => k.match.test(context));
    extra = (kind ? kind.points : GENERIC_PROJECT)(tech);
  } else if (field === 'experience') {
    extra = EXPERIENCE_POINTS(tech);
  } else if (field === 'achievement') {
    extra = ACHIEVEMENT_POINTS[ctx.category ?? ''] ?? ACHIEVEMENT_POINTS.Award;
  } else {
    const topic = ctx.title?.replace(/\b(certification|certificate|course|program(me)?)\b/gi, '').trim();
    extra = [
      `Completed structured coursework and assessments covering ${topic || 'the core concepts of the subject'}${ctx.issuer ? `, offered by ${ctx.issuer}` : ''}.`,
      'Applied the concepts through hands-on exercises and practical assignments.',
    ];
  }

  const target = field === 'project' || field === 'experience' ? 5 : field === 'certification' ? 3 : 3;
  const out = [...own];
  for (const point of extra) {
    if (out.length >= target) break;
    if (!repeats(point, existing) && !out.some((o) => o.toLowerCase() === point.toLowerCase())) out.push(point);
  }
  return out;
}
