// Shared Supabase client + trusted-role auth helpers for the login page
// and the student/assistant dashboards.
//
// IMPORTANT: role checks here read `profiles.role`, never
// `user.user_metadata.role`. user_metadata is editable by the signed-in
// user themselves via supabase.auth.updateUser(), so it must never be
// used for authorization — only profiles.role is trustworthy, because
// it has no client-writable RLS policy (all writes to it go through
// SECURITY DEFINER RPCs). See phase1_student_assistant.sql.

import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://ohytjcwcmzalftmsdvbq.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_ApiQJQ2W-sfMo7i3jl_NSw_0eWMvVmF';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// A second, non-persisting client — used only to sign up a new student
// account without replacing the currently signed-in assistant's session.
export function createEphemeralClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, storageKey: 'utkarshminds-student-signup' },
  });
}

export type Role = 'student' | 'assistant';

export interface TrustedProfile {
  id: string;
  role: Role;
  student_id: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  must_change_password: boolean;
}

export async function getTrustedSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return { session: null, role: null as Role | null, profile: null as TrustedProfile | null };
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, role, student_id, full_name, email, phone, must_change_password')
    .eq('id', session.user.id)
    .single();

  if (error || !profile) {
    console.error('Failed to load trusted profile/role:', error);
    return { session, role: null as Role | null, profile: null as TrustedProfile | null };
  }

  return { session, role: profile.role as Role, profile: profile as TrustedProfile };
}

const dashboardPath = (role: Role | null) => (role === 'assistant' ? '/assistant-dashboard' : '/student-dashboard');

// Redirects away if the signed-in user's trusted role doesn't match.
// Returns { session, profile } on success, or null after redirecting.
export async function requireRole(expectedRole: Role) {
  const { session, role, profile } = await getTrustedSession();

  if (!session) {
    window.location.href = '/login';
    return null;
  }

  if (role !== expectedRole) {
    window.location.href = dashboardPath(role);
    return null;
  }

  return { session, profile: profile as TrustedProfile };
}

export function redirectToDashboard(role: Role | null) {
  window.location.href = dashboardPath(role);
}

// Records that a student has used their one-time self-service password
// change (see phase4_password_policy.sql). profiles has no client-
// writable UPDATE policy, so this goes through a SECURITY DEFINER RPC
// like every other write to that table.
export async function markPasswordChanged() {
  return supabase.rpc('mark_password_changed');
}
