// Proxy for NIBIO's AR50 land-resource WMS, restyled to show the ground types a
// canopy map cannot describe: bog, bare rock, damp and open ground.
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

// Descriptive, not judgemental — the layer says what the ground IS, and the
// camper decides what that means for them.
//
// History worth keeping: forest used to be split three ways by arskogbon
// (skogbonitet) into "glissen / skog / tett skog". Skogbonitet measures how fast
// timber grows — soil depth and nutrients — NOT how densely trees stand, and
// unproductive ground is often covered in dense stunted scrub. That inference
// was wrong. Canopy density now comes from SR16, which models it directly, and
// forest is not drawn here at all.
const AAPEN_MARK = '#EBD98A'   // open, dry ground
const FUKTIG_MARK = '#7FC3B0'  // open but moist
const BART_FJELL = '#B0AAA0'   // bare rock
const MYR = '#9B7FB0'          // bog

const eq = (p, v) =>
  `<ogc:PropertyIsEqualTo><ogc:PropertyName>${p}</ogc:PropertyName><ogc:Literal>${v}</ogc:Literal></ogc:PropertyIsEqualTo>`
const and = (...f) => `<ogc:And>${f.join('')}</ogc:And>`
const rule = (filter, color) =>
  `<Rule><ogc:Filter>${filter}</ogc:Filter>` +
  `<PolygonSymbolizer><Fill><CssParameter name="fill">${color}</CssParameter></Fill></PolygonSymbolizer></Rule>`

// artype:  50 snaumark, 60 myr (30 skog and 10/20/70/81/82/99 left transparent)
// arveget: 51 bar mark, 52 flekkvis, 54 samanhengande tørr, 55 frisk
// Ordinary forest is deliberately NOT drawn. "There are trees here" adds nothing
// once Kronedekning says how dense they are, and forest is most of Norway — so
// colouring it buried the bands that actually carry information. What's left is
// the ground you can't read from a canopy map: bog, bare rock, damp and open.
const RULES = [
  [and(eq('artype', 50), eq('arveget', 51)), BART_FJELL],
  [and(eq('artype', 50), eq('arveget', 52)), AAPEN_MARK],
  [and(eq('artype', 50), eq('arveget', 54)), AAPEN_MARK],
  [and(eq('artype', 50), eq('arveget', 55)), FUKTIG_MARK],
  [eq('artype', 60), MYR],
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
