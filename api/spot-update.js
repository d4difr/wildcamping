import { createClient } from '@supabase/supabase-js'
import { verifiedUserId, ownsSpot } from './_owner.js'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const ALLOWED_FIELDS = ['name', 'description', 'photo_url', 'photo_urls', 'spot_type', 'access', 'region']

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const { id, owner_token, ...fields } = req.body || {}
  // owner_token is no longer required: a signed-in user on a new device has
  // a token, but not the one that made the spot. ownsSpot decides.
  if (!id) return res.status(400).json({ error: 'Missing id' })

  const { data: spot } = await supabaseAdmin.from('spots').select('owner_token, user_id').eq('id', id).single()
  if (!spot) return res.status(404).json({ error: 'Not found' })
  // Account OR device token — see api/_owner.js for why both.
  const userId = await verifiedUserId(req)
  if (!ownsSpot(spot, { userId, ownerToken: owner_token })) return res.status(403).json({ error: 'Forbidden' })

  const update = {}
  for (const key of ALLOWED_FIELDS) {
    if (key in fields) update[key] = fields[key]
  }

  await supabaseAdmin.from('spots').update(update).eq('id', id)
  res.status(200).json({ ok: true })
}
