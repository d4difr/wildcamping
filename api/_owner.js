// Who is allowed to act on a spot.
//
// Ownership has two sources now, and they are a UNION rather than a choice:
//
//   user_id      - set when a spot is claimed. Follows the person across
//                  devices, and is verifiable: the JWT is signed by Supabase.
//   owner_token  - a UUID the browser made up. Not verifiable at all, but it is
//                  how every spot created before accounts is owned, and how
//                  anyone who never signs in still owns theirs.
//
// Keeping both means claiming can never take something away. A user who claimed
// on their laptop can still edit from the phone that made the spot, and a user
// who declined the claim prompt is no worse off than yesterday — which is what
// makes "Ikke nå" safe to promise.
//
// The asymmetry is deliberate and worth remembering: user_id is proof, the token
// is only a claim. Anyone who captured a token before it was hidden can still
// use it. That risk ends when token access is dropped for claimed spots, which
// is a later decision, not this one.

import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Verifies the caller's Supabase session, if they sent one. Returns null for
// signed-out callers, which is normal rather than an error — most people using
// this site have no account.
export async function verifiedUserId(req) {
  const header = req.headers?.authorization
  if (!header || !header.startsWith('Bearer ')) return null
  const jwt = header.slice(7)
  if (!jwt) return null
  try {
    const { data, error } = await supabaseAdmin.auth.getUser(jwt)
    if (error) return null
    return data?.user?.id ?? null
  } catch {
    return null
  }
}

const MIN_TOKEN_LENGTH = 20

// True if this caller may edit or delete this spot.
export function ownsSpot(spot, { userId, ownerToken }) {
  if (!spot) return false
  if (userId && spot.user_id && spot.user_id === userId) return true
  if (
    typeof ownerToken === 'string' &&
    ownerToken.length >= MIN_TOKEN_LENGTH &&
    spot.owner_token === ownerToken
  ) return true
  return false
}

export { supabaseAdmin }
