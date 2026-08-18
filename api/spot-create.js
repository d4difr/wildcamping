// Creating a spot, server-side.
//
// WHY THIS MOVED OFF THE CLIENT
//
// AddSpotForm used to insert with the anon key and read the row back with
// .select('id'), which it needs so the flatness measurement can be queued
// immediately. Reading back requires SELECT permission on the new row — and the
// new row is status='pending'. That worked only because RLS carried
// "Allow public reads" USING (true).
//
// Dropping that policy is the whole point of Phase 0, and the moment it goes the
// remaining policy is status='approved', so the insert would fail on its
// RETURNING clause and submitting a spot would break. Inserting with the service
// role sidesteps RLS entirely, and matches how update and delete already work.
//
// status is set here, not taken from the caller: the client must never be able
// to submit a spot as already approved.

import { createClient } from '@supabase/supabase-js'
import { verifiedUserId } from './_owner.js'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const ALLOWED_FIELDS = [
  'name', 'description', 'latitude', 'longitude',
  'photo_url', 'photo_urls', 'spot_type', 'access', 'region',
]

const MIN_TOKEN_LENGTH = 20

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const { owner_token, ...fields } = req.body || {}

  if (typeof owner_token !== 'string' || owner_token.length < MIN_TOKEN_LENGTH) {
    return res.status(400).json({ error: 'Missing owner_token' })
  }

  const name = typeof fields.name === 'string' ? fields.name.trim() : ''
  if (!name) return res.status(400).json({ error: 'Missing name' })

  const lat = Number(fields.latitude)
  const lng = Number(fields.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'Missing coordinates' })
  }
  // Roughly Norway including Svalbard. Keeps junk out of the moderation queue.
  if (lat < 57 || lat > 82 || lng < -10 || lng > 36) {
    return res.status(400).json({ error: 'Coordinates outside Norway' })
  }

  // Attach the account when there is one, so a signed-in contributor never has
  // to claim their own new spot — claiming exists for spots made before
  // accounts, not for ones made today. It is also what makes the approval
  // email possible, since a device token leaves no address to write to.
  const userId = await verifiedUserId(req)

  const row = { owner_token, status: 'pending' }
  if (userId) row.user_id = userId
  for (const key of ALLOWED_FIELDS) {
    if (key in fields) row[key] = fields[key]
  }
  row.name = name
  row.latitude = lat
  row.longitude = lng

  const { data, error } = await supabaseAdmin
    .from('spots')
    .insert(row)
    .select('id')
    .single()

  if (error) return res.status(500).json({ error: 'Insert failed' })
  return res.status(200).json({ id: data.id })
}
