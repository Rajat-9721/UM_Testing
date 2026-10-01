// Saved resumes ("My Resumes").
//
// Stored in public.resumes (phase10_resumes.sql), private to each student
// through RLS. Until that table exists — or if the network drops — resumes
// are kept in this browser's localStorage so nothing a student types is
// lost; the UI says which storage is in use.

import { supabase } from '../supabase';
import { cloneResume, normaliseResume } from './defaults';
import type { AtsResult, ResumeData, ResumeRecord, ResumeStatus, TemplateId } from './types';

const COLUMNS = 'id, name, template, data, ats, status, created_at, updated_at';
const LOCAL_KEY = (userId: string) => `um-resumes:${userId}`;

let tableMissing = false;

const isMissingTable = (error: { code?: string } | null) => !!error && (error.code === '42P01' || error.code === 'PGRST205');

export function usingLocalStorage() {
  return tableMissing;
}

// ---- localStorage fallback ----
function readLocal(userId: string): ResumeRecord[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY(userId));
    return raw ? (JSON.parse(raw) as ResumeRecord[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(userId: string, records: ResumeRecord[]) {
  try {
    localStorage.setItem(LOCAL_KEY(userId), JSON.stringify(records));
  } catch {
    /* storage full or blocked — nothing more we can do locally */
  }
}

const localId = () => `local-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const toRecord = (row: any): ResumeRecord => ({
  id: row.id,
  name: row.name ?? 'Untitled Resume',
  template: row.template,
  data: normaliseResume(row.data),
  ats: row.ats ?? null,
  status: row.status ?? 'draft',
  created_at: row.created_at,
  updated_at: row.updated_at,
});

// ---- public API ----
export async function listResumes(userId: string): Promise<ResumeRecord[]> {
  if (!tableMissing) {
    const { data, error } = await supabase.from('resumes').select(COLUMNS).eq('user_id', userId).order('updated_at', { ascending: false });
    if (!error) return (data ?? []).map(toRecord);
    if (isMissingTable(error)) tableMissing = true;
    else throw new Error('Could not load your resumes. Please try again.');
  }
  return readLocal(userId).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function getResume(userId: string, id: string): Promise<ResumeRecord | null> {
  if (!id.startsWith('local-') && !tableMissing) {
    const { data, error } = await supabase.from('resumes').select(COLUMNS).eq('id', id).maybeSingle();
    if (!error) return data ? toRecord(data) : null;
    if (isMissingTable(error)) tableMissing = true;
    else throw new Error('Could not open this resume. Please try again.');
  }
  return readLocal(userId).find((r) => r.id === id) ?? null;
}

export interface ResumeDraft {
  name: string;
  template: TemplateId;
  data: ResumeData;
  ats?: AtsResult | null;
  status?: ResumeStatus;
}

export async function createResume(userId: string, draft: ResumeDraft): Promise<ResumeRecord> {
  if (!tableMissing) {
    const { data, error } = await supabase
      .from('resumes')
      .insert({ user_id: userId, name: draft.name, template: draft.template, data: draft.data, ats: draft.ats ?? null, status: draft.status ?? 'draft' })
      .select(COLUMNS)
      .single();
    if (!error) return toRecord(data);
    if (isMissingTable(error)) tableMissing = true;
    else throw new Error('Could not save your resume. Please try again.');
  }
  const now = new Date().toISOString();
  const record: ResumeRecord = {
    id: localId(),
    name: draft.name,
    template: draft.template,
    data: cloneResume(draft.data),
    ats: draft.ats ?? null,
    status: draft.status ?? 'draft',
    created_at: now,
    updated_at: now,
  };
  writeLocal(userId, [record, ...readLocal(userId)]);
  return record;
}

export async function updateResume(userId: string, id: string, patch: Partial<ResumeDraft>): Promise<string> {
  const now = new Date().toISOString();
  if (!id.startsWith('local-') && !tableMissing) {
    const { data, error } = await supabase.from('resumes').update(patch).eq('id', id).select('updated_at').single();
    if (!error) return data.updated_at as string;
    if (isMissingTable(error)) tableMissing = true;
    else throw new Error('Could not save your changes.');
  }
  writeLocal(
    userId,
    readLocal(userId).map((r) => (r.id === id ? { ...r, ...patch, data: patch.data ? cloneResume(patch.data) : r.data, updated_at: now } : r)),
  );
  return now;
}

export async function deleteResume(userId: string, id: string): Promise<void> {
  if (!id.startsWith('local-') && !tableMissing) {
    const { error } = await supabase.from('resumes').delete().eq('id', id);
    if (!error) return;
    if (isMissingTable(error)) tableMissing = true;
    else throw new Error('Could not delete this resume.');
  }
  writeLocal(userId, readLocal(userId).filter((r) => r.id !== id));
}

export async function duplicateResume(userId: string, record: ResumeRecord): Promise<ResumeRecord> {
  return createResume(userId, {
    name: `${record.name} (Copy)`,
    template: record.template,
    data: cloneResume(record.data),
    ats: record.ats,
    status: 'draft',
  });
}

/** Titles of the programs the student is enrolled in (for prefill + suggestions). */
export async function loadPrograms(userId: string): Promise<string[]> {
  const { data: enrollments, error } = await supabase.from('enrollment_payment_summary').select('course_id').eq('student_id', userId);
  if (error || !enrollments?.length) return [];
  const ids = enrollments.map((e: any) => e.course_id).filter(Boolean);
  if (!ids.length) return [];
  const { data: courses } = await supabase.from('courses').select('id, title').in('id', ids);
  return (courses ?? []).map((c: any) => String(c.title ?? '')).filter(Boolean);
}

/** "just now", "5 min ago", "Yesterday", "3 days ago", or a date. */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then) / 1000;
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} hr ago`;
  const days = Math.round(diff / 86400);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
