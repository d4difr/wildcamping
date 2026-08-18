-- Make usernames private, so the app can honestly say so.
--
-- profiles carried `for select using (true)` — written for attribution, which
-- would need names to be public. Attribution is deferred indefinitely, so today
-- that policy lets anyone with the anon key list every username on the site:
--
--   GET /rest/v1/profiles?select=username   ->  [{"username":"Olafur"}]
--
-- Nothing displays names anywhere, so this bought nothing and leaked a little.
-- It surfaced when the modal copy was changed to "Navnet ditt er kun synlig for
-- deg" — which would have been false. A privacy claim in the UI has to be
-- enforced in the database, not asserted in a paragraph.
--
-- Safe to restrict: the only reads are a user fetching their OWN row
-- (useAuth.js, AuthModal.jsx). Nothing reads other people's.
--
-- When attribution eventually ships this does NOT need reverting. The design in
-- docs/accounts.md deliberately routes display names through a derived
-- author_name from a view or RPC, precisely so that spots.user_id and the
-- profiles table never have to be publicly readable — exposing them would let
-- one attributed spot deanonymise all of an author's anonymous ones.

drop policy if exists "profiles readable" on profiles;

create policy "own profile readable" on profiles
  for select using (auth.uid() = user_id);

-- Second layer, and the same default Supabase applies to every new table: anon
-- holds grants unless told otherwise, so RLS was the only thing standing here.
revoke all on profiles from anon;

-- VERIFY — with a profile row present, or this proves nothing:
--
--   With the ANON key:
--     GET /rest/v1/profiles?select=username    -> 401 / 42501
--
--   Signed in: your own name still shows in the nav, and setting, changing and
--   removing it all still work.

-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- drop policy if exists "own profile readable" on profiles;
-- create policy "profiles readable" on profiles for select using (true);
-- grant select on profiles to anon;
