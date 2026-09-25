// My Resumes (student portal): list, preview, download, rename, duplicate,
// change template and delete. Each resume is independent — editing one
// never touches another.

import { requireRole } from '../supabase';
import { buildResumeDocx, downloadBlob, resumeFileName } from './exportDocx';
import { buildResumePdf } from './exportPdf';
import { buildDoc } from './model';
import { mountScaledResume } from './renderHtml';
import { deleteResume, duplicateResume, listResumes, relativeTime, updateResume, usingLocalStorage } from './store';
import { getTemplate, TEMPLATES } from './templates';
import type { ResumeRecord, TemplateId } from './types';
import { h, toast } from './ui';

let userId = '';
let resumes: ResumeRecord[] = [];
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

async function download(r: ResumeRecord, kind: 'pdf' | 'docx', btn?: HTMLButtonElement) {
  const label = btn?.textContent;
  if (btn) {
    btn.disabled = true;
    btn.textContent = '…';
  }
  try {
    const rdoc = buildDoc(r.data, r.template);
    const blob = kind === 'pdf' ? await buildResumePdf(rdoc) : await buildResumeDocx(rdoc);
    downloadBlob(blob, resumeFileName(r.name, kind));
  } catch (error) {
    console.error(error);
    toast('Could not create the file. Please try again.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = label ?? '';
    }
  }
}

let previewMount: ReturnType<typeof mountScaledResume> | null = null;

function openPreview(r: ResumeRecord) {
  previewMount?.destroy();
  previewMount = mountScaledResume($('previewModalHost'));
  $('previewModalTitle').textContent = r.name;
  const pdf = h('button', { class: 'rg-btn rg-btn--primary rg-btn--sm', text: 'Download PDF', attrs: { type: 'button' } });
  pdf.addEventListener('click', () => download(r, 'pdf', pdf));
  const docx = h('button', { class: 'rg-btn rg-btn--ghost rg-btn--sm', text: 'Download DOCX', attrs: { type: 'button' } });
  docx.addEventListener('click', () => download(r, 'docx', docx));
  const edit = h('a', { class: 'rg-btn rg-btn--ghost rg-btn--sm', text: 'Edit', attrs: { href: `/student-resume-generator?id=${encodeURIComponent(r.id)}&step=2` } });
  $('previewModalActions').replaceChildren(edit, docx, pdf);
  $('previewModal').classList.add('active');
  requestAnimationFrame(() => previewMount!.update(buildDoc(r.data, r.template, { placeholders: true })));
}

function confirmDelete(r: ResumeRecord) {
  $('deleteMessage').textContent = `“${r.name}” will be permanently deleted. This can’t be undone.`;
  $('deleteModal').classList.add('active');
  $<HTMLButtonElement>('deleteConfirm').onclick = async () => {
    $('deleteModal').classList.remove('active');
    try {
      await deleteResume(userId, r.id);
      resumes = resumes.filter((x) => x.id !== r.id);
      render();
      toast('Resume deleted');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not delete this resume.', 'error');
    }
  };
}

function card(r: ResumeRecord): HTMLElement {
  const thumb = h('div', { class: 'rg-thumb', attrs: { 'aria-hidden': 'true' } });
  const mount = mountScaledResume(thumb);
  requestAnimationFrame(() => mount.update(buildDoc(r.data, r.template, { placeholders: true })));

  const title = h('h2', { text: r.name });
  const titleRow = h('div', { class: 'mr-card__title' }, title, h('span', { class: `mr-status${r.status === 'complete' ? ' mr-status--complete' : ''}`, text: r.status === 'complete' ? 'Complete' : 'Draft' }));

  // Change template right from the card.
  const tplSelect = h('select', { attrs: { 'aria-label': `Template for ${r.name}` } });
  for (const t of TEMPLATES) tplSelect.append(h('option', { text: t.name, attrs: { value: t.id, selected: t.id === r.template } }));
  tplSelect.addEventListener('change', async () => {
    const template = tplSelect.value as TemplateId;
    try {
      r.updated_at = await updateResume(userId, r.id, { template });
      r.template = template;
      render();
      toast(`Template changed to ${getTemplate(template).name} — content unchanged`);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not change the template.', 'error');
    }
  });

  const meta = h(
    'dl',
    { class: 'mr-meta' },
    h('dt', { text: 'Target Role' }),
    h('dd', { text: r.data.personal.targetRole || '—' }),
    h('dt', { text: 'Template' }),
    h('dd', {}, tplSelect),
    h('dt', { text: 'ATS Score' }),
    h('dd', { text: r.ats ? `${r.ats.score} / 100` : 'Not reviewed yet' }),
    h('dt', { text: 'Last Updated' }),
    h('dd', { text: relativeTime(r.updated_at) }),
  );

  const edit = h('a', { class: 'rg-btn rg-btn--primary rg-btn--sm', text: 'Edit', attrs: { href: `/student-resume-generator?id=${encodeURIComponent(r.id)}&step=2` } });
  const preview = h('button', { class: 'rg-btn rg-btn--ghost rg-btn--sm', text: 'Preview', attrs: { type: 'button' } });
  preview.addEventListener('click', () => openPreview(r));
  const pdf = h('button', { class: 'rg-btn rg-btn--ghost rg-btn--sm', text: 'PDF', attrs: { type: 'button', 'aria-label': `Download ${r.name} as PDF` } });
  pdf.addEventListener('click', () => download(r, 'pdf', pdf));
  const docx = h('button', { class: 'rg-btn rg-btn--ghost rg-btn--sm', text: 'DOCX', attrs: { type: 'button', 'aria-label': `Download ${r.name} as DOCX` } });
  docx.addEventListener('click', () => download(r, 'docx', docx));

  const rename = h('button', { class: 'rg-link-btn', text: 'Rename', attrs: { type: 'button' } });
  rename.addEventListener('click', () => {
    const input = h('input', { attrs: { type: 'text', maxlength: '120', 'aria-label': 'New name' } });
    input.value = r.name;
    const ok = h('button', { class: 'rg-btn rg-btn--primary rg-btn--sm', text: 'Save', attrs: { type: 'button' } });
    const form = h('div', { class: 'mr-rename' }, input, ok);
    const commit = async () => {
      const name = input.value.trim();
      if (!name || name === r.name) return render();
      try {
        r.updated_at = await updateResume(userId, r.id, { name });
        r.name = name;
        toast('Resume renamed');
      } catch (error) {
        toast(error instanceof Error ? error.message : 'Could not rename.', 'error');
      }
      render();
    };
    ok.addEventListener('click', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') render();
    });
    titleRow.replaceChildren(form);
    input.focus();
    input.select();
  });

  const duplicate = h('button', { class: 'rg-link-btn', text: 'Duplicate', attrs: { type: 'button' } });
  duplicate.addEventListener('click', async () => {
    try {
      const copy = await duplicateResume(userId, r);
      resumes = [copy, ...resumes];
      render();
      toast('Copy created');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Could not duplicate.', 'error');
    }
  });
  const del = h('button', { class: 'rg-link-btn', text: 'Delete', attrs: { type: 'button' } });
  del.style.color = 'var(--color-danger)';
  del.addEventListener('click', () => confirmDelete(r));

  return h(
    'article',
    { class: 'mr-card' },
    thumb,
    h('div', { class: 'mr-card__body' }, titleRow, meta, h('div', { class: 'mr-actions' }, edit, preview, pdf, docx), h('div', { class: 'mr-more' }, rename, duplicate, del)),
  );
}

function render() {
  const list = $('resumeList');
  $('storageNote').hidden = !usingLocalStorage();
  if (!resumes.length) {
    list.replaceChildren(
      h(
        'div',
        { class: 'mr-empty' },
        h('h2', { text: 'No resumes yet' }),
        h('p', { text: 'Create your first ATS-friendly resume — it takes about 10 minutes.' }),
        h('a', { class: 'rg-btn rg-btn--primary', text: '+ Create New Resume', attrs: { href: '/student-resume-generator' } }),
      ),
    );
    return;
  }
  list.replaceChildren(h('div', { class: 'mr-grid' }, ...resumes.map(card)));
}

export async function initMyResumes() {
  const auth = await requireRole('student');
  if (!auth) return;
  userId = auth.session.user.id;
  $('mrPage').hidden = false;
  try {
    resumes = await listResumes(userId);
  } catch (error) {
    $('resumeList').replaceChildren(h('p', { class: 'dash-muted', text: error instanceof Error ? error.message : 'Could not load your resumes.' }));
    return;
  }
  render();
}
