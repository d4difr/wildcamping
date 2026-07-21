export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

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
        subject: `Ny leirplass til godkjenning: ${name}`,
        html: `
          <p>En ny leirplass er sendt inn og venter på godkjenning.</p>
          <ul>
            <li><strong>Navn:</strong> ${name}</li>
            <li><strong>Type:</strong> ${spotType}</li>
            <li><strong>Tilgang:</strong> ${access || '—'}</li>
            <li><strong>Fylke:</strong> ${region || '—'}</li>
            <li><strong>Koordinater:</strong> ${lat}, ${lng}</li>
          </ul>
          <p><a href="https://vildakart.no/?v=hvk0209X">Gå til admin-panelet →</a></p>
        `,
      }),
    })
    res.status(200).json({ ok: true })
  } catch {
    res.status(200).json({ ok: false }) // fail silently
  }
}
