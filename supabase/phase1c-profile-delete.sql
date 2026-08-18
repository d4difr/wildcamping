-- Lets someone go back to being anonymous.
--
-- Anonymity in this schema means having no profiles row — that was the point of
-- creating the row only when a name is chosen. So "become anonymous again" is a
-- DELETE, and profiles had select, insert and update policies but no delete one.
-- Without this the button would fail silently: RLS refuses, no row is removed,
-- and the name stays.

drop policy if exists "own profile delete" on profiles;
create policy "own profile delete" on profiles
  for delete using (auth.uid() = user_id);

grant delete on profiles to authenticated;

-- NOTE: deleting the row frees the username for anyone else, because the unique
-- index goes with it. That is the right behaviour — a name nobody is using
-- should not stay reserved forever — but it does mean going anonymous and then
-- changing your mind may find the old name taken. The modal warns about this.

-- VERIFY
--   As a signed-in user with a name: the "Bli anonym igjen" button empties the
--   nav to "Anonym" and survives a reload.
--   select count(*) from profiles;   -- drops by one
