// Admin session tokens.
//
// WHY THIS EXISTS
//
// The admin password used to live in the client as VITE_ADMIN_KEY, and the login
// check was `if (pw === ADMIN_KEY)` — compared in the browser against a value the
// browser already held. VITE_ vars are compiled into the bundle by design, so the
// real password shipped in plain text at /assets/index-*.js. Anyone could read it
// and call /api/admin-action to approve, delete or permanently purge any spot.
//
// A secret the browser can check is a secret the browser can read. So the
// password now only ever exists on the server: the admin types it, the client
// posts it once, and gets back a signed token with an expiry. The token is not a
// secret in the same way — it expires, it is scoped to admin actions, and it
// cannot be turned back into the password.
//
// ADMIN_KEY must NOT have a VITE_ prefix. If it ever regains one it is public
// again, and this whole file is pointless.

import crypto from 'crypto'

const TTL_MS = 12 * 60 * 60 * 1000 // one working day; admin re-types after that

// The password doubles as the signing key. That is deliberate: rotating the
// password invalidates every outstanding token, which is what you want the
// moment you suspect one has leaked.
function secret() {
  const key = process.env.ADMIN_KEY
  if (!key) throw new Error('ADMIN_KEY is not set')
  return key
}

const b64url = (buf) => Buffer.from(buf).toString('base64url')

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url')
}

export function issueToken() {
  const payload = b64url(JSON.stringify({ exp: Date.now() + TTL_MS }))
  return `${payload}.${sign(payload)}`
}

// Returns true only for a token this server signed, that has not expired.
export function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return false
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return false

  // Compare in constant time. Buffers must match in length first, or
  // timingSafeEqual throws instead of returning false.
  const expected = Buffer.from(sign(payload))
  const given = Buffer.from(sig)
  if (expected.length !== given.length) return false
  if (!crypto.timingSafeEqual(expected, given)) return false

  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString())
    return typeof exp === 'number' && Date.now() < exp
  } catch {
    return false
  }
}

// Guard for admin endpoints. Returns true if it has already sent a 403.
export function rejectIfNotAdmin(req, res) {
  const token = req.body?.admin_token || req.headers['x-admin-token']
  if (verifyToken(token)) return false
  res.status(403).json({ error: 'Forbidden' })
  return true
}

// Constant-time password check, so a wrong guess cannot be narrowed down by
// timing the response.
export function passwordMatches(given) {
  if (typeof given !== 'string') return false
  const a = Buffer.from(given)
  const b = Buffer.from(secret())
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
