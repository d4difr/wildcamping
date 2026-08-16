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
const AR50 = 'https://wms.nibio.no/cgi-bin/ar50_2'

// Ground you could pitch on at all: 30 skog + 50 snaumark. Everything else —
// water, bog, farmland, buildings, glacier — gets masked out of the render.
const LAND_SLD =
  '<?xml version="1.0" encoding="UTF-8"?><StyledLayerDescriptor version="1.0.0" ' +
  'xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc">' +
  '<NamedLayer><Name>Arealtyper</Name><UserStyle><FeatureTypeStyle>' +
  ['30', '50'].map((v) =>
    `<Rule><ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>artype</ogc:PropertyName>` +
    `<ogc:Literal>${v}</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>` +
    `<PolygonSymbolizer><Fill><CssParameter name="fill">#FFFFFF</CssParameter></Fill></PolygonSymbolizer></Rule>`
  ).join('') +
  '</FeatureTypeStyle></UserStyle></NamedLayer></StyledLayerDescriptor>'

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
// Light-to-dark: flat ground is pale, steep ground is deep indigo. That is the
// conventional reading for terrain and matches how a shaded relief map behaves.
//
// Band 1 is still isolated from the rest, but now by a large gap at the LIGHT
// end rather than the dark end — the step from band 1 to band 2 is several times
// any later step, so prime ground reads as a distinct pale patch instead of the
// top of a smooth ramp.
//
// Every slope is now coloured, including steep ground. That was previously left
// transparent to stop the map washing out, but the old pale bands had almost no
// contrast between them; a proper light-to-dark ramp carries full coverage fine
// and reads as terrain shape. Only NoData stays clear.
//
// Water no longer matters here: the fills are drawn beneath the basemap's water
// layer, so lakes keep their own colour regardless of what the DTM reports.
// Defined in _terrain.js so the Egnet layer tests the same "helt flatt" this
// legend advertises. Changing a band here changes both.
import { SLOPE_BANDS as BANDS } from './_terrain.js'
import { decodePng, encodePng } from './_png.js'

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

  const bb = nums.join(',')
  const params = new URLSearchParams({
    bbox: bb,
    bboxSR: '3857',
    imageSR: '3857',
    size: '256,256',
    format: 'png32',
    renderingRule: RENDERING_RULE,
    f: 'image',
  })

  const landUrl =
    `${AR50}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=Arealtyper&CRS=EPSG:3857` +
    `&BBOX=${bb}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=TRUE&STYLES=` +
    `&SLD_BODY=${encodeURIComponent(LAND_SLD)}`

  try {
    // Zoomed-out tiles cover more ground and can take a few seconds cold.
    const [upstream, landRes] = await Promise.all([
      fetch(`${DTM}?${params}`, { signal: AbortSignal.timeout(15000) }),
      fetch(landUrl, { signal: AbortSignal.timeout(15000) }),
    ])
    if (!upstream.ok) return sendBlank(res)

    let buf = Buffer.from(await upstream.arrayBuffer())
    // ArcGIS reports errors as JSON with a 200, so sniff the PNG magic bytes.
    if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return sendBlank(res)

    // Blank out everything that isn't campable ground. Without this the layer
    // calls lakes and bog "helt flatt" — which they are, and you cannot sleep on
    // either. Measured: on a Baneheia tile 90% of the flattest band was water or
    // bog; Hardangervidda 70%. If the mask can't be fetched we serve the raw
    // slope rather than nothing, since it is still useful with that caveat.
    if (landRes.ok) {
      const landBuf = Buffer.from(await landRes.arrayBuffer())
      if (landBuf.length >= 8 && landBuf.readUInt32BE(0) === 0x89504e47) {
        try {
          const slope = decodePng(buf)
          const land = decodePng(landBuf)
          for (let i = 0; i < slope.data.length; i += 4) {
            if (land.data[i + 3] <= 20) slope.data[i + 3] = 0
          }
          buf = encodePng(slope.data, slope.width, slope.height)
        } catch {
          // Fall through with the unmasked render.
        }
      }
    }

    res.setHeader('Content-Type', 'image/png')
    // Terrain changes on a scale of decades — cache hard at the edge.
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400')
    return res.status(200).send(buf)
  } catch {
    return sendBlank(res)
  }
}
