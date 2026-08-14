// Proxy for Kartverket's Turrutebasen — marked, maintained foot routes.
//
// Additive, not exclusive: this draws lines, while Terrengtype/Helning/Vern draw
// area fills. Lines over a fill is exactly the combination that answers the real
// planning question — "is this flat, legal patch actually reachable?" — so this
// layer is deliberately outside the one-at-a-time overlay group.
//
// Only Fotrute is requested. The service exposes ~40 sublayers (every difficulty
// grade of every route type); showing all of it is noise, and ski løyper are a
// winter concern like the avalanche layer we parked.
//
// Kartverket Turrutebasen. Attribution: "Kilde: Kartverket".

const TURRUTER = 'https://wms.geonorge.no/skwms1/wms.friluftsruter2'

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
    `${TURRUTER}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=Fotrute` +
    `&CRS=EPSG:3857&BBOX=${nums.join(',')}&WIDTH=256&HEIGHT=256` +
    `&FORMAT=image/png&TRANSPARENT=TRUE&STYLES=`

  try {
    const upstream = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!upstream.ok) return sendBlank(res)

    const buf = Buffer.from(await upstream.arrayBuffer())
    // MapServer reports errors as XML with a 200, so sniff the PNG magic bytes.
    if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return sendBlank(res)

    res.setHeader('Content-Type', 'image/png')
    // Routes change occasionally — a week at the edge.
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400')
    return res.status(200).send(buf)
  } catch {
    return sendBlank(res)
  }
}
