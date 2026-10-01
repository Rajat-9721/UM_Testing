// Dictionary spell-check for resume text (template mode; the real AI
// fixes spelling itself). Uses nspell with the en_US Hunspell dictionary
// (dictionary-en, MIT AND BSD), loaded lazily on first use — about 550 KB,
// fetched only when a student first clicks "Improve with AI".
//
// Used for autocorrect across the whole resume (a field is corrected when
// the student leaves it, and every field again on the Review step).
// Conservative on purpose, because a wrong "correction" is worse than a
// missed typo:
//   - the curated fixes + proper casing from textCleanup run first;
//   - lower-case words are dictionary-checked; a capitalised word
//     mid-sentence (probably a name, product or acronym) is only touched
//     in titles, and only to a common resume word (see SpellMode);
//   - known tech terms are never touched;
//   - a word is replaced only by a suggestion within 1–2 edits.
// Every change is shown to the student with an Undo.

import { cleanText } from '../linkedin/textCleanup';

type Speller = { correct: (w: string) => boolean; suggest: (w: string) => string[] };

let spellerPromise: Promise<Speller | null> | null = null;

/** Starts loading the dictionary in the background (call when the wizard opens). */
export function preloadSpeller() {
  void loadSpeller();
}

function loadSpeller(): Promise<Speller | null> {
  spellerPromise ??= (async () => {
    try {
      const [{ default: nspell }, aff, dic] = await Promise.all([
        import('nspell'),
        import('../../../node_modules/dictionary-en/index.aff?raw'),
        import('../../../node_modules/dictionary-en/index.dic?raw'),
      ]);
      return nspell(aff.default, dic.default) as Speller;
    } catch (error) {
      console.error('Spell-check dictionary failed to load:', error);
      return null; // curated fixes still apply
    }
  })();
  return spellerPromise;
}

// Words the dictionary doesn't know but are fine on a resume.
const ALLOW = new Set(
  (
    'api apis ui ux sql nosql mysql postgresql mongodb json csv xml html css javascript typescript nodejs react reactjs ' +
    'nextjs vue angular django flask fastapi numpy pandas scikit sklearn matplotlib seaborn tensorflow pytorch keras xgboost ' +
    'lightgbm opencv nlp llm llms genai chatbot chatbots dataset datasets backend frontend fullstack devops github gitlab ' +
    'jupyter colab kaggle tableau powerbi dax etl eda kpi kpis dashboard dashboards preprocessing hyperparameter hyperparameters ' +
    'workflow workflows webapp app apps login signup url urls http https wifi iot arduino raspberry firebase supabase aws gcp ' +
    'azure docker kubernetes linux ubuntu bash cli sdk sdks oauth jwt crud mvp saas b2b ecommerce e-commerce frontend ' +
    'utkarsh spit hackathon hackathons webinar webinars upskilling onboarding scalable reusable microservices chatgpt openai ' +
    'langchain huggingface transformers bert gpt cnn rnn lstm yolo'
  ).split(/\s+/),
);

// Common resume words. When a typo has several close dictionary matches
// ("usign" → sign/using, "prises" → poises/prices), these win.
const PREFERRED = new Set(
  (
    'using used use built build building builds developed develop developing created create designed design implemented ' +
    'implement analysed analyzed analysis analyse analyze trained training tested testing deployed deployment managed led ' +
    'organised organized coordinated collaborated presented participated volunteered completed achieved improved increased ' +
    'reduced automated integrated wrote written learned learnt worked working helped supported maintained researched ' +
    'customer customers client clients user users student students farmer farmers patient patients teacher teachers ' +
    'question questions answer answers query queries price prices product products service services sales stock market ' +
    'crop crops weather traffic health disease hospital school college university company business finance marketing ' +
    'data dataset datasets model models prediction predictions predict predicting forecast forecasting classification ' +
    'detection recognition recommendation sentiment review reviews image images video text speech voice chatbot assistant ' +
    'website web application applications app apps system systems platform portal dashboard dashboards report reports ' +
    'feature features result results accuracy performance interface responsive mobile online real time database ' +
    'project projects team teams member members event events workshop competition hackathon award prize winner finalist ' +
    'first second third club committee coordinator presentation research paper published internship intern experience ' +
    'responsibilities communication leadership problem problems solving skills technical automation scraping library ' +
    'inventory attendance billing payment booking tracking portfolio blog game quiz calculator news email loan credit fraud ' +
    'house car quality security network testing learning machine deep neural natural language processing vision ' +
    // job titles and subjects
    'analyst analysts scientist engineer engineering developer designer manager consultant architect administrator ' +
    'specialist associate executive officer trainee fresher graduate science computer structures structure algorithms ' +
    'statistics mathematics physics chemistry economics accounting commerce electronics electrical mechanical civil ' +
    'programming networks operating intelligence artificial information technology management ' +
    // common summary words
    'enthusiastic motivated passionate dedicated skilled experienced eager seeking opportunity opportunities knowledge ' +
    'strong excellent practical professional career growth role position ability abilities hands'
  ).split(/\s+/),
);

const sharedEnds = (a: string, b: string) => {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return p + s;
};

function distance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
    }
  }
  return dp[a.length][b.length];
}

export interface SpellResult {
  text: string;
  fixes: { from: string; to: string }[];
}

/**
 * How much to correct:
 *   prose — descriptions: every lower-case word is dictionary-checked;
 *           capitalised words mid-sentence are left alone (names, brands).
 *   title — titles ("Sales Forcasting Dashbord"): as prose, plus a
 *           capitalised word is corrected, but only to a common resume word
 *           (Dashbord → Dashboard; "Zomato" never becomes "Tomato").
 *   safe  — names of companies/colleges, skills, locations: only the
 *           curated typo list and proper casing, no dictionary guesses.
 */
export type SpellMode = 'prose' | 'title' | 'safe';

/** Fixes spelling in text. Never throws; returns the original on failure. */
export async function spellFix(input: string, opts: { mode?: SpellMode } = {}): Promise<SpellResult> {
  const mode = opts.mode ?? 'prose';
  const curated = cleanText(input);
  const fixes = [...curated.fixes];
  if (mode === 'safe') return { text: curated.text, fixes };
  const speller = await loadSpeller();
  if (!speller) return { text: curated.text, fixes };

  const text = curated.text.replace(/[A-Za-z][A-Za-z']*/g, (word, offset: number, whole: string) => {
    const lower = word.toLowerCase();
    if (word.length < 3 || ALLOW.has(lower)) return word;
    // Capitalised mid-sentence → likely a name/product; ALL CAPS → acronym.
    const atStart = offset === 0 || /[.!?\n]\s*$/.test(whole.slice(Math.max(0, offset - 3), offset));
    if (/[A-Z]/.test(word.slice(1))) return word;
    const capitalised = /^[A-Z]/.test(word);
    // Capitalised mid-sentence in prose → almost certainly a name/brand.
    if (capitalised && !atStart && mode !== 'title') return word;
    if (speller.correct(word) || speller.correct(lower)) return word;

    const maxEdits = word.length <= 5 ? 1 : 2;
    // Rank close candidates: common resume word → fewest edits → same first
    // letter → most shared start/end letters → same last letter.
    const ranked = speller
      .suggest(lower)
      .filter((s) => !/\s/.test(s))
      .map((s) => {
        const c = s.toLowerCase();
        return { s, d: distance(lower, c), pref: PREFERRED.has(c), first: c[0] === lower[0], ends: sharedEnds(lower, c), last: c.at(-1) === lower.at(-1) };
      })
      .filter((c) => c.d <= maxEdits)
      .sort((a, b) => Number(b.pref) - Number(a.pref) || a.d - b.d || Number(b.first) - Number(a.first) || b.ends - a.ends || Number(b.last) - Number(a.last));
    // Any other capitalised word (sentence start, or in a title) may still be
    // a name or brand: only fix it to a common resume word, or when the fix
    // keeps the first letter and is a single edit — typos almost never change
    // the first letter, while "Zomato" → "Tomato" would.
    const best = ranked[0];
    if (capitalised && best && !best.pref && !(best.first && best.d === 1)) return word;
    const pick = ranked[0]?.s;
    if (!pick) return word;
    const fixed = /^[A-Z]/.test(word) ? pick[0].toUpperCase() + pick.slice(1) : pick;
    fixes.push({ from: word, to: fixed });
    return fixed;
  });

  return { text, fixes };
}
