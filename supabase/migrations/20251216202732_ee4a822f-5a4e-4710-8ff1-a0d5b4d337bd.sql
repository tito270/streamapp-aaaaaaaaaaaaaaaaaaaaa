-- =========================================
-- 0) Extensions
-- =========================================
create extension if not exists pgcrypto;

-- =========================================
-- 1) PROFILES TABLE (for username + role)
-- Used in Register.tsx: supabase.from("profiles").upsert({ id: user.id, ... })
-- =========================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text,
  role text default 'user',
  roles jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- updated_at trigger
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- RLS
alter table public.profiles enable row level security;

-- Allow logged-in user to read own profile
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

-- Allow logged-in user to insert own profile (needed for your Register upsert)
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

-- Allow logged-in user to update own profile (optional, useful later)
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- =========================================
-- 2) STREAMS TABLE
-- Used in StreamManager + ManagementDialog:
-- select/insert/update/delete on "streams"
-- =========================================
create table if not exists public.streams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  url text not null,
  resolution text default '480p',
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_streams_updated_at on public.streams;
create trigger trg_streams_updated_at
before update on public.streams
for each row execute function public.set_updated_at();

create index if not exists idx_streams_user_id on public.streams(user_id);
create index if not exists idx_streams_created_at on public.streams(created_at);

alter table public.streams enable row level security;

-- User can read own streams
drop policy if exists "streams_select_own" on public.streams;
create policy "streams_select_own"
on public.streams
for select
to authenticated
using (auth.uid() = user_id);

-- User can insert own streams
drop policy if exists "streams_insert_own" on public.streams;
create policy "streams_insert_own"
on public.streams
for insert
to authenticated
with check (auth.uid() = user_id);

-- User can update own streams
drop policy if exists "streams_update_own" on public.streams;
create policy "streams_update_own"
on public.streams
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- User can delete own streams
drop policy if exists "streams_delete_own" on public.streams;
create policy "streams_delete_own"
on public.streams
for delete
to authenticated
using (auth.uid() = user_id);

-- =========================================
-- 3) BITRATE LOGS TABLE
-- Used in StreamManager:
-- insert into "bitrate_logs"
-- select last 24h for CSV
-- =========================================
create table if not exists public.bitrate_logs (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  stream_id uuid references public.streams(id) on delete set null,
  stream_name text not null,
  stream_url text not null,
  bitrate_mbps double precision not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_bitrate_logs_user_time on public.bitrate_logs(user_id, created_at);
create index if not exists idx_bitrate_logs_stream_id on public.bitrate_logs(stream_id);

alter table public.bitrate_logs enable row level security;

-- User can read own logs (CSV download)
drop policy if exists "bitrate_logs_select_own" on public.bitrate_logs;
create policy "bitrate_logs_select_own"
on public.bitrate_logs
for select
to authenticated
using (auth.uid() = user_id);

-- User can insert own logs (buffer insert)
drop policy if exists "bitrate_logs_insert_own" on public.bitrate_logs;
create policy "bitrate_logs_insert_own"
on public.bitrate_logs
for insert
to authenticated
with check (auth.uid() = user_id);

-- Optional: block updates/deletes (your UI doesn’t need them)
-- (Do nothing => denied by RLS)

