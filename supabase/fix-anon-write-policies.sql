-- Closes a live hole that is wider than the owner_token one.
--
-- pg_policies on `spots` currently contains:
--
--   Public can read approved spots  SELECT  (status = 'approved')
--   Public can submit new spots     INSERT  NULL
--   anon delete                     DELETE  true      <-- anyone, any row
--   anon update                     UPDATE  true      <-- anyone, any row
--   Allow public inserts            INSERT  NULL
--   Allow public reads              SELECT  true      <-- overrides the one above
--
-- RLS policies are OR'ed together, so the permissive ones win outright.
--
-- WHY THIS MATTERS MORE THAN THE owner_token FIX
--
-- /api/spot-delete and /api/spot-update authorise by owner_token, and we hid
-- that token in 9d51073. But the token was never needed: the anon key ships in
-- the JS bundle by design, and with it anyone can call PostgREST directly.
--
--   DELETE /rest/v1/spots?id=eq.<any id>
--   PATCH  /rest/v1/spots?id=eq.<any id>   {"status": "approved"}
--
-- That bypasses the endpoints entirely. Anyone can delete any pin, edit anyone's
-- pin, or self-approve their own submission without review.
--
-- Verified against production: both requests return 204 rather than 403, so the
-- table grants exist and the policies permit them. They were sent with a filter
-- matching no rows, so nothing was modified. A conclusive test would mean
-- deleting a real row, which was not done.
--
-- WHAT THE APP ACTUALLY NEEDS FROM anon
--
--   INSERT  - AddSpotForm.jsx:194, submitting a spot
--   UPDATE  - CampingMap.jsx:1573, flagging, touching only flags/flag_reports
--   DELETE  - nothing. The client never deletes.
--
-- All three write endpoints use SUPABASE_SERVICE_ROLE_KEY and so bypass RLS;
-- none of them relies on these policies.

-- ---------------------------------------------------------------------------
-- STEP 1 - anon has no business deleting anything
-- ---------------------------------------------------------------------------

drop policy if exists "anon delete" on public.spots;
revoke delete on public.spots from anon;

-- ---------------------------------------------------------------------------
-- STEP 2 - narrow UPDATE to the two columns flagging needs
--
-- Same trap as the owner_token fix: a column-level REVOKE cannot carve a hole
-- in a table-level grant. Drop the table grant, then grant back the columns.
-- ---------------------------------------------------------------------------

revoke update on public.spots from anon;
grant update (flags, flag_reports) on public.spots to anon;

-- The policy still says `true`, which is correct for flagging: reporting a spot
-- is meant to be possible on any spot, by anyone, without an account. The column
-- grant is what stops it being an edit-anything primitive.

-- ---------------------------------------------------------------------------
-- STEP 3 - reads. DO NOT RUN YET.
--
-- "Allow public reads" (true) is what makes every pending and soft-deleted row
-- readable with the public key. It cannot be dropped until the three reads that
-- depend on it move to serverless endpoints - the admin panel, and a user
-- seeing their own pending spot. That is Phase 0 in docs/accounts.md.
--
-- Run this only after Phase 0 ships:
--
--   drop policy if exists "Allow public reads" on public.spots;
--
-- which leaves "Public can read approved spots". Note that policy does not test
-- deleted_at, so soft-deleted rows stay readable; Phase 1 replaces it with
--   using (status = 'approved' and deleted_at is null)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- STEP 4 - optional tidy. Two INSERT policies do the same job.
-- ---------------------------------------------------------------------------

-- drop policy if exists "Allow public inserts" on public.spots;

-- ---------------------------------------------------------------------------
-- VERIFY  (anon key, against a real spot id)
--
--   DELETE /rest/v1/spots?id=eq.<id>                    -> 403 permission denied
--   PATCH  /rest/v1/spots?id=eq.<id> {"status":"..."}   -> 403 permission denied
--   PATCH  /rest/v1/spots?id=eq.<id> {"flags":1}        -> 204, still works
--
-- And in the app: submitting a spot works, flagging a spot works, the admin
-- panel still approves and deletes.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- create policy "anon delete" on public.spots for delete using (true);
-- grant delete on public.spots to anon;
-- grant update on public.spots to anon;
