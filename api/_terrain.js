// Shared terrain definitions. The leading underscore keeps Vercel from exposing
// this as a route — it is imported by the tile endpoints, not called directly.
//
// This exists because the Helning layer and the Egnet layer both need to agree
// on what "helt flatt" means. They used to define it separately, which would
// have drifted silently the first time one threshold was tuned: the legend would
// say one thing and the combined layer would quietly test another.

// Slope bands in degrees, chosen for pitching a tent rather than avalanche risk.
// Light for flat, dark for steep — the conventional terrain reading. Band 1 is
// isolated from the rest by a large gap in lightness so prime ground reads as a
// distinct pale patch rather than the top of a smooth ramp.
export const SLOPE_BANDS = [
  { max: 2, rgb: [240, 243, 255] }, // helt flatt — also what Egnet/telt requires
  { max: 4, rgb: [168, 172, 216] },
  { max: 6, rgb: [122, 127, 187] },
  { max: 9, rgb: [82, 87, 156] },
  { max: 13, rgb: [46, 51, 114] },
  { max: 90, rgb: [23, 26, 66] },
]

// The band Egnet/telt treats as flat enough to sleep on.
export const FLAT_BAND = SLOPE_BANDS[0]

// Slope only carries its stated meaning when zoomed in — ArcGIS computes it at
// the requested output resolution, so a zoomed-out tile averages steep ground
// into gentle. Measured on one Lofoten tile: 82% "flat" at z11 -> 51% at z13 ->
// 12% at z15, for the same cliffs. Do not lower without re-measuring that drift.
export const SLOPE_MIN_ZOOM = 13
