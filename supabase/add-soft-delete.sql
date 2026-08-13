-- Soft delete for spots.
-- Run this in the Supabase SQL editor (Project > SQL Editor > New query).
--
-- After this, "Slett" in the admin panel only stamps deleted_at. The row stays
-- in the table and can be restored from the "Slettet" tab. Permanent removal is
-- a separate "Slett permanent" action.

alter table spots add column if not exists deleted_at timestamptz;

-- Partial index: the app filters `deleted_at is null` on every public read.
create index if not exists spots_not_deleted_idx
  on spots (created_at desc)
  where deleted_at is null;
