// Shared auth helpers.
//
// IMPORTANT: role checks here read `profiles.role`, never
// `user.user_metadata.role`. user_metadata is editable by the signed-in
// user themselves via supabase.auth.updateUser(), so it must never be
// used for authorization — only profiles.role is trustworthy, because
// it has no client-writable RLS policy (all writes to it go through
// SECURITY DEFINER RPCs). See phase1_student_assistant.sql.

async function getTrustedSession(client) {
  const { data: { session } } = await client.auth.getSession();
  if (!session) {
    return { session: null, role: null, profile: null };
  }

  const { data: profile, error } = await client
    .from('profiles')
    .select('id, role, student_id, full_name, email, phone')
    .eq('id', session.user.id)
    .single();

  if (error || !profile) {
    console.error('Failed to load trusted profile/role:', error);
    return { session, role: null, profile: null };
  }

  return { session, role: profile.role, profile };
}

// Redirects away if the signed-in user's trusted role doesn't match.
// Returns { session, profile } on success, or null after redirecting.
async function requireRole(client, expectedRole) {
  const { session, role, profile } = await getTrustedSession(client);

  if (!session) {
    window.location.href = './login.html';
    return null;
  }

  if (role !== expectedRole) {
    window.location.href = role === 'assistant' ? './assistant-dashboard.html' : './student-dashboard.html';
    return null;
  }

  return { session, profile };
}
