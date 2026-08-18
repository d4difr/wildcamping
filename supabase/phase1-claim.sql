-- Phase 1, final step: attach device-owned spots to an account.
--
-- Supersedes step 4 of phase1-accounts.sql, which had the claim function but not
-- the counter. Run this whole file; running the claim function twice is harmless
-- by design.
--
-- RUN THIS ONLY ONCE SIGN-IN WORKS, so a failed claim can be told apart from a
-- failed login.

-- ---------------------------------------------------------------------------
-- How many spots on this device are not yet attached to any account?
--
-- Needed to decide whether to offer the prompt at all. my_spot_ids() cannot
-- answer it: it matches on owner_token alone, so it keeps returning the same
-- spots after they are claimed, and the prompt would reappear forever.
--
-- security definer because owner_token is not readable by anon — that was the
-- fix in 9d51073 and this must not undo it.
-- ---------------------------------------------------------------------------

create or replace function public.my_unclaimed_spot_count(p_token text)
returns integer
language sql
security definer
stable
set search_path = public
as $$
  select count(*)::int
  from spots
  where p_token is not null
    and length(p_token) >= 20
    and owner_token = p_token
    and user_id is null
    and deleted_at is null
$$;

revoke all on function public.my_unclaimed_spot_count(text) from public;
grant execute on function public.my_unclaimed_spot_count(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- The claim itself.
--
--   1. Never lose a spot   - owner_token keeps working, claimed or not
--   2. Idempotent          - a second run matches nothing
--   3. One-way             - user B can never take user A's spots, even holding
--                            the old token
--   4. Auditable           - every claim is written to spot_claims
--
-- `user_id is null` in the WHERE is what gives 2 and 3. Removing it would let
-- anyone who obtains a token reassign someone else's spots to themselves.
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
-- BEFORE AND AFTER — run this both times, the total must not change
--
--   select count(*) as total, count(user_id) as claimed from spots;
--
-- and afterwards:
--
--   select count(*) from spot_claims;     -- must equal what claim returned
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ROLLBACK - undoes a claim run without touching anything else
-- ---------------------------------------------------------------------------
-- update spots set user_id = null
--  where id in (select spot_id from spot_claims where claimed_at > now() - interval '1 hour');
-- delete from spot_claims where claimed_at > now() - interval '1 hour';
