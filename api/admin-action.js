import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const { action, id, admin_key } = req.body || {}

  if (!admin_key || admin_key !== process.env.ADMIN_KEY) return res.status(403).json({ error: 'Forbidden' })
  if (!id) return res.status(400).json({ error: 'Missing id' })

  if (action === 'delete') {
    await supabaseAdmin.from('spots').delete().eq('id', id)
  } else if (action === 'approve') {
    await supabaseAdmin.from('spots').update({ status: 'approved' }).eq('id', id)
  } else if (action === 'clear-flags') {
    await supabaseAdmin.from('spots').update({ flags: 0, flag_reports: [] }).eq('id', id)
  } else {
    return res.status(400).json({ error: 'Unknown action' })
  }

  res.status(200).json({ ok: true })
}
