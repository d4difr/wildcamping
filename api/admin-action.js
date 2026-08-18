import { createClient } from '@supabase/supabase-js'
import { rejectIfNotAdmin } from './_admin-auth.js'

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// Tells the contributor their spot is live.
//
// Only possible for signed-in submitters: a device-token contributor leaves no
// email address anywhere, so there is nobody to write to. That asymmetry is one
// of the few concrete things an account buys, alongside favourites and pins.
//
// Best-effort throughout. Every failure path returns quietly rather than
// throwing, because an approval that worked must not be reported as broken
// because a mail server was slow.
async function notifyApproved(spotId) {
  if (!process.env.RESEND_API_KEY) return

  const { data: spot } = await supabaseAdmin
    .from('spots').select('name, user_id').eq('id', spotId).single()
  if (!spot?.user_id) return // device-owned, no address to reach

  const { data: userRes } = await supabaseAdmin.auth.admin.getUserById(spot.user_id)
  const email = userRes?.user?.email
  if (!email) return

  const url = `https://www.vildakart.no/?spot=${encodeURIComponent(spotId)}`

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Vildakart <no-reply@vildakart.no>',
      to: email,
      subject: `Leirplassen din er godkjent: ${spot.name}`,
      // Plain-text part as well as HTML — see the note in notify.js. It matters
      // more here: this one goes to a user, and someone whose first email from
      // Vildakart lands in spam will never see it.
      text:
        `Hei!\n\n${spot.name} er nå godkjent og synlig for alle på Vildakart.\n\n` +
        `Se leirplassen: ${url}\n\n` +
        `Du får denne e-posten fordi du la til en leirplass mens du var innlogget.`,
      html: `
        <p>Hei!</p>
        <p><strong>${escapeHtml(spot.name)}</strong> er nå godkjent og synlig for alle på Vildakart.</p>
        <p><a href="${url}">Se leirplassen</a></p>
        <p style="color:#666;font-size:0.9em">Takk for at du deler. Du får denne e-posten fordi du la til en leirplass mens du var innlogget.</p>
      `,
    }),
  })
}

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

    // MUST be awaited. This was fire-and-forget so a slow mail server could not
    // make an approval look failed — correct reasoning for a long-lived server,
    // wrong for serverless: once res.json() returns, Vercel freezes the
    // instance and a pending promise may never run at all. The email silently
    // never sent.
    //
    // Awaited with a timeout instead, so a hanging mail server delays the
    // response by at most 8s rather than forever, and any failure is caught —
    // the spot is already approved and must be reported as such regardless.
    try {
      await Promise.race([
        notifyApproved(id),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
      ])
    } catch (e) {
      console.warn('approval email failed:', e?.message)
    }
  } else if (action === 'clear-flags') {
    await supabaseAdmin.from('spots').update({ flags: 0, flag_reports: [] }).eq('id', id)
  } else {
    return res.status(400).json({ error: 'Unknown action' })
  }

  res.status(200).json({ ok: true })
}
