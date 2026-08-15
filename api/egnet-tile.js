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
// telt:      flat AND not dense canopy
// hengekoye: trees present — slope barely matters when you're off the ground
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

import zlib from 'zlib'

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

// --- minimal PNG ------------------------------------------------------------
function decodePng(buf) {
  let pos = 8, w, h, ct, idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9] }
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (ct !== 6) throw new Error('expected RGBA')
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const bpp = 4, stride = w * bpp, out = Buffer.alloc(h * stride)
  let rp = 0
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
  for (let y = 0; y < h; y++) {
    const f = raw[rp++]
    for (let i = 0; i < stride; i++) {
      const x = raw[rp + i]
      const a = i >= bpp ? out[y * stride + i - bpp] : 0
      const b = y > 0 ? out[(y - 1) * stride + i] : 0
      const c = (i >= bpp && y > 0) ? out[(y - 1) * stride + i - bpp] : 0
      let v
      switch (f) {
        case 0: v = x; break
        case 1: v = x + a; break
        case 2: v = x + b; break
        case 3: v = x + ((a + b) >> 1); break
        case 4: v = x + paeth(a, b, c); break
        default: throw new Error('bad filter')
      }
      out[y * stride + i] = v & 255
    }
    rp += stride
  }
  return { data: out, width: w, height: h }
}

const CRC = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c }
  return (buf) => { let c = -1; for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0 }
})()

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(td))
  return Buffer.concat([len, td, crc])
}

function encodePng(data, w, h) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6
  const stride = w * 4
  const raw = Buffer.alloc(h * (stride + 1))
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0
    data.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const BLANK = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)
function sendBlank(res) {
  res.setHeader('Content-Type', 'image/png')
  res.setHeader('Cache-Control', 'public, max-age=60')
  return res.status(200).send(BLANK)
}

const near = (d, i, rgb, tol = 6) =>
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
  const wms = (base, layer, sld) =>
    `${base}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${layer}&CRS=EPSG:3857` +
    `&BBOX=${bb}&WIDTH=256&HEIGHT=256&FORMAT=image/png&TRANSPARENT=TRUE&STYLES=` +
    (sld ? `&SLD_BODY=${encodeURIComponent(sld)}` : '')

  const grab = async (url) => {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!r.ok) throw new Error('upstream')
    const b = Buffer.from(await r.arrayBuffer())
    if (b.length < 8 || b.readUInt32BE(0) !== 0x89504e47) throw new Error('not png')
    return decodePng(b)
  }

  try {
    const [slope, canopy, land] = await Promise.all([
      grab(`${DTM}?bbox=${bb}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&renderingRule=${encodeURIComponent(SLOPE_RULE)}&f=image`),
      grab(wms(SR16, 'SRRKRONEDEK')),
      grab(wms(AR50, 'Arealtyper', LAND_SLD)),
    ])

    const [r, g, b] = RESULT_RGB[mode]
    const out = Buffer.alloc(256 * 256 * 4)
    for (let i = 0; i < out.length; i += 4) {
      if (land.data[i + 3] <= 20) continue          // not campable ground
      const hasCanopy = canopy.data[i + 3] > 20
      let ok
      if (mode === 'hengekoye') {
        ok = hasCanopy                               // trees are the requirement
      } else {
        const isFlat = slope.data[i + 3] > 20 && near(slope.data, i, FLAT_RGB)
        const isOpen = !hasCanopy || OPEN_CANOPY.some((c) => near(canopy.data, i, c))
        ok = isFlat && isOpen
      }
      if (ok) { out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = 235 }
    }

    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=86400')
    return res.status(200).send(encodePng(out, 256, 256))
  } catch {
    return sendBlank(res)
  }
}
