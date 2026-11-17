# Supabase Schema & Storage Bucket Configuration

This handover guide documents the live **Supabase PostgreSQL schema**, **Row-Level Security (RLS) policies**, **indexes**, **triggers**, **RPC functions**, **Realtime publication**, and **Storage bucket configuration** for **PikolScore** so another developer can replicate the backend cleanly in a new Supabase project.

---

## 1. Live Storage Buckets (Fetched from `storage.buckets`)

Currently, this project has **1 storage bucket** configured in Supabase:

| Bucket ID | Name | Public | File Size Limit | Allowed MIME Types | Created At (UTC) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `player-photos` | `player-photos` | `true` | `15728640` bytes (15 MB) | `image/jpeg`, `image/png`, `image/webp` | `2026-10-31 08:15:35.367091+00` |

### Storage Path & Usage Convention
* **Object Path Format** (from [`components/player/PlayerPortal.jsx`](../components/player/PlayerPortal.jsx)):
  ```text
  <user_uuid>/slot-<1..4>-<timestamp>.<ext>
  ```
* **Profile Mapping**:
  * `public.profiles.photo_urls` stores a 4-element JSONB array of public URLs (`[slot1, slot2, slot3, slot4]`, defaulting to `[null, null, null, null]`).
  * `public.profiles.avatar_url` stores the first non-null URL from `photo_urls` (or the OAuth avatar URL on initial sign-up).

### Copy-Paste Bucket & Storage RLS SQL
Run this in the Supabase **SQL Editor** to recreate the `player-photos` bucket and its folder-scoped security policies:

```sql
-- 1. Create or update the player-photos bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'player-photos',
  'player-photos',
  true,
  15728640,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 2. Storage object RLS policies (folder-scoped to auth.uid())
drop policy if exists "Public read player photos" on storage.objects;
create policy "Public read player photos"
  on storage.objects for select
  to public
  using (bucket_id = 'player-photos');

drop policy if exists "Players can upload own photos" on storage.objects;
create policy "Players can upload own photos"
  on storage.objects for insert
  to public
  with check (
    bucket_id = 'player-photos'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

drop policy if exists "Players can update own photos" on storage.objects;
create policy "Players can update own photos"
  on storage.objects for update
  to public
  using (
    bucket_id = 'player-photos'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'player-photos'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

drop policy if exists "Players can delete own photos" on storage.objects;
create policy "Players can delete own photos"
  on storage.objects for delete
  to public
  using (
    bucket_id = 'player-photos'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );
```

---

## 2. Database Tables (Executable Creation Order)

Below is the exact schema ordered by foreign key dependencies (`auth.users` → `public.profiles` → `public.match_sessions` → `public.match_events`), including the live `UNIQUE` and `ON DELETE` rules:

```sql
-- =========================================================================
-- 1. public.profiles
-- =========================================================================
create table if not exists public.profiles (
  id uuid not null,
  full_name text,
  role text check (role = any (array['referee'::text, 'player'::text])),
  avatar_url text,
  created_at timestamp with time zone not null default timezone('utc'::text, now()),
  last_active_at timestamp with time zone not null default now(),
  experience text check (
    experience is null
    or (experience = any (array['beginner'::text, 'novice'::text, 'intermediate'::text, 'expert'::text]))
  ),
  photo_urls jsonb not null default '[null, null, null, null]'::jsonb
    check (jsonb_typeof(photo_urls) = 'array'::text),
  constraint profiles_pkey primary key (id),
  constraint profiles_id_fkey foreign key (id) references auth.users(id) on delete cascade
);

-- =========================================================================
-- 2. public.match_sessions
-- =========================================================================
create table if not exists public.match_sessions (
  id uuid not null,
  umpire_id uuid not null default auth.uid(),
  format text not null default 'doubles'::text
    check (format = any (array['singles'::text, 'doubles'::text])),
  target_score smallint not null default 11
    check (target_score >= 1 and target_score <= 99),
  win_by smallint not null default 2
    check (win_by >= 1 and win_by <= 10),
  status text not null default 'in_progress'::text
    check (status = any (array['in_progress'::text, 'completed'::text, 'abandoned'::text])),
  team_keys jsonb not null default '["omega", "alpha"]'::jsonb,
  team_names jsonb not null default '["Team Omega", "Team Alpha"]'::jsonb,
  team_palettes jsonb not null default '["omega", "alpha"]'::jsonb,
  player_names jsonb not null default '{"team0": ["Player 1", "Player 2"], "team1": ["Player 3", "Player 4"]}'::jsonb,
  initial_state jsonb not null,
  score_team0 smallint not null default 0 check (score_team0 >= 0 and score_team0 <= 99),
  score_team1 smallint not null default 0 check (score_team1 >= 0 and score_team1 <= 99),
  serving_team smallint not null default 0 check (serving_team = any (array[0, 1])),
  server_number smallint not null default 2 check (server_number = any (array[1, 2])),
  server_court text not null default 'right'::text check (server_court = any (array['right'::text, 'left'::text])),
  court_positions jsonb not null,
  winner_team smallint check (winner_team = any (array[0, 1])),
  head_sequence integer not null default 0,
  version integer not null default 0,
  timer_status text not null default 'idle'::text
    check (timer_status = any (array['idle'::text, 'running'::text, 'paused'::text, 'expired'::text])),
  timer_duration_ms integer not null default 1800000 check (timer_duration_ms > 0),
  timer_remaining_ms integer not null default 1800000 check (timer_remaining_ms >= 0),
  timer_ends_at timestamp with time zone,
  timer_updated_at timestamp with time zone not null default now(),
  legacy_log jsonb,
  completed_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint match_sessions_pkey primary key (id),
  constraint match_sessions_umpire_id_fkey foreign key (umpire_id) references public.profiles(id) on delete restrict
);

-- =========================================================================
-- 3. public.match_events
-- =========================================================================
create table if not exists public.match_events (
  id uuid not null,
  session_id uuid not null,
  sequence integer not null check (sequence > 0),
  status text not null default 'active'::text
    check (status = any (array['active'::text, 'undone'::text, 'discarded'::text])),
  event_type text not null
    check (event_type = any (array['point'::text, 'secondServer'::text, 'sideOut'::text, 'gameWon'::text])),
  elapsed_seconds integer not null default 0 check (elapsed_seconds >= 0),
  state_after jsonb not null check (
    jsonb_typeof(state_after -> 'scores'::text) = 'array'::text
    and (((state_after -> 'scores'::text) ->> 0)::integer) >= 0
    and (((state_after -> 'scores'::text) ->> 0)::integer) <= 99
    and (((state_after -> 'scores'::text) ->> 1)::integer) >= 0
    and (((state_after -> 'scores'::text) ->> 1)::integer) <= 99
    and (((state_after ->> 'servingTeam'::text)::integer) = any (array[0, 1]))
    and (((state_after ->> 'serverNumber'::text)::integer) = any (array[1, 2]))
    and ((state_after ->> 'serverCourt'::text) = any (array['right'::text, 'left'::text]))
  ),
  call_string text not null,
  message text not null,
  created_by uuid not null default auth.uid(),
  created_at timestamp with time zone not null default now(),
  status_changed_at timestamp with time zone not null default now(),
  constraint match_events_pkey primary key (id),
  constraint match_events_session_id_sequence_key unique (session_id, sequence),
  constraint match_events_session_id_fkey foreign key (session_id) references public.match_sessions(id) on delete cascade
);
```

---

## 3. Indexes

```sql
create index if not exists idx_profiles_id_last_active
  on public.profiles using btree (id, last_active_at);

create index if not exists idx_match_sessions_umpire_status
  on public.match_sessions using btree (umpire_id, status, updated_at desc);

create index if not exists idx_match_sessions_active_updated
  on public.match_sessions using btree (updated_at desc)
  where (status = 'in_progress'::text);

create index if not exists idx_match_sessions_umpire_active_updated
  on public.match_sessions using btree (umpire_id, updated_at desc)
  where (status = 'in_progress'::text);

create index if not exists idx_match_events_session_status_seq
  on public.match_events using btree (session_id, status, sequence);
```

---

## 4. Row-Level Security (RLS) Policies

```sql
alter table public.profiles enable row level security;
alter table public.match_sessions enable row level security;
alter table public.match_events enable row level security;

-- public.profiles
drop policy if exists "Public profiles are readable by everyone" on public.profiles;
create policy "Public profiles are readable by everyone"
  on public.profiles for select
  to public
  using (true);

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
  on public.profiles for insert
  to public
  with check ((select auth.uid()) = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update
  to public
  using ((select auth.uid()) = id);

-- public.match_sessions
drop policy if exists "umpire_select_own_sessions" on public.match_sessions;
create policy "umpire_select_own_sessions"
  on public.match_sessions for select
  to authenticated
  using (umpire_id = (select auth.uid()));

drop policy if exists "spectator_select_public_sessions" on public.match_sessions;
create policy "spectator_select_public_sessions"
  on public.match_sessions for select
  to anon, authenticated
  using (status = any (array['in_progress'::text, 'completed'::text]));

-- public.match_events
drop policy if exists "select_events_of_visible_sessions" on public.match_events;
create policy "select_events_of_visible_sessions"
  on public.match_events for select
  to anon, authenticated
  using (exists (
    select 1
    from public.match_sessions s
    where s.id = match_events.session_id
      and (
        s.umpire_id = (select auth.uid())
        or s.status = any (array['in_progress'::text, 'completed'::text])
      )
  ));
```

---

## 5. Triggers, RPC Functions & Realtime

### Triggers
1. **`auth.users` → `on_auth_user_created`**: Automatically creates or merges a row in `public.profiles` whenever a new user signs up.
2. **`public.profiles` → `trg_protect_profile_role`**: Prevents `authenticated` or `anon` clients from changing `profiles.role` once assigned.

```sql
-- Auth profile bootstrap
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_name text;
  v_avatar text;
begin
  if (new.raw_user_meta_data->>'role') in ('referee', 'player') then
    v_role := new.raw_user_meta_data->>'role';
  else
    v_role := null;
  end if;

  v_name := coalesce(
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name'
  );

  v_avatar := coalesce(
    new.raw_user_meta_data->>'avatar_url',
    new.raw_user_meta_data->>'picture'
  );

  insert into public.profiles (id, full_name, role, avatar_url)
  values (new.id, v_name, v_role, v_avatar)
  on conflict (id) do update set
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Role protection trigger
create or replace function public.fn_protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if old.role is not null and new.role is distinct from old.role then
      raise exception 'User role cannot be changed once assigned' using errcode = '42501';
    end if;

    if new.role is not null and new.role not in ('referee', 'player') then
      raise exception 'Invalid role' using errcode = '22023';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_profile_role on public.profiles;
create trigger trg_protect_profile_role
  before update on public.profiles
  for each row execute function public.fn_protect_profile_role();

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.fn_protect_profile_role() from public, anon, authenticated;
```

### Live Match RPC Functions
The scoreboard client relies on the following Postgres functions in `public` (extracted from the live database):

```sql
-- Internal helper: apply head-state cache update to match_sessions
create or replace function public._apply_head_state(
  p_session_id uuid,
  p_state jsonb,
  p_bump_head_seq boolean default false
) returns public.match_sessions
language sql
set search_path = ''
as $$
  update public.match_sessions set
    score_team0     = (p_state->'scores'->>0)::smallint,
    score_team1     = (p_state->'scores'->>1)::smallint,
    serving_team    = (p_state->>'servingTeam')::smallint,
    server_number   = (p_state->>'serverNumber')::smallint,
    server_court    = p_state->>'serverCourt',
    court_positions = p_state->'courtPositions',
    winner_team     = case when coalesce((p_state->>'gameOver')::boolean, false)
                           then (p_state->>'winner')::smallint
                           else null end,
    status          = case when coalesce((p_state->>'gameOver')::boolean, false)
                           then 'completed'::text
                           else 'in_progress'::text end,
    completed_at    = case when coalesce((p_state->>'gameOver')::boolean, false)
                           then coalesce(completed_at, now())
                           else null end,
    timer_status    = case when coalesce((p_state->>'gameOver')::boolean, false) and timer_status = 'running'
                           then 'paused'::text
                           else timer_status end,
    head_sequence   = case when p_bump_head_seq then head_sequence + 1 else head_sequence end,
    version         = version + 1,
    updated_at      = now()
  where id = p_session_id
  returning *;
$$;

-- Internal helper: row-lock session and validate ownership/status/version
create or replace function public._lock_session(
  p_session_id uuid,
  p_expected_version integer
) returns public.match_sessions
language plpgsql
set search_path = 'public'
as $$
declare s public.match_sessions;
begin
  select * into s from public.match_sessions where id = p_session_id for update;
  if not found or s.umpire_id <> auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if s.status <> 'in_progress' then
    raise exception 'session_closed' using errcode = 'P0001';
  end if;
  if p_expected_version is not null and s.version <> p_expected_version then
    raise exception 'version_conflict' using errcode = '40001';
  end if;
  return s;
end $$;

-- Create a match session (referee role required)
create or replace function public.fn_create_session(
  p_session_id uuid,
  p_format text,
  p_team_keys jsonb,
  p_team_names jsonb,
  p_team_palettes jsonb,
  p_player_names jsonb,
  p_initial_state jsonb,
  p_timer_duration_ms integer default 1800000,
  p_legacy_log jsonb default null::jsonb,
  p_auto_start_timer boolean default true
) returns public.match_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare s public.match_sessions;
declare v_uid uuid;
declare v_timer_status text;
declare v_timer_ends_at timestamptz;
begin
  v_uid := (select auth.uid());
  if v_uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.profiles where id = v_uid and role = 'referee'
  ) then
    raise exception 'Only registered umpires may create match sessions' using errcode = '42501';
  end if;

  if coalesce(p_auto_start_timer, true) then
    v_timer_status := 'running';
    v_timer_ends_at := now() + (p_timer_duration_ms * interval '1 millisecond');
  else
    v_timer_status := 'idle';
    v_timer_ends_at := null;
  end if;

  insert into public.match_sessions (
    id, umpire_id, format, team_keys, team_names, team_palettes, player_names,
    initial_state, court_positions,
    timer_status, timer_duration_ms, timer_remaining_ms, timer_ends_at, timer_updated_at,
    legacy_log
  ) values (
    p_session_id, v_uid, p_format, p_team_keys, p_team_names, p_team_palettes, p_player_names,
    p_initial_state, p_initial_state->'courtPositions',
    v_timer_status, p_timer_duration_ms, p_timer_duration_ms, v_timer_ends_at, now(),
    p_legacy_log
  )
  on conflict (id) do nothing;

  select * into s from public.match_sessions where id = p_session_id;
  if s.umpire_id <> v_uid then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if s.version = 0 then
    s := public._apply_head_state(p_session_id, p_initial_state, false);
  end if;
  return s;
end;
$$;

-- Record rally event with idempotency and optimistic concurrency
create or replace function public.fn_record_rally(
  p_session_id uuid,
  p_event_id uuid,
  p_expected_version integer,
  p_event_type text,
  p_elapsed_seconds integer,
  p_state_after jsonb,
  p_call_string text,
  p_message text
) returns public.match_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare s public.match_sessions;
begin
  s := public._lock_session(p_session_id, null);

  if exists (select 1 from public.match_events where id = p_event_id) then
    return s;
  end if;

  if s.version <> p_expected_version then
    raise exception 'version_conflict' using errcode = '40001';
  end if;

  update public.match_events
     set status = 'discarded', status_changed_at = now()
   where session_id = p_session_id and status = 'undone';

  insert into public.match_events (
    id, session_id, sequence, event_type, elapsed_seconds, state_after, call_string, message, created_by
  ) values (
    p_event_id, p_session_id, s.head_sequence + 1, p_event_type,
    greatest(0, p_elapsed_seconds), p_state_after, p_call_string, p_message, (select auth.uid())
  );

  return public._apply_head_state(p_session_id, p_state_after, true);
end $$;

-- Undo latest active rally event (supports undoing winning point on completed session)
create or replace function public.fn_undo_rally(
  p_session_id uuid,
  p_expected_version integer
) returns public.match_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.match_sessions;
  v_target_id uuid;
  v_head jsonb;
begin
  select * into s from public.match_sessions where id = p_session_id for update;
  if not found or s.umpire_id <> (select auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if s.status not in ('in_progress', 'completed') then
    raise exception 'session_closed' using errcode = 'P0001';
  end if;
  if p_expected_version is not null and s.version <> p_expected_version then
    raise exception 'version_conflict' using errcode = '40001';
  end if;

  select id into v_target_id from public.match_events
   where session_id = p_session_id and status = 'active'
   order by sequence desc limit 1;

  if v_target_id is null then
    raise exception 'nothing_to_undo' using errcode = 'P0002';
  end if;

  update public.match_events
     set status = 'undone', status_changed_at = now()
   where id = v_target_id;

  select state_after into v_head from public.match_events
   where session_id = p_session_id and status = 'active'
   order by sequence desc limit 1;

  return public._apply_head_state(p_session_id, coalesce(v_head, s.initial_state), false);
end $$;

-- Redo earliest undone rally event
create or replace function public.fn_redo_rally(
  p_session_id uuid,
  p_expected_version integer
) returns public.match_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.match_sessions;
  v_target_id uuid;
  v_head jsonb;
begin
  s := public._lock_session(p_session_id, p_expected_version);

  select id, state_after into v_target_id, v_head from public.match_events
   where session_id = p_session_id and status = 'undone'
   order by sequence asc limit 1;

  if v_target_id is null then
    raise exception 'nothing_to_redo' using errcode = 'P0002';
  end if;

  update public.match_events
     set status = 'active', status_changed_at = now()
   where id = v_target_id;

  return public._apply_head_state(p_session_id, v_head, false);
end $$;

-- Synchronize match timer
create or replace function public.fn_set_timer(
  p_session_id uuid,
  p_status text,
  p_remaining_ms integer,
  p_ends_at timestamp with time zone,
  p_client_ts timestamp with time zone
) returns public.match_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare s public.match_sessions;
begin
  select * into s from public.match_sessions where id = p_session_id for update;
  if not found or s.umpire_id <> (select auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if s.status = 'abandoned' then
    return s;
  end if;

  update public.match_sessions set
    timer_status       = p_status,
    timer_remaining_ms = greatest(0, p_remaining_ms),
    timer_ends_at      = p_ends_at,
    timer_updated_at   = now(),
    updated_at         = now()
  where id = p_session_id
  returning * into s;
  return s;
end $$;

-- Update team names, palettes, or keys
create or replace function public.fn_update_session_meta(
  p_session_id uuid,
  p_team_names jsonb default null::jsonb,
  p_team_palettes jsonb default null::jsonb,
  p_team_keys jsonb default null::jsonb
) returns public.match_sessions
language plpgsql
security definer
set search_path = 'public'
as $$
declare s public.match_sessions;
begin
  s := public._lock_session(p_session_id, null);

  update public.match_sessions set
    team_names    = coalesce(p_team_names, team_names),
    team_palettes = coalesce(p_team_palettes, team_palettes),
    team_keys     = coalesce(p_team_keys, team_keys),
    updated_at    = now()
  where id = p_session_id
  returning * into s;
  return s;
end $$;

-- Close match session (completed or abandoned)
create or replace function public.fn_close_session(
  p_session_id uuid,
  p_status text
) returns public.match_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare s public.match_sessions;
begin
  if p_status not in ('completed', 'abandoned') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  select * into s from public.match_sessions where id = p_session_id for update;
  if not found or s.umpire_id <> (select auth.uid()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if s.status in ('completed', 'abandoned') then
    return s;
  end if;

  update public.match_sessions set
    status       = case when s.winner_team is not null then 'completed' else p_status end,
    completed_at = coalesce(completed_at, now()),
    timer_status = case when timer_status = 'running' then 'paused' else timer_status end,
    updated_at   = now()
  where id = p_session_id
  returning * into s;
  return s;
end $$;

-- Function grants
revoke all on function public._apply_head_state(uuid, jsonb, boolean) from public, anon, authenticated;
revoke all on function public._lock_session(uuid, integer) from public, anon, authenticated;

grant execute on function public.fn_create_session(uuid, text, jsonb, jsonb, jsonb, jsonb, jsonb, integer, jsonb, boolean) to authenticated;
grant execute on function public.fn_record_rally(uuid, uuid, integer, text, integer, jsonb, text, text) to authenticated;
grant execute on function public.fn_undo_rally(uuid, integer) to authenticated;
grant execute on function public.fn_redo_rally(uuid, integer) to authenticated;
grant execute on function public.fn_set_timer(uuid, text, integer, timestamp with time zone, timestamp with time zone) to authenticated;
grant execute on function public.fn_update_session_meta(uuid, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.fn_close_session(uuid, text) to authenticated;
```

### Realtime Publication
Only `public.match_sessions` is added to the Supabase Realtime publication (`supabase_realtime`):

```sql
alter publication supabase_realtime add table public.match_sessions;
```

---

## 6. JSONB Column Structures Used by Application Code

Because `public.match_sessions` has no separate `court_number` column in the live schema, court metadata, lobby slot assignments, TV pairing, and the confirmed webhook result are stored inside `match_sessions.player_names` JSONB (read/written by [`app/api/match/lobby/route.js`](../app/api/match/lobby/route.js) and [`app/api/match/results/route.js`](../app/api/match/results/route.js)):

### `match_sessions.player_names`
```json
{
  "courtNumber": 1,
  "umpireId": "uuid-of-referee-or-null",
  "umpireName": "Ref John",
  "lobbyLocked": true,
  "pairedTvIds": ["tv_A4F92C"],
  "team0": ["Alice", "Bob"],
  "team1": ["Charlie", "Dana"],
  "slots": {
    "team0": [
      { "userId": "uuid-alice", "name": "Alice" },
      { "userId": "uuid-bob", "name": "Bob" }
    ],
    "team1": [
      { "userId": "uuid-charlie", "name": "Charlie" },
      { "userId": null, "name": "Dana" }
    ]
  },
  "tvClosedReason": "completed",
  "tvClosedAt": "2026-11-17T08:18:35.000Z",
  "confirmedAt": "2026-11-17T08:18:35.000Z",
  "webhookDelivery": {
    "configured": true,
    "delivered": true,
    "attempts": 1,
    "status": 200,
    "error": null
  },
  "confirmedResult": {
    "event": "match.concluded",
    "sessionId": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

### `match_sessions.initial_state` & `match_events.state_after`
Must satisfy the `match_events_state_after_check` constraint (`scores` array of 2 ints `0..99`, `servingTeam` in `[0,1]`, `serverNumber` in `[1,2]`, `serverCourt` in `['right','left']`):
```json
{
  "format": "doubles",
  "scores": [11, 8],
  "servingTeam": 0,
  "serverNumber": 1,
  "serverCourt": "left",
  "courtPositions": [
    { "left": "Bob", "right": "Alice" },
    { "left": "Dana", "right": "Charlie" }
  ],
  "gameOver": true,
  "winner": 0
}
```

---

## 7. Server-Side Environment Variables for Setup

To point a new Next.js deployment at the copied Supabase project (see [`.env.example`](../.env.example)):

```env
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-or-publishable-key>
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<your-anon-or-publishable-key>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
NEXT_PUBLIC_CLOUD_SYNC=true

# Optional: Wrenqueue Webhook & Match Result API
MATCH_WEBHOOK_URL=https://<wrenqueue-domain>/api/webhooks/pikolscore
MATCH_WEBHOOK_SECRET=<shared-secret>
```
