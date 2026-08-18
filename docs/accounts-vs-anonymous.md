# With an account vs without

State of the site as of 2026-08-18, after the account work. Verified against the
code and the database policies rather than from memory.

**The governing rule: gate saving, not viewing.** Everything you can look at is
open to everyone. An account is only needed to *keep* something.

---

## What each can do

| | No account | Account |
|---|---|---|
| Browse the map and every approved spot | ✅ | ✅ |
| Search places and spots | ✅ | ✅ |
| Planning layers — Helning, Vern, Kronedekning | ✅ | ✅ |
| 3D terrain, basemap switching, distance measuring | ✅ | ✅ |
| Copy coordinates, download GPX | ✅ | ✅ |
| **Submit a spot** | ✅ | ✅ |
| Edit / delete your own spots | ✅ *same browser only* | ✅ *any device* |
| See your own pending spot awaiting approval | ✅ *same browser only* | ✅ *any device* |
| Flag a spot as a problem | ✅ | ✅ |
| **Favourites** | ❌ | ✅ |
| **Private planning pins** | ❌ | ✅ |
| **Email when your spot is approved** | ❌ | ✅ |
| Display name | ❌ | ✅ optional |

Nothing is hidden from a signed-out visitor. The differences are all about
*persistence* and *identity*, never about access to the map or its data.

### The one asymmetry worth understanding

Without an account, ownership is a random UUID in that browser's localStorage.
It works, but it is tied to the browser: clear your data, switch device, or use
a different browser, and your spots are no longer yours to edit. Nothing is
lost — the spots stay on the map — but the controls disappear.

With an account, ownership is a **union** of the account and the device token,
so signing in adds a route to your spots without removing the old one.

---

## What is stored

### In your browser (no account)

| Key | What it is | Cleared by recovery? |
|---|---|---|
| `vilda_owner_token` | random UUID proving you submitted a spot | **No — deliberately kept** |
| `vilda_flagged` | which spots you have reported, so the button greys out | Yes |
| `vilda_admin_token` | admin session, only if you are the administrator | Yes |

No cookies, no analytics identifier, no email. A signed-out visitor is not
identifiable to the site beyond a token their own browser generated.

### In your browser (with an account)

Everything above, plus `sb-<project>-auth-token` — the Supabase session, written
by the auth library. It is what keeps you signed in between visits, and why the
magic link is needed once per device rather than once per visit.

### On the server (no account)

Only the spot itself: name, description, coordinates, photos, type, access,
region, and the `owner_token` that says which browser submitted it.

`owner_token` is **not readable** through the public API — that was a live hole,
fixed in `fix-owner-token-exposure.sql`.

### On the server (with an account)

| Table | Contents | Who can read it |
|---|---|---|
| `auth.users` | your email, sign-in timestamps | you, and the administrator |
| `profiles` | display name, if you chose one | **you only** — plus the administrator via the service role |
| `spots.user_id` | which spots are yours | nobody through the API; used server-side |
| `favourites` | spots you saved | **you only** |
| `planning_pins` | your private pins, with notes and coordinates | **you only** |
| `spot_claims` | audit trail of pre-account spots you claimed | nobody through the API |

**Email is the only personal data the site holds**, and only for account
holders. It is used to sign in and to tell you when a spot is approved.

---

## Who can see your display name

| | Can see it |
|---|---|
| Other users | **No** |
| Anonymous visitors | **No** |
| You | Yes |
| Administrator | Yes, via the service role |

This is enforced in the database — `profiles` is restricted to the owner and
`anon` has no grant at all — not merely hidden in the interface. That is why the
name dialog can say *"Navnet er ikke synlig for andre brukere"*. It does not
claim "only you", because the administrator can see it, and a privacy claim that
is technically untrue is worse than a vaguer one that holds.

**No name is displayed anywhere on the site today.** Attribution is deferred
until there is a community to justify it — see `accounts.md`. When it arrives,
showing your name will be a **per-spot** choice, never all-or-nothing.

---

## Deleting your account

**Not built yet.** The intended behaviour is recorded in `accounts.md`: deleting
an account *orphans* its spots rather than removing them — the name goes, the
pin stays. Removing contributions would punish the map for someone leaving.

One known blocker: `spots.user_id` references `auth.users` with no `on delete`
clause, so deleting a user with spots would error rather than orphan them. That
needs `on delete set null` before account deletion can ship.

---

## Things a signed-out visitor should know

- Your spots are tied to **this browser**. Signing in later attaches them to you
  permanently, and the site offers to do that on first sign-in.
- Declining that offer is safe forever. The token keeps working either way.
- Clearing browser data loses the ability to edit your spots. The recovery
  screen preserves `vilda_owner_token` for exactly this reason; DevTools'
  "Clear site data" does not.
