-- Make the account actually own things.
--
-- Phase 1 recorded user_id on claimed spots but nothing read it, so signing in
-- bought the user nothing: "Mine bidrag" and the edit/delete controls still
-- resolved ownership from the device token alone. Signing in on a second device
-- showed an empty list, which is the exact problem accounts exist to solve.
--
-- Ownership is now a UNION of the two sources, not a choice between them:
--
--   user_id      proof. Signed by Supabase, follows the person across devices.
--   owner_token  a claim. Unverifiable, but it is how every pre-account spot is
--                owned and how anyone who never signs in still owns theirs.
--
-- Union matters for two cases that would otherwise regress:
--
--   signed in, new device      -> sees claimed spots despite an unknown token
--   signed in, declined claim  -> still sees this device's spots, so "Ikke nå"
--                                 stays as harmless as it was promised to be
--
-- The matching server-side check is in api/_owner.js, and must agree with this.

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
    and (
      -- the account, when there is one
      (auth.uid() is not null and user_id = auth.uid())
      or
      -- this device. The length floor refuses to answer for trivial guesses,
      -- so the function cannot be used to fish for spots.
      (p_token is not null and length(p_token) >= 20 and owner_token = p_token)
    )
$$;

revoke all on function public.my_spot_ids(text) from public;
grant execute on function public.my_spot_ids(text) to anon, authenticated;

-- VERIFY
--
--   select * from my_spot_ids('<your device token>');
--     signed out -> that device's spots only
--     signed in  -> the union, which for you is the same 9 plus anything
--                   created on this device since
--
--   select * from my_spot_ids('short');
--     signed out -> nothing
--     signed in  -> your claimed spots, because the account arm does not depend
--                   on the token at all. This is the behaviour that makes a new
--                   device work.

-- ---------------------------------------------------------------------------
-- ROLLBACK — restores token-only ownership
-- ---------------------------------------------------------------------------
-- create or replace function public.my_spot_ids(p_token text)
-- returns setof uuid language sql security definer stable set search_path = public
-- as $$
--   select id from spots
--   where p_token is not null and length(p_token) >= 20
--     and owner_token = p_token and deleted_at is null
-- $$;
