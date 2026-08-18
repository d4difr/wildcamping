-- Fixes a hole in phase1-accounts.sql.
--
-- The profiles insert/update policies read the blocklist:
--
--   lower(username) not in (select name from reserved_usernames)
--
-- That subquery runs with the CALLER's privileges, so RLS on
-- reserved_usernames applies to it. Supabase enables RLS on new tables, and no
-- policy was written for this one — so the caller sees zero rows.
--
-- And `x NOT IN (empty set)` is TRUE. Not false, not an error: TRUE.
--
-- So the check silently passes everything. Someone could register the username
-- `admin` and the policy would wave it through, which is the precise opposite of
-- what the table is for. Verified from the client: the anon key reads 0 rows
-- from a table that should hold 10.
--
-- A blocklist that fails open is worse than none, because it looks like
-- protection.

-- The list is not secret — it exists to be checked against. RLS buys nothing
-- here and costs correctness.
alter table reserved_usernames disable row level security;

-- Re-run in case the original insert was also swallowed.
insert into reserved_usernames (name) values
  ('admin'), ('administrator'), ('vilda'), ('vildakart'), ('moderator'),
  ('support'), ('system'), ('anonym'), ('anonymous'), ('root')
on conflict do nothing;

-- VERIFY — must return 10, and must return 10 to the ANON key too, since that is
-- the role whose visibility the policy subquery depends on:
--
--   select count(*) from reserved_usernames;
--
-- and from a terminal:
--
--   curl "$URL/rest/v1/reserved_usernames?select=name" \
--     -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
--
-- If that returns [] the policy is still failing open.

-- ---------------------------------------------------------------------------
-- The wider lesson, worth keeping in mind for Phases 2-4
-- ---------------------------------------------------------------------------
-- Any RLS policy containing a subquery over another table inherits that table's
-- RLS. If the inner table is invisible to the caller, the subquery returns
-- nothing and the surrounding condition can quietly invert.
--
-- The safe patterns are: keep lookup tables RLS-free when they are public, or
-- wrap the check in a `security definer` function so it reads with the
-- function owner's privileges instead of the caller's.
