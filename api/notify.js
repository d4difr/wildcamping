// In-memory rate limit: max 10 submissions per IP per hour
const rateLimitMap = new Map()
const WINDOW_MS = 60 * 60 * 1000
const MAX_REQUESTS = 10

function isRateLimited(ip) {
  const now = Date.now()
  const entry = rateLimitMap.get(ip) || { count: 0, start: now }
  if (now - entry.start > WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, start: now })
    return false
  }
  if (entry.count >= MAX_REQUESTS) return true
  rateLimitMap.set(ip, { count: entry.count + 1, start: entry.start })
  return false
}

function escapeHtml(str) {
  return String(str ?? '—')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown'
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Too many requests' })

  const { name, lat, lng, spotType, access, region } = req.body || {}

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // vildakart.no is verified in Resend (DKIM + SPF on the send subdomain),
        // so this no longer depends on onboarding@resend.dev — Resend's shared
        // test sender, which can only deliver to the account owner's own
        // address. That was fine while this only emailed the admin, and would
        // have failed the moment it emailed anyone else.
        from: 'Vildakart <no-reply@vildakart.no>',
        to: 'dadifr@outlook.com',
        subject: `Ny leirplass til godkjenning: ${escapeHtml(name)}`,
        html: `
          <p>En ny leirplass er sendt inn og venter på godkjenning.</p>
          <ul>
            <li><strong>Navn:</strong> ${escapeHtml(name)}</li>
            <li><strong>Type:</strong> ${escapeHtml(spotType)}</li>
            <li><strong>Tilgang:</strong> ${escapeHtml(access)}</li>
            <li><strong>Fylke:</strong> ${escapeHtml(region)}</li>
            <li><strong>Koordinater:</strong> ${escapeHtml(lat)}, ${escapeHtml(lng)}</li>
          </ul>
          <p><a href="https://vildakart.no/?v=hvk0209X">Gå til admin-panelet →</a></p>
        `,
      }),
    })
    // fetch() resolves for 4xx too, so a rejected send used to be reported as
    // ok:true and vanish. A refused sender domain fails exactly this way, which
    // is why switching from onboarding@resend.dev looked like nothing happening.
    if (!resendRes.ok) {
      const detail = await resendRes.text().catch(() => '')
      console.error('resend rejected notify:', resendRes.status, detail.slice(0, 300))
      return res.status(200).json({ ok: false, provider: resendRes.status })
    }
    res.status(200).json({ ok: true })
  } catch (err) {
    console.error('notify threw:', err?.message)
    res.status(200).json({ ok: false })
  }
}
