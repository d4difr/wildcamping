// Proxy for NIBIO's AR50 land-resource WMS, restyled into three terrain bands.
//
// Why proxy instead of hitting the WMS directly from the browser:
//   1. NIBIO sends no Cache-Control/ETag, so every pan would re-request. We add
//      edge caching here and stay polite to a free public service.
//   2. The SLD makes the upstream URL ~5 kB; the browser only ever sees ?bbox=.
//
// Data: NIBIO AR50 (NLOD 1.0, "Kilde: NIBIO"). AR5 is deliberately NOT used —
// it does not map above the treeline (coded 99 "Ikke kartlagt"), which is
// exactly the terrain this layer needs to describe.

const AR50 = 'https://wms.nibio.no/cgi-bin/ar50_2'

const LETT = '#4C9A5A'
const MIDDELS = '#D98E04'
const KREVENDE = '#A6432B'

const eq = (p, v) =>
  `<ogc:PropertyIsEqualTo><ogc:PropertyName>${p}</ogc:PropertyName><ogc:Literal>${v}</ogc:Literal></ogc:PropertyIsEqualTo>`
const between = (p, lo, hi) =>
  `<ogc:PropertyIsBetween><ogc:PropertyName>${p}</ogc:PropertyName>` +
  `<ogc:LowerBoundary><ogc:Literal>${lo}</ogc:Literal></ogc:LowerBoundary>` +
  `<ogc:UpperBoundary><ogc:Literal>${hi}</ogc:Literal></ogc:UpperBoundary></ogc:PropertyIsBetween>`
const and = (...f) => `<ogc:And>${f.join('')}</ogc:And>`
const rule = (filter, color) =>
  `<Rule><ogc:Filter>${filter}</ogc:Filter>` +
  `<PolygonSymbolizer><Fill><CssParameter name="fill">${color}</CssParameter></Fill></PolygonSymbolizer></Rule>`

// artype:    30 skog, 50 snaumark, 60 myr (20/70/81/82/10/99 left transparent)
// arskogbon: 11 impediment .. 18 høg og særs høg — productivity as a density proxy
// arveget:   51 bar mark, 52 flekkvis, 54 samanhengande tørr, 55 frisk
const RULES = [
  [and(eq('artype', 50), eq('arveget', 51)), KREVENDE], // bare rock — nowhere to peg
  [and(eq('artype', 50), eq('arveget', 52)), LETT],
  [and(eq('artype', 50), eq('arveget', 54)), LETT],     // continuous dry cover — ideal
  [and(eq('artype', 50), eq('arveget', 55)), MIDDELS],  // moist
  [and(eq('artype', 30), eq('arskogbon', 11)), LETT],   // impediment forest — sparse, stunted
  [and(eq('artype', 30), between('arskogbon', 12, 13)), MIDDELS],
  [and(eq('artype', 30), between('arskogbon', 14, 18)), KREVENDE],
  [eq('artype', 60), KREVENDE],                          // myr — wet ground
]

const SLD =
  `<?xml version="1.0" encoding="UTF-8"?>` +
  `<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc">` +
  `<NamedLayer><Name>Arealtyper</Name><UserStyle><FeatureTypeStyle>` +
  RULES.map(([f, c]) => rule(f, c)).join('') +
  `</FeatureTypeStyle></UserStyle></NamedLayer></StyledLayerDescriptor>`

// 1x1 transparent PNG — served on upstream failure so the map shows a gap
// rather than broken-tile errors.
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
    `${AR50}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=Arealtyper` +
    `&CRS=EPSG:3857&BBOX=${nums.join(',')}&WIDTH=256&HEIGHT=256` +
    `&FORMAT=image/png&TRANSPARENT=TRUE&STYLES=&SLD_BODY=${encodeURIComponent(SLD)}`

  try {
    const upstream = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!upstream.ok) return sendBlank(res)

    const buf = Buffer.from(await upstream.arrayBuffer())
    // MapServer reports errors as XML with a 200, so sniff the PNG magic bytes.
    if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return sendBlank(res)

    res.setHeader('Content-Type', 'image/png')
    // AR50 updates roughly yearly — cache hard at the edge.
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400')
    return res.status(200).send(buf)
  } catch {
    return sendBlank(res)
  }
}
