// Proxy for Miljødirektoratet's protected-areas map (Naturbase), coloured by how
// restrictive the protection is for camping.
//
// This is a legal layer, not a terrain one. Naturreservat (2752 of them) very
// often ban camping outright; nasjonalpark generally allows it under
// allemannsretten with local rules. Colouring them identically would hide the
// distinction that actually matters.
//
// The upstream export endpoint 404s on GET once dynamicLayers is attached (URL
// too long), so we POST upstream while still serving a plain GET tile URL that
// Mapbox can use.
//
// Miljødirektoratet Naturbase. Attribution: "Kilde: Miljødirektoratet".

const VERN = 'https://kart.miljodirektoratet.no/arcgis/rest/services/vern/MapServer/export'

const fill = (r, g, b) => ({
  type: 'esriSFS',
  style: 'esriSFSSolid',
  color: [r, g, b, 255],
  outline: { type: 'esriSLS', style: 'esriSLSSolid', color: [r, g, b, 255], width: 0.4 },
})

// Purple family, deliberately unlike the terrain layers (Terrengtype greens,
// Helning golds) — this says "rules apply here", not "the ground looks like X".
const STRICT = [176, 48, 96]   // naturreservat — often no camping at all
const PARK = [123, 75, 148]    // nasjonalpark — allowed, but local rules
const MILD = [169, 143, 196]   // landskapsvern / annen fredning — usually fine

const DYNAMIC_LAYERS = JSON.stringify([{
  id: 0,
  source: { type: 'mapLayer', mapLayerId: 0 },
  // Marine protection doesn't affect where you pitch a tent on land.
  definitionExpression: "verneformAggregert <> 'marintVerneområde'",
  drawingInfo: {
    renderer: {
      type: 'uniqueValue',
      field1: 'verneformAggregert',
      defaultSymbol: fill(...MILD),
      uniqueValueInfos: [
        { value: 'naturreservat', symbol: fill(...STRICT) },
        { value: 'nasjonalpark', symbol: fill(...PARK) },
        { value: 'landskapsvernområde', symbol: fill(...MILD) },
        { value: 'annenFredning', symbol: fill(...MILD) },
      ],
    },
  },
}])

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

  const body = new URLSearchParams({
    bbox: nums.join(','),
    bboxSR: '3857',
    imageSR: '3857',
    size: '256,256',
    format: 'png32',
    transparent: 'true',
    dynamicLayers: DYNAMIC_LAYERS,
    f: 'image',
  })

  try {
    const upstream = await fetch(VERN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15000),
    })
    if (!upstream.ok) return sendBlank(res)

    const buf = Buffer.from(await upstream.arrayBuffer())
    // ArcGIS reports errors as HTML/JSON with a 200, so sniff the PNG magic bytes.
    if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return sendBlank(res)

    res.setHeader('Content-Type', 'image/png')
    // Protection boundaries change rarely, but they are legally meaningful —
    // a week at the edge rather than the month used for terrain.
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400')
    return res.status(200).send(buf)
  } catch {
    return sendBlank(res)
  }
}
