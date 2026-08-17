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

// Water only: 81 ferskvann + 82 hav. Drawn white, and the render is dropped
// wherever this paints.
//
// This layer used to mask to "campable ground" (30 skog + 50 snaumark), which
// also removed bog, farmland and built-up areas. That was the wrong line to
// draw. Helning answers one question — how steep is this — and withholding real
// measurements because we decided nobody could sleep there is the same mistake
// as the old Lett/Middels/Krevende bands: it turns a measurement into a verdict.
// It also masked lidar-resolution data with land cover generalised to
// 1:50 000, so a shoreline off by a few tens of metres silently erased real
// ground, indistinguishable from no data.
//
// Water is excluded on different grounds, and this is the whole justification:
// over a lake the DTM measures the WATER SURFACE, so the 0° it reports is an
// artifact of what the sensor hit, not flat ground. The number is meaningless
// there. Nothing about permission — reading the map is the user's job.
const WATER_SLD =
  '<?xml version="1.0" encoding="UTF-8"?><StyledLayerDescriptor version="1.0.0" ' +
  'xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc">' +
  '<NamedLayer><Name>Arealtyper</Name><UserStyle><FeatureTypeStyle>' +
  ['81', '82'].map((v) =>
    `<Rule><ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>artype</ogc:PropertyName>` +
    `<ogc:Literal>${v}</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>` +
    `<PolygonSymbolizer><Fill><CssParameter name="fill">#FFFFFF</CssParameter></Fill></PolygonSymbolizer></Rule>`
  ).join('') +
  '</FeatureTypeStyle></UserStyle></NamedLayer></StyledLayerDescriptor>'

// Slope bands in degrees, chosen for pitching a tent rather than avalanche risk.
// Defined in _terrain.js so the palette and the legend cannot drift apart.
//
// The palette settled after several wrong turns, each worth not repeating:
//
//   - Every slope is coloured, including steep ground. An earlier version left
//     anything above the last band transparent to stop the map washing out. The
//     real cause was that the bands had almost no contrast between them; a
//     proper light-to-dark ramp carries full coverage fine. Only NoData is clear.
//   - Light-to-dark, flat being palest, is the conventional terrain reading and
//     matches shaded relief. The first attempt ran dark-to-pale and inverted it.
//   - Indigo, not plain blue: the basemap draws lakes in cyan-blue, so a blue
//     "helt flatt" patch beside a shoreline was ambiguous. Indigo shares no hue
//     with water, land or routes. A warm gold ramp was tried first and read as
//     mush over Outdoors' greens.
//   - Band 1 sits a long way from band 2 in lightness, several times any later
//     step, so prime ground reads as a distinct pale patch rather than the top
//     of a smooth ramp.
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

  const waterUrl =
    `${AR50}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=Arealtyper&CRS=EPSG:3857` +
    `&BBOX=${bb}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=TRUE&STYLES=` +
    `&SLD_BODY=${encodeURIComponent(WATER_SLD)}`

  try {
    // Zoomed-out tiles cover more ground and can take a few seconds cold.
    const [upstream, waterRes] = await Promise.all([
      fetch(`${DTM}?${params}`, { signal: AbortSignal.timeout(15000) }),
      fetch(waterUrl, { signal: AbortSignal.timeout(15000) }),
    ])
    if (!upstream.ok) return sendBlank(res)

    let buf = Buffer.from(await upstream.arrayBuffer())
    // ArcGIS reports errors as JSON with a 200, so sniff the PNG magic bytes.
    if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return sendBlank(res)

    // Drop the render wherever AR50 says water. Everything else — bog, farmland,
    // built-up, forest, snaumark — keeps its measured slope, because it IS
    // measured ground and judging it is the user's job.
    //
    // Note this is the opposite test to the one it replaced: mask where water is
    // painted, rather than keep only where land is painted. Getting that
    // backwards would blank the whole map.
    //
    // The threshold is 128, not the 20 used elsewhere, and the asymmetry is the
    // point. AR50's polygon edges come back antialiased, so a low threshold on
    // an *exclusion* mask eats a pixel of real shoreline — about 9.5 m at z14 —
    // where the old inclusion mask would have kept the same pixel. Measured on
    // lake-heavy Hardangervidda: 68.0% coloured at >20 against 68.5% at >128,
    // with open water still fully removed either way. Only solidly-water pixels
    // are dropped.
    //
    // If AR50 can't be fetched we serve the raw slope rather than nothing. The
    // basemap draws its own water fill above this layer on Outdoors and
    // Topografisk, so a missed lake is usually invisible anyway; Satellitt is
    // the case where it would show.
    if (waterRes.ok) {
      const waterBuf = Buffer.from(await waterRes.arrayBuffer())
      if (waterBuf.length >= 8 && waterBuf.readUInt32BE(0) === 0x89504e47) {
        try {
          const slope = decodePng(buf)
          const water = decodePng(waterBuf)
          for (let i = 0; i < slope.data.length; i += 4) {
            if (water.data[i + 3] > 128) slope.data[i + 3] = 0
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
