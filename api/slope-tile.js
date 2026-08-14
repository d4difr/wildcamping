// Proxy for Kartverket's terrain model, rendered as a slope (helning) heatmap.
//
// Kartverket's ImageServer allows server-side raster functions, so we send a
// Slope -> Remap -> Colormap chain and it returns a finished image. Nothing is
// precomputed or stored on our side.
//
// IMPORTANT — this renders at any zoom but is only *meaningful* when zoomed in.
// ArcGIS computes slope at the requested output resolution, so a zoomed-out tile
// averages steep ground into gentle ground. Measured on one Lofoten tile, the
// share reading "flat" went 82% at z11 -> 51% at z13 -> 12% at z15, for the same
// cliffs. The layer is therefore gated to TERRENGTYPE/HELNING min zoom on the
// client; do not lower it without re-measuring that drift.
//
// Kartverket høydedata, open data. Attribution: "Kilde: Kartverket".

const DTM = 'https://hoydedata.no/arcgis/rest/services/DTM/ImageServer/exportImage'

// Slope bands in degrees, chosen for pitching a tent rather than avalanche risk.
//
// Only campable ground is coloured. Anything steeper than the last band is left
// transparent (AllowUnmatched: false), so the map highlights where you *could*
// pitch rather than washing every pixel in colour — which read as mush over the
// green basemap and buried the signal.
//
// Warm gold is used because it stands out against Outdoors' greens; the earlier
// blue ramp turned to teal and disappeared.
// A sequential ramp rather than two flat bands — the extra steps read as terrain
// shape, not just a yes/no mask.
//
// The first band is deliberately much darker than the second rather than one
// even step in the ramp — that jump is what makes prime camping ground jump out
// instead of blending into its neighbours.
//
// Blue works here where it failed before because the ramp now runs dark-to-pale
// with FLAT at the dark end. The original version had flat as the palest colour
// and painted every pixel including steep ground, so it washed to teal over the
// green basemap. Here everything above 13° is left undrawn.
// Indigo rather than plain blue: the basemap already draws lakes in cyan-blue,
// and a blue "helt flatt" patch beside a shoreline was ambiguous. Indigo shares
// no hue with water (cyan), land (green) or routes (orange).
// Band 1 is separated from the rest by VALUE, not hue. Indigo sits only ~29° from
// the basemap's lake blue, so hue alone was not enough to stop flat shoreline
// reading as water — but nothing on the basemap is this dark, so a near-navy
// patch is unambiguous. Bands 2-5 are then a tight pale ramp, which keeps the
// gradient without competing with band 1 for attention.
const BANDS = [
  { max: 2,  rgb: [ 31,  32,  96] }, // helt flatt — very dark, unmistakable
  { max: 4,  rgb: [168, 168, 212] }, // deliberate leap in lightness
  { max: 6,  rgb: [194, 194, 226] },
  { max: 9,  rgb: [216, 216, 238] },
  { max: 13, rgb: [236, 236, 247] }, // skrått — almost gone
]

const inputRanges = BANDS.flatMap((b, i) => [i === 0 ? 0 : BANDS[i - 1].max, b.max])
const outputValues = BANDS.map((_, i) => i + 1)
const colormap = BANDS.map((b, i) => [i + 1, ...b.rgb])

const RENDERING_RULE = JSON.stringify({
  rasterFunction: 'Colormap',
  rasterFunctionArguments: {
    Colormap: colormap,
    Raster: {
      rasterFunction: 'Remap',
      rasterFunctionArguments: {
        InputRanges: inputRanges,
        OutputValues: outputValues,
        AllowUnmatched: false,
        Raster: {
          rasterFunction: 'Slope',
          rasterFunctionArguments: { ZFactor: 1, SlopeType: 1 },
        },
      },
    },
  },
})

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

  const params = new URLSearchParams({
    bbox: nums.join(','),
    bboxSR: '3857',
    imageSR: '3857',
    size: '256,256',
    format: 'png32',
    renderingRule: RENDERING_RULE,
    f: 'image',
  })

  try {
    // Zoomed-out tiles cover more ground and can take a few seconds cold.
    const upstream = await fetch(`${DTM}?${params}`, { signal: AbortSignal.timeout(15000) })
    if (!upstream.ok) return sendBlank(res)

    const buf = Buffer.from(await upstream.arrayBuffer())
    // ArcGIS reports errors as JSON with a 200, so sniff the PNG magic bytes.
    if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return sendBlank(res)

    res.setHeader('Content-Type', 'image/png')
    // Terrain changes on a scale of decades — cache hard at the edge.
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400')
    return res.status(200).send(buf)
  } catch {
    return sendBlank(res)
  }
}
