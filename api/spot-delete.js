import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const { id, owner_token } = req.body || {}
  if (!id || !owner_token) return res.status(400).json({ error: 'Missing fields' })

  const { data: spot } = await supabaseAdmin.from('spots').select('owner_token').eq('id', id).single()
  if (!spot) return res.status(404).json({ error: 'Not found' })
  if (spot.owner_token !== owner_token) return res.status(403).json({ error: 'Forbidden' })

  // Soft delete — recoverable from the admin "Slettet" tab
  await supabaseAdmin.from('spots').update({ deleted_at: new Date().toISOString() }).eq('id', id)
  res.status(200).json({ ok: true })
}
