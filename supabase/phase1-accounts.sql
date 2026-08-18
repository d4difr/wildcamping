-- Phase 1: accounts. Schema, profiles, and claiming device-owned spots.
--
-- Everything here is ADDITIVE. No existing policy is changed and no existing
-- column is touched, so the map, submitting, flagging and the admin panel behave
-- exactly as before while this sits unused.
--
-- Note this deliberately does NOT add a "read own spots" RLS policy, which the
-- original plan had. Phase 0 moved own-pending reads to /api/spots-private, so
-- nothing needs it yet, and changing the SELECT policy on `spots` is the single
-- riskiest thing in the whole account project — it is what the map depends on.
-- It waits until a feature actually requires it.
--
-- RUN STEPS 1-3 TOGETHER. Step 4 is the claim function and can wait until the
-- sign-in flow is working.

-- ---------------------------------------------------------------------------
-- STEP 1 - ownership column
--
-- Nullable forever. Legacy spots stay device-owned, and a user who never claims
-- keeps working exactly as today.
-- ---------------------------------------------------------------------------

alter table spots add column if not exists user_id uuid references auth.users(id);
create index if not exists spots_user_id_idx on spots (user_id);

-- REMINDER: anon has column-level SELECT on spots, so a new column is invisible
-- to the app until granted. user_id is NOT granted here on purpose — the client
-- has no use for it yet, and Phase 2 (attribution) is when that changes.

-- ---------------------------------------------------------------------------
-- STEP 2 - profiles
--
-- A row exists only once someone chooses a username. No row means no display
-- name, which is exactly what posting anonymously needs — so anonymity is the
-- default and costs nothing, rather than being a flag to remember to set.
-- ---------------------------------------------------------------------------

create table if not exists profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  username    text not null check (
                char_length(username) between 3 and 24
                and username ~ '^[A-Za-z0-9æøåÆØÅ_-]+$'
              ),
  created_at  timestamptz not null default now()
);

-- Case-insensitive uniqueness. Without this "Dadi" and "dadi" are different
-- users, which is how impersonation starts.
create unique index if not exists profiles_username_lower_idx
  on profiles (lower(username));

-- Names that would let someone pose as the site itself.
create table if not exists reserved_usernames (name text primary key);
insert into reserved_usernames (name) values
  ('admin'), ('administrator'), ('vilda'), ('vildakart'), ('moderator'),
  ('support'), ('system'), ('anonym'), ('anonymous'), ('root')
on conflict do nothing;

alter table profiles enable row level security;

-- Usernames are public — they appear next to spots from Phase 2 on.
drop policy if exists "profiles readable" on profiles;
create policy "profiles readable" on profiles
  for select using (true);

-- You may only create or edit your own, and only if the name is not reserved.
drop policy if exists "own profile insert" on profiles;
create policy "own profile insert" on profiles
  for insert with check (
    auth.uid() = user_id
    and lower(username) not in (select name from reserved_usernames)
  );

drop policy if exists "own profile update" on profiles;
create policy "own profile update" on profiles
  for update using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and lower(username) not in (select name from reserved_usernames)
  );

grant select on profiles to anon, authenticated;
grant insert, update on profiles to authenticated;
grant select on reserved_usernames to anon, authenticated;

-- ---------------------------------------------------------------------------
-- STEP 3 - claim audit trail
--
-- Written before the claim function exists so that when claiming does run, there
-- is never a moment where spots move without a record of it.
-- ---------------------------------------------------------------------------

create table if not exists spot_claims (
  id          bigserial primary key,
  spot_id     uuid not null references spots(id),
  user_id     uuid not null references auth.users(id),
  owner_token text not null,
  claimed_at  timestamptz not null default now()
);

alter table spot_claims enable row level security;
-- No policies: nobody reads this through the API. It is for forensics, via the
-- SQL editor or the service role.

-- ---------------------------------------------------------------------------
-- STEP 4 - the claim function.  RUN THIS ONLY AFTER SIGN-IN WORKS.
--
-- Guarantees, in order of importance:
--   1. Never lose a spot. owner_token keeps working forever, claimed or not.
--   2. Idempotent. Running twice claims nothing the second time.
--   3. One-way. A spot owned by user A is never claimable by user B, even from
--      a device holding the old token.
--   4. Auditable. Every claim is recorded.
--
-- `user_id is null` in the WHERE is what makes 2 and 3 hold: a second call
-- matches nothing, and another user's spot is never in scope.
-- ---------------------------------------------------------------------------

create or replace function public.claim_my_spots(p_token text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_token is null or length(p_token) < 20 then return 0; end if;

  with claimed as (
    update spots
       set user_id = auth.uid()
     where owner_token = p_token
       and user_id is null
    returning id
  )
  insert into spot_claims (spot_id, user_id, owner_token)
  select id, auth.uid(), p_token from claimed;

  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.claim_my_spots(text) from public;
grant execute on function public.claim_my_spots(text) to authenticated;

-- ---------------------------------------------------------------------------
-- VERIFY
--
--   select count(*), count(user_id) from spots;      -- total must not change
--   select * from profiles;
--   insert into profiles (user_id, username) values (auth.uid(), 'admin');
--                                                   -- must be refused
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- update spots set user_id = null
--   where id in (select spot_id from spot_claims where claimed_at > '<time>');
-- drop function if exists public.claim_my_spots(text);
-- drop table if exists spot_claims;
-- drop table if exists profiles;
-- drop table if exists reserved_usernames;
-- alter table spots drop column if exists user_id;
