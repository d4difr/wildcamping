// "Egnet" — combines three sources into one answer: where could you actually
// pitch, for the kind of camp you're carrying.
//
// The layers it replaces each answer half the question, and asking a user to
// intersect two colour ramps in their head is exactly the work software should
// do. So this fetches all three inputs, ANDs them per pixel, and returns a
// single mask.
//
//   Kartverket DTM  -> slope       (is it flat)
//   NIBIO SR16      -> kronedekning (are there trees, and how many)
//   NIBIO AR50      -> arealtype    (is it land you could camp on at all)
//
// telt:      flat, on campable ground
// hengekoye: trees present — slope barely matters when you're off the ground
//
// TELT DELIBERATELY IGNORES CANOPY. It used to require "not dense forest", and
// field testing in Baneheia showed that was wrong in both directions:
//   - Dense forest is usually still pitchable. A one-person tent needs very
//     little space and there is normally a gap between trunks, so the condition
//     discarded a lot of good ground.
//   - Open canopy is not reliably better. In lowland forest, openings get more
//     sunlight and grow thick tall grass that is effectively unpitchable; the
//     same openness high on a hill has no grass and is fine.
// A condition that is wrong in both directions is not a weak filter, it is not
// a filter. Canopy remains its own descriptive layer, and is still the whole
// basis of hengekoye, where trees genuinely are the requirement.
//
// Not modelled, on purpose: the grass effect above. It would need an elevation
// threshold that we would be guessing, in one forest, and there is no dataset
// for ground vegetation under trees (AR50's arveget is "not relevant" for
// artype 30). Guessing at exactly this kind of proxy is what produced the
// earlier "glissen skog" mistake. It is disclosed in the legend instead.
//
// Two traps worth recording, both found by testing rather than reasoning:
//   1. SR16 covers forest only. Absent data above the treeline means NO TREES,
//      not "unknown" — treating it as unknown scored Hardangervidda, some of the
//      best tent ground in Norway, at 0% suitable.
//   2. The DTM treats a lake surface as perfectly flat, so water scored as ideal.
//      The AR50 mask excludes water, built-up, farmland, glacier and bog.
//
// PNG is decoded and re-encoded by hand (zlib only) to avoid pulling in an image
// dependency for what is a per-pixel AND.

import { decodePng, encodePng } from './_png.js'

const DTM = 'https://hoydedata.no/arcgis/rest/services/DTM/ImageServer/exportImage'
const SR16 = 'https://wms.nibio.no/cgi-bin/sr16'
const AR50 = 'https://wms.nibio.no/cgi-bin/ar50_2'

// --- slope: the SAME "helt flatt" band the Helning layer shows, imported rather
// than copied so the legend and this test cannot drift apart ---
import { FLAT_BAND } from './_terrain.js'
const FLAT_MAX_DEG = FLAT_BAND.max
const FLAT_RGB = FLAT_BAND.rgb
const SLOPE_RULE = JSON.stringify({
  rasterFunction: 'Colormap',
  rasterFunctionArguments: {
    Colormap: [[1, ...FLAT_RGB]],
    Raster: {
      rasterFunction: 'Remap',
      rasterFunctionArguments: {
        InputRanges: [0, FLAT_MAX_DEG],
        OutputValues: [1],
        AllowUnmatched: false,
        Raster: { rasterFunction: 'Slope', rasterFunctionArguments: { ZFactor: 1, SlopeType: 1 } },
      },
    },
  },
})

// NIBIO's own 9-class Greens ramp for kronedekning, light -> dark. We match on
// their published colours rather than sending our own SLD, because their
// interval semantics proved easy to misread and a wrong threshold here is
// invisible. The lighter five are the open end.
const OPEN_CANOPY = [
  [229, 245, 224], [199, 233, 192], [161, 217, 155], [116, 196, 118], [65, 171, 93],
]

// Ground you could pitch on at all: 30 skog + 50 snaumark.
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

const RESULT_RGB = { telt: [27, 94, 32], hengekoye: [92, 74, 30] }

// Three separate causes of blockiness, measured rather than guessed:
//   1. SR16's raster form is a 16 m grid. Its vector form follows forest stand
//      boundaries instead — 771 hard edges vs 341 on the same tile.
//   2. Deciding each output pixel yes/no gives no partial coverage, so every
//      edge snaps on or off.
//   3. The dominant cause: the classified slope image comes back with only TWO
//      alpha levels and 498 straight edge runs, against 42 for vector canopy and
//      33 for land. The slope mask was doing nearly all the staircasing.
//
// Fix for 2 and 3 is the same — composite at SUPERSAMPLE x and average down.
// That works because ArcGIS genuinely computes slope at whatever resolution is
// requested: normalised mask perimeter went 6652 -> 10090 -> 19163 for 256 ->
// 512 -> 1024, i.e. real extra detail rather than interpolation.
//
// At 4x: 17 alpha levels and ~2400 soft edges, vs 5 levels and ~1260 at 2x.
// Costs 16x the upstream pixels of a plain tile, which is only reasonable
// because the result is cached at the edge for 30 days.
//
// SRVKRONEDEK only renders from z13, which is already this layer's minimum.
const CANOPY_LAYER = 'SRVKRONEDEK'
const SUPERSAMPLE = 4
const TILE = 256


const BLANK = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)
function sendBlank(res) {
  res.setHeader('Content-Type', 'image/png')
  res.setHeader('Cache-Control', 'public, max-age=60')
  return res.status(200).send(BLANK)
}

const near = (d, i, rgb, tol = 10) =>
  Math.abs(d[i] - rgb[0]) <= tol && Math.abs(d[i + 1] - rgb[1]) <= tol && Math.abs(d[i + 2] - rgb[2]) <= tol

const MERC = 20037508.35

export default async function handler(req, res) {
  const { bbox } = req.query
  const mode = req.query.mode === 'hengekoye' ? 'hengekoye' : 'telt'
  if (!bbox) return res.status(400).json({ error: 'Missing bbox' })

  const parts = String(bbox).split(',')
  if (parts.length !== 4) return res.status(400).json({ error: 'Malformed bbox' })
  const nums = parts.map(Number)
  if (nums.some((n) => !Number.isFinite(n) || Math.abs(n) > MERC * 1.01)) {
    return res.status(400).json({ error: 'bbox out of range' })
  }
  const [minX, minY, maxX, maxY] = nums
  if (maxX <= minX || maxY <= minY) return res.status(400).json({ error: 'Inverted bbox' })

  const bb = nums.join(',')
  const S = TILE * SUPERSAMPLE
  const wms = (base, layer, sld) =>
    `${base}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${layer}&CRS=EPSG:3857` +
    `&BBOX=${bb}&WIDTH=${S}&HEIGHT=${S}&FORMAT=image/png&TRANSPARENT=TRUE&STYLES=` +
    (sld ? `&SLD_BODY=${encodeURIComponent(sld)}` : '')

  const grab = async (url) => {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!r.ok) throw new Error('upstream')
    const b = Buffer.from(await r.arrayBuffer())
    if (b.length < 8 || b.readUInt32BE(0) !== 0x89504e47) throw new Error('not png')
    return decodePng(b)
  }

  try {
    // Telt does not need canopy at all (see the note above), so don't fetch it.
    const needCanopy = mode === 'hengekoye'
    const [slope, canopy, land] = await Promise.all([
      needCanopy
        ? Promise.resolve(null)
        : grab(`${DTM}?bbox=${bb}&bboxSR=3857&imageSR=3857&size=${S},${S}&format=png32&renderingRule=${encodeURIComponent(SLOPE_RULE)}&f=image`),
      needCanopy ? grab(wms(SR16, CANOPY_LAYER)) : Promise.resolve(null),
      grab(wms(AR50, 'Arealtyper', LAND_SLD)),
    ])

    // Test every subpixel...
    const hit = new Uint8Array(S * S)
    for (let p = 0; p < S * S; p++) {
      const i = p * 4
      if (land.data[i + 3] <= 20) continue           // not campable ground
      if (mode === 'hengekoye') {
        if (canopy.data[i + 3] > 20) hit[p] = 1      // trees are the requirement
      } else {
        if (slope.data[i + 3] > 20 && near(slope.data, i, FLAT_RGB)) hit[p] = 1
      }
    }

    // ...then average down, so a partly-qualifying output pixel comes out partly
    // transparent instead of snapping to on/off. That is what softens the edges.
    const [r, g, b] = RESULT_RGB[mode]
    const out = Buffer.alloc(TILE * TILE * 4)
    const per = SUPERSAMPLE * SUPERSAMPLE
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        let c = 0
        for (let dy = 0; dy < SUPERSAMPLE; dy++) {
          for (let dx = 0; dx < SUPERSAMPLE; dx++) {
            c += hit[(y * SUPERSAMPLE + dy) * S + (x * SUPERSAMPLE + dx)]
          }
        }
        if (!c) continue
        const o = (y * TILE + x) * 4
        out[o] = r; out[o + 1] = g; out[o + 2] = b
        out[o + 3] = Math.round((235 * c) / per)
      }
    }

    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400')
    return res.status(200).send(encodePng(out, TILE, TILE))
  } catch {
    return sendBlank(res)
  }
}
