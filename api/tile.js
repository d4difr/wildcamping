// One route for every map tile proxy: /api/tile?layer=slope&bbox=...
//
// WHY THESE ARE NOT FIVE ROUTES
//
// Vercel's Hobby plan caps a deployment at 12 serverless functions, and every
// non-underscore file in api/ is one. Five tile proxies took five slots, which
// left no room to add anything — deployments started failing outright with
// "No more than 12 Serverless Functions", and six commits silently never
// shipped before that was diagnosed.
//
// The handlers themselves are untouched. They keep their own files, now
// underscore-prefixed so Vercel does not route them, and this dispatches by
// `layer`. That is deliberate: each one carries hard-won detail — zoom gating,
// SLD bodies, the AR50 water mask, PNG compositing — and merging their bodies
// would have risked all of it to save a slot. Nothing here changes what a tile
// looks like, only the URL it arrives on.
//
// Budget after this: 8 of 12 used.

import ar50 from './_ar50-tile.js'
import kronedekning from './_kronedekning-tile.js'
import slope from './_slope-tile.js'
import turrute from './_turrute-tile.js'
import vern from './_vern-tile.js'

const LAYERS = { ar50, kronedekning, slope, turrute, vern }

export default async function handler(req, res) {
  const handler = LAYERS[req.query.layer]
  if (!handler) {
    return res.status(400).json({
      error: 'Unknown layer',
      layers: Object.keys(LAYERS),
    })
  }
  return handler(req, res)
}
