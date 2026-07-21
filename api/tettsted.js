export default async function handler(req, res) {
  const { lat, lng } = req.query
  if (!lat || !lng) return res.status(400).json({ error: 'Missing lat/lng' })

  const delta = 0.003
  const minLat = parseFloat(lat) - delta
  const maxLat = parseFloat(lat) + delta
  const minLng = parseFloat(lng) - delta
  const maxLng = parseFloat(lng) + delta

  const url =
    `https://kart.ssb.no/api/mapserver/v1/wfs/tettsteder` +
    `?service=WFS&version=2.0.0&request=GetFeature` +
    `&typeNames=ms:tettsted_2024&count=1` +
    `&BBOX=${minLat},${minLng},${maxLat},${maxLng},EPSG:4326`

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
    const text = await response.text()
    const inTettsted = text.includes('numberReturned="1"') ||
      (text.includes('numberReturned=') && !text.includes('numberReturned="0"'))
    res.status(200).json({ inTettsted })
  } catch {
    res.status(200).json({ inTettsted: false }) // fail open
  }
}
