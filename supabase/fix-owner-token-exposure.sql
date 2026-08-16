-- Closes a live hole: owner_token was readable through the public anon key.
--
--   GET /rest/v1/spots?select=id,owner_token   -> every spot's token
--
-- /api/spot-delete and /api/spot-update authorise by comparing the supplied
-- token against the stored one, so a readable token meant anyone could delete
-- or edit any spot. The anon key is public by design; the mistake was exposing
-- a secret through it.
--
-- RUN THESE IN ORDER. Step 1 is additive and safe to run any time. Only run
-- step 2 once the client that uses my_spot_ids() is deployed, otherwise the
-- edit/delete controls quietly disappear for legitimate owners.

-- ---------------------------------------------------------------------------
-- STEP 1 — give the client the only thing it legitimately needs: which spot ids
-- belong to the caller's device token. Security definer so it can read the
-- column the caller cannot.
-- ---------------------------------------------------------------------------

create or replace function public.my_spot_ids(p_token text)
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select id
  from spots
  where p_token is not null
    and length(p_token) >= 20   -- refuse to answer for trivial guesses
    and owner_token = p_token
    and deleted_at is null
$$;

revoke all on function public.my_spot_ids(text) from public;
grant execute on function public.my_spot_ids(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- STEP 2 — stop the secret being readable. Run AFTER deploying the new client.
--
-- Note Postgres requires column-level SELECT to reference a column anywhere in
-- a query, including WHERE. So this also blocks
--   .eq('owner_token', ...)
-- which is why the client now filters by id instead.
-- ---------------------------------------------------------------------------

-- NOTE: a plain
--     revoke select (owner_token) on public.spots from anon;
-- DOES NOT WORK and fails silently. In Postgres a table-level SELECT grant
-- covers every column, and a column-level revoke cannot carve a hole in it.
-- Verified against production: after running it, owner_token was still readable.
--
-- The working form is to drop the table-level grant and grant back the columns
-- that should stay public. If you add a column to spots later, you MUST add it
-- here too or it will be invisible to the app.

revoke select on public.spots from anon;

grant select (
  id, name, description, latitude, longitude,
  photo_url, photo_urls, status, created_at,
  access, spot_type, spot_types, region,
  flags, flag_reports, deleted_at,
  flatness_deg, flatness_relief_m, flatness_offset_m, flatness_checked_at
) on public.spots to anon;

-- Verify — the first must now fail, the rest must still work:
--   select owner_token from spots limit 1;              -> permission denied
--   select id, name from spots limit 1;                 -> works
--   select * from my_spot_ids('<a real token>');        -> that device's ids
--   select * from my_spot_ids('short');                 -> no rows
--
-- `select *` will also now fail for anon, which is expected — the app selects
-- explicit columns. Check the site still lists spots after running this.

-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- grant select (owner_token) on public.spots to anon;
-- drop function if exists public.my_spot_ids(text);

-- ---------------------------------------------------------------------------
-- REMAINING RISK
-- ---------------------------------------------------------------------------
-- This narrows the hole, it does not close it. Anyone who already captured a
-- token, or who obtains one another way, can still act on those spots — the
-- token is a bearer credential with no expiry. Tokens stop being a security
-- boundary only when ownership moves to real accounts (see
-- docs/accounts-phase1.md).
