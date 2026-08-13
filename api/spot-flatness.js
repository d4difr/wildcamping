// Measures how flat the ground is around a spot, using Kartverket's national
// terrain model (DTM — bare earth, vegetation stripped out).
//
// Why "flattest patch nearby" rather than "slope at the pin":
// slope at tent scale is extremely sensitive. On a real spot we measured 13.8°
// at the pin and 3.5° four metres away — ordinary GPS error flips the answer.
// Asking "is there a tent-sized flat patch near here" is robust to that, and is
// the question a camper actually has.
//
// Source: Kartverket høydedata (DTM ImageServer), free/open data.

import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const DTM = 'https://hoydedata.no/arcgis/rest/services/DTM/ImageServer/getSamples'

const GRID = 11    // 11x11 samples
const STEP = 2     // metres between samples -> covers 20x20 m
const RECHECK_DAYS = 180

// Horn's method over a 3x3 window, the standard slope algorithm.
function hornSlope(w, step) {
  const [a, b, c, d, , f, g, h, i] = w
  const dzdx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8 * step)
  const dzdy = ((g + 2 * h + i) - (a + 2 * b + c)) / (8 * step)
  return Math.atan(Math.hypot(dzdx, dzdy)) * 180 / Math.PI
}

async function measure(lat, lng) {
  const mPerDegLat = 111320
  const mPerDegLon = 111320 * Math.cos(lat * Math.PI / 180)
  const half = (GRID - 1) / 2

  const points = []
  for (let r = half; r >= -half; r--) {
    for (let c = -half; c <= half; c++) {
      points.push([lng + (c * STEP) / mPerDegLon, lat + (r * STEP) / mPerDegLat])
    }
  }

  const body = new URLSearchParams({
    geometry: JSON.stringify({ points, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryMultipoint',
    returnFirstValueOnly: 'true',
    interpolation: 'RSP_BilinearInterpolation',
    f: 'json',
  })

  const res = await fetch(DTM, { method: 'POST', body, signal: AbortSignal.timeout(20000) })
  if (!res.ok) return null
  const json = await res.json()
  if (!Array.isArray(json.samples) || json.samples.length === 0) return null

  // locationId is the index of our input point, so we can place values exactly.
  const z = new Array(GRID * GRID).fill(NaN)
  for (const s of json.samples) {
    const v = parseFloat(s.value)
    if (Number.isFinite(v) && Number.isInteger(s.locationId)) z[s.locationId] = v
  }

  let best = null
  for (let r = 1; r < GRID - 1; r++) {
    for (let c = 1; c < GRID - 1; c++) {
      const w = [
        z[(r - 1) * GRID + c - 1], z[(r - 1) * GRID + c], z[(r - 1) * GRID + c + 1],
        z[r * GRID + c - 1],       z[r * GRID + c],       z[r * GRID + c + 1],
        z[(r + 1) * GRID + c - 1], z[(r + 1) * GRID + c], z[(r + 1) * GRID + c + 1],
      ]
      if (w.some((v) => !Number.isFinite(v))) continue
      const slope = hornSlope(w, STEP)
      if (!Number.isFinite(slope)) continue
      const north = (half - r) * STEP
      const east = (c - half) * STEP
      const offset = Math.hypot(north, east)
      if (!best || slope < best.slope) {
        best = { slope, relief: Math.max(...w) - Math.min(...w), offset }
      }
    }
  }
  return best
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const { id } = req.body || {}
  if (!id) return res.status(400).json({ error: 'Missing id' })

  // Coordinates come from the database, never from the caller.
  const { data: spot } = await supabaseAdmin
    .from('spots')
    .select('id, latitude, longitude, flatness_deg, flatness_relief_m, flatness_offset_m, flatness_checked_at')
    .eq('id', id)
    .single()
  if (!spot) return res.status(404).json({ error: 'Not found' })

  // Already measured recently — hand back the stored value.
  if (spot.flatness_checked_at) {
    const age = (Date.now() - new Date(spot.flatness_checked_at)) / 86400000
    if (age < RECHECK_DAYS) {
      return res.status(200).json({
        cached: true,
        slope_deg: spot.flatness_deg,
        relief_m: spot.flatness_relief_m,
        offset_m: spot.flatness_offset_m,
      })
    }
  }

  let best = null
  try {
    best = await measure(spot.latitude, spot.longitude)
  } catch {
    // Upstream slow or down — fall through and record the attempt.
  }

  const round = (n, p = 1) => (n == null ? null : Math.round(n * 10 ** p) / 10 ** p)
  const update = {
    flatness_deg: round(best?.slope),
    flatness_relief_m: round(best?.relief, 2),
    flatness_offset_m: round(best?.offset, 0),
    flatness_checked_at: new Date().toISOString(),
  }
  await supabaseAdmin.from('spots').update(update).eq('id', id)

  return res.status(200).json({
    cached: false,
    slope_deg: update.flatness_deg,
    relief_m: update.flatness_relief_m,
    offset_m: update.flatness_offset_m,
  })
}
