-- =====================================================================
-- Phase 9: LinkedIn Post Generator — generation history
--
-- HOW TO RUN: paste this whole file into the Supabase SQL Editor for
-- this project and run it once. It only ADDS a new table, index,
-- trigger and policies — it does not touch any existing table or row.
-- Safe to re-run.
--
-- What it stores: each time an assistant generates LinkedIn posts, the
-- inputs and the generated variations are saved as one row, so the
-- "Recent Posts" list can reopen them later. Edits and single-card
-- regenerations update that row's `posts`.
--
-- Access model: every row is private to the user who created it.
-- Unlike profiles/payments (which are written only through SECURITY
-- DEFINER RPCs), this table holds nothing privileged — only a user's
-- own drafts — so owner-scoped RLS on direct writes is sufficient.
-- Both assistants and students can use the generator; each only ever
-- sees their own rows.
-- =====================================================================

create table if not exists public.linkedin_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('student', 'assistant')),
  purpose text not null,
  topic text not null,
  input jsonb not null,
  posts jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists linkedin_generations_user_created_idx
  on public.linkedin_generations (user_id, created_at desc);

create or replace function public.touch_linkedin_generation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  -- Ownership and role are fixed at creation time.
  new.user_id := old.user_id;
  new.role := old.role;
  new.created_at := old.created_at;
  return new;
end;
$$;

drop trigger if exists linkedin_generations_touch on public.linkedin_generations;
create trigger linkedin_generations_touch
  before update on public.linkedin_generations
  for each row execute function public.touch_linkedin_generation();

alter table public.linkedin_generations enable row level security;

drop policy if exists "Owners can view their LinkedIn generations" on public.linkedin_generations;
create policy "Owners can view their LinkedIn generations" on public.linkedin_generations
  for select using (user_id = auth.uid() and public.current_role() in ('assistant', 'student'));

drop policy if exists "Owners can create LinkedIn generations" on public.linkedin_generations;
create policy "Owners can create LinkedIn generations" on public.linkedin_generations
  for insert with check (
    user_id = auth.uid()
    and public.current_role() in ('assistant', 'student')
    and role = public.current_role()
  );

drop policy if exists "Owners can update their LinkedIn generations" on public.linkedin_generations;
create policy "Owners can update their LinkedIn generations" on public.linkedin_generations
  for update using (user_id = auth.uid() and public.current_role() in ('assistant', 'student'))
  with check (user_id = auth.uid());

drop policy if exists "Owners can delete their LinkedIn generations" on public.linkedin_generations;
create policy "Owners can delete their LinkedIn generations" on public.linkedin_generations
  for delete using (user_id = auth.uid() and public.current_role() in ('assistant', 'student'));
