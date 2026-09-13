// Point and text lookups the browser needs, answered server-side.
//
// These used to be fetched straight from the public services, which meant the
// browser's network panel listed exactly which datasets Vildakart is built on.
// Routing them here keeps that between this server and the sources. The map
// attribution still names them, as the data licences require.
//
// One function with ?kind= rather than one per lookup: Vercel Hobby allows 12.

import tettsted from './_tettsted.js'

const inNorway = (lat, lng) => lat >= 57 && lat <= 71.5 && lng >= 4 && lng <= 31.5

// Returns the land-type label under a point, or null when there is none.
// The blocking decision stays in the client, which already owns that list.
async function land(req, res) {
  const lat = Number(req.query.lat), lng = Number(req.query.lng)
  if (!inNorway(lat, lng)) return res.status(400).json({ error: 'Out of range' })
  const d = 0.0005
  const url =
    `https://wms.nibio.no/cgi-bin/ar5?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo` +
    `&LAYERS=Arealtype&QUERY_LAYERS=Arealtype` +
    `&CRS=EPSG:4326&BBOX=${lat - d},${lng - d},${lat + d},${lng + d}` +
    `&WIDTH=100&HEIGHT=100&I=50&J=50&INFO_FORMAT=text/html`
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(9000) })
    if (!r.ok) return res.status(200).json({ label: null })
    const m = (await r.text()).match(/Arealtype<\/td>\s*<TD[^>]*>([^<]+)<\/td>/i)
    return res.status(200).json({ label: m ? m[1].trim() : null })
  } catch {
    return res.status(200).json({ label: null }) // fail open, as before
  }
}

// Heights along a measured line. Body: { points: [[lng, lat], ...] }.
async function elevation(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  const points = req.body?.points
  if (!Array.isArray(points) || points.length < 2 || points.length > 200 ||
      !points.every((p) => Array.isArray(p) && inNorway(Number(p[1]), Number(p[0])))) {
    return res.status(400).json({ error: 'Bad points' })
  }
  const body = new URLSearchParams({
    geometry: JSON.stringify({ points: points.map(([x, y]) => [Number(x), Number(y)]), spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryMultipoint',
    returnFirstValueOnly: 'true',
    interpolation: 'RSP_BilinearInterpolation',
    f: 'json',
  })
  try {
    const r = await fetch('https://hoydedata.no/arcgis/rest/services/DTM/ImageServer/getSamples', {
      method: 'POST', body, signal: AbortSignal.timeout(20000),
    })
    const json = await r.json()
    const z = new Array(points.length).fill(null)
    for (const s of json.samples ?? []) {
      const v = parseFloat(s.value)
      if (Number.isFinite(v) && Number.isInteger(s.locationId) && s.locationId < z.length) z[s.locationId] = v
    }
    return res.status(200).json({ z })
  } catch {
    return res.status(502).json({ error: 'Upstream failed' })
  }
}

// Norwegian place names. Only the fields the search box uses are passed on.
async function places(req, res) {
  const q = String(req.query.q ?? '').trim()
  if (!q || q.length > 100) return res.status(400).json({ error: 'Bad query' })
  try {
    const r = await fetch(
      `https://ws.geonorge.no/stedsnavn/v1/navn?sok=${encodeURIComponent(q)}&treffPerSide=10&utkoordsys=4258`,
      { signal: AbortSignal.timeout(5000) }
    )
    const json = await r.json()
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400')
    return res.status(200).json({
      navn: (json.navn ?? []).map((n) => ({
        stedsnummer: n.stedsnummer,
        skrivemåte: n.skrivemåte,
        navneobjekttype: n.navneobjekttype,
        kommuner: n.kommuner?.slice(0, 1).map((k) => ({ kommunenavn: k.kommunenavn })),
        representasjonspunkt: n.representasjonspunkt,
      })),
    })
  } catch {
    return res.status(200).json({ navn: [] })
  }
}

const KINDS = { land, elevation, places, tettsted }

export default function handler(req, res) {
  const fn = KINDS[req.query.kind]
  if (!fn) return res.status(400).json({ error: 'Unknown kind' })
  return fn(req, res)
}
