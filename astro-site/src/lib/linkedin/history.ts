// Generation history ("Recent Posts") backed by public.linkedin_generations
// (see phase9_linkedin_generator.sql). RLS limits every row to its owner,
// so these queries never need a user filter for security — the explicit
// user_id filter is only there to make intent obvious.
//
// History is an enhancement, not a dependency: if the table hasn't been
// created yet every function here degrades to "no history" instead of
// breaking generation.

import { supabase, type Role } from '../supabase';
import type { GeneratedPost, GeneratorInput } from './types';

export interface HistoryEntry {
  id: string;
  role: Role;
  purpose: string;
  topic: string;
  input: GeneratorInput;
  posts: GeneratedPost[];
  created_at: string;
}

let historyUnavailable = false;

// PostgREST error codes for "relation/table does not exist".
function isMissingTable(error: { code?: string } | null): boolean {
  return !!error && (error.code === '42P01' || error.code === 'PGRST205');
}

export function isHistoryAvailable() {
  return !historyUnavailable;
}

export async function listHistory(userId: string, limit = 12): Promise<HistoryEntry[]> {
  if (historyUnavailable) return [];
  const { data, error } = await supabase
    .from('linkedin_generations')
    .select('id, role, purpose, topic, input, posts, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    if (isMissingTable(error)) historyUnavailable = true;
    else console.error('Failed to load LinkedIn history:', error);
    return [];
  }
  return (data ?? []) as HistoryEntry[];
}

export async function saveGeneration(userId: string, input: GeneratorInput, posts: GeneratedPost[]): Promise<string | null> {
  if (historyUnavailable) return null;
  const { data, error } = await supabase
    .from('linkedin_generations')
    .insert({ user_id: userId, role: input.role, purpose: input.purpose, topic: input.topic.trim(), input, posts })
    .select('id')
    .single();
  if (error) {
    if (isMissingTable(error)) historyUnavailable = true;
    else console.error('Failed to save LinkedIn generation:', error);
    return null;
  }
  return data.id as string;
}

/** Persists edits / single-card regenerations back onto the saved entry. */
export async function updateGenerationPosts(id: string, posts: GeneratedPost[]): Promise<void> {
  if (historyUnavailable) return;
  const { error } = await supabase.from('linkedin_generations').update({ posts }).eq('id', id);
  if (error && !isMissingTable(error)) console.error('Failed to update LinkedIn generation:', error);
}

export async function deleteGeneration(id: string): Promise<boolean> {
  const { error } = await supabase.from('linkedin_generations').delete().eq('id', id);
  if (error) {
    console.error('Failed to delete LinkedIn generation:', error);
    return false;
  }
  return true;
}
