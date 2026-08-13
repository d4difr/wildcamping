-- Per-spot flatness, measured from Kartverket's terrain model.
-- Run this in the Supabase SQL editor (Project > SQL Editor > New query).
--
-- flatness_deg      slope of the flattest tent-sized (4x4 m) patch found within
--                   ~10 m of the pin, in degrees. NULL = no elevation coverage.
-- flatness_relief_m height difference across that patch, in metres.
-- flatness_offset_m how far that patch sits from the pin itself.
-- flatness_checked_at  set whenever we ask, even if the answer was "no data",
--                   so we don't re-query Kartverket forever for the same spot.

alter table spots add column if not exists flatness_deg real;
alter table spots add column if not exists flatness_relief_m real;
alter table spots add column if not exists flatness_offset_m real;
alter table spots add column if not exists flatness_checked_at timestamptz;
