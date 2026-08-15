// Proxy for NIBIO's SR16 crown-coverage layer (kronedekning) — how much of the
// ground is actually shaded by tree canopy, measured from lidar and
// photogrammetry at 16 m resolution.
//
// This exists because Terrengtype could NOT answer "how dense are the trees".
// It was splitting forest by skogbonitet, which measures how fast timber grows
// (soil depth, nutrients), not how densely trees stand — unproductive ground is
// often covered in dense stunted scrub. That inference was wrong and has been
// removed; this layer measures the thing directly.
//
// We deliberately use NIBIO's OWN styling rather than a custom SLD. Their
// service does support SLD, but the interval semantics proved easy to
// misread, and shipping guessed thresholds would repeat exactly the mistake this
// layer exists to correct. Their ramp runs light (open) to dark (dense) —
// verified by cross-reference: at Baneheia, where the histogram shows canopy is
// overwhelmingly 90-100%, their darkest class is the dominant colour.
//
// NIBIO SR16. Attribution: "Kilde: NIBIO".

const SR16 = 'https://wms.nibio.no/cgi-bin/sr16'

const BLANK = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

function sendBlank(res) {
  res.setHeader('Content-Type', 'image/png')
  res.setHeader('Cache-Control', 'public, max-age=60')
  return res.status(200).send(BLANK)
}

const MERC = 20037508.35

export default async function handler(req, res) {
  const { bbox } = req.query
  if (!bbox) return res.status(400).json({ error: 'Missing bbox' })

  // Strict validation — this endpoint must not become an open proxy.
  const parts = String(bbox).split(',')
  if (parts.length !== 4) return res.status(400).json({ error: 'Malformed bbox' })
  const nums = parts.map(Number)
  if (nums.some((n) => !Number.isFinite(n) || Math.abs(n) > MERC * 1.01)) {
    return res.status(400).json({ error: 'bbox out of range' })
  }
  const [minX, minY, maxX, maxY] = nums
  if (maxX <= minX || maxY <= minY) return res.status(400).json({ error: 'Inverted bbox' })

  const url =
    `${SR16}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=SRRKRONEDEK` +
    `&CRS=EPSG:3857&BBOX=${nums.join(',')}&WIDTH=256&HEIGHT=256` +
    `&FORMAT=image/png&TRANSPARENT=TRUE&STYLES=`

  try {
    const upstream = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!upstream.ok) return sendBlank(res)

    const buf = Buffer.from(await upstream.arrayBuffer())
    // MapServer reports errors as XML with a 200, so sniff the PNG magic bytes.
    if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return sendBlank(res)

    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400')
    return res.status(200).send(buf)
  } catch {
    return sendBlank(res)
  }
}
