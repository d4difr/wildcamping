import { createClient } from '@supabase/supabase-js'
import { rejectIfNotAdmin } from './_admin-auth.js'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const { action, id } = req.body || {}

  // Was `admin_key !== process.env.ADMIN_KEY`, with the key supplied by the
  // client — which meant the client had to know the password, so it shipped in
  // the bundle. Now a signed token proves the caller logged in server-side.
  if (rejectIfNotAdmin(req, res)) return
  if (!id) return res.status(400).json({ error: 'Missing id' })

  if (action === 'delete') {
    // Soft delete — row is kept so it can be restored from the "Slettet" tab
    await supabaseAdmin.from('spots').update({ deleted_at: new Date().toISOString() }).eq('id', id)
  } else if (action === 'restore') {
    await supabaseAdmin.from('spots').update({ deleted_at: null }).eq('id', id)
  } else if (action === 'purge') {
    // Permanent removal — only reachable from the "Slettet" tab
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
