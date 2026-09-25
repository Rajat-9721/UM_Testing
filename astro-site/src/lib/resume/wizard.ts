// Resume Generator wizard (student portal).
//
// Layout: one step's form on the LEFT, the live resume on the RIGHT
// (sticky). Every edit updates the preview immediately and is autosaved.
// Steps: 0 Template · 1 Personal · 2 Education · 3 Skills · 4 Projects ·
// 5 Experience · 6 Certifications & Achievements · 7 AI · 8 Review & ATS.
// The ATS score is only ever shown on step 8.

import { requireRole, type TrustedProfile } from '../supabase';
import { analyzeJobDescription, correctTitle, enhanceResume, improveText, isTemplateAi, ResumeAiError, type ImproveField, type JdResult } from './ai';
import type { ExpandContext } from './expand';
import { computeAts } from './ats';
import {
  isMostlyEmpty,
  newAchievement,
  newCertification,
  newCustomSection,
  newEducation,
  newExperience,
  newProject,
  normaliseResume,
  sampleResume,
  seedFromProfile,
} from './defaults';
import { buildResumeDocx, downloadBlob, resumeFileName } from './exportDocx';
import { buildResumePdf } from './exportPdf';
import { buildDoc, resolveSections } from './model';
import { mountScaledResume } from './renderHtml';
import { createResume, getResume, loadPrograms, relativeTime, updateResume, usingLocalStorage } from './store';
import { groupFor, suggestSkills, TARGET_ROLES } from './suggestions';
import { getTemplate, SECTION_LABELS, TEMPLATES } from './templates';
import {
  ACHIEVEMENT_CATEGORIES,
  EXPERIENCE_TYPES,
  SKILL_GROUPS,
  type AtsResult,
  type ResumeData,
  type ResumeRecord,
  type SectionId,
  type TemplateId,
} from './types';
import { chipInput, field, h, select, textArea, textInput, toast } from './ui';
import { cleanText } from '../linkedin/textCleanup';
import { autocorrectResume, type AutoFix } from './autocorrect';
import { preloadSpeller } from './spell';

/** Skills: known typos + proper casing ("pyhton" → "Python", "tensorflow" → "TensorFlow"). */
const fixSkill = (v: string) => cleanText(v).text;

const STEP_TITLES = [
  'Choose Your Resume Template',
  'Personal Information',
  'Education',
  'Skills',
  'Projects',
  'Experience',
  'Certifications & Achievements',
  'AI Enhancement',
  'Review & ATS Score',
];
const LAST_STEP = STEP_TITLES.length - 1;

interface State {
  userId: string;
  profile: TrustedProfile;
  programs: string[];
  record: ResumeRecord | null;
  name: string;
  nameTouched: boolean;
  template: TemplateId;
  data: ResumeData;
  ats: AtsResult | null;
  status: 'draft' | 'complete';
  step: number;
  maxStep: number;
  jd: JdResult | null;
  /** AI undo history per field key (most recent last). */
  undo: Map<string, string[]>;
  /** Text as it was before AI first touched a field (for Regenerate). */
  original: Map<string, string>;
}

let S: State;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------- preview

let preview: ReturnType<typeof mountScaledResume>;
let previewQueued = false;

function refreshPreview() {
  if (previewQueued) return;
  previewQueued = true;
  requestAnimationFrame(() => {
    previewQueued = false;
    const showSample = S.step === 0 && isMostlyEmpty(S.data);
    $('previewNote').hidden = !showSample;
    preview.update(buildDoc(showSample ? sampleResume() : S.data, S.template, { placeholders: true }));
    if (S.step === LAST_STEP) renderAts();
  });
}

// ---------------------------------------------------------------- saving

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saving = false;
let saveAgain = false;

const BACKUP_KEY = () => `um-resume-backup:${S.userId}:${S.record?.id ?? 'new'}`;

function setSaveStatus(text: string, kind: 'ok' | 'busy' | 'error' = 'ok') {
  const el = $('saveStatus');
  el.textContent = text;
  el.dataset.kind = kind;
}

function backup() {
  try {
    localStorage.setItem(BACKUP_KEY(), JSON.stringify({ savedAt: new Date().toISOString(), name: S.name, template: S.template, data: S.data }));
  } catch {
    /* storage unavailable */
  }
}

function clearBackup() {
  try {
    localStorage.removeItem(BACKUP_KEY());
  } catch {
    /* ignore */
  }
}

/** Something changed: refresh the preview and autosave shortly. */
function changed(opts: { preview?: boolean } = {}) {
  if (opts.preview !== false) refreshPreview();
  if (!S.nameTouched) {
    const role = S.data.personal.targetRole.trim();
    S.name = role ? `${role} Resume` : 'My Resume';
    $<HTMLInputElement>('resumeName').value = S.name;
  }
  backup();
  if (!S.record && S.step === 0) return; // saved once a template is chosen
  setSaveStatus('Saving…', 'busy');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 900);
}

async function save(extra: { status?: 'draft' | 'complete'; ats?: AtsResult | null } = {}) {
  if (saving) {
    saveAgain = true;
    return;
  }
  saving = true;
  clearTimeout(saveTimer);
  try {
    const payload = { name: S.name.trim() || 'Untitled Resume', template: S.template, data: S.data, ...(extra.status ? { status: extra.status } : {}), ...(extra.ats !== undefined ? { ats: extra.ats } : {}) };
    if (!S.record) {
      const oldKey = BACKUP_KEY();
      S.record = await createResume(S.userId, { ...payload, status: extra.status ?? 'draft', ats: extra.ats ?? null });
      try {
        localStorage.removeItem(oldKey);
      } catch {
        /* ignore */
      }
      const url = new URL(window.location.href);
      url.searchParams.set('id', S.record.id);
      history.replaceState(null, '', url);
    } else {
      S.record.updated_at = await updateResume(S.userId, S.record.id, payload);
    }
    clearBackup();
    setSaveStatus(usingLocalStorage() ? 'Saved on this device' : 'Saved · just now');
  } catch (error) {
    backup();
    setSaveStatus('Not saved — will retry', 'error');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 5000);
    console.error(error);
  } finally {
    saving = false;
    if (saveAgain) {
      saveAgain = false;
      save();
    }
  }
}

// Keep "Saved · just now" honest as time passes.
setInterval(() => {
  if (S?.record && $('saveStatus').dataset.kind === 'ok' && !usingLocalStorage()) {
    setSaveStatus(`Saved · ${relativeTime(S.record.updated_at)}`);
  }
}, 30_000);

// ---------------------------------------------------------------- steps

function setStep(step: number) {
  S.step = Math.max(0, Math.min(LAST_STEP, step));
  if (S.step !== LAST_STEP) spellUndone = false;
  S.maxStep = Math.max(S.maxStep, S.step);
  renderStepper();
  renderStep();
  refreshPreview();
  const url = new URL(window.location.href);
  url.searchParams.set('step', String(S.step + 1));
  history.replaceState(null, '', url);
  $('stepPanel').focus({ preventScroll: true });
  if (window.matchMedia('(max-width: 1023px)').matches) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderStepper() {
  document.querySelectorAll<HTMLButtonElement>('.rg-step').forEach((btn) => {
    const i = Number(btn.dataset.step);
    btn.disabled = i > S.maxStep;
    btn.classList.toggle('is-current', i === S.step);
    btn.classList.toggle('is-done', i < S.maxStep && i !== S.step);
    if (i === S.step) btn.setAttribute('aria-current', 'step');
    else btn.removeAttribute('aria-current');
  });
  $<HTMLButtonElement>('backBtn').hidden = S.step === 0;
  const next = $<HTMLButtonElement>('nextBtn');
  next.hidden = S.step === 0 || S.step === LAST_STEP;
  next.textContent = S.step === LAST_STEP - 1 ? 'Review & ATS Score' : 'Next';
}

function stepHeader(title: string, hint?: string) {
  return h('div', { class: 'rg-step-head' }, h('p', { class: 'rg-kicker', text: `Step ${S.step + 1} of ${STEP_TITLES.length}` }), h('h2', { text: title }), hint ? h('p', { class: 'rg-lead', text: hint }) : null);
}

function renderStep() {
  const panel = $('stepPanel');
  const builders = [stepTemplate, stepPersonal, stepEducation, stepSkills, stepProjects, stepExperience, stepCertifications, stepAi, stepReview];
  panel.replaceChildren(stepHeader(STEP_TITLES[S.step], STEP_HINTS[S.step]), builders[S.step]());
  if (S.step === LAST_STEP) void checkWholeResume();
}

// ---------------------------------------------------------------- whole-resume spelling

/** Set after "Undo all" so the review step doesn't immediately re-correct. */
let spellUndone = false;
let lastSpellFix: { fixes: AutoFix[]; before: ResumeData } | null = null;

/** Autocorrects every field of the resume; shows what changed on the review step. */
async function checkWholeResume(): Promise<number> {
  if (spellUndone) {
    renderSpellSummary(lastSpellFix?.fixes ?? [], true);
    return 0;
  }
  const before: ResumeData = JSON.parse(JSON.stringify(S.data));
  const fixes = await autocorrectResume(S.data);
  if (fixes.length) {
    lastSpellFix = { fixes, before };
    changed();
  }
  renderSpellSummary(fixes.length ? fixes : lastSpellFix?.fixes ?? [], false, fixes.length === 0 && !lastSpellFix);
  return fixes.length;
}

function renderSpellSummary(fixes: AutoFix[], undone: boolean, clean = false) {
  const host = document.getElementById('spellHost');
  if (!host) return;
  if (undone) {
    host.replaceChildren(h('p', { class: 'rg-spell', text: 'Spelling corrections were undone. Your original text is kept.' }));
    return;
  }
  if (clean || !fixes.length) {
    host.replaceChildren(h('p', { class: 'rg-spell rg-spell--ok', text: '✓ Spelling checked across your whole resume — no mistakes found.' }));
    return;
  }
  const undo = h('button', { class: 'rg-link-btn', text: 'Undo all', attrs: { type: 'button' } });
  undo.addEventListener('click', () => {
    if (!lastSpellFix) return;
    S.data = lastSpellFix.before;
    spellUndone = true;
    changed();
    renderStep();
    toast('Spelling corrections undone');
  });
  const list = h('ul', { class: 'rg-spell__list' }, ...fixes.slice(0, 12).map((f) => h('li', {}, h('span', { class: 'rg-spell__where', text: `${f.where}: ` }), h('s', { text: f.from }), ' → ', h('strong', { text: f.to }))));
  host.replaceChildren(
    h(
      'div',
      { class: 'rg-spell rg-spell--fixed', attrs: { role: 'status' } },
      h('p', {}, h('strong', { text: `✓ We corrected ${fixes.length} spelling ${fixes.length === 1 ? 'mistake' : 'mistakes'} across your resume. ` }), undo),
      list,
      fixes.length > 12 ? h('p', { class: 'rg-hint', text: `+ ${fixes.length - 12} more` }) : null,
    ),
  );
}

const STEP_HINTS = [
  'Pick a look to start with — you can switch at any time without losing anything.',
  'Pre-filled from your profile where available. Everything is editable.',
  'Add your degree, school or program. Most recent first.',
  'Add skills you can confidently discuss. Press Enter after each one.',
  'Projects are the strongest proof of skill for students. Describe what you built and with which tools.',
  'Internships, jobs, freelance or part-time work.',
  'Certificates you earned and achievements you are proud of.',
  'Let AI polish your wording. It only works with what you entered — nothing is invented, and every change can be edited or undone.',
  'Your ATS score, improvement suggestions and downloads.',
];

// A repeatable list of entry cards with add / remove / move up-down.
function repeatable<T extends { id: string }>(opts: {
  items: T[];
  label: (item: T, i: number) => string;
  body: (item: T) => HTMLElement[];
  create: () => T;
  addLabel: string;
  empty?: string;
}): HTMLElement {
  const wrap = h('div', { class: 'rg-list' });
  const rerender = () => wrap.replaceWith(repeatable(opts));
  opts.items.forEach((item, i) => {
    const actions = h(
      'div',
      { class: 'rg-entry__actions' },
      h('button', { class: 'rg-icon-btn', text: '↑', attrs: { type: 'button', 'aria-label': 'Move up', disabled: i === 0 }, on: { click: () => { [opts.items[i - 1], opts.items[i]] = [opts.items[i], opts.items[i - 1]]; changed(); rerender(); } } }),
      h('button', { class: 'rg-icon-btn', text: '↓', attrs: { type: 'button', 'aria-label': 'Move down', disabled: i === opts.items.length - 1 }, on: { click: () => { [opts.items[i + 1], opts.items[i]] = [opts.items[i], opts.items[i + 1]]; changed(); rerender(); } } }),
      h('button', { class: 'rg-icon-btn rg-icon-btn--danger', text: 'Remove', attrs: { type: 'button' }, on: { click: () => { opts.items.splice(i, 1); changed(); rerender(); } } }),
    );
    wrap.append(h('div', { class: 'rg-entry' }, h('div', { class: 'rg-entry__head' }, h('h3', { text: opts.label(item, i) }), actions), h('div', { class: 'rg-grid' }, ...opts.body(item))));
  });
  if (!opts.items.length && opts.empty) wrap.append(h('p', { class: 'rg-empty', text: opts.empty }));
  wrap.append(
    h('button', {
      class: 'rg-add',
      text: `+ ${opts.addLabel}`,
      attrs: { type: 'button' },
      on: {
        click: () => {
          opts.items.push(opts.create());
          changed();
          rerender();
          requestAnimationFrame(() => {
            const cards = document.querySelectorAll<HTMLElement>('.rg-entry');
            cards[cards.length - 1]?.querySelector<HTMLElement>('input, textarea, select')?.focus();
          });
        },
      },
    }),
  );
  return wrap;
}

// ---- AI helpers shared by several steps ----
function aiFailure(error: unknown) {
  toast(error instanceof ResumeAiError ? error.message : 'AI help failed. Please try again.', 'error');
}

/** Applies AI text to a field, remembering the previous value for Undo. */
function applyAi(key: string, current: string, next: string, set: (v: string) => void) {
  if (!S.original.has(key)) S.original.set(key, current);
  const stack = S.undo.get(key) ?? [];
  stack.push(current);
  S.undo.set(key, stack);
  set(next);
  changed();
}

function undoAi(key: string, set: (v: string) => void) {
  const stack = S.undo.get(key);
  const prev = stack?.pop();
  if (prev === undefined) return;
  set(prev);
  if (!stack!.length) S.original.delete(key);
  changed();
}

/**
 * "Improve with AI" for a single textarea: shows the suggestion with
 * Accept / Edit / Reject (never replaces text silently).
 */
function improveBox(opts: {
  key: string;
  field: ImproveField;
  area: HTMLTextAreaElement;
  get: () => string;
  set: (v: string) => void;
  context?: () => ExpandContext;
  /** The entry's title field — its spelling is corrected on Accept too. */
  title?: { get: () => string; set: (v: string) => void };
}): HTMLElement {
  const box = h('div', { class: 'rg-ai' });
  const btn = h('button', { class: 'rg-ai-btn', text: '✨ Improve with AI', attrs: { type: 'button' } });
  const undoBtn = h('button', { class: 'rg-link-btn', text: 'Undo AI change', attrs: { type: 'button', hidden: !(S.undo.get(opts.key)?.length) } });
  const result = h('div', { class: 'rg-ai__result', attrs: { hidden: true } });

  undoBtn.addEventListener('click', () => {
    undoAi(opts.key, opts.set);
    opts.area.value = opts.get();
    undoBtn.hidden = !(S.undo.get(opts.key)?.length);
    toast('Previous text restored');
  });

  btn.addEventListener('click', async () => {
    const text = opts.get().trim();
    const context = opts.context?.() ?? {};
    if (!text && !context.title?.trim() && opts.field !== 'summary') {
      toast('Add a title or a short description first, then improve it.', 'error');
      opts.area.focus();
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Improving…';
    try {
      const [suggestion, fixedTitle] = await Promise.all([
        improveText(opts.field, text, S.data, context),
        opts.title?.get().trim() ? correctTitle(opts.title.get()) : Promise.resolve(''),
      ]);
      const titleChanged = !!opts.title && !!fixedTitle && fixedTitle !== opts.title.get().trim();
      const proposal = h('p', { class: 'rg-ai__text', text: suggestion });
      const accept = h('button', { class: 'rg-btn rg-btn--primary rg-btn--sm', text: 'Accept', attrs: { type: 'button' } });
      const edit = h('button', { class: 'rg-btn rg-btn--ghost rg-btn--sm', text: 'Edit', attrs: { type: 'button' } });
      const reject = h('button', { class: 'rg-btn rg-btn--ghost rg-btn--sm', text: 'Reject', attrs: { type: 'button' } });
      const done = () => {
        result.hidden = true;
        result.replaceChildren();
        undoBtn.hidden = !(S.undo.get(opts.key)?.length);
      };
      // Applies the suggestion (and the corrected title); re-renders the step
      // when the title changed so its input shows the fix.
      const apply = (focus: boolean) => {
        applyAi(opts.key, opts.get(), suggestion, opts.set);
        opts.area.value = suggestion;
        done();
        if (titleChanged) {
          opts.title!.set(fixedTitle);
          changed();
          const id = opts.area.id;
          renderStep();
          if (focus) requestAnimationFrame(() => document.getElementById(id)?.focus());
        } else if (focus) {
          opts.area.focus();
        }
      };
      accept.addEventListener('click', () => {
        apply(false);
        toast('AI suggestion applied');
      });
      edit.addEventListener('click', () => apply(true));
      reject.addEventListener('click', done);
      result.replaceChildren(
        h('p', { class: 'rg-ai__label', text: isTemplateAi ? 'Suggested points (template mode)' : 'AI suggestion' }),
        titleChanged ? h('p', { class: 'rg-hint', text: `Title spelling will also be corrected to “${fixedTitle}”.` }) : null,
        proposal,
        h('p', { class: 'rg-hint rg-ai__warn', text: 'Spelling corrected and points added. Keep only what is true for you — edit or delete anything that isn’t.' }),
        h('div', { class: 'rg-ai__actions' }, accept, edit, reject),
      );
      result.hidden = false;
    } catch (error) {
      aiFailure(error);
    } finally {
      btn.disabled = false;
      btn.textContent = '✨ Improve with AI';
    }
  });

  box.append(h('div', { class: 'rg-ai__bar' }, btn, undoBtn), result);
  return box;
}

// ---------------------------------------------------------------- step 1: template

function templateCard(tplId: TemplateId): HTMLElement {
  const tpl = getTemplate(tplId);
  const selected = S.template === tplId && !!S.record;
  const thumb = h('div', { class: 'rg-thumb', attrs: { 'aria-hidden': 'true' } });
  const mount = mountScaledResume(thumb);
  requestAnimationFrame(() => mount.update(buildDoc(sampleResume(), tplId)));

  const use = h('button', { class: 'rg-btn rg-btn--primary rg-btn--sm', text: selected ? 'Selected' : 'Use Template', attrs: { type: 'button' } });
  use.addEventListener('click', () => chooseTemplate(tplId, true));
  const prev = h('button', { class: 'rg-btn rg-btn--ghost rg-btn--sm', text: 'Preview', attrs: { type: 'button' } });
  prev.addEventListener('click', () => openTemplatePreview(tplId));

  return h(
    'article',
    { class: `rg-tpl${selected ? ' is-selected' : ''}` },
    thumb,
    h('div', { class: 'rg-tpl__body' }, h('div', { class: 'rg-tpl__title' }, h('h3', { text: tpl.name }), h('span', { class: 'rg-badge', text: 'ATS Friendly' })), h('p', { text: tpl.description }), h('div', { class: 'rg-tpl__actions' }, prev, use)),
  );
}

function stepTemplate(): HTMLElement {
  return h('div', { class: 'rg-tpl-grid' }, ...TEMPLATES.map((t) => templateCard(t.id)));
}

async function chooseTemplate(id: TemplateId, advance: boolean) {
  S.template = id;
  $<HTMLSelectElement>('templateSelect').value = id;
  refreshPreview();
  if (!S.record) {
    setSaveStatus('Saving…', 'busy');
    await save();
  } else {
    changed();
  }
  toast(`${getTemplate(id).name} selected`);
  if (advance && S.step === 0) setStep(1);
  else if (S.step === 0) renderStep();
}

let modalMount: ReturnType<typeof mountScaledResume> | null = null;

function openTemplatePreview(id: TemplateId) {
  modalMount?.destroy();
  const mount = (modalMount = mountScaledResume($('templateModalHost')));
  $('templateModalTitle').textContent = getTemplate(id).name;
  $('templateModal').classList.add('active');
  requestAnimationFrame(() => mount.update(buildDoc(isMostlyEmpty(S.data) ? sampleResume() : S.data, id, { placeholders: true })));
  const use = $<HTMLButtonElement>('templateModalUse');
  use.onclick = () => {
    $('templateModal').classList.remove('active');
    chooseTemplate(id, true);
  };
}

// ---------------------------------------------------------------- step 2: personal

function stepPersonal(): HTMLElement {
  const p = S.data.personal;
  const set = (key: keyof typeof p) => (v: string) => {
    p[key] = v;
    changed();
  };
  const roles = h('datalist', { attrs: { id: 'roleOptions' } }, ...TARGET_ROLES.map((r) => h('option', { attrs: { value: r } })));
  return h(
    'div',
    { class: 'rg-grid' },
    field('Full Name', textInput(p.fullName, set('fullName'), { maxlength: 80, autocomplete: 'name' })),
    field('Target Job Role', textInput(p.targetRole, set('targetRole'), { placeholder: 'e.g. Data Analyst', list: 'roleOptions', maxlength: 80, autocorrect: 'title' }), { hint: 'Used to tailor keywords and AI suggestions.' }),
    field('Email', textInput(p.email, set('email'), { type: 'email', maxlength: 120, autocomplete: 'email' })),
    field('Phone Number', textInput(p.phone, set('phone'), { type: 'tel', maxlength: 30, autocomplete: 'tel' })),
    field('Location', textInput(p.location, set('location'), { placeholder: 'City, State', maxlength: 80, autocorrect: 'safe' }), { optional: true }),
    field('LinkedIn URL', textInput(p.linkedin, set('linkedin'), { placeholder: 'linkedin.com/in/your-name', maxlength: 200 }), { optional: true }),
    field('GitHub URL', textInput(p.github, set('github'), { placeholder: 'github.com/your-username', maxlength: 200 }), { optional: true }),
    field('Portfolio URL', textInput(p.portfolio, set('portfolio'), { placeholder: 'your-portfolio.com', maxlength: 200 }), { optional: true }),
    roles,
  );
}

// ---------------------------------------------------------------- step 3: education

function stepEducation(): HTMLElement {
  return repeatable({
    items: S.data.education,
    label: (e, i) => e.degree.trim() || `Education ${i + 1}`,
    create: newEducation,
    addLabel: 'Add Education',
    empty: 'No education added yet.',
    body: (e) => [
      field('Degree / Course', textInput(e.degree, (v) => { e.degree = v; changed(); }, { placeholder: 'e.g. B.Tech in Computer Engineering', maxlength: 150, autocorrect: 'title' }), { wide: true }),
      field('College / University', textInput(e.institution, (v) => { e.institution = v; changed(); }, { maxlength: 150, autocorrect: 'safe' }), { wide: true }),
      field('Start Year', textInput(e.startYear, (v) => { e.startYear = v; changed(); }, { placeholder: '2022', maxlength: 20 })),
      field('End Year', textInput(e.endYear, (v) => { e.endYear = v; changed(); }, { placeholder: '2026 or Present', maxlength: 20 })),
      field('CGPA / Percentage', textInput(e.score, (v) => { e.score = v; changed(); }, { placeholder: 'e.g. CGPA 8.4 or 85%', maxlength: 40 }), { optional: true }),
      field('Relevant Coursework', textInput(e.coursework, (v) => { e.coursework = v; changed(); }, { placeholder: 'e.g. DBMS, Statistics', maxlength: 300, autocorrect: 'title' }), { optional: true }),
    ],
  });
}

// ---------------------------------------------------------------- step 4: skills

function stepSkills(): HTMLElement {
  const inputs = new Map<string, ReturnType<typeof chipInput>>();
  const groups = h(
    'div',
    { class: 'rg-skill-groups' },
    ...SKILL_GROUPS.map((g) => {
      const chips = chipInput(S.data.skills[g.key], (values) => {
        S.data.skills[g.key] = values;
        changed();
        renderSuggestions();
      }, { label: g.label, placeholder: g.key === 'soft' ? 'e.g. Communication' : 'Type a skill, press Enter', transform: fixSkill });
      inputs.set(g.key, chips);
      return field(g.label, chips, { wide: true });
    }),
  );

  const sugWrap = h('div', { class: 'rg-suggest' });
  const renderSuggestions = () => {
    const existing = Object.values(S.data.skills).flat();
    const list = suggestSkills({ programs: S.programs, targetRole: S.data.personal.targetRole, existing, dismissed: S.data.dismissedSuggestions });
    sugWrap.replaceChildren(
      h('div', { class: 'rg-suggest__head' }, h('h3', { text: '✨ AI Suggestions' }), h('p', { class: 'rg-hint', text: 'Based on your program and target role. Add only skills you actually have — nothing is added automatically.' })),
    );
    if (!list.length) {
      sugWrap.append(h('p', { class: 'rg-empty', text: S.programs.length || S.data.personal.targetRole ? 'No more suggestions — nice coverage.' : 'Add a target job role in Personal Information to see suggestions.' }));
      return;
    }
    const chips = h('div', { class: 'rg-suggest__chips' });
    for (const s of list) {
      const add = h('button', { class: 'rg-sugg__btn', text: '+ Add', attrs: { type: 'button', 'aria-label': `Add ${s.name}` } });
      add.addEventListener('click', () => {
        S.data.skills[s.group] = [...S.data.skills[s.group], s.name];
        changed();
        renderStep(); // rebuild chip inputs with the new value
        toast(`${s.name} added to ${SKILL_GROUPS.find((g) => g.key === s.group)!.label}`);
      });
      const edit = h('button', { class: 'rg-sugg__btn', text: 'Edit', attrs: { type: 'button', 'aria-label': `Edit ${s.name} before adding` } });
      edit.addEventListener('click', () => inputs.get(s.group)?.prefill(s.name));
      const remove = h('button', { class: 'rg-sugg__btn', text: '×', attrs: { type: 'button', 'aria-label': `Dismiss ${s.name}` } });
      remove.addEventListener('click', () => {
        S.data.dismissedSuggestions = [...S.data.dismissedSuggestions, s.name.toLowerCase()];
        changed({ preview: false });
        renderSuggestions();
      });
      chips.append(h('span', { class: 'rg-sugg', attrs: { title: s.reason } }, h('span', { class: 'rg-sugg__name', text: s.name }), add, edit, remove));
    }
    sugWrap.append(chips);
  };
  renderSuggestions();
  return h('div', {}, groups, sugWrap);
}

// ---------------------------------------------------------------- step 5: projects

function stepProjects(): HTMLElement {
  return repeatable({
    items: S.data.projects,
    label: (p, i) => p.name.trim() || `Project ${i + 1}`,
    create: newProject,
    addLabel: 'Add Project',
    empty: 'No projects yet — add your best one or two.',
    body: (p) => {
      const area = textArea(p.description, (v) => { p.description = v; changed(); }, { rows: 4, placeholder: 'e.g. Made an AI chatbot using Python.\n(One point per line)', maxlength: 1500, autocorrect: 'prose' });
      return [
        field('Project Name', textInput(p.name, (v) => { p.name = v; changed(); }, { maxlength: 120, autocorrect: 'title' }), { wide: true }),
        h('div', { class: 'form-group rg-wide' }, h('label', { text: 'Project Description', attrs: { for: area.id || (area.id = `pd-${p.id}`) } }), area, improveBox({ key: `project:${p.id}`, field: 'project', area, get: () => p.description, set: (v) => (p.description = v), context: () => ({ title: p.name, technologies: p.technologies }), title: { get: () => p.name, set: (v) => (p.name = v) } })),
        field('Technologies Used', chipInput(p.technologies, (v) => { p.technologies = v; changed(); }, { label: 'Technologies used', placeholder: 'e.g. Python, press Enter', transform: fixSkill }), { wide: true }),
        field('GitHub URL', textInput(p.githubUrl, (v) => { p.githubUrl = v; changed(); }, { maxlength: 200 }), { optional: true }),
        field('Live Demo URL', textInput(p.liveUrl, (v) => { p.liveUrl = v; changed(); }, { maxlength: 200 }), { optional: true }),
        field('Project Duration', textInput(p.duration, (v) => { p.duration = v; changed(); }, { placeholder: 'e.g. Jan 2025 – Mar 2025', maxlength: 40 }), { optional: true }),
      ];
    },
  });
}

// ---------------------------------------------------------------- step 6: experience

function stepExperience(): HTMLElement {
  const wrap = h('div');
  const toggle = h('input', { attrs: { type: 'checkbox', id: 'noExperience' } });
  toggle.checked = S.data.noExperience;
  toggle.addEventListener('change', () => {
    S.data.noExperience = toggle.checked;
    changed();
    renderStep();
  });
  wrap.append(h('label', { class: 'rg-check', attrs: { for: 'noExperience' } }, toggle, " I don't have experience yet"));

  if (S.data.noExperience) {
    wrap.append(
      h(
        'div',
        { class: 'rg-note' },
        h('strong', { text: 'That’s completely fine for a fresher resume.' }),
        h('p', { text: 'Recruiters will focus on your Education, Projects, Skills, Certifications and Achievements — make those sections strong. The Fresher / Student template puts them first.' }),
      ),
    );
    return wrap;
  }

  wrap.append(
    repeatable({
      items: S.data.experience,
      label: (e, i) => [e.title.trim(), e.company.trim()].filter(Boolean).join(' — ') || `Experience ${i + 1}`,
      create: newExperience,
      addLabel: 'Add Experience',
      empty: 'No experience added yet.',
      body: (e) => {
        const area = textArea(e.responsibilities, (v) => { e.responsibilities = v; changed(); }, { rows: 4, placeholder: 'What did you do? One point per line.', maxlength: 1500, autocorrect: 'prose' });
        area.id = `resp-${e.id}`;
        const current = h('input', { attrs: { type: 'checkbox', id: `cur-${e.id}` } });
        current.checked = e.current;
        const endInput = textInput(e.endDate, (v) => { e.endDate = v; changed(); }, { placeholder: 'e.g. Aug 2025', maxlength: 30 });
        endInput.disabled = e.current;
        current.addEventListener('change', () => {
          e.current = current.checked;
          endInput.disabled = current.checked;
          changed();
        });
        return [
          field('Type', select(EXPERIENCE_TYPES, e.type, (v) => { e.type = v as typeof e.type; changed(); })),
          field('Job Title', textInput(e.title, (v) => { e.title = v; changed(); }, { maxlength: 120, autocorrect: 'title' })),
          field('Company', textInput(e.company, (v) => { e.company = v; changed(); }, { maxlength: 120, autocorrect: 'safe' })),
          field('Location', textInput(e.location, (v) => { e.location = v; changed(); }, { maxlength: 80, autocorrect: 'safe' }), { optional: true }),
          field('Start Date', textInput(e.startDate, (v) => { e.startDate = v; changed(); }, { placeholder: 'e.g. Jun 2025', maxlength: 30 })),
          h('div', { class: 'form-group' }, h('label', { text: 'End Date', attrs: { for: endInput.id || (endInput.id = `end-${e.id}`) } }), endInput, h('label', { class: 'rg-check rg-check--sm', attrs: { for: current.id } }, current, ' I currently work here')),
          h('div', { class: 'form-group rg-wide' }, h('label', { text: 'Responsibilities', attrs: { for: area.id } }), area, improveBox({ key: `experience:${e.id}`, field: 'experience', area, get: () => e.responsibilities, set: (v) => (e.responsibilities = v), context: () => ({ title: [e.title, e.company].filter(Boolean).join(' at '), role: e.title }) })),
          field('Achievements', textArea(e.achievements, (v) => { e.achievements = v; changed(); }, { rows: 2, placeholder: 'One per line — only what actually happened.', maxlength: 800, autocorrect: 'prose' }), { optional: true, wide: true }),
        ];
      },
    }),
  );
  return wrap;
}

/** A details textarea with "Improve with AI" (achievements, certifications). */
function detailsWithAi(opts: { key: string; field: ImproveField; label: string; placeholder: string; get: () => string; set: (v: string) => void; context: () => ExpandContext; title?: { get: () => string; set: (v: string) => void } }): HTMLElement {
  const area = textArea(opts.get(), (v) => { opts.set(v); changed(); }, { rows: 3, placeholder: opts.placeholder, maxlength: 1000, autocorrect: 'prose' });
  area.id = `det-${opts.key.replace(/[^a-z0-9]/gi, '-')}`;
  return h(
    'div',
    { class: 'form-group rg-wide' },
    h('label', { attrs: { for: area.id } }, opts.label, h('span', { class: 'rg-optional', text: ' (optional)' })),
    area,
    improveBox({ key: opts.key, field: opts.field, area, get: opts.get, set: opts.set, context: opts.context, title: opts.title }),
  );
}

// ---------------------------------------------------------------- step 7: certifications & achievements

function stepCertifications(): HTMLElement {
  return h(
    'div',
    { class: 'rg-stack' },
    h('h3', { class: 'rg-subhead', text: 'Certifications' }),
    repeatable({
      items: S.data.certifications,
      label: (c, i) => c.name.trim() || `Certification ${i + 1}`,
      create: newCertification,
      addLabel: 'Add Certification',
      body: (c) => [
        field('Certification Name', textInput(c.name, (v) => { c.name = v; changed(); }, { maxlength: 150, autocorrect: 'title' }), { wide: true }),
        field('Issuing Organization', textInput(c.issuer, (v) => { c.issuer = v; changed(); }, { maxlength: 120, autocorrect: 'safe' })),
        field('Date', textInput(c.date, (v) => { c.date = v; changed(); }, { placeholder: 'e.g. Mar 2025', maxlength: 30 })),
        field('Credential URL', textInput(c.url, (v) => { c.url = v; changed(); }, { maxlength: 200 }), { optional: true, wide: true }),
        detailsWithAi({ key: `certification:${c.id}`, field: 'certification', label: 'Details / Skills Covered', placeholder: 'What did it cover? One point per line — or leave empty and use Improve with AI.', get: () => c.description, set: (v) => (c.description = v), context: () => ({ title: c.name, issuer: c.issuer }), title: { get: () => c.name, set: (v) => (c.name = v) } }),
      ],
    }),
    h('h3', { class: 'rg-subhead', text: 'Achievements' }),
    repeatable({
      items: S.data.achievements,
      label: (a, i) => a.title.trim() || `Achievement ${i + 1}`,
      create: newAchievement,
      addLabel: 'Add Achievement',
      body: (a) => [
        field('Category', select(ACHIEVEMENT_CATEGORIES, a.category, (v) => { a.category = v as typeof a.category; changed(); })),
        field('Date', textInput(a.date, (v) => { a.date = v; changed(); }, { maxlength: 30 }), { optional: true }),
        field('Title', textInput(a.title, (v) => { a.title = v; changed(); }, { placeholder: 'e.g. Finalist, Smart India Hackathon 2025', maxlength: 200, autocorrect: 'title' }), { wide: true }),
        detailsWithAi({ key: `achievement:${a.id}`, field: 'achievement', label: 'Details', placeholder: 'What did you do? One point per line — or leave empty and use Improve with AI.', get: () => a.description, set: (v) => (a.description = v), context: () => ({ title: a.title, category: a.category }), title: { get: () => a.title, set: (v) => (a.title = v) } }),
      ],
    }),
  );
}

// ---------------------------------------------------------------- step 8: AI enhancement

function aiFieldCard(opts: { key: string; field: ImproveField; title: string; get: () => string; set: (v: string) => void; rows?: number; placeholder?: string; context?: () => ExpandContext }): HTMLElement {
  const area = textArea(opts.get(), (v) => { opts.set(v); changed(); }, { rows: opts.rows ?? 4, placeholder: opts.placeholder, maxlength: 2000, autocorrect: 'prose' });
  area.id = `ai-${opts.key.replace(/[^a-z0-9]/gi, '-')}`;
  const improve = h('button', { class: 'rg-ai-btn', attrs: { type: 'button' } });
  const regen = h('button', { class: 'rg-btn rg-btn--ghost rg-btn--sm', text: 'Regenerate', attrs: { type: 'button' } });
  const undo = h('button', { class: 'rg-btn rg-btn--ghost rg-btn--sm', text: 'Undo', attrs: { type: 'button' } });
  const sync = () => {
    improve.textContent = opts.field === 'summary' && !opts.get().trim() ? '✨ Write with AI' : '✨ Improve with AI';
    regen.hidden = !S.original.has(opts.key);
    undo.hidden = !(S.undo.get(opts.key)?.length);
  };
  const run = async (source: string, button: HTMLButtonElement) => {
    const context = opts.context?.() ?? {};
    if (!source.trim() && !context.title?.trim() && opts.field !== 'summary') return toast('Add some text first.', 'error');
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Working…';
    try {
      const next = await improveText(opts.field, source, S.data, context);
      applyAi(opts.key, opts.get(), next, opts.set);
      area.value = next;
    } catch (error) {
      aiFailure(error);
    } finally {
      button.disabled = false;
      button.textContent = label;
      sync();
    }
  };
  improve.addEventListener('click', () => run(opts.get(), improve));
  regen.addEventListener('click', () => run(S.original.get(opts.key) ?? opts.get(), regen));
  undo.addEventListener('click', () => {
    undoAi(opts.key, opts.set);
    area.value = opts.get();
    sync();
  });
  area.addEventListener('input', sync);
  sync();
  return h('div', { class: 'rg-ai-card' }, h('label', { class: 'rg-ai-card__title', text: opts.title, attrs: { for: area.id } }), area, h('div', { class: 'rg-ai__bar' }, improve, regen, undo));
}

function stepAi(): HTMLElement {
  const wrap = h('div', { class: 'rg-stack' });

  const enhanceBtn = h('button', { class: 'rg-btn rg-btn--accent', text: '✨ Enhance Resume with AI', attrs: { type: 'button' } });
  enhanceBtn.addEventListener('click', async () => {
    enhanceBtn.disabled = true;
    enhanceBtn.textContent = 'Enhancing…';
    try {
      await runEnhance();
      toast('Resume enhanced — review each section below. Undo restores your text.');
      renderStep();
    } catch (error) {
      aiFailure(error);
      enhanceBtn.disabled = false;
      enhanceBtn.textContent = '✨ Enhance Resume with AI';
    }
  });
  wrap.append(
    h(
      'div',
      { class: 'rg-note rg-note--accent' },
      h('p', { text: `Polishes your summary, project descriptions and experience points${S.data.personal.targetRole ? ` for a ${S.data.personal.targetRole} role` : ''}: stronger action verbs, clearer wording, better keywords. It never adds skills, projects, experience or numbers you didn't provide.` }),
      enhanceBtn,
      isTemplateAi ? h('p', { class: 'rg-hint', text: 'Template mode: wording is tidied with rules. Real AI rewriting turns on once the AI service is connected.' }) : null,
    ),
  );

  wrap.append(h('h3', { class: 'rg-subhead', text: 'Professional Summary' }));
  wrap.append(aiFieldCard({ key: 'summary', field: 'summary', title: 'Summary', get: () => S.data.summary, set: (v) => (S.data.summary = v), rows: 5, placeholder: 'Leave empty and press “Write with AI” to draft one from your details.' }));

  const projects = S.data.projects.filter((p) => p.name.trim() || p.description.trim());
  if (projects.length) {
    wrap.append(h('h3', { class: 'rg-subhead', text: 'Project Descriptions' }));
    projects.forEach((p) => wrap.append(aiFieldCard({ key: `project:${p.id}`, field: 'project', title: p.name || 'Project', get: () => p.description, set: (v) => (p.description = v), context: () => ({ title: p.name, technologies: p.technologies }) })));
  }
  const jobs = S.data.noExperience ? [] : S.data.experience.filter((e) => e.company.trim() || e.title.trim());
  if (jobs.length) {
    wrap.append(h('h3', { class: 'rg-subhead', text: 'Experience' }));
    jobs.forEach((e) => wrap.append(aiFieldCard({ key: `experience:${e.id}`, field: 'experience', title: [e.title, e.company].filter(Boolean).join(' — '), get: () => e.responsibilities, set: (v) => (e.responsibilities = v), context: () => ({ title: [e.title, e.company].filter(Boolean).join(' at '), role: e.title }) })));
  }
  const certs = S.data.certifications.filter((c) => c.name.trim());
  if (certs.length) {
    wrap.append(h('h3', { class: 'rg-subhead', text: 'Certifications' }));
    certs.forEach((c) => wrap.append(aiFieldCard({ key: `certification:${c.id}`, field: 'certification', title: c.name, rows: 3, get: () => c.description, set: (v) => (c.description = v), context: () => ({ title: c.name, issuer: c.issuer }) })));
  }
  const wins = S.data.achievements.filter((a) => a.title.trim());
  if (wins.length) {
    wrap.append(h('h3', { class: 'rg-subhead', text: 'Achievements' }));
    wins.forEach((a) => wrap.append(aiFieldCard({ key: `achievement:${a.id}`, field: 'achievement', title: a.title, rows: 3, get: () => a.description, set: (v) => (a.description = v), context: () => ({ title: a.title, category: a.category }) })));
  }

  // Target role + job description optimisation
  wrap.append(h('h3', { class: 'rg-subhead', text: 'Target Job Role' }));
  wrap.append(field('Target Job Role', textInput(S.data.personal.targetRole, (v) => { S.data.personal.targetRole = v; changed(); }, { list: 'roleOptions2', maxlength: 80, autocorrect: 'title' }), { hint: 'AI tailors wording and keywords to this role.' }));
  wrap.append(h('datalist', { attrs: { id: 'roleOptions2' } }, ...TARGET_ROLES.map((r) => h('option', { attrs: { value: r } }))));
  wrap.append(jdPanel());
  return wrap;
}

async function runEnhance() {
  const result = await enhanceResume(S.data);
  if (result.summary.trim() && result.summary.trim() !== S.data.summary.trim()) {
    applyAi('summary', S.data.summary, result.summary.trim(), (v) => (S.data.summary = v));
  }
  for (const r of result.projects) {
    const p = S.data.projects.find((x) => x.id === r.id);
    if (p && r.description.trim() && r.description.trim() !== p.description.trim()) applyAi(`project:${p.id}`, p.description, r.description.trim(), (v) => (p.description = v));
  }
  for (const r of result.experience) {
    const e = S.data.experience.find((x) => x.id === r.id);
    if (e && r.responsibilities.trim() && r.responsibilities.trim() !== e.responsibilities.trim()) applyAi(`experience:${e.id}`, e.responsibilities, r.responsibilities.trim(), (v) => (e.responsibilities = v));
  }
}

function jdPanel(): HTMLElement {
  const wrap = h('div', { class: 'rg-jd' });
  const area = textArea(S.data.jobDescription, (v) => { S.data.jobDescription = v; changed({ preview: false }); }, { rows: 6, placeholder: 'Paste the job description here…', maxlength: 6000 });
  area.id = 'jdText';
  const analyze = h('button', { class: 'rg-btn rg-btn--primary rg-btn--sm', text: 'Analyze Job Description', attrs: { type: 'button' } });
  const results = h('div', { class: 'rg-jd__results' });

  const show = (r: JdResult) => {
    results.replaceChildren();
    const found = r.keywords.filter((k) => !r.missing.includes(k));
    if (found.length) {
      results.append(h('p', { class: 'rg-jd__label', text: 'Already on your resume' }), h('div', { class: 'rg-kw-list' }, ...found.map((k) => h('span', { class: 'rg-kw rg-kw--ok', text: k }))));
    }
    if (r.missing.length) {
      results.append(h('p', { class: 'rg-jd__label', text: 'Asked for but not on your resume — add only the ones you genuinely have' }));
      const list = h('div', { class: 'rg-kw-list' });
      for (const k of r.missing) {
        const btn = h('button', { class: 'rg-kw rg-kw--add', text: `+ ${k}`, attrs: { type: 'button', title: 'I have this skill — add it' } });
        btn.addEventListener('click', () => {
          const group = groupFor(k);
          if (!S.data.skills[group].some((s) => s.toLowerCase() === k.toLowerCase())) S.data.skills[group] = [...S.data.skills[group], k];
          changed();
          btn.disabled = true;
          btn.textContent = `✓ ${k}`;
          toast(`${k} added to Skills`);
        });
        list.append(btn);
      }
      results.append(list);
    }
    if (r.suggestions.length) results.append(h('p', { class: 'rg-jd__label', text: 'Suggestions' }), h('ul', { class: 'rg-tips' }, ...r.suggestions.map((s) => h('li', { text: s }))));
  };

  analyze.addEventListener('click', async () => {
    if (S.data.jobDescription.trim().length < 40) return toast('Paste the full job description first.', 'error');
    analyze.disabled = true;
    analyze.textContent = 'Analyzing…';
    try {
      S.jd = await analyzeJobDescription(S.data, S.data.jobDescription);
      show(S.jd);
    } catch (error) {
      aiFailure(error);
    } finally {
      analyze.disabled = false;
      analyze.textContent = 'Analyze Job Description';
    }
  });
  if (S.jd) show(S.jd);

  wrap.append(h('h3', { class: 'rg-subhead', text: 'Optimize for Job Description' }), h('p', { class: 'rg-hint', text: 'Optional. Compare your resume with a specific job posting to find relevant keywords.' }), h('label', { class: 'rg-sr-only', text: 'Job description', attrs: { for: 'jdText' } }), area, h('div', { class: 'rg-ai__bar' }, analyze), results);
  return wrap;
}

// ---------------------------------------------------------------- step 9: review & ATS

function scoreTone(score: number) {
  return score >= 85 ? 'good' : score >= 70 ? 'ok' : 'low';
}

function renderAts() {
  const host = document.getElementById('atsHost');
  if (!host) return;
  S.ats = computeAts(S.data);
  const a = S.ats;
  const ring = h('div', { class: `rg-score rg-score--${scoreTone(a.score)}`, attrs: { role: 'img', 'aria-label': `ATS score ${a.score} out of 100` } });
  ring.style.setProperty('--pct', String(a.score));
  ring.append(h('span', { class: 'rg-score__num', text: String(a.score) }), h('span', { class: 'rg-score__of', text: '/ 100' }));
  const bars = h(
    'div',
    { class: 'rg-bars' },
    ...a.categories.map((c) => {
      const fill = h('span', { class: `rg-bar__fill rg-bar__fill--${scoreTone(c.score)}` });
      fill.style.width = `${c.score}%`;
      return h('div', { class: 'rg-bar' }, h('span', { class: 'rg-bar__label', text: c.label }), h('span', { class: 'rg-bar__track' }, fill), h('span', { class: 'rg-bar__val', text: `${c.score}%` }));
    }),
  );
  host.replaceChildren(
    h('div', { class: 'rg-ats' }, ring, h('div', { class: 'rg-ats__text' }, h('h3', { text: 'ATS Score' }), h('p', { class: 'rg-hint', text: a.score >= 90 ? 'Excellent — your resume is well optimised.' : a.score >= 75 ? 'Good. The suggestions below can push it higher.' : 'Work through the suggestions below to improve it.' }))),
    bars,
    a.suggestions.length ? h('div', {}, h('p', { class: 'rg-jd__label', text: 'Improvement suggestions' }), h('ul', { class: 'rg-tips' }, ...a.suggestions.map((s) => h('li', { text: s })))) : h('p', { class: 'rg-hint', text: 'No major issues found.' }),
    h('p', { class: 'rg-hint rg-disclaimer', text: 'This score estimates how well applicant-tracking systems can read your resume and match it to your target role. It is a guide, not a guarantee.' }),
  );
}

function sectionManager(): HTMLElement {
  const cfg = getTemplate(S.template);
  const wrap = h('div', { class: 'rg-sections' });
  const render = () => {
    const sections = resolveSections(S.data, cfg);
    const list = h('ol', { class: 'rg-sec-list' });
    sections.forEach((s, i) => {
      const move = (dir: number) => {
        const next = [...sections];
        [next[i], next[i + dir]] = [next[i + dir], next[i]];
        S.data.sections = next;
        changed();
        render();
      };
      const vis = h('input', { attrs: { type: 'checkbox', id: `sec-${s.id}`, 'aria-label': `Show ${SECTION_LABELS[s.id]}` } });
      vis.checked = s.visible;
      vis.addEventListener('change', () => {
        S.data.sections = sections.map((x) => (x.id === s.id ? { ...x, visible: vis.checked } : x));
        changed();
      });
      list.append(
        h(
          'li',
          { class: 'rg-sec' },
          h('label', { class: 'rg-check', attrs: { for: vis.id } }, vis, ` ${SECTION_LABELS[s.id as SectionId]}`),
          h('span', { class: 'rg-sec__btns' }, h('button', { class: 'rg-icon-btn', text: '↑', attrs: { type: 'button', 'aria-label': 'Move up', disabled: i === 0 }, on: { click: () => move(-1) } }), h('button', { class: 'rg-icon-btn', text: '↓', attrs: { type: 'button', 'aria-label': 'Move down', disabled: i === sections.length - 1 }, on: { click: () => move(1) } })),
        ),
      );
    });
    const reset = h('button', { class: 'rg-link-btn', text: 'Reset to template order', attrs: { type: 'button', hidden: !S.data.sections } });
    reset.addEventListener('click', () => {
      S.data.sections = null;
      changed();
      render();
    });

    const custom = repeatable({
      items: S.data.customSections,
      label: (c, i) => c.title.trim() || `Additional section ${i + 1}`,
      create: newCustomSection,
      addLabel: 'Add Section',
      body: (c) => [
        field('Section Title', textInput(c.title, (v) => { c.title = v; changed(); }, { placeholder: 'e.g. Languages, Volunteering', maxlength: 60, autocorrect: 'title' }), { wide: true }),
        field('Items (one per line)', textArea(c.content, (v) => { c.content = v; changed(); }, { rows: 3, maxlength: 1000, autocorrect: 'prose' }), { wide: true }),
      ],
    });
    wrap.replaceChildren(h('p', { class: 'rg-jd__label', text: 'Sections — reorder or hide' }), list, reset, h('p', { class: 'rg-jd__label', text: 'Additional sections' }), custom);
  };
  render();
  return wrap;
}

function stepReview(): HTMLElement {
  const nameInput = textInput(S.name, (v) => {
    S.name = v;
    S.nameTouched = true;
    $<HTMLInputElement>('resumeName').value = v;
    changed({ preview: false });
  }, { maxlength: 120 });

  const improve = h('button', { class: 'rg-btn rg-btn--accent', text: '✨ Improve ATS Score', attrs: { type: 'button' } });
  improve.addEventListener('click', async () => {
    const before = computeAts(S.data).score;
    improve.disabled = true;
    improve.textContent = 'Improving…';
    try {
      await runEnhance();
      renderAts();
      const after = S.ats?.score ?? before;
      toast(after > before ? `ATS score improved: ${before} → ${after}` : 'Wording polished. Follow the suggestions to improve the score further.');
    } catch (error) {
      aiFailure(error);
    } finally {
      improve.disabled = false;
      improve.textContent = '✨ Improve ATS Score';
    }
  });

  const edit = h('button', { class: 'rg-btn rg-btn--ghost', text: 'Edit Resume', attrs: { type: 'button' } });
  edit.addEventListener('click', () => setStep(1));
  const saveBtn = h('button', { class: 'rg-btn rg-btn--primary', text: S.status === 'complete' ? 'Saved ✓ — Save Again' : 'Save Resume', attrs: { type: 'button' } });
  saveBtn.addEventListener('click', async () => {
    S.status = 'complete';
    S.ats = computeAts(S.data);
    setSaveStatus('Saving…', 'busy');
    await save({ status: 'complete', ats: S.ats });
    saveBtn.textContent = 'Saved ✓ — Save Again';
    toast('Resume saved to My Resumes');
  });

  const pdfBtn = h('button', { class: 'rg-btn rg-btn--primary', text: 'Download PDF', attrs: { type: 'button' } });
  pdfBtn.addEventListener('click', () => download('pdf', pdfBtn));
  const docxBtn = h('button', { class: 'rg-btn rg-btn--ghost', text: 'Download DOCX', attrs: { type: 'button' } });
  docxBtn.addEventListener('click', () => download('docx', docxBtn));

  return h(
    'div',
    { class: 'rg-stack' },
    h('div', { attrs: { id: 'spellHost' } }, h('p', { class: 'rg-spell', text: 'Checking spelling across your whole resume…' })),
    h('div', { attrs: { id: 'atsHost' } }),
    h('div', { class: 'rg-actions' }, improve, edit),
    field('Resume Name', nameInput, { hint: 'Shown in My Resumes and used as the file name.' }),
    h('div', { class: 'rg-actions' }, saveBtn, pdfBtn, docxBtn),
    h('a', { class: 'rg-link', text: 'Go to My Resumes →', attrs: { href: '/student-my-resumes' } }),
    h('hr', { class: 'rg-divider' }),
    sectionManager(),
  );
}

async function download(kind: 'pdf' | 'docx', btn: HTMLButtonElement) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Preparing…';
  try {
    // Last spelling pass so the file never contains a known typo.
    if (!spellUndone) {
      const fixed = await checkWholeResume();
      if (fixed) toast(`Corrected ${fixed} spelling ${fixed === 1 ? 'mistake' : 'mistakes'} before downloading`);
    }
    const rdoc = buildDoc(S.data, S.template);
    if (!rdoc.name) toast('Tip: add your name in Personal Information first.', 'error');
    const blob = kind === 'pdf' ? await buildResumePdf(rdoc) : await buildResumeDocx(rdoc);
    downloadBlob(blob, resumeFileName(S.name, kind));
    // Downloading from the review step also records the ATS result.
    S.ats = computeAts(S.data);
    save({ ats: S.ats });
  } catch (error) {
    console.error(error);
    toast('Could not create the file. Please try again.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

// ---------------------------------------------------------------- init

function wireChrome() {
  document.querySelectorAll<HTMLButtonElement>('.rg-step').forEach((btn) => btn.addEventListener('click', () => setStep(Number(btn.dataset.step))));
  $('backBtn').addEventListener('click', () => setStep(S.step - 1));
  $('nextBtn').addEventListener('click', () => setStep(S.step + 1));

  const select = $<HTMLSelectElement>('templateSelect');
  select.replaceChildren(...TEMPLATES.map((t) => h('option', { text: t.name, attrs: { value: t.id } })));
  select.value = S.template;
  select.addEventListener('change', () => {
    S.template = select.value as TemplateId;
    changed();
    if (S.step === 0) renderStep();
    if (S.step === LAST_STEP) renderStep();
    toast(`${getTemplate(S.template).name} applied — your content is unchanged`);
  });

  const name = $<HTMLInputElement>('resumeName');
  name.value = S.name;
  name.addEventListener('input', () => {
    S.name = name.value;
    S.nameTouched = true;
    changed({ preview: false });
  });

  document.querySelectorAll<HTMLButtonElement>('.rg-mobile-tabs [data-pane]').forEach((tab) =>
    tab.addEventListener('click', () => {
      $('work').dataset.pane = tab.dataset.pane!;
      document.querySelectorAll('.rg-mobile-tabs [data-pane]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
      if (tab.dataset.pane === 'preview') refreshPreview();
    }),
  );

  window.addEventListener('beforeunload', (e) => {
    if ($('saveStatus').dataset.kind === 'busy') {
      e.preventDefault();
      save();
    }
  });
}

export async function initWizard() {
  const auth = await requireRole('student');
  if (!auth) return;
  const userId = auth.session.user.id;
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');

  let programs: string[] = [];
  try {
    programs = await loadPrograms(userId);
  } catch {
    /* suggestions just won't be course-specific */
  }

  let record: ResumeRecord | null = null;
  if (id) {
    try {
      record = await getResume(userId, id);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not open this resume.', 'error');
    }
    if (!record) toast('That resume could not be found — starting a new one.', 'error');
  }

  S = {
    userId,
    profile: auth.profile,
    programs,
    record,
    name: record?.name ?? 'My Resume',
    nameTouched: !!record,
    template: record?.template ?? 'classic',
    data: record ? normaliseResume(record.data) : seedFromProfile({ fullName: auth.profile.full_name, email: auth.profile.email, phone: auth.profile.phone, programs }),
    ats: record?.ats ?? null,
    status: record?.status ?? 'draft',
    step: 0,
    maxStep: record ? LAST_STEP : 0,
    jd: null,
    undo: new Map(),
    original: new Map(),
  };

  // Restore unsaved local edits (e.g. after going offline / closing the tab mid-save).
  try {
    const raw = localStorage.getItem(BACKUP_KEY());
    if (raw) {
      const backupData = JSON.parse(raw);
      if (!record || backupData.savedAt > record.updated_at) {
        S.data = normaliseResume(backupData.data);
        S.template = backupData.template ?? S.template;
        S.name = backupData.name ?? S.name;
        if (record) toast('Restored changes that had not been saved yet.');
      }
    }
  } catch {
    /* ignore corrupt backup */
  }

  $('rgPage').hidden = false;
  preview = mountScaledResume($('previewHost'));
  // Load the spell-check dictionary in the background so autocorrect is instant.
  ('requestIdleCallback' in window ? window.requestIdleCallback : (fn: () => void) => setTimeout(fn, 1500))(() => preloadSpeller());
  wireChrome();
  setSaveStatus(record ? (usingLocalStorage() ? 'Saved on this device' : `Saved · ${relativeTime(record.updated_at)}`) : 'Not saved yet');

  const requested = Number(params.get('step'));
  setStep(record && requested >= 1 && requested <= STEP_TITLES.length ? requested - 1 : record ? 1 : 0);
}
