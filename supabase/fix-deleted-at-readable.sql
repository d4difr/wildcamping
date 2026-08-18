-- Closes the last hole from the 2026-08-18 policy dump.
--
-- "Public can read approved spots" tests status but NOT deleted_at:
--
--   using (status = 'approved')
--
-- Soft delete sets deleted_at and leaves status alone, so a spot an admin
-- deletes stays readable through the API. The client filters it out with
-- `.is('deleted_at', null)`, so it vanishes from the map — but client-side
-- filtering is presentation, not privacy. Anyone with the anon key could still
-- read a spot that was removed, including ones removed BECAUSE they should not
-- be public.
--
-- ALTER POLICY, NOT DROP + CREATE
--
-- This is the policy the whole map depends on. Dropping and recreating it leaves
-- a window, however short, where no SELECT policy exists and every visitor sees
-- an empty map. ALTER swaps the USING clause in place, atomically — there is no
-- moment where the map is unprotected or empty.

alter policy "Public can read approved spots" on public.spots
  using (status = 'approved' and deleted_at is null);

-- ---------------------------------------------------------------------------
-- VERIFY
--
-- 1. The map must still work — with the ANON key:
--      GET /rest/v1/spots?select=id&status=eq.approved   -> 28 rows (or current)
--
-- 2. Then soft-delete a spot from the admin panel and, with the ANON key:
--      GET /rest/v1/spots?select=id,name&deleted_at=not.is.null   -> []
--
--    Testing before deleting something proves nothing: an empty result looks
--    identical whether the policy works or there is simply nothing deleted.
--    That mistake was made twice today.
--
-- 3. Restore the spot from the admin "Slettet" tab afterwards.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- alter policy "Public can read approved spots" on public.spots
--   using (status = 'approved');
