# Accounts — full plan

Five phases, ordered by risk. The riskiest ships last and alone.

## The governing decision: gate saving, not viewing

**Anything you can look at stays open. An account is only needed to keep
something.**

| | Signed out | Signed in |
|---|---|---|
| Browse pins | ✅ | ✅ |
| Planlegg layers (Helning, Vern, Kronedekning) | ✅ | ✅ |
| Add a public pin | ✅ | ✅ |
| Favourite a pin | — | ✅ |
| Private planning pins | — | ✅ |
| Post under a username | — | ✅ |

The original idea was to put Planlegg behind login. Rejected, for three reasons:

1. The planning layers are what makes Vildakart different from a list of
   coordinates — they're the thing someone tells a friend about. A signup wall
   on first visit loses the person who would have become a contributor.
2. The data is public and NLOD-licensed. Gating it sits badly with the site.
3. Favourites and private pins are *inherently* account-shaped — there is
   nowhere to put a favourite without a user to attach it to. They make people
   sign up at the moment an account obviously helps them, which a wall does not.

**Posting stays open.** Requiring an account to add a pin would improve
accountability, but it taxes the contribution the site most needs. People claim
their pins later — that is what the claim flow in Phase 1 is for.

---

## Phase 0 — Move privileged reads off the anon key

**Behaviour-preserving refactor. Nothing changes on screen. Ship alone.**

Three reads currently use the public anon key and expect to see rows that
Phase 1's RLS will hide:

| Where | What it reads |
|---|---|
| [CampingMap.jsx:693](../src/components/CampingMap.jsx) — `AdminPanel` | every spot, any status |
| [CampingMap.jsx:1303](../src/components/CampingMap.jsx) | own pending spots, by id |
| [CampingMap.jsx:1320](../src/components/CampingMap.jsx) | all pending spots (admin) |

A consequence worth stating plainly: **pending spots are readable by anyone
holding the anon key today.** They are not secret, but they are not meant to be
browsable either.

The moment Phase 1 adds `status = 'approved' and deleted_at is null`, all three
return nothing — the admin panel empties, and users stop seeing their own
pending pins. So they move to serverless endpoints using the service role,
matching how `/api/admin-action` already works.

Note the second one is not an admin path. It is a legitimate user feature —
seeing your own pin awaiting approval — and the earlier version of this plan
missed it.

### Prerequisite

```sql
select policyname, cmd, qual from pg_policies where tablename = 'spots';
```

**Do not write new policies on top of unknown ones.** This has not been run yet.

### Done when

Admin panel still lists pending spots, and a device-owned pending pin is still
visible to its owner, both verified against production.

---

## Phase 1 — Auth, profiles, claiming

No user-visible features. Sign in, have an identity, attach existing spots.

### Schema

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

Reserve `admin`, `vilda`, `vildakart` and similar as usernames — they are public
strings and will be used to impersonate.

### RLS

```sql
create policy "profiles readable" on profiles for select using (true);
create policy "own profile insert" on profiles for insert
  with check (auth.uid() = user_id);
create policy "own profile update" on profiles for update
  using (auth.uid() = user_id);

create policy "read approved spots" on spots for select
  using (status = 'approved' and deleted_at is null);

create policy "read own spots" on spots for select
  using (auth.uid() is not null and user_id = auth.uid());
```

**Deliberately not done:** letting device-token users read their own pending
spots via RLS. `owner_token` is client-supplied and unverifiable, so it cannot
be a privacy boundary. That path goes through the Phase 0 endpoint instead.

### Auth

Supabase Auth, **magic link** — nothing to leak, nothing to reset, and email is
already wired up via Resend.

- Restrict redirect URLs to `vildakart.no` and `localhost:5173`
- Confirm the sender domain so links don't land in spam
- **Rate-limit the send endpoint.** It sends email on demand to any address;
  without a limit it is a spam relay.

### Claim flow

Requirements, in order of importance:

1. **Never lose a spot.** `owner_token` keeps working forever, claimed or not.
2. **Idempotent.** Clicking twice does nothing the second time.
3. **One-way.** A spot owned by user A can never be claimed by user B, even from
   a device holding the old token.
4. **Auditable.** Every claim is recorded.

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

After first sign-in, if the device token matches unclaimed spots:

> **Vi fant 3 leirplasser på denne enheten.** Vil du knytte dem til kontoen din?
> [Ja, knytt til kontoen] [Ikke nå]

"Ikke nå" must stay safe forever — the spots keep working via the token.

### Also in this phase

**Account deletion.** First personal data the site has ever held, EU users.
Deleting an account **orphans** its spots rather than removing them: drop the
name, keep the pin. Removing contributions punishes the map for someone leaving.

**Privacy policy** in the Om modal — there was nothing to disclose before.

---

## Phase 2 — Attribution. DEFERRED (decided 2026-08-18)

Not next, and not on a date. **Revisit when there is a community to be known
by** — a working signal would be several people contributing repeatedly rather
than once, and returning to the site unprompted.

The reasoning: a name beside a pin is only recognition if someone is there to
recognise it. With a handful of contributors it is exposure without the benefit
that justifies it. Right now people are still deciding whether Vildakart is
solid enough to contribute to at all, and anonymous contribution is the lower
bar to clear. The founding concept — anonymous pins, anonymous browsing —
stays until the community makes attribution worth something.

Deferring costs nothing structurally. `user_id` is already recorded on claimed
spots and already hidden from the client, so this can switch on later for spots
going forward with no schema unwind.

When it does happen, the design is settled:

- "Lagt til av *username*" on the spot card
- **Anonymity is per-pin, not per-account.** Someone may want their name on a
  good find and not on the one near their cabin.
- **`user_id` must NOT be exposed to the client.** The obvious implementation —
  grant `user_id` to anon and join it to public `profiles` — silently breaks
  anonymity: anyone could group every spot by author, so one attributed spot
  deanonymises all of that author's anonymous ones. The client must receive only
  a derived `author_name` that is null when the spot is anonymous, resolved
  server-side by a view or RPC.
- Existing spots default to **not** attributed. They were published when the
  site had no accounts, and content posted anonymously must not gain a name
  retroactively without the author choosing it.
- New spots: attributed by default **if the author has a username**, since
  choosing a display name already expresses wanting credit. No username means
  always anonymous, with no toggle to forget.

---

## Phase 3 — Favourites

Own table, simple RLS, self-contained. The first thing an account visibly buys.

```sql
create table favourites (
  user_id  uuid references auth.users(id) on delete cascade,
  spot_id  uuid references spots(id) on delete cascade,
  primary key (user_id, spot_id)
);
```

Readable and writable only by the owning user.

---

## Phase 4 — Private planning pins

**Highest risk. Own branch, own test matrix, ship alone.**

Needs a `visibility` column on `spots` and RLS that holds for every role.

An RLS mistake here leaks where people plan to sleep alone outdoors. That is the
whole reason this phase is last: by the time it ships, auth, ownership and
policy behaviour are already proven by four phases in production.

---

## Testing

Applies to every phase touching RLS.

1. **Branch the database.** The claim function does a bulk `UPDATE` on the real
   spots table; that deserves a rehearsal.
2. **Test RLS by querying the REST API directly as each role** — anon key,
   user A's JWT, user B's JWT. Not through the UI: the UI filters client-side
   and will cheerfully hide things RLS is actually exposing.
3. **Count before and after.** `select count(*), count(user_id) from spots`.
   The total must not change.

| Case | Expected |
|---|---|
| anon reads approved spot | visible |
| anon reads `owner_token` | denied |
| anon reads another user's pending spot | denied |
| user A reads own pending spot | visible |
| user B reads user A's pending spot | denied |
| `claim_my_spots` twice | 2nd returns 0, nothing changes |
| user B claims token for A's claimed spots | returns 0 |
| unclaimed device user edits own spot | still works |
| admin panel | still sees everything |

---

## Rollback

- `user_id` is additive and nullable — leaving it populated breaks nothing.
- Undo a claim run:
  `update spots set user_id = null where id in (select spot_id from spot_claims where claimed_at > $t)`
- RLS policies drop individually. **Save `pg_policies` output before changing
  anything.**

---

## Already done

The ownership hole this plan originally opened with is fixed and shipped:
`owner_token` is no longer readable through the anon key, and ownership comes
from `my_spot_ids()` — commits `9d51073` and `13f9c03`, SQL in
`supabase/fix-owner-token-exposure.sql`.

It narrowed the hole rather than closing it: anyone who captured a token can
still act on those spots. Tokens stop being a security boundary only when
ownership moves to accounts, which is Phase 1.

**Footgun it left behind:** anon has column-level SELECT, so adding a column to
`spots` requires adding it in *two* places — the SQL grant and `SPOT_COLUMNS` in
`CampingMap.jsx` — or it is silently invisible to the app. Phases 1, 2 and 4 all
add columns.
