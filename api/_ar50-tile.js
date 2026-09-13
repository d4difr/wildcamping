// Proxy for NIBIO's AR50 land-resource WMS, restyled to show the ground types a
// canopy map cannot describe: bog, bare rock, damp and open ground.
//
// Why proxy instead of hitting the WMS directly from the browser:
//   1. NIBIO sends no Cache-Control/ETag, so every pan would re-request. We add
//      edge caching here and stay polite to a free public service.
//   2. The SLD makes the upstream URL ~5 kB; the browser only ever sees ?bbox=.
//
// Data: NIBIO AR50 and AR5 (NLOD 1.0, "Kilde: NIBIO"). AR50 is the base
// everywhere. From z13, AR5 refines it wherever AR5 is mapped — it is not
// mapped above the treeline (99 "Ikke kartlagt"), so AR5 can never replace
// AR50 outright. See "AR5 detail at high zoom" below.

import { decodePng, encodePng } from './_png.js'

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

// ---------------------------------------------------------------------------
// AR5 detail at high zoom
// ---------------------------------------------------------------------------
//
// AR50 is mapped at 1:50 000, so a 15 m bog or a small clearing is folded into
// whatever surrounds it — useless at tent scale. AR5 is mapped at 1:5 000.
//
// Why a composite rather than switching to AR5 outright (see the header note):
//   - AR5 is "Ikke kartlagt" (99) above the treeline, exactly where AR50 is
//     needed. Those pixels keep AR50.
//   - AR5 has no arveget, so it cannot tell bare rock from dry or damp open
//     ground. Where both call it open ground, the AR50 pixel keeps that
//     detail; where only AR5 does, it is plain AAPEN_MARK.
//   - Where AR5 is mapped and says anything else (forest, farmland, water),
//     AR50's coarser colour is removed. Otherwise a bog AR50 smeared across a
//     forest would show through, and the layer would contradict itself.
//
// AR5 is not styled for display. It is rendered as a key: one pure channel
// per class, read back per pixel.

const AR5 = 'https://wms.nibio.no/cgi-bin/ar5'

// z13 tiles are ~4.9 km wide in EPSG:3857; below that AR5 detail is sub-pixel
// and doubles the upstream work for nothing.
const AR5_MAX_TILE_WIDTH = (2 * MERC) / 2 ** 13 + 1

const not = (f) => `<ogc:Not>${f}</ogc:Not>`
const or = (...f) => `<ogc:Or>${f.join('')}</ogc:Or>`
const KEY_SLD =
  `<?xml version="1.0" encoding="UTF-8"?>` +
  `<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc">` +
  `<NamedLayer><Name>Arealtype</Name><UserStyle><FeatureTypeStyle>` +
  rule(eq('artype', 60), '#FF0000') +
  rule(eq('artype', 50), '#00FF00') +
  rule(not(or(eq('artype', 60), eq('artype', 50), eq('artype', 99))), '#0000FF') +
  `</FeatureTypeStyle></UserStyle></NamedLayer></StyledLayerDescriptor>`

async function fetchAr5(bbox) {
  const r = await fetch(
    `${AR5}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=Arealtype` +
    `&CRS=EPSG:3857&BBOX=${bbox.join(',')}&WIDTH=256&HEIGHT=256` +
    `&FORMAT=image/png&TRANSPARENT=TRUE&STYLES=&SLD_BODY=${encodeURIComponent(KEY_SLD)}`,
    { signal: AbortSignal.timeout(10000) }
  )
  if (!r.ok) return null
  const b = Buffer.from(await r.arrayBuffer())
  return b.length >= 8 && b.readUInt32BE(0) === 0x89504e47 ? b : null
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const OPEN_SHADES = [AAPEN_MARK, FUKTIG_MARK, BART_FJELL].map(hex)
const MYR_RGB = hex(MYR)
const AAPEN_RGB = hex(AAPEN_MARK)

function compositeAr5(ar50Buf, ar5Buf) {
  const base = decodePng(ar50Buf)
  const key = decodePng(ar5Buf)
  const d = base.data, k = key.data
  const set = (i, [r, g, b]) => { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255 }

  for (let i = 0; i < d.length; i += 4) {
    // Edges come back antialiased. 128 keeps each boundary pixel on one side
    // instead of letting a half-covered pixel decide in both directions.
    if (k[i + 3] <= 128) continue // unmapped or no polygon: AR50 stands
    const r = k[i], g = k[i + 1], b = k[i + 2]
    if (r >= g && r >= b) {
      set(i, MYR_RGB)
    } else if (g >= b) {
      const isOpenShade = d[i + 3] > 128 &&
        OPEN_SHADES.some(([cr, cg, cb]) => Math.abs(d[i] - cr) + Math.abs(d[i + 1] - cg) + Math.abs(d[i + 2] - cb) < 30)
      if (!isOpenShade) set(i, AAPEN_RGB)
    } else {
      d[i + 3] = 0
    }
  }
  return encodePng(d, base.width, base.height)
}

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

  const detailed = maxX - minX <= AR5_MAX_TILE_WIDTH

  try {
    const [upstream, ar5Res] = await Promise.all([
      fetch(url, { signal: AbortSignal.timeout(10000) }),
      detailed ? fetchAr5(nums).catch(() => null) : null,
    ])
    if (!upstream.ok) return sendBlank(res)

    let buf = Buffer.from(await upstream.arrayBuffer())
    // MapServer reports errors as XML with a 200, so sniff the PNG magic bytes.
    if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return sendBlank(res)

    // If AR5 fails we serve plain AR50: coarser, but never wrong about where
    // the map has data, so degrading silently is fine.
    if (ar5Res) {
      try {
        buf = compositeAr5(buf, ar5Res)
      } catch {
        // Fall through with the AR50 render.
      }
    }

    res.setHeader('Content-Type', 'image/png')
    // AR50 updates roughly yearly — cache hard at the edge.
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400')
    return res.status(200).send(buf)
  } catch {
    return sendBlank(res)
  }
}
