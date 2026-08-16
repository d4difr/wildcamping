# Accounts — Phase 1: auth, ownership, and claiming existing spots

Scope: sign-in, profiles, and safely moving existing device-owned spots onto
accounts. **No new user-facing features.** Favourites, anonymous posting and
private planning pins are later phases and are deliberately excluded — a bug in
this phase is much easier to attribute if nothing else changed at the same time.

---

## 0. Fix the ownership hole first (do this before anything else)

**This is a live vulnerability, independent of accounts.**

Verified against production with only the public anon key:

```
GET /rest/v1/spots?select=id,name,owner_token
-> returns every spot's owner_token
```

`/api/spot-delete` and `/api/spot-update` authorise by comparing the supplied
`owner_token` against the stored one. Since the stored token is publicly
readable, **anyone can delete or edit any spot.**

The anon key is meant to be public — it ships in the JS bundle. The mistake is
that a *secret* (the ownership token) is exposed through it.

### Fix

```sql
-- Stop the secret being readable.
revoke select (owner_token) on public.spots from anon;

-- Give the client the one thing it legitimately needs: which spots are mine.
create or replace function public.my_spot_ids(p_token text)
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from spots
  where owner_token = p_token
    and p_token is not null
    and length(p_token) >= 20   -- refuse to answer for trivial guesses
$$;

revoke all on function public.my_spot_ids(text) from public;
grant execute on function public.my_spot_ids(text) to anon, authenticated;
```

### Client change

`CampingMap.jsx` currently decides ownership with `spot.owner_token === ownerToken`
in several places. Replace with a `Set` of ids fetched once:

```js
const { data } = await supabase.rpc('my_spot_ids', { p_token: ownerToken })
setOwnedIds(new Set(data ?? []))
// then: ownedIds.has(spot.id)
```

Note this narrows the hole rather than closing it completely — someone who
learns a token can still act on it. Tokens stop being a security boundary at
all once ownership moves to accounts, which is the real fix.

---

## 1. Prerequisite: admin reads must stop using the anon key

`AdminPanel` currently does `supabase.from('spots').select('*')` with the anon
key and expects to see pending, flagged and soft-deleted rows.

Any RLS tightening breaks that. So before touching policies, move admin reads to
a serverless endpoint that uses the service role and checks `ADMIN_KEY`, matching
how `/api/admin-action` already works.

**Verify first**, because the probe above was inconclusive — it returned 0 rows
for pending and deleted, but there may simply have been none at the time:

```sql
select policyname, cmd, qual from pg_policies where tablename = 'spots';
```

Do not write new policies on top of unknown ones.

---

## 2. Schema

```sql
-- Ownership. Nullable: legacy spots stay device-owned forever.
alter table spots add column if not exists user_id uuid references auth.users(id);
create index if not exists spots_user_id_idx on spots (user_id);

-- Profiles. Username is display-only; auth identity lives in auth.users.
create table if not exists profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  username    text unique not null check (char_length(username) between 3 and 24),
  created_at  timestamptz not null default now()
);
alter table profiles enable row level security;

-- Audit trail for claiming, so a bad migration can be traced and undone.
create table if not exists spot_claims (
  id          bigserial primary key,
  spot_id     uuid not null references spots(id),
  user_id     uuid not null references auth.users(id),
  owner_token text not null,
  claimed_at  timestamptz not null default now()
);
```

`visibility` and `display_mode` belong to Phases 3–4. Not needed here.

---

## 3. RLS

```sql
-- profiles: usernames are public, but only you can write yours.
create policy "profiles readable" on profiles for select using (true);
create policy "own profile insert" on profiles for insert
  with check (auth.uid() = user_id);
create policy "own profile update" on profiles for update
  using (auth.uid() = user_id);

-- spots: public sees approved, undeleted spots.
create policy "read approved spots" on spots for select
  using (status = 'approved' and deleted_at is null);

-- signed-in users additionally see their own, whatever the status.
create policy "read own spots" on spots for select
  using (auth.uid() is not null and user_id = auth.uid());
```

**Deliberately not done here:** letting device-token users read their own pending
spots via RLS. `owner_token` is client-supplied and unverifiable, so it cannot be
a privacy boundary. That path should go through a serverless endpoint, or wait
until the user has an account.

**This is the highest-risk part of the whole project.** Once private pins exist
(Phase 4), an RLS mistake leaks where people plan to sleep alone outdoors.

---

## 4. Auth

Supabase Auth, **magic link** (email, no password): nothing to leak, nothing to
reset, and email is already wired up via Resend.

Settings that matter:
- Restrict redirect URLs to `vildakart.no` and `localhost:5173`
- Confirm the sender domain so links don't land in spam
- Leave signups open, but keep an eye on it — magic-link endpoints get abused

---

## 5. The claim flow

The riskiest step. Requirements, in order of importance:

1. **Never lose a spot.** `owner_token` keeps working forever, claimed or not.
2. **Idempotent.** Clicking twice does nothing the second time.
3. **One-way.** A spot already owned by user A can never be claimed by user B,
   even from a device holding the old token.
4. **Auditable.** Every claim is recorded in `spot_claims`.

```sql
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
       and user_id is null              -- never steal an already-claimed spot
    returning id
  )
  insert into spot_claims (spot_id, user_id, owner_token)
  select id, auth.uid(), p_token from claimed;

  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.claim_my_spots(text) from public;
grant execute on function public.claim_my_spots(text) to authenticated;
```

`user_id is null` is what makes rules 2 and 3 hold: a second call matches
nothing, and another user's spot is never in scope.

### UX

After first sign-in, if the device token matches unclaimed spots:

> **Vi fant 3 leirplasser på denne enheten.** Vil du knytte dem til kontoen din?
> [Ja, knytt til kontoen] [Ikke nå]

"Ikke nå" must remain safe forever — the spots keep working via the token.

---

## 6. Testing

Do not test against production data.

1. **Branch the database.** Supabase branching, or restore a backup into a
   second project. The claim function does a bulk `UPDATE` on the real spots
   table; that deserves a rehearsal.
2. **Test RLS as each role, not through the UI.** The UI filters client-side and
   will happily hide things RLS is actually exposing. Query the REST API
   directly with (a) the anon key, (b) user A's JWT, (c) user B's JWT.
3. **Cases that must pass:**

| Case | Expected |
|---|---|
| anon reads approved spot | visible |
| anon reads `owner_token` | **denied** |
| anon reads another user's pending spot | denied |
| user A reads own pending spot | visible |
| user B reads user A's pending spot | **denied** |
| `claim_my_spots` twice | 2nd returns 0, nothing changes |
| user B claims token for A's claimed spots | returns 0 |
| unclaimed device user edits own spot | still works |
| admin panel | still sees everything (via service role) |

4. **Count before and after.** `select count(*), count(user_id) from spots`
   before and after claiming, on the branch. Total must not change.

---

## 7. Rollback

- `user_id` is additive and nullable — leaving it populated breaks nothing.
- To undo a claim run: `update spots set user_id = null where id in (select spot_id from spot_claims where claimed_at > $t)`.
- Revoking the `owner_token` grant is instantly reversible with `grant select (owner_token) ... to anon`.
- RLS policies can be dropped individually; keep the old policy definitions from
  `pg_policies` before changing anything.

---

## Order of work

1. Fix the ownership hole (section 0) — **ship separately, before any account work**
2. Move admin reads to serverless (section 1)
3. Schema + RLS on a branch (2, 3)
4. Auth + claim flow on a branch (4, 5)
5. Test (6), then ship behind a flag if possible

Sections 1–5 are one branch. Section 0 is its own small change and should not
wait for the rest.
