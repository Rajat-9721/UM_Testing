// Cleans up what the user typed before any post is written:
//   - fixes common misspellings (a curated list — never a guess, so a
//     person's or company's name can't be "corrected" into something else)
//   - gives technical terms, programs, institutions, degrees, months and
//     days their proper capitalisation (python -> Python, sql -> SQL)
//   - capitalises sentence starts and a standalone "i"
//   - tidies spacing and punctuation
// Every change except sentence-start capitals is reported back so the UI
// can show the user exactly what was corrected.

export interface Correction {
  from: string;
  to: string;
}

// ---- Common misspellings (lower-case key -> correct spelling) ----
const MISSPELLINGS: Record<string, string> = {
  // achievement / success
  acheive: 'achieve', acheived: 'achieved', achive: 'achieve', achived: 'achieved',
  acheivement: 'achievement', achievment: 'achievement', achivement: 'achievement', acheivements: 'achievements', achivements: 'achievements',
  sucess: 'success', succes: 'success', sucessful: 'successful', succesful: 'successful', successfull: 'successful', sucesful: 'successful',
  sucessfully: 'successfully', succesfully: 'successfully', successfuly: 'successfully', successfullly: 'successfully',
  suceed: 'succeed', succeded: 'succeeded', congrats: 'congratulations', congratulation: 'congratulations', congradulations: 'congratulations', congratualtions: 'congratulations',
  // completion / participation
  completd: 'completed', compleated: 'completed', complted: 'completed', completeed: 'completed', compelted: 'completed', complet: 'complete',
  participaton: 'participation', particpation: 'participation', particpated: 'participated', participted: 'participated', partcipated: 'participated',
  particpants: 'participants', participents: 'participants', particpant: 'participant', participent: 'participant',
  // learning / education
  learing: 'learning', leanring: 'learning', lerning: 'learning', learnig: 'learning', lernt: 'learnt',
  stuednts: 'students', studnets: 'students', studens: 'students', studetns: 'students', studnet: 'student', stuent: 'student', stduents: 'students',
  trainig: 'training', traning: 'training', trainning: 'training', trianing: 'training',
  acadamy: 'academy', acedemy: 'academy', accademy: 'academy', acadmey: 'academy',
  instutute: 'institute', institue: 'institute', insititute: 'institute', insitute: 'institute', instiute: 'institute',
  certifcate: 'certificate', cerificate: 'certificate', certficate: 'certificate', certificte: 'certificate',
  certifcation: 'certification', certificaton: 'certification', certfication: 'certification', certifiction: 'certification',
  graduatoin: 'graduation', graduaton: 'graduation', gradution: 'graduation',
  knowlege: 'knowledge', knowledeg: 'knowledge', knowldge: 'knowledge', knowledgable: 'knowledgeable',
  mentorhsip: 'mentorship', mentership: 'mentorship', mentorshp: 'mentorship', mentros: 'mentors', metnors: 'mentors',
  facutly: 'faculty', faclty: 'faculty', facuty: 'faculty',
  semister: 'semester', semestar: 'semester',
  excercise: 'exercise', excersise: 'exercise',
  // events
  workshp: 'workshop', worshop: 'workshop', wokshop: 'workshop', workhsop: 'workshop',
  hackthon: 'hackathon', hakathon: 'hackathon', hackaton: 'hackathon', hackathan: 'hackathon', hackethon: 'hackathon',
  seminer: 'seminar', seminaar: 'seminar', webiner: 'webinar', webinaar: 'webinar',
  presentaion: 'presentation', presentaton: 'presentation', presntation: 'presentation', presenation: 'presentation',
  intership: 'internship', internsip: 'internship', internhsip: 'internship', internshp: 'internship',
  oppurtunity: 'opportunity', oppertunity: 'opportunity', oportunity: 'opportunity', opprtunity: 'opportunity', opportunitiy: 'opportunity',
  oppurtunities: 'opportunities', oppertunities: 'opportunities', oportunities: 'opportunities',
  collaberation: 'collaboration', colaboration: 'collaboration', collabaration: 'collaboration', collabration: 'collaboration',
  comunity: 'community', communty: 'community', commuinty: 'community', comunication: 'communication', communcation: 'communication',
  // tech
  projcet: 'project', porject: 'project', proejct: 'project', prject: 'project', projetc: 'project', projcets: 'projects', porjects: 'projects',
  programing: 'programming', programm: 'program', progam: 'program', progarm: 'program', prgram: 'program', progams: 'programs',
  developement: 'development', devlopment: 'development', develpment: 'development', devloper: 'developer', develper: 'developer',
  enginering: 'engineering', engeneering: 'engineering', engineeering: 'engineering', enginnering: 'engineering', engneering: 'engineering',
  techonlogy: 'technology', technolgy: 'technology', tecnology: 'technology', technlogy: 'technology', techology: 'technology',
  intelligance: 'intelligence', inteligence: 'intelligence', intellegence: 'intelligence', intelignece: 'intelligence',
  pyhton: 'python', pytohn: 'python', pyton: 'python', phyton: 'python',
  machien: 'machine', mahcine: 'machine', machin: 'machine', mechine: 'machine',
  scince: 'science', sceince: 'science', sicence: 'science', scienec: 'science',
  analaysis: 'analysis', analysys: 'analysis', anaylsis: 'analysis', analyis: 'analysis', analystics: 'analytics', anlytics: 'analytics', analytcs: 'analytics',
  algoritm: 'algorithm', algorthm: 'algorithm', alogrithm: 'algorithm', algorithim: 'algorithm', algoritms: 'algorithms',
  databse: 'database', datbase: 'database', dataase: 'database',
  predicton: 'prediction', prediciton: 'prediction', forcasting: 'forecasting', forecating: 'forecasting',
  visualiztion: 'visualization', visulization: 'visualization', vizualization: 'visualization',
  deployement: 'deployment', deploment: 'deployment',
  // general
  recieve: 'receive', recieved: 'received', recive: 'receive', recived: 'received',
  begining: 'beginning', beleive: 'believe', belive: 'believe', definately: 'definitely', definatly: 'definitely',
  seperate: 'separate', seperately: 'separately', occured: 'occurred', occurence: 'occurrence', occassion: 'occasion',
  enviroment: 'environment', enviornment: 'environment', experiance: 'experience', expirience: 'experience', experince: 'experience',
  managment: 'management', mangement: 'management', managemnt: 'management',
  proffesional: 'professional', profesional: 'professional', proffessional: 'professional', professinal: 'professional',
  reccomend: 'recommend', recomend: 'recommend', reccommend: 'recommend', refered: 'referred', relevent: 'relevant', responsibilty: 'responsibility',
  tommorow: 'tomorrow', tomorow: 'tomorrow', tommorrow: 'tomorrow', untill: 'until', wich: 'which', whcih: 'which',
  becuase: 'because', becasue: 'because', beacuse: 'because', becaue: 'because',
  teh: 'the', adn: 'and', thier: 'their', freind: 'friend', freinds: 'friends', recieving: 'receiving',
  accomodate: 'accommodate', adress: 'address', arguement: 'argument', calender: 'calendar', commited: 'committed',
  existance: 'existence', goverment: 'government', happend: 'happened', immediatly: 'immediately', noticable: 'noticeable',
  persue: 'pursue', prefered: 'preferred', similer: 'similar', speach: 'speech', suprise: 'surprise', wierd: 'weird',
  writting: 'writing', writen: 'written', finaly: 'finally', finnaly: 'finally', realy: 'really', truely: 'truly',
  excelent: 'excellent', excellant: 'excellent', exellent: 'excellent', grammer: 'grammar', independant: 'independent',
  guidence: 'guidance', guidnace: 'guidance', gratefull: 'grateful', greatful: 'grateful', thankfull: 'thankful',
  sucessfull: 'successful', amazng: 'amazing', incredable: 'incredible', exited: 'excited', excitd: 'excited',
  // chat-speak
  ur: 'your', pls: 'please', plz: 'please', thx: 'thanks', tnx: 'thanks', gud: 'good', bcz: 'because', bcoz: 'because', coz: 'because', wid: 'with',
};

// ---- Proper capitalisation (lower-case key -> canonical form) ----
// Multi-word terms are matched before single words.
const PHRASES: [string, string][] = [
  ['sardar patel institute of technology', 'Sardar Patel Institute of Technology'],
  ['natural language processing', 'Natural Language Processing'],
  ['artificial intelligence', 'Artificial Intelligence'],
  ['prompt engineering', 'Prompt Engineering'],
  ['computer vision', 'Computer Vision'],
  ['machine learning', 'Machine Learning'],
  ['generative ai', 'Generative AI'],
  ['deep learning', 'Deep Learning'],
  ['data science', 'Data Science'],
  ['data analytics', 'Data Analytics'],
  ['utkarsh minds', 'Utkarsh Minds'],
  ['power bi', 'Power BI'],
  ['scikit learn', 'scikit-learn'],
  ['google colab', 'Google Colab'],
  ['node js', 'Node.js'],
];

const TERMS: Record<string, string> = {
  // languages, tools, platforms
  python: 'Python', sql: 'SQL', mysql: 'MySQL', postgresql: 'PostgreSQL', mongodb: 'MongoDB', nosql: 'NoSQL',
  ai: 'AI', ml: 'ML', nlp: 'NLP', llm: 'LLM', llms: 'LLMs', genai: 'GenAI', chatgpt: 'ChatGPT', openai: 'OpenAI',
  api: 'API', apis: 'APIs', ui: 'UI', ux: 'UX', html: 'HTML', css: 'CSS', javascript: 'JavaScript', typescript: 'TypeScript',
  java: 'Java', react: 'React', nodejs: 'Node.js', 'node.js': 'Node.js', django: 'Django', flask: 'Flask',
  tensorflow: 'TensorFlow', pytorch: 'PyTorch', numpy: 'NumPy', keras: 'Keras', xgboost: 'XGBoost', opencv: 'OpenCV',
  excel: 'Excel', tableau: 'Tableau', powerbi: 'Power BI', github: 'GitHub', git: 'Git', linkedin: 'LinkedIn', youtube: 'YouTube',
  aws: 'AWS', azure: 'Azure', gcp: 'GCP', docker: 'Docker', kubernetes: 'Kubernetes', jupyter: 'Jupyter', iot: 'IoT',
  google: 'Google', microsoft: 'Microsoft', amazon: 'Amazon', ibm: 'IBM', kaggle: 'Kaggle',
  // institutions / places
  spit: 'SPIT', iit: 'IIT', iits: 'IITs', nit: 'NIT', mumbai: 'Mumbai', india: 'India', andheri: 'Andheri', maharashtra: 'Maharashtra',
  // degrees
  btech: 'B.Tech', 'b.tech': 'B.Tech', mtech: 'M.Tech', 'm.tech': 'M.Tech', be: 'BE', mba: 'MBA', bba: 'BBA', bca: 'BCA', mca: 'MCA',
  bsc: 'BSc', 'b.sc': 'B.Sc', msc: 'MSc', 'm.sc': 'M.Sc', phd: 'PhD', ceo: 'CEO', cto: 'CTO',
  // months / days
  january: 'January', february: 'February', march: 'March', april: 'April', june: 'June', july: 'July', august: 'August',
  september: 'September', october: 'October', november: 'November', december: 'December',
  monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday',
};

// "be", "it", "may" etc. are ordinary words far more often than acronyms
// or months — only treat them as terms in contexts that make it clear.
// In resumes "react", "java" and "git" are nearly always the technologies,
// so they are capitalised; these stay ambiguous (ordinary words too).
const AMBIGUOUS = new Set(['be', 'march', 'excel']);

// Ordinary words that end a run of names ("thanks to our faculty",
// "thanks to rajat for the help").
const NAME_STOPWORDS = new Set([
  'the', 'our', 'my', 'your', 'their', 'his', 'her', 'all', 'every', 'everyone', 'each', 'team', 'teams', 'faculty',
  'mentors', 'mentor', 'trainers', 'trainer', 'teachers', 'teacher', 'students', 'learners', 'participants', 'for',
  'to', 'from', 'with', 'who', 'whose', 'that', 'this', 'these', 'those', 'in', 'on', 'at', 'of', 'a', 'an', 'you',
  'so', 'very', 'much', 'guidance', 'support', 'help', 'sir', 'madam', 'maam', 'ma’am', 'and', 'is', 'are', 'was', 'were',
  'has', 'have', 'had', 'will', 'did', 'does', 'for', 'again', 'always', 'everybody', 'us', 'them', 'him',
]);

// Phrases that are usually followed by people's names, and honorifics.
const NAME_LEADS: string[][] = [
  ['thanks', 'to'], ['thank', 'you'], ['grateful', 'to'], ['congratulations', 'to'], ['congrats', 'to'],
  ['shoutout', 'to'], ['shout-out', 'to'], ['kudos', 'to'], ['led', 'by'], ['mentored', 'by'], ['guided', 'by'],
  ['taught', 'by'], ['presented', 'by'], ['organised', 'by'], ['organized', 'by'], ['hosted', 'by'],
  ['mr'], ['mrs'], ['ms'], ['dr'], ['prof'],
];
const HONORIFICS: Record<string, string> = { mr: 'Mr', mrs: 'Mrs', ms: 'Ms', dr: 'Dr', prof: 'Prof' };

/**
 * People's names can't be spell-checked, but they can be capitalised
 * where context makes them obvious: after "thanks to", "congratulations
 * to", "led by", "Dr." and similar, capitalise the following lower-case
 * words up to the first ordinary word or sentence end
 * ("thanks to rajat and mihir for…" -> "Rajat and Mihir").
 */
function capitaliseNames(text: string, note: (from: string, to: string) => void): string {
  const words = Array.from(text.matchAll(/[A-Za-z][A-Za-z'’-]*/g), (m) => ({ word: m[0], index: m.index ?? 0 }));
  const edits: { index: number; from: string; to: string }[] = [];
  const bare = (w: string) => w.toLowerCase();
  // Text between two words; a name run continues only across spaces,
  // commas, "&" and honorific dots.
  const gapBetween = (a: number, b: number) => text.slice(words[a].index + words[a].word.length, words[b].index);

  let i = 0;
  while (i < words.length) {
    const lead = NAME_LEADS.find((phrase) => phrase.every((p, k) => words[i + k] && bare(words[i + k].word) === p));
    if (!lead) {
      i++;
      continue;
    }
    const last = i + lead.length - 1;
    const honorific = lead.length === 1 ? HONORIFICS[lead[0]] : undefined;
    if (honorific && words[i].word !== honorific) edits.push({ index: words[i].index, from: words[i].word, to: honorific });

    let j = last + 1;
    let count = 0;
    while (j < words.length && count < 6) {
      // Continue only across spaces, commas and "&" — or the dot of "Dr." —
      // so a full stop or other punctuation ends the list of names.
      const gap = gapBetween(j - 1, j);
      const afterHonorific = !!HONORIFICS[bare(words[j - 1].word)] && /^\.?\s+$/.test(gap);
      if (!/^[\s,&]+$/.test(gap) && !afterHonorific) break;
      const w = words[j].word;
      const lower = bare(w);
      if (lower === 'and') {
        j++;
        continue;
      }
      if (NAME_STOPWORDS.has(lower) || TERMS[lower] || MISSPELLINGS[lower] || w.length < 2) break;
      if (/^[a-z]/.test(w)) edits.push({ index: words[j].index, from: w, to: w[0].toUpperCase() + w.slice(1) });
      j++;
      count++;
    }
    i = Math.max(j, i + 1);
  }

  edits.sort((a, b) => a.index - b.index).forEach((e) => note(e.from, e.to));
  // Apply from the end so earlier indexes stay valid.
  let out = text;
  for (const e of [...edits].reverse()) {
    out = out.slice(0, e.index) + e.to + out.slice(e.index + e.from.length);
  }
  return out;
}

function matchCase(source: string, replacement: string): string {
  // Keep a capital the user typed at the start of a plain word.
  if (source[0] === source[0].toUpperCase() && source[0] !== source[0].toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

export function cleanText(input: string): { text: string; fixes: Correction[] } {
  const fixes: Correction[] = [];
  const note = (from: string, to: string) => {
    if (from !== to && !fixes.some((f) => f.from.toLowerCase() === from.toLowerCase() && f.to === to)) fixes.push({ from, to });
  };

  let text = input
    .replace(/[ \t]+/g, ' ') // collapse runs of spaces
    .replace(/ +([,.;:!?])/g, '$1') // no space before punctuation
    .replace(/,(?=[A-Za-z])/g, ', ') // space after a comma
    // Space after a full stop run into the next sentence ("done.thanks"),
    // but not inside Node.js, B.Tech, e.g. or a domain like utkarshminds.com.
    .replace(/([A-Za-z]{2,})\.([A-Za-z]{3,})\b/g,(m: string, a: string, b: string, offset: number, whole: string) => {
      const after = whole[offset + m.length] ?? '';
      const before = whole[offset - 1] ?? '';
      const looksLikeUrl = /^www$/i.test(a) || after === '.' || after === '/' || before === '.' || before === '/' || /^(com|org|net|edu|gov|info|app|dev)$/i.test(b);
      return looksLikeUrl ? m : `${a}. ${b}`;
    })
    .replace(/([!?]){2,}/g, '$1') // "!!!" -> "!"
    .replace(/\.{4,}/g, '…')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .trim();

  // Multi-word terms first.
  for (const [phrase, canonical] of PHRASES) {
    const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')}\\b`, 'gi');
    text = text.replace(re, (m) => {
      note(m, canonical);
      return canonical;
    });
  }

  // Word by word. Words containing digits or already mixed-case (XGBoost,
  // iPhone) are left alone; so are unknown words — including names.
  text = text.replace(/[A-Za-z][A-Za-z.'’]*[A-Za-z]|[A-Za-z]/g, (word, offset: number, whole: string) => {
    const lower = word.toLowerCase();
    const isMixed = /[a-z]/.test(word) && /[A-Z]/.test(word.slice(1));
    if (isMixed) return word;

    if (word === 'i') return 'I';

    const misspelt = MISSPELLINGS[lower];
    if (misspelt) {
      const fixed = TERMS[misspelt.toLowerCase()] ?? matchCase(word, misspelt);
      note(word, fixed);
      return fixed;
    }
    if (lower === 'u') {
      // Only the standalone chat-speak "u", not a list label like "(u)".
      const before = whole[offset - 1] ?? ' ';
      if (/[\s,]/.test(before)) {
        note(word, 'you');
        return 'you';
      }
      return word;
    }

    const term = TERMS[lower];
    if (term && !AMBIGUOUS.has(lower) && word !== term) {
      // Leave an ALL-CAPS word alone unless the canonical form is also caps-heavy.
      if (word === word.toUpperCase() && word.length > 1 && term !== term.toUpperCase()) return word;
      note(word, term);
      return term;
    }
    return word;
  });

  text = capitaliseNames(text, note);

  // Sentence starts (not reported — it's not a correction worth listing).
  text = text.replace(/(^|[.!?]\s+|\n\s*)([a-z])/g, (match: string, lead: string, ch: string, offset: number, whole: string) => {
    // Not after abbreviations like "e.g." / "i.e." / "etc." / "vs.".
    if (/\b(e\.g|i\.e|etc|vs)\.\s+$/i.test(whole.slice(Math.max(0, offset - 6), offset + lead.length))) return match;
    return lead + ch.toUpperCase();
  });

  return { text, fixes };
}

export function cleanKeywords(keywords: string[]): { keywords: string[]; fixes: Correction[] } {
  const fixes: Correction[] = [];
  const cleaned = keywords.map((k) => {
    const r = cleanText(k);
    fixes.push(...r.fixes);
    // A keyword is a label: title-case plain lower-case words (e.g. "data
    // visualization" -> "Data Visualization") unless a term rule applied.
    return r.text.replace(/\b([a-z])([a-z]+)/g, (_, a: string, b: string) => a.toUpperCase() + b);
  });
  return { keywords: Array.from(new Set(cleaned)), fixes };
}
