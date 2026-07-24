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
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Vildakart <onboarding@resend.dev>',
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
    res.status(200).json({ ok: true })
  } catch {
    res.status(200).json({ ok: false })
  }
}
