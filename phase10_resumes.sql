-- =====================================================================
-- Phase 10: Resume Generator — saved resumes ("My Resumes")
--
-- HOW TO RUN: paste this whole file into the Supabase SQL Editor for
-- this project and run it once. It only ADDS new tables, indexes,
-- triggers and policies — it does not touch any existing table or row.
-- Safe to re-run.
--
-- resumes           one row per resume a student creates. Content (data)
--                   and presentation (template) are stored separately, so
--                   switching templates never changes the content.
-- resume_ai_usage   one row per AI request, used only to enforce a fair
--                   hourly limit in the resume-ai Edge Function.
--
-- Access model: every row is private to the student who created it.
-- Only students can use the feature (withdrawn students are signed out
-- by the app and refused by the Edge Function).
-- =====================================================================

create table if not exists public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null default 'Untitled Resume' check (char_length(name) <= 120),
  template text not null default 'classic'
    check (template in ('classic', 'modern', 'technical', 'fresher', 'dataScience', 'twoColumn')),
  data jsonb not null default '{}'::jsonb,
  ats jsonb,
  status text not null default 'draft' check (status in ('draft', 'complete')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists resumes_user_updated_idx on public.resumes (user_id, updated_at desc);

create or replace function public.touch_resume()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  -- Ownership and creation time are fixed.
  new.user_id := old.user_id;
  new.created_at := old.created_at;
  return new;
end;
$$;

drop trigger if exists resumes_touch on public.resumes;
create trigger resumes_touch
  before update on public.resumes
  for each row execute function public.touch_resume();

alter table public.resumes enable row level security;

drop policy if exists "Students can view their resumes" on public.resumes;
create policy "Students can view their resumes" on public.resumes
  for select using (user_id = auth.uid() and public.current_role() = 'student');

drop policy if exists "Students can create resumes" on public.resumes;
create policy "Students can create resumes" on public.resumes
  for insert with check (user_id = auth.uid() and public.current_role() = 'student');

drop policy if exists "Students can update their resumes" on public.resumes;
create policy "Students can update their resumes" on public.resumes
  for update using (user_id = auth.uid() and public.current_role() = 'student')
  with check (user_id = auth.uid());

drop policy if exists "Students can delete their resumes" on public.resumes;
create policy "Students can delete their resumes" on public.resumes
  for delete using (user_id = auth.uid() and public.current_role() = 'student');


create table if not exists public.resume_ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  action text not null,
  created_at timestamptz not null default now()
);

create index if not exists resume_ai_usage_user_created_idx on public.resume_ai_usage (user_id, created_at desc);

alter table public.resume_ai_usage enable row level security;

drop policy if exists "Students can log their AI usage" on public.resume_ai_usage;
create policy "Students can log their AI usage" on public.resume_ai_usage
  for insert with check (user_id = auth.uid() and public.current_role() = 'student');

drop policy if exists "Students can view their AI usage" on public.resume_ai_usage;
create policy "Students can view their AI usage" on public.resume_ai_usage
  for select using (user_id = auth.uid());
