// Exchanges the admin password for a short-lived signed token.
//
// The password is compared here and nowhere else. The client never holds it
// beyond the keystroke that submits this request — see _admin-auth.js for why.

import { issueToken, passwordMatches } from './_admin-auth.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { password } = req.body || {}

  if (!passwordMatches(password)) {
    // A deliberate delay. Serverless has no shared memory, so a request counter
    // would not survive between invocations and cannot rate-limit properly; this
    // at least caps how fast a single caller can grind through guesses. It is not
    // a substitute for a strong password.
    await new Promise((r) => setTimeout(r, 600))
    return res.status(403).json({ error: 'Feil passord' })
  }

  return res.status(200).json({ token: issueToken() })
}
