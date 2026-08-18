-- Phase 3: favourites. The first thing an account visibly buys the person
-- holding it — until now signing in only protected spots across devices, which
-- stays invisible until you get a new phone.
--
-- Self-contained: a new table, its own policies, and no change to `spots` or to
-- any existing policy. Nothing here can affect the map for signed-out visitors.

create table if not exists favourites (
  user_id    uuid not null references auth.users(id) on delete cascade,
  spot_id    uuid not null references spots(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, spot_id)
);

-- Listing someone's favourites should not require scanning the table.
create index if not exists favourites_user_idx on favourites (user_id);

alter table favourites enable row level security;

-- Strictly private. Unlike profiles, which are public because usernames appear
-- next to spots, a favourite says where a named person is interested in
-- sleeping — nobody else should be able to read that, ever.
--
-- Note every policy is `auth.uid() = user_id`, including the insert check:
-- without it, a signed-in user could write rows on someone else's behalf.
drop policy if exists "own favourites read" on favourites;
create policy "own favourites read" on favourites
  for select using (auth.uid() = user_id);

drop policy if exists "own favourites insert" on favourites;
create policy "own favourites insert" on favourites
  for insert with check (auth.uid() = user_id);

drop policy if exists "own favourites delete" on favourites;
create policy "own favourites delete" on favourites
  for delete using (auth.uid() = user_id);

-- Nothing for anon: a signed-out visitor has no favourites and must not be able
-- to read anyone else's.
grant select, insert, delete on favourites to authenticated;

-- VERIFY
--
--   Signed in, from the app:  favouriting a spot adds one row.
--   With the ANON key, this must return an empty list, never rows:
--     curl "$URL/rest/v1/favourites?select=*" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
--
--   select count(*) from favourites;   -- in the SQL editor, as the owner

-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- drop table if exists favourites;
