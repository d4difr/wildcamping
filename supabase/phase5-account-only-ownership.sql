-- Ownership requires an account.
--
-- Until now editing and deleting a spot was granted by owner_token — a UUID the
-- browser generated for itself. It is not proof of anything: it is
-- client-supplied, unverifiable, and anyone who obtained one could act on those
-- spots. That risk has been noted since the token was first hidden and could
-- not be removed while the token still granted rights.
--
-- The flow now:
--
--   1. Signed out, you can still add a spot. Nothing about contributing changes.
--   2. You cannot edit or delete it — nothing proves it is yours.
--   3. You create an account.
--   4. The device token is still in your browser, so the site offers to attach
--      the spots it made to your new account.
--   5. Accept, and you can edit and delete them — from any device, forever.
--
-- The token keeps exactly one job: identifying which spots to offer at step 4.
-- It grants nothing on its own, which is the point.
--
-- A logged-out contributor who regrets a spot is not stuck: "Rapporter innhold"
-- flags it for the administrator, which is the same route available to anyone.
--
-- The matching server-side check is ownsSpot() in api/_owner.js. The two must
-- agree, or the UI will offer buttons the API refuses.

create or replace function public.my_spot_ids(p_token text)
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select id
  from spots
  where deleted_at is null
    and auth.uid() is not null
    and user_id = auth.uid()
$$;

revoke all on function public.my_spot_ids(text) from public;
grant execute on function public.my_spot_ids(text) to anon, authenticated;

-- p_token is now unused. Kept in the signature so the client does not need a
-- coordinated deploy — an argument that is ignored is harmless, and dropping it
-- would break every call made by a browser still running the old bundle.

-- NOTE: my_unclaimed_spot_count() and claim_my_spots() still take the token and
-- must keep doing so. They are how step 4 works. Do not "tidy" them to match
-- this one.

-- VERIFY
--   Signed out:  select * from my_spot_ids('<a real device token>');  -> no rows
--   Signed in:   same call -> your claimed spots, token irrelevant

-- ---------------------------------------------------------------------------
-- ROLLBACK — restores token-based ownership
-- ---------------------------------------------------------------------------
-- create or replace function public.my_spot_ids(p_token text)
-- returns setof uuid language sql security definer stable set search_path = public
-- as $$
--   select id from spots
--   where deleted_at is null
--     and ((auth.uid() is not null and user_id = auth.uid())
--       or (p_token is not null and length(p_token) >= 20 and owner_token = p_token))
-- $$;
