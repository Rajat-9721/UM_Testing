// Assistant Dashboard -> Leads: every enquiry from the website forms,
// newest first, with status, follow-up date, notes and an Excel download.
//
// Lead text comes from public forms, so it is only ever put on the page
// with textContent — never innerHTML.
// Database: marketing_leads + lead_statuses (phase11_lead_otp.sql). Edits
// go through update_marketing_lead(), the only write assistants have.

import type { SupabaseClient } from '@supabase/supabase-js';
import { buildCsv, downloadCsv } from './csv';
import { LEAD_SOURCES } from './rules';

interface Lead {
  id: string;
  created_at: string;
  name: string;
  email: string;
  mobile: string;
  program: string;
  source: string;
  education_status: string | null;
  email_verified: boolean;
  consent_at: string | null;
  status: string;
  follow_up_on: string | null;
  notes: string | null;
  updated_at: string | null;
}

interface LeadStatus {
  key: string;
  label: string;
  description: string | null;
  stage: 'open' | 'won' | 'lost';
  sort_order: number;
  is_active: boolean;
}

const PAGE_SIZE = 50;
const EXPORT_BATCH = 1000;
const EXPORT_MAX = 20_000;
const COLUMNS =
  'id, created_at, name, email, mobile, program, source, education_status, email_verified, consent_at, status, follow_up_on, notes, updated_at';
const IST = 'Asia/Kolkata';

// ---- formatting (India time) ----
const todayIst = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const displayDateTime = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(
    new Date(iso),
  );
const displayDate = (ymd: string) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${ymd}T00:00:00Z`));
// "2026-10-06 20:15" — Excel recognises this as a date/time, so the column sorts properly.
function excelDateTime(iso: string | null) {
  if (!iso) return '';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}
const prettyMobile = (m: string) => (/^\d{10}$/.test(m) ? `${m.slice(0, 5)} ${m.slice(5)}` : m);
const sourceLabel = (source: string) => (LEAD_SOURCES as Record<string, { label: string }>)[source]?.label ?? source;

// Search text goes into a PostgREST filter, so drop the characters that
// have meaning there. Typed phone numbers are reduced to their digits.
function searchTerm(raw: string): string {
  let term = raw.trim().slice(0, 60);
  if (/^[\d\s+()-]+$/.test(term)) {
    term = term.replace(/\D/g, '');
    if (term.length === 12 && term.startsWith('91')) term = term.slice(2);
  }
  // Commas and brackets would break the or(...) filter; * and % are wildcards.
  return term.replace(/[,()*%\\"']/g, ' ').trim();
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {}, ...children: (Node | string | null)[]) {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children) if (child !== null) node.append(child);
  return node;
}

export function initLeadsPanel(supabase: SupabaseClient) {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const body = $<HTMLTableSectionElement>('leadsTableBody');
  const search = $<HTMLInputElement>('leadSearch');
  const statusFilter = $<HTMLSelectElement>('leadStatusFilter');
  const sourceFilter = $<HTMLSelectElement>('leadSourceFilter');
  const dateFilter = $<HTMLSelectElement>('leadDateFilter');
  const dueToggle = $<HTMLInputElement>('leadFollowUpToggle');
  const countEl = $('leadsCount');
  const loadMoreBtn = $<HTMLButtonElement>('leadsLoadMore');
  const exportBtn = $<HTMLButtonElement>('downloadLeadsBtn');
  const summary = $('leadsSummary');

  let statuses: LeadStatus[] = [];
  let rows: Lead[] = [];
  let total = 0;
  let loadToken = 0;

  const statusOf = (key: string) => statuses.find((s) => s.key === key);
  const openKeys = () => statuses.filter((s) => s.stage === 'open').map((s) => s.key);
  const isDue = (lead: Lead) => Boolean(lead.follow_up_on && lead.follow_up_on <= todayIst() && statusOf(lead.status)?.stage === 'open');

  // Adds the toolbar's filters to a marketing_leads query.
  function applyFilters(query: any) {
    let q = query;
    const term = searchTerm(search.value);
    if (term) q = q.or(`name.ilike.*${term}*,email.ilike.*${term}*,mobile.ilike.*${term}*`);
    if (statusFilter.value) q = q.eq('status', statusFilter.value);
    if (sourceFilter.value) q = q.eq('source', sourceFilter.value);
    if (dateFilter.value === 'today') q = q.gte('created_at', new Date(`${todayIst()}T00:00:00+05:30`).toISOString());
    else if (dateFilter.value !== 'all') q = q.gte('created_at', new Date(Date.now() - Number(dateFilter.value) * 86_400_000).toISOString());
    if (dueToggle.checked) q = q.lte('follow_up_on', todayIst()).in('status', openKeys());
    return q;
  }

  function statusSelect(lead: Lead, onChange: (value: string) => void) {
    const select = el('select', { className: `lead-status-select lead-stage-${statusOf(lead.status)?.stage ?? 'open'}` });
    select.setAttribute('aria-label', `Status for ${lead.name}`);
    for (const s of statuses) {
      if (!s.is_active && s.key !== lead.status) continue;
      select.append(el('option', { value: s.key, textContent: s.label, title: s.description ?? '' }));
    }
    if (!statusOf(lead.status)) select.append(el('option', { value: lead.status, textContent: lead.status }));
    select.value = lead.status;
    select.addEventListener('change', () => onChange(select.value));
    return select;
  }

  async function saveChanges(lead: Lead, changes: Partial<Pick<Lead, 'status' | 'follow_up_on' | 'notes'>>) {
    const { error } = await supabase.rpc('update_marketing_lead', { p_lead_id: lead.id, p_changes: changes });
    if (error) throw error;
    Object.assign(lead, changes, { updated_at: new Date().toISOString() });
  }

  function renderRow(lead: Lead): HTMLTableRowElement {
    const tel = `+91${lead.mobile}`;
    const contact = el(
      'td',
      { className: 'lead-contact' },
      el('a', { href: `tel:${tel}`, textContent: prettyMobile(lead.mobile) }),
      el('a', { href: `https://wa.me/91${lead.mobile}`, target: '_blank', rel: 'noopener', className: 'lead-wa', textContent: 'WhatsApp' }),
      el('br'),
      el('a', { href: `mailto:${lead.email}`, className: 'lead-email', textContent: lead.email }),
      el('span', {
        className: `lead-badge ${lead.email_verified ? 'lead-badge--ok' : ''}`,
        textContent: lead.email_verified ? 'Verified' : 'Not verified',
        title: lead.email_verified ? 'Email confirmed with a code' : 'Email not confirmed',
      }),
    );

    const due = isDue(lead);
    const followUp = el('td', { className: due ? 'lead-due' : '', textContent: lead.follow_up_on ? displayDate(lead.follow_up_on) : '—' });
    if (due) followUp.prepend(el('span', { className: 'lead-due-dot', title: 'Follow-up due' }));

    const row = el(
      'tr',
      {},
      el('td', { className: 'lead-when', textContent: displayDateTime(lead.created_at) }),
      el(
        'td',
        { className: 'wrap-cell' },
        el('strong', { textContent: lead.name }),
        lead.education_status ? el('div', { className: 'dash-muted', textContent: lead.education_status }) : null,
        lead.notes ? el('div', { className: 'lead-note-preview', textContent: lead.notes, title: lead.notes }) : null,
      ),
      contact,
      el('td', { className: 'wrap-cell' }, lead.program, el('div', { className: 'dash-muted', textContent: sourceLabel(lead.source) })),
      el(
        'td',
        {},
        statusSelect(lead, async (value) => {
          const previous = lead.status;
          try {
            await saveChanges(lead, { status: value });
            row.replaceWith(renderRow(lead));
            void loadSummary();
          } catch (error: any) {
            alert(`Could not update the status: ${error.message ?? error}`);
            lead.status = previous;
            row.replaceWith(renderRow(lead));
          }
        }),
      ),
      followUp,
      el('td', { className: 'row-actions' }, el('button', { type: 'button', textContent: 'Details', onclick: () => openDetails(lead, row) })),
    );
    return row;
  }

  function showMessage(text: string) {
    body.replaceChildren(el('tr', {}, el('td', { colSpan: 7, className: 'empty-state', textContent: text })));
  }

  async function load(append = false) {
    const token = ++loadToken;
    if (!append) {
      rows = [];
      showMessage('Loading leads…');
    }
    loadMoreBtn.disabled = true;
    const { data, error, count } = await applyFilters(
      supabase.from('marketing_leads').select(COLUMNS, { count: 'exact' }).order('created_at', { ascending: false }),
    ).range(rows.length, rows.length + PAGE_SIZE - 1);
    if (token !== loadToken) return; // a newer search started meanwhile

    loadMoreBtn.disabled = false;
    if (error) {
      console.error('Failed to load leads:', error);
      showMessage(`Failed to load leads: ${error.message}`);
      return;
    }
    const page = (data ?? []) as Lead[];
    rows = rows.concat(page);
    total = count ?? rows.length;
    if (!append) body.replaceChildren();
    if (!rows.length) showMessage('No leads match these filters.');
    else body.append(...page.map(renderRow));
    countEl.textContent = rows.length ? `Showing ${rows.length} of ${total} lead${total === 1 ? '' : 's'}` : '';
    loadMoreBtn.hidden = rows.length >= total;
  }

  async function loadSummary() {
    const since7 = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const head = () => supabase.from('marketing_leads').select('id', { count: 'exact', head: true });
    const [fresh, due, week] = await Promise.all([
      head().eq('status', 'new'),
      head().lte('follow_up_on', todayIst()).in('status', openKeys()),
      head().gte('created_at', since7),
    ]);
    const tile = (value: number | null, label: string) =>
      el('div', { className: 'summary-tile' }, el('div', { className: 'value', textContent: String(value ?? '—') }), el('div', { className: 'label', textContent: label }));
    summary.replaceChildren(tile(fresh.count, 'New (not contacted)'), tile(due.count, 'Follow-ups due'), tile(week.count, 'Received in last 7 days'));
  }

  // ---- details modal ----
  const modal = $('leadModal');
  const modalInfo = $('leadModalInfo');
  const modalStatus = $<HTMLSelectElement>('leadModalStatus');
  const modalFollowUp = $<HTMLInputElement>('leadModalFollowUp');
  const modalNotes = $<HTMLTextAreaElement>('leadModalNotes');
  const modalError = $('leadModalError');
  const modalSave = $<HTMLButtonElement>('leadModalSave');
  let current: { lead: Lead; row: HTMLTableRowElement } | null = null;

  function openDetails(lead: Lead, row: HTMLTableRowElement) {
    current = { lead, row };
    $('leadModalTitle').textContent = lead.name;
    const info: [string, string][] = [
      ['Received', displayDateTime(lead.created_at)],
      ['Email', `${lead.email}${lead.email_verified ? ' (verified)' : ' (not verified)'}`],
      ['Mobile', `+91 ${prettyMobile(lead.mobile)}`],
      ['Program', lead.program],
      ['Form', sourceLabel(lead.source)],
      ['Education / status', lead.education_status ?? '—'],
      ['Agreed to be contacted', lead.consent_at ? displayDateTime(lead.consent_at) : '—'],
      ['Last updated', lead.updated_at ? displayDateTime(lead.updated_at) : '—'],
    ];
    modalInfo.replaceChildren(
      ...info.map(([label, value]) =>
        el('div', { className: 'profile-row' }, el('span', { className: 'label', textContent: label }), el('span', { className: 'value', textContent: value })),
      ),
    );
    modalStatus.replaceChildren(...statusSelect(lead, () => {}).children);
    modalStatus.value = lead.status;
    modalFollowUp.value = lead.follow_up_on ?? '';
    modalNotes.value = lead.notes ?? '';
    modalError.style.display = 'none';
    modal.classList.add('active');
    modalStatus.focus();
  }

  modalSave.addEventListener('click', async () => {
    if (!current) return;
    modalSave.disabled = true;
    modalError.style.display = 'none';
    try {
      await saveChanges(current.lead, {
        status: modalStatus.value,
        follow_up_on: modalFollowUp.value || null,
        notes: modalNotes.value.trim() || null,
      });
      current.row.replaceWith(renderRow(current.lead));
      modal.classList.remove('active');
      void loadSummary();
    } catch (error: any) {
      modalError.textContent = `Could not save: ${error.message ?? error}`;
      modalError.style.display = 'block';
    } finally {
      modalSave.disabled = false;
    }
  });

  // ---- Excel download (everything matching the current filters) ----
  exportBtn.addEventListener('click', async () => {
    const label = exportBtn.textContent;
    exportBtn.disabled = true;
    exportBtn.textContent = 'Preparing…';
    try {
      const all: Lead[] = [];
      for (let from = 0; from < EXPORT_MAX; from += EXPORT_BATCH) {
        const { data, error } = await applyFilters(
          supabase.from('marketing_leads').select(COLUMNS).order('created_at', { ascending: false }),
        ).range(from, from + EXPORT_BATCH - 1);
        if (error) throw error;
        all.push(...((data ?? []) as Lead[]));
        if (!data || data.length < EXPORT_BATCH) break;
      }
      const csv = buildCsv(
        ['Received (IST)', 'Name', 'Email', 'Mobile', 'Program', 'Form', 'Education / status', 'Email verified', 'Agreed to be contacted', 'Status', 'Follow-up date', 'Notes', 'Last updated (IST)'],
        all.map((l) => [
          excelDateTime(l.created_at),
          l.name,
          l.email,
          l.mobile,
          l.program,
          sourceLabel(l.source),
          l.education_status ?? '',
          l.email_verified ? 'Yes' : 'No',
          l.consent_at ? 'Yes' : 'No',
          statusOf(l.status)?.label ?? l.status,
          l.follow_up_on ?? '',
          l.notes ?? '',
          excelDateTime(l.updated_at),
        ]),
      );
      downloadCsv(`utkarsh-minds-leads-${todayIst()}.csv`, csv);
    } catch (error: any) {
      alert(`Could not prepare the download: ${error.message ?? error}`);
    } finally {
      exportBtn.disabled = false;
      exportBtn.textContent = label;
    }
  });

  // ---- filters ----
  let debounce: ReturnType<typeof setTimeout> | undefined;
  search.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => void load(), 300);
  });
  [statusFilter, sourceFilter, dateFilter, dueToggle].forEach((input) => input.addEventListener('change', () => void load()));
  loadMoreBtn.addEventListener('click', () => void load(true));

  // ---- start ----
  async function start() {
    const { data, error } = await supabase.from('lead_statuses').select('*').order('sort_order');
    if (error) {
      console.error('Failed to load lead statuses:', error);
      showMessage('Leads are not set up yet. Run phase11_lead_otp.sql in the Supabase SQL Editor, then reload this page.');
      return;
    }
    statuses = (data ?? []) as LeadStatus[];
    statusFilter.append(...statuses.filter((s) => s.is_active).map((s) => el('option', { value: s.key, textContent: s.label })));
    await Promise.all([load(), loadSummary()]);
  }

  return start();
}
