import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Map, { Marker, Source, Layer, useMap, AttributionControl } from 'react-map-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { supabase } from '../supabaseClient'
import AddSpotForm from './AddSpotForm'

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

const ACCESS_LABELS = {
  'road': '🚗 Bilvei',
  'short-hike': '🥾 Kort tur',
  'day-hike': '⛰ Dagstur',
  'remote': '🏔 Avsidesliggende',
}

const SPOT_COLORS = { tent: '#1b4332', hammock: '#5c4a1e' }

// NIBIO's AR50 WMS stops rendering above 1:500 000 — verified blank at z<=9.
const TERRENGTYPE_MIN_ZOOM = 10

// Slope of the flattest tent-sized patch near a pin, from Kartverket's terrain
// model. Thresholds are about pitching comfort, not safety.
function flatnessLabel(deg) {
  if (deg == null) return null
  if (deg < 5) return { text: 'Nesten flatt', tone: 'good' }
  if (deg < 10) return { text: 'Svakt hellende', tone: 'good' }
  if (deg < 15) return { text: 'Merkbar helling', tone: 'mid' }
  return { text: 'Bratt', tone: 'poor' }
}

// Slope only carries its stated meaning when zoomed in — a zoomed-out tile
// averages steep ground into gentle ground. Measured drift on one Lofoten tile:
// 82% "flat" at z11, 51% at z13, 12% at z15, for the same cliffs.
const HELNING_MIN_ZOOM = 13

// Mirrors api/slope-tile.js. Only campable ground is coloured; steeper ground is
// left unmarked so the eye goes straight to where a tent could actually go.
const HELNING_BANDS = [
  { color: '#F0F3FF', label: 'Helt flatt', hint: 'Under 2°' },
  { color: '#A8ACD8', label: 'Nesten flatt', hint: '2–4°' },
  { color: '#7A7FBB', label: 'Svakt skrått', hint: '4–6°' },
  { color: '#52579C', label: 'Merkbar helling', hint: '6–9°' },
  { color: '#2E3372', label: 'Skrått', hint: '9–13°' },
  { color: '#171A42', label: 'Bratt', hint: 'Over 13°' },
]

// Kartverket's topographic map, served from their open tile cache — no token,
// CORS *, and it renders z4-z18 (verified). This is the map Norwegians know from
// norgeskart.no and DNT: marked trails, cabins and terrain naming that Mapbox
// Outdoors doesn't carry for Norway.
//
// A minimal style rather than a Mapbox style URL. It has no symbol layers, so no
// glyphs/sprite are needed; the overlay layers are all raster and get added
// programmatically on style.load as usual.
const TOPO_STYLE = {
  version: 8,
  sources: {
    'kv-topo': {
      type: 'raster',
      tiles: ['https://cache.kartverket.no/v1/service?service=WMTS&request=GetTile&version=1.0.0&layer=topo&style=default&tilematrixset=webmercator&TileMatrix={z}&TileRow={y}&TileCol={x}&format=image/png'],
      tileSize: 256,
      maxzoom: 18,
      attribution: '© <a href="https://www.kartverket.no/" target="_blank" rel="noopener">Kartverket</a>',
    },
  },
  layers: [{ id: 'kv-topo-layer', type: 'raster', source: 'kv-topo' }],
}

const BASEMAPS = [
  { key: 'outdoors', label: '🗺 Outdoors', hint: 'Mapbox friluftskart', style: 'mapbox://styles/mapbox/outdoors-v12' },
  { key: 'satellite', label: '🛰 Satellitt', hint: 'Flyfoto', style: 'mapbox://styles/mapbox/satellite-streets-v12' },
  { key: 'topo', label: '🇳🇴 Topografisk', hint: 'Kartverkets norgeskart — stier, hytter, myr', style: TOPO_STYLE },
]

// --- Distance measuring -----------------------------------------------------
// Aimed at "how far is this spot from the road", not route planning: a few
// clicked points, the distance along them, and how much climbing is involved.

const EARTH_R = 6371000

function haversine(a, b) {
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_R * Math.asin(Math.sqrt(h))
}

function pathLength(points) {
  let m = 0
  for (let i = 1; i < points.length; i++) m += haversine(points[i - 1], points[i])
  return m
}

function formatDistance(m) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`.replace('.', ',')
}

// A circle in real-world metres, as a polygon. Has to be geographic rather than a
// pixel-radius circle so it stays the right size on the ground as you zoom —
// a fixed-pixel circle would imply better precision the further you zoom in.
function circlePolygon(lng, lat, radiusM, steps = 64) {
  const dLat = radiusM / 111320
  const dLng = radiusM / (111320 * Math.cos((lat * Math.PI) / 180))
  const ring = []
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI
    ring.push([lng + dLng * Math.cos(t), lat + dLat * Math.sin(t)])
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] } }
}

// Evenly spaced points along the path, for sampling an elevation profile.
// Capped so a long path doesn't turn into a huge request.
function sampleAlong(points, count = 80) {
  if (points.length < 2) return points
  const segs = []
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const d = haversine(points[i - 1], points[i])
    segs.push({ a: points[i - 1], b: points[i], d })
    total += d
  }
  if (total === 0) return points
  const out = []
  for (let i = 0; i < count; i++) {
    let target = (total * i) / (count - 1)
    for (const s of segs) {
      if (target <= s.d || s === segs[segs.length - 1]) {
        const t = s.d === 0 ? 0 : Math.min(1, target / s.d)
        out.push({ lng: s.a.lng + (s.b.lng - s.a.lng) * t, lat: s.a.lat + (s.b.lat - s.a.lat) * t })
        break
      }
      target -= s.d
    }
  }
  return out
}

// Kartverket's navneobjekttype is a long controlled vocabulary (Vann, Nut, Myr,
// Gard, Tettbebyggelse …), so match on word stems rather than listing every value.
const STEDSNAVN_ICONS = [
  [/vann|vatn|tjern|tjønn|innsjø|elv|bekk|foss|fjord|bukt|vik|sjø/i, '💧'],
  [/fjell|berg|nut|topp|haug|ås|hei|kolle|tind|pigg/i, '⛰'],
  [/myr|mo|slette|eng/i, '🌾'],
  [/vidde|vidda|platå/i, '⛰'],
  [/skog|li$|lia|dal/i, '🌲'],
  [/øy|holme|skjær|nes|odde|strand/i, '🏝'],
  [/by|tettbe|bygd|grend|sted/i, '🏘'],
  [/gard|gård|bruk|plass|seter|hytte|bu$/i, '🏠'],
]

function stedsnavnIcon(type) {
  for (const [re, icon] of STEDSNAVN_ICONS) if (re.test(type || '')) return icon
  return '📍'
}

// NIBIO's own SR16 ramp: light = open canopy, dark = dense. We show it as a
// gradient rather than numbered classes because we use their classification, not
// our own — see the note in api/kronedekning-tile.js.
// SR16 vector renders only from z13; the raster covers below that.
const KRONEDEKNING_VECTOR_MIN_ZOOM = 13

const KRONEDEKNING_BANDS = [
  { color: '#E5F5E0', label: 'Åpent', hint: 'Lite kronedekke — mest lys ned til bakken' },
  { color: '#74C476', label: 'Middels', hint: 'Delvis lukket kronedekke' },
  { color: '#00441B', label: 'Tett', hint: 'Nesten helt lukket kronedekke' },
]

// Turrutebasen stops rendering above 1:1 000 000 — verified blank at z<=9.
const TURRUTER_MIN_ZOOM = 10

// Turruter is drawn by Kartverket in their own red; we don't restyle it, so the
// swatch just mirrors what the service returns.
const TURRUTER_BANDS = [
  { color: '#FF7F7F', label: 'Merket sti', hint: 'Fotrute fra Turrutebasen' },
]

// Mirrors api/vern-tile.js. A legal layer, not a terrain one — purple family so
// it never reads as "the ground looks like this".
const VERN_BANDS = [
  { color: '#B03060', label: 'Naturreservat', hint: 'Ofte forbud mot telting' },
  { color: '#7B4B94', label: 'Nasjonalpark', hint: 'Telting normalt tillatt, men egne regler' },
  { color: '#A98FC4', label: 'Landskapsvern m.m.', hint: 'Som regel tillatt' },
]

// Overlay tiles are cached for 30 days at the edge and a day in the browser, and
// the URL is the cache key. Changing a palette or threshold without changing the
// URL leaves stale tiles served alongside fresh ones — which showed up as a
// patchwork of old blue and new gold tiles after the Helning recolour.
//
// Deriving the key from the band definitions means any style edit busts the
// cache on its own; there is no version constant to remember to bump. Keep the
// hints in sync with the thresholds in the API so threshold-only changes are
// caught too.
function styleKey(bands) {
  const s = bands.map((b) => `${b.color}${b.label}${b.hint}`).join('|')
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h).toString(36)
}

// Mirrors api/ar50-tile.js. Describes what the ground IS rather than rating it —
// dense forest is poor for a tent and ideal for a hammock, so a single "krevende"
// verdict would be wrong for half the users. Hints name the trade-off instead.
// Vanlig skog vises ikke — se notatet i api/ar50-tile.js. Kronedekning svarer på
// hvor tett trærne står; dette laget viser bakken der det ikke bare er skog.
const TERRENGTYPE_BANDS = [
  { color: '#EBD98A', label: 'Åpen mark', hint: 'Tørr, åpen bakke. Bra for telt — ingen trær til hengekøye' },
  { color: '#7FC3B0', label: 'Fuktig mark', hint: 'Åpen, men fuktig underlag' },
  { color: '#B0AAA0', label: 'Bart fjell', hint: 'Lite jord — vanskelig å få ned plugger' },
  { color: '#9B7FB0', label: 'Myr', hint: 'Vått underlag — sjelden egnet til telt' },
]

const TENT_SVG = `<svg width="17" height="17" viewBox="0 0 24 19" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M10 0L14 3M14 0L10 3" stroke="#fff" stroke-width="1.5" stroke-linecap="round" />
  <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2.2L22.4 17.8H1.6L12 2.2ZM12 10.6L16.5 17.8H7.4L12 10.6Z" fill="#fff" />
  <rect x="0" y="17.8" width="24" height="1" fill="#fff" />
</svg>`

const HAMMOCK_SVG = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <line x1="4" y1="3" x2="4" y2="21" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>
  <line x1="20" y1="3" x2="20" y2="21" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M4 9 Q12 18 20 9" stroke="#fff" stroke-width="2" fill="#fff" fill-opacity="0.25" stroke-linecap="round"/>
  <line x1="4" y1="7.5" x2="8" y2="9.5" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="20" y1="7.5" x2="16" y2="9.5" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>
</svg>`

const PLAIN_ACCESS_LABELS = {
  'road': 'Bilvei',
  'short-hike': 'Kort tur (< 1 t)',
  'day-hike': 'Dagstur (1–3 t)',
  'remote': 'Avsidesliggende (3 t+)',
}

function escapeXml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// Human-readable summary used as the waypoint description in the GPX file.
function spotSummary(spot) {
  const parts = [
    spot.spot_type === 'hammock' ? 'Hengekøye' : 'Telt',
    spot.access ? PLAIN_ACCESS_LABELS[spot.access] : null,
    spot.region,
  ].filter(Boolean)
  const line = parts.join(' · ')
  return spot.description ? `${line}\n\n${spot.description}` : line
}

// GPX 1.1 waypoint file. Consumed by Garmin, COROS, Google Earth, gpx.studio,
// Gaia, Komoot, OsmAnd — anything that reads <wpt>.
function buildGpx(spots, docName) {
  const wpts = spots.map((spot) => {
    const url = `https://vildakart.no/?spot=${spot.id}`
    return `  <wpt lat="${spot.latitude}" lon="${spot.longitude}">
    <name>${escapeXml(spot.name)}</name>
    <desc>${escapeXml(spotSummary(spot))}</desc>
    <sym>Campground</sym>
    <type>Camping</type>
    <link href="${escapeXml(url)}"><text>Vildakart</text></link>
  </wpt>`
  }).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Vildakart"
     xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${escapeXml(docName)}</name>
    <link href="https://vildakart.no"><text>Vildakart</text></link>
    <time>${new Date().toISOString()}</time>
  </metadata>
${wpts}
</gpx>
`
}

function slugifyFilename(name) {
  return String(name)
    .toLowerCase()
    .replace(/[æå]/g, 'a').replace(/ø/g, 'o')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'leirplass'
}

function downloadGpx(spots, docName) {
  const blob = new Blob([buildGpx(spots, docName)], { type: 'application/gpx+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${slugifyFilename(docName)}.gpx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Clipboard API needs a secure context; fall back to a temporary textarea.
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'absolute'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

function SpotMarker({ spot, active, onClick }) {
  const bg = SPOT_COLORS[spot.spot_type] ?? SPOT_COLORS.tent
  const svg = spot.spot_type === 'hammock' ? HAMMOCK_SVG : TENT_SVG
  const size = active ? 36 : 28
  return (
    <Marker longitude={spot.longitude} latitude={spot.latitude} anchor="center" onClick={e => { e.originalEvent.stopPropagation(); onClick(spot) }}>
      <span
        className={`spot-badge${active ? ' spot-badge--active' : ''}`}
        style={{ background: bg, width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', cursor: 'pointer' }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </Marker>
  )
}

function SpotBadges({ spot }) {
  return (
    <div className="badge-row">
      <span className={`access-badge access-badge--type-${spot.spot_type || 'tent'}`}>
        {spot.spot_type === 'hammock' ? '🪢 Hengekøye' : '⛺ Telt'}
      </span>
      {spot.access && <span className={`access-badge access-badge--${spot.access}`}>{ACCESS_LABELS[spot.access]}</span>}
      {spot.region && <span className="access-badge access-badge--region">📍 {spot.region}</span>}
    </div>
  )
}

function Lightbox({ photos, startIndex, onClose }) {
  const [index, setIndex] = useState(startIndex)
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') setIndex((i) => (i + 1) % photos.length)
      if (e.key === 'ArrowLeft') setIndex((i) => (i - 1 + photos.length) % photos.length)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [photos.length, onClose])
  return createPortal(
    <div className="lightbox-overlay" onClick={onClose}>
      <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
        <button className="lightbox-close" onClick={onClose}>✕</button>
        <img src={photos[index]} alt="" className="lightbox-img" />
        {photos.length > 1 && (
          <>
            <button className="lightbox-arrow lightbox-arrow--prev" onClick={() => setIndex((i) => (i - 1 + photos.length) % photos.length)}>‹</button>
            <button className="lightbox-arrow lightbox-arrow--next" onClick={() => setIndex((i) => (i + 1) % photos.length)}>›</button>
            <div className="lightbox-dots">
              {photos.map((_, i) => <span key={i} className={`lightbox-dot${i === index ? ' lightbox-dot--active' : ''}`} onClick={() => setIndex(i)} />)}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}

const FLAG_REASONS = [
  'Privat eiendom',
  'Feil plassering på kartet',
  'Stedet er stengt eller utilgjengelig',
  'Feil eller misvisende informasjon',
  'Annet',
]

function ReportModal({ spot, onSubmit, onClose }) {
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')
  function handleSubmit(e) {
    e.preventDefault()
    if (!reason) return
    onSubmit(spot, reason, comment.trim())
  }
  return createPortal(
    <div className="about-overlay" onClick={onClose}>
      <div className="about-modal report-modal" onClick={(e) => e.stopPropagation()}>
        <button className="about-close" onClick={onClose}>✕</button>
        <h2 style={{ marginBottom: '1rem' }}>Rapporter innhold</h2>
        <form onSubmit={handleSubmit}>
          <p style={{ marginBottom: '0.75rem', fontSize: '0.9rem', color: '#555' }}>Hva er problemet med <strong>{spot.name}</strong>?</p>
          <div className="report-reasons">
            {FLAG_REASONS.map((r) => (
              <label key={r} className={`report-reason${reason === r ? ' report-reason--selected' : ''}`}>
                <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} />
                {r}
              </label>
            ))}
          </div>
          {reason === 'Annet' && (
            <textarea
              className="report-comment"
              placeholder="Beskriv problemet kort..."
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={300}
              rows={3}
            />
          )}
          <button type="submit" className="report-submit" disabled={!reason}>Send rapport</button>
        </form>
      </div>
    </div>,
    document.body
  )
}

function SpotDetail({ spot, onBack, onReport, alreadyReported }) {
  const photos = spot.photo_urls?.length ? spot.photo_urls : spot.photo_url ? [spot.photo_url] : []
  const [lightboxIndex, setLightboxIndex] = useState(null)
  const [showReportModal, setShowReportModal] = useState(false)
  const [copyState, setCopyState] = useState('idle') // 'idle' | 'ok' | 'fail'
  const staticMap = `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/static/pin-s+d98e04(${spot.longitude},${spot.latitude})/${spot.longitude},${spot.latitude},13,0/600x240@2x?access_token=${TOKEN}`
  function handleReportSubmit(spot, reason, comment) {
    setShowReportModal(false)
    onReport(spot, reason, comment)
  }
  async function handleCopyCoords() {
    const ok = await copyText(`${spot.latitude.toFixed(5)}, ${spot.longitude.toFixed(5)}`)
    setCopyState(ok ? 'ok' : 'fail')
    setTimeout(() => setCopyState('idle'), 2000)
  }
  return (
    <div className="spot-detail">
      {lightboxIndex !== null && <Lightbox photos={photos} startIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} />}
      {showReportModal && <ReportModal spot={spot} onSubmit={handleReportSubmit} onClose={() => setShowReportModal(false)} />}
      <button className="go-back-btn" onClick={onBack}>← Gå tilbake</button>
      <h2 className="spot-detail-name">{spot.name}</h2>
      <SpotBadges spot={spot} />
      {photos.length === 1 ? (
        <img src={photos[0]} alt={spot.name} className="spot-detail-static-map" style={{ cursor: 'pointer' }} onClick={() => setLightboxIndex(0)} />
      ) : photos.length > 1 ? (
        <div className="detail-photo-strip">
          {photos.map((url, i) => <img key={i} src={url} alt={`${spot.name} ${i + 1}`} className="detail-photo" onClick={() => setLightboxIndex(i)} />)}
        </div>
      ) : (
        <img src={staticMap} alt="Kart" className="spot-detail-static-map" />
      )}
      {spot.description && <p className="spot-detail-desc">{spot.description}</p>}
      {(() => {
        const f = flatnessLabel(spot.flatness_deg)
        if (!f) return null
        return (
          <p className={`spot-flatness spot-flatness--${f.tone}`}>
            <span className="spot-flatness-label">⛰ {f.text}</span>
            <span className="spot-flatness-detail">
              {Math.round(spot.flatness_deg)}° på det flateste innenfor 10 m
            </span>
            <span className="spot-flatness-source">Målt i Kartverkets terrengmodell</span>
          </p>
        )
      })()}
      <p className="spot-detail-coords">
        {spot.latitude.toFixed(5)}, {spot.longitude.toFixed(5)}
        {' · '}
        <a href={`https://www.google.com/maps?q=${spot.latitude},${spot.longitude}`} target="_blank" rel="noopener noreferrer">Åpne i Google Maps</a>
      </p>
      <div className="spot-export">
        <button className="spot-export-btn" onClick={handleCopyCoords}>
          {copyState === 'ok' ? '✓ Kopiert' : copyState === 'fail' ? 'Merk teksten over' : '⧉ Kopier koordinater'}
        </button>
        <button className="spot-export-btn" onClick={() => downloadGpx([spot], spot.name)}>
          ↓ Last ned GPX
        </button>
      </div>
      <p className="spot-export-hint">GPX-filen kan importeres i Garmin, COROS, Google Earth, gpx.studio og de fleste turplanleggere.</p>
      <button
        className={`report-btn${alreadyReported ? ' report-btn--done' : ''}`}
        onClick={() => !alreadyReported && setShowReportModal(true)}
        disabled={alreadyReported}
      >
        {alreadyReported ? 'Rapportert' : 'Rapporter innhold'}
      </button>
    </div>
  )
}

function AboutModal({ onClose }) {
  const [contactStatus, setContactStatus] = useState('idle')
  async function handleContactSubmit(e) {
    e.preventDefault()
    setContactStatus('sending')
    const form = e.target
    try {
      const res = await fetch('https://formspree.io/f/mykrpyjj', { method: 'POST', headers: { 'Accept': 'application/json' }, body: new FormData(form) })
      if (res.ok) { setContactStatus('sent'); form.reset() } else setContactStatus('error')
    } catch { setContactStatus('error') }
  }
  return createPortal(
    <div className="about-overlay" onClick={onClose}>
      <div className="about-modal" onClick={(e) => e.stopPropagation()}>
        <button className="about-close" onClick={onClose}>✕</button>
        <h1 className="about-title">Om Vildakart</h1>
        <section className="about-section">
          <h2>Hvorfor Vildakart?</h2>
          <p>Vildakart er laget av friluftsfolk, for friluftsfolk. Del steder du har funnet på tur med andre som ferdes i norsk natur. Norge har noe av den vakreste naturen i verden, og allemannsretten gir oss alle rett til å ferdes og overnatte i den. Men gode leirplasser er spredt rundt i forum, Facebook-grupper og muntlige tips. Vildakart er laget for å samle dem på ett sted, slik at alle som elsker friluftsliv enkelt kan dele og oppdage nye steder.</p>
        </section>
        <section className="about-section">
          <h2>Slik fungerer kartet</h2>
          <p>Alle kan legge til en leirplass uten å opprette konto. Klikk på «Legg til leirplass», plasser en pin på kartet og fyll inn det du vet. Leirplassen knyttes til enheten du brukte, så du kan redigere eller slette den igjen fra samme telefon eller datamaskin.</p>
          <p>Når du plasserer en pin sjekker kartet automatisk om området er klassifisert som innmark i NIBIOs arealkart, som dyrket mark, bebyggelse eller åpen fastmark i tettbygd strøk. Steder i slike områder kan ikke legges til. Alle nye leirplasser gjennomgås av en administrator før de vises på kartet.</p>
        </section>
        <section className="about-section about-section--contact">
          <h2>Kontakt</h2>
          <p>Spørsmål, tilbakemeldinger eller forslag? Fyll ut skjemaet under.</p>
          {contactStatus === 'sent' ? (
            <p className="contact-success">Takk for meldingen, vi svarer så fort vi kan.</p>
          ) : (
            <form className="contact-form" onSubmit={handleContactSubmit}>
              <input type="text" name="name" placeholder="Navn" required />
              <input type="email" name="email" placeholder="E-post" required />
              <textarea name="message" rows={3} placeholder="Melding" required />
              {contactStatus === 'error' && <p className="contact-error">Noe gikk galt, prøv igjen.</p>}
              <button type="submit" className="primary" disabled={contactStatus === 'sending'}>{contactStatus === 'sending' ? 'Sender…' : 'Send melding'}</button>
            </form>
          )}
        </section>
      </div>
    </div>,
    document.body
  )
}

function RespektModal({ onClose }) {
  return createPortal(
    <div className="about-overlay" onClick={onClose}>
      <div className="about-modal" onClick={(e) => e.stopPropagation()}>
        <button className="about-close" onClick={onClose}>✕</button>
        <h1 className="about-title">Respekt for naturen</h1>
        <section className="about-section">
          <h2>Kjenn allemannsretten</h2>
          <p>Allemannsretten gir alle rett til å ferdes og overnatte i utmark, uansett hvem som eier landet. Utmark er udyrket mark og omfatter det meste av skog, fjell, myr, innsjøer og strender.</p>
          <p style={{ marginTop: '0.65rem' }}>Allemannsretten gjelder <strong>ikke</strong> på innmark: dyrket jord, beite i aktiv bruk, gårdsplasser, hus- og hyttetomter eller industriareal. Du kan likevel ferdes på frossen eller snødekt innmark.</p>
          <p style={{ marginTop: '0.65rem' }}>Du kan slå opp telt i utmark så lenge du holder minst <strong>150 meter fra nærmeste bebodde hus eller hytte</strong>. Du kan bli på samme sted i inntil to netter uten å spørre grunneier. På høyfjellet eller langt fra bebyggelse kan du bli lenger.</p>
        </section>
        <section className="about-section">
          <h2>Motorisert ferdsel</h2>
          <p>Allemannsretten gjelder til fots, på sykkel, til hest og med ikke-motorisert fartøy. <strong>Det er ikke tillatt å kjøre bil, motorsykkel, ATV eller bobil inn i utmark</strong> for å nå en leirplass. Kjøretøy skal stå på lovlig parkering ved vei.</p>
        </section>
        <section className="about-section">
          <h2>Legg ingen spor</h2>
          <p>Ta med deg alt søppel ut igjen. Grav ned menneskelig avfall minst 60 meter fra vann og stier. Telt på stein eller gress der det er mulig, ikke på sårbar vegetasjon. En god tommelfingerregel: neste person som kommer dit skal ikke se at du har vært der.</p>
          <p style={{ marginTop: '0.65rem' }}><strong>Bålforbudet gjelder fra 15. april til 15. september</strong> i og nær skog over hele landet. Bål er likevel tillatt der det er opplagt at det ikke kan starte brann, for eksempel på en godkjent bålplass eller når det ligger snø på bakken. Bruk alltid eksisterende ildsteder der det finnes, og aldri levende trær eller røtter som brensel.</p>
          <p style={{ marginTop: '0.65rem' }}>Mange av de vakreste plassene er vakre nettopp fordi de er ukjente. Gjentatte besøk kan ødelegge vegetasjon og gjøre stier til gjørmehull. Tenk deg om før du deler sårbare plasser videre.</p>
        </section>
        <section className="about-section">
          <h2>Vis hensyn til dyrelivet</h2>
          <p>I hekke- og yngletiden (april–juli) er mange fugler og pattedyr svært sårbare for forstyrrelser. Hold avstand til reirplasser og unger. <strong>Hunder skal holdes i bånd fra 1. april til 20. august.</strong> Respekter beitedyr og hold deg unna områder med sau eller storfe.</p>
        </section>
        <section className="about-section">
          <h2>Vis hensyn til andre og grunneier</h2>
          <p>Opptre hensynsfullt ovenfor folk du møter på tur. Unngå unødvendig støy. Lukk porter etter deg og unngå skade på gjerder og skogplantefelt. Unngå skade på steder med kulturhistorisk verdi, som arkeologiske kulturminner og fredede byggverk.</p>
          <p style={{ marginTop: '0.65rem' }}>Hus og hytter nær utmark har rett til en privat sone. Vurder avstand, vegetasjon og lydnivå, og vis alltid skjønn.</p>
        </section>
        <section className="about-section">
          <h2>Den uskrevne regelen</h2>
          <p>Allemannsretten er et privilegium vi deler, ikke en rettighet vi kan ta for gitt. Jo bedre vi tar vare på naturen og respekterer grunneierne, jo lenger kan vi beholde denne friheten. Bruk naturen, men behandle den som om den tilhører alle, fordi det gjør den.</p>
        </section>
        <section className="about-section">
          <h2>Ansvarsfraskrivelse</h2>
          <p>Vildakart er en plattform der brukere deler leirplasser basert på egne erfaringer. Vi kontrollerer ikke innholdet og kan ikke garantere at informasjonen er oppdatert eller nøyaktig.</p>
          <p style={{ marginTop: '0.65rem' }}>Du er selv ansvarlig for å følge allemannsretten og lokale ferdselsforbud, sjekke om området er vernet (naturreservat, nasjonalpark) og overholde eventuelle restriksjoner, respektere grunneiere og andre friluftsfolk, og etterlate naturen slik du fant den.</p>
          <p style={{ marginTop: '0.65rem' }}>Vildakart er ikke ansvarlig for skader, ulykker eller regelbrudd som oppstår som følge av besøk på steder delt på kartet.</p>
        </section>
        <section className="about-section respekt-sources">
          <h2>Kilder</h2>
          <ul>
            <li><a href="https://www.dnt.no/turtips/turvett/allemannsretten/" target="_blank" rel="noopener noreferrer">Allemannsretten, DNT</a></li>
            <li><a href="https://www.dnt.no/turtips/turvett/allemannsretten/allemannspliktene/" target="_blank" rel="noopener noreferrer">Allemannspliktene, DNT</a></li>
            <li><a href="https://www.miljodirektoratet.no/ansvarsomrader/friluftsliv/friluftsliv-og-allemannsretten/allemannsretten/" target="_blank" rel="noopener noreferrer">Allemannsretten, Miljødirektoratet</a></li>
            <li><a href="https://www.miljodirektoratet.no/ansvarsomrader/friluftsliv/friluftsliv-og-allemannsretten/telt-og-hengekoye/" target="_blank" rel="noopener noreferrer">Telt og hengekøye, Miljødirektoratet</a></li>
            <li><a href="https://lovdata.no/dokument/NL/lov/1957-06-28-16" target="_blank" rel="noopener noreferrer">Friluftsloven, Lovdata</a></li>
          </ul>
        </section>
      </div>
    </div>,
    document.body
  )
}

function AdminPanel({ isAdmin, adminKey, onLogin, onLogout, onClose, onViewSpot, onRefreshPending }) {
  const [password, setPassword] = useState('')
  const [spots, setSpots] = useState([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('all')
  const [stats, setStats] = useState(null)
  const [backfill, setBackfill] = useState(null) // null | { done, total }

  useEffect(() => {
    if (isAdmin) { fetchAll(); fetchStats() }
  }, [isAdmin])

  function handleLogin(e) {
    e.preventDefault()
    onLogin(password)
  }

  async function fetchAll() {
    setLoading(true)
    try {
      const { data } = await supabase.from('spots').select('*').order('created_at', { ascending: false })
      if (data) setSpots(data)
    } finally {
      setLoading(false)
    }
  }

  async function fetchStats() {
    const { data } = await supabase.from('page_views').select('visited_at')
    if (!data) return
    const now = new Date()
    const todayStr = now.toISOString().slice(0, 10)
    const weekAgo = new Date(now - 7 * 864e5)
    const today = data.filter(v => v.visited_at.slice(0, 10) === todayStr).length
    const week = data.filter(v => new Date(v.visited_at) >= weekAgo).length
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now - i * 864e5)
      const key = d.toISOString().slice(0, 10)
      const label = d.toLocaleDateString('no', { weekday: 'short', day: 'numeric' })
      const count = data.filter(v => v.visited_at.slice(0, 10) === key).length
      return { label, count }
    }).reverse()
    setStats({ total: data.length, today, week, days })
  }

  async function adminAction(action, id) {
    await fetch('/api/admin-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, id, admin_key: adminKey }),
    })
  }

  async function handleDelete(id) {
    const spot = spots.find((x) => x.id === id)
    if (!window.confirm(`Slette "${spot?.name ?? 'denne leirplassen'}"?\n\nDen flyttes til Slettet og kan gjenopprettes.`)) return
    await adminAction('delete', id)
    setSpots((s) => s.map((x) => x.id === id ? { ...x, deleted_at: new Date().toISOString() } : x))
    onRefreshPending?.()
  }

  async function handleRestore(id) {
    await adminAction('restore', id)
    setSpots((s) => s.map((x) => x.id === id ? { ...x, deleted_at: null } : x))
    onRefreshPending?.()
  }

  async function handlePurge(id) {
    const spot = spots.find((x) => x.id === id)
    if (!window.confirm(`Slette "${spot?.name ?? 'denne leirplassen'}" permanent?\n\nDette kan IKKE angres.`)) return
    await adminAction('purge', id)
    setSpots((s) => s.filter((x) => x.id !== id))
  }

  async function handleClearFlags(id) {
    await adminAction('clear-flags', id)
    setSpots((s) => s.map((x) => x.id === id ? { ...x, flags: 0, flag_reports: [] } : x))
  }

  async function handleApprove(id) {
    await adminAction('approve', id)
    setSpots((s) => s.filter((x) => x.id !== id))
    onRefreshPending?.()
  }

  // One-off catch-up for spots created before flatness measuring existed, or
  // whose measurement failed. Runs one at a time to stay polite to Kartverket.
  async function handleBackfillFlatness() {
    const todo = spots.filter((s) => !s.deleted_at && !s.flatness_checked_at)
    if (todo.length === 0) return
    setBackfill({ done: 0, total: todo.length })
    for (let i = 0; i < todo.length; i++) {
      try {
        const res = await fetch('/api/spot-flatness', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: todo[i].id }),
        })
        if (res.ok) {
          const d = await res.json()
          setSpots((list) => list.map((x) => x.id === todo[i].id ? {
            ...x, flatness_deg: d.slope_deg, flatness_checked_at: new Date().toISOString(),
          } : x))
        }
      } catch {
        // Skip this one; a later run will pick it up again.
      }
      setBackfill({ done: i + 1, total: todo.length })
    }
    setTimeout(() => setBackfill(null), 2500)
  }

  const live = spots.filter((s) => !s.deleted_at)
  const deleted = spots.filter((s) => s.deleted_at)
  const flagged = live.filter((s) => s.flags > 0)
  const pending = live.filter((s) => s.status === 'pending')
  const displayed = filter === 'flagged' ? flagged : filter === 'pending' ? pending : filter === 'deleted' ? deleted : live

  return createPortal(
    <div className="admin-overlay">
      <div className={`admin-panel${!isAdmin ? ' admin-panel--login' : ''}`}>
        {!isAdmin ? (
          <>
            <button className="about-close" style={{ position: 'absolute', top: '1rem', right: '1rem' }} onClick={onClose}>✕</button>
            <div className="admin-login-inner">
              <h2>Admin</h2>
              <form onSubmit={handleLogin}>
                <input type="password" placeholder="Passord" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
                <button type="submit" className="primary">Logg inn</button>
              </form>
            </div>
          </>
        ) : (
          <>
        <div className="admin-header">
          <div>
            <h2>Admin</h2>
            <span className="admin-subtitle">{live.length} leirplasser totalt</span>
          </div>
          <button className="about-close admin-close" onClick={onClose}>✕</button>
          <div className="admin-header-right">
            <div className="admin-tabs">
              <button className={`admin-tab${filter === 'all' ? ' admin-tab--active' : ''}`} onClick={() => setFilter('all')}>Alle</button>
              <button className={`admin-tab${filter === 'pending' ? ' admin-tab--active' : ''}`} onClick={() => setFilter('pending')}>
                Til godkjenning {pending.length > 0 && <span className="admin-flag-badge admin-flag-badge--pending">{pending.length}</span>}
              </button>
              <button className={`admin-tab${filter === 'flagged' ? ' admin-tab--active' : ''}`} onClick={() => setFilter('flagged')}>
                Flagget {flagged.length > 0 && <span className="admin-flag-badge">{flagged.length}</span>}
              </button>
              <button className={`admin-tab${filter === 'deleted' ? ' admin-tab--active' : ''}`} onClick={() => setFilter('deleted')}>
                Slettet {deleted.length > 0 && <span className="admin-flag-badge admin-flag-badge--deleted">{deleted.length}</span>}
              </button>
            </div>
          </div>
        </div>
        {stats && (
          <div className="admin-stats">
            <div className="admin-stat-cards">
              <div className="admin-stat-card"><span className="admin-stat-value">{stats.total}</span><span className="admin-stat-label">Totalt</span></div>
              <div className="admin-stat-card"><span className="admin-stat-value">{stats.week}</span><span className="admin-stat-label">Siste 7 dager</span></div>
              <div className="admin-stat-card"><span className="admin-stat-value">{stats.today}</span><span className="admin-stat-label">I dag</span></div>
            </div>
            <div className="admin-chart">
              {(() => {
                const max = Math.max(...stats.days.map(d => d.count), 1)
                return stats.days.map((d, i) => (
                  <div key={i} className="admin-chart-col">
                    <span className="admin-chart-count">{d.count || ''}</span>
                    <div className="admin-chart-bar-wrap"><div className="admin-chart-bar" style={{ height: `${(d.count / max) * 100}%` }} /></div>
                    <span className="admin-chart-label">{d.label}</span>
                  </div>
                ))
              })()}
            </div>
            {(() => {
              const missing = live.filter((s) => !s.flatness_checked_at).length
              if (!backfill && missing === 0) return null
              return (
                <div className="admin-backfill">
                  <button className="admin-btn" onClick={handleBackfillFlatness} disabled={!!backfill}>
                    {backfill
                      ? `Måler terreng… ${backfill.done}/${backfill.total}`
                      : `Mål terreng for ${missing} leirplass${missing === 1 ? '' : 'er'}`}
                  </button>
                </div>
              )
            })()}
          </div>
        )}
        {loading ? <p style={{ padding: '1rem' }}>Laster...</p> : (
          <div className="admin-list">
            {displayed.map((spot) => (
              <div key={spot.id} className={`admin-spot${spot.flags >= 3 ? ' admin-spot--flagged' : ''}`}>
                <div className="admin-spot-info">
                  <strong>{spot.name}</strong>
                  <span className="admin-spot-meta">
                    {spot.region && `${spot.region} · `}
                    {spot.created_at ? new Date(spot.created_at).toLocaleDateString('no') : ''}
                    {spot.flags > 0 && <span className="admin-flag-count"> · {spot.flags} flagg</span>}
                    {spot.deleted_at && <span className="admin-deleted-note"> · slettet {new Date(spot.deleted_at).toLocaleDateString('no')}</span>}
                  </span>
                  {filter === 'flagged' && spot.flag_reports?.length > 0 && (
                    <div className="admin-flag-reports">
                      {spot.flag_reports.map((r, i) => (
                        <div key={i} className="admin-flag-report">
                          <span className="admin-flag-report-reason">{r.reason}</span>
                          {r.comment && <span className="admin-flag-report-comment">"{r.comment}"</span>}
                          <span className="admin-flag-report-date">{new Date(r.flagged_at).toLocaleDateString('no')}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="admin-spot-actions">
                  {spot.deleted_at ? (
                    <>
                      <button className="admin-btn admin-btn--approve" onClick={() => handleRestore(spot.id)}>↩ Gjenopprett</button>
                      <button className="admin-btn admin-btn--delete" onClick={() => handlePurge(spot.id)}>Slett permanent</button>
                    </>
                  ) : (
                    <>
                      <button className="admin-btn admin-btn--goto" onClick={() => onViewSpot(spot)}>📍 Gå til</button>
                      {spot.status === 'pending' && <button className="admin-btn admin-btn--approve" onClick={() => handleApprove(spot.id)}>Godkjenn</button>}
                      {spot.flags > 0 && <button className="admin-btn" onClick={() => handleClearFlags(spot.id)}>Fjern flagg</button>}
                      <button className="admin-btn admin-btn--delete" onClick={() => handleDelete(spot.id)}>Slett</button>
                    </>
                  )}
                </div>
              </div>
            ))}
            {displayed.length === 0 && <p style={{ padding: '1rem', color: '#999' }}>Ingen leirplasser her.</p>}
          </div>
        )}
          </>
        )}
      </div>
    </div>,
    document.body
  )
}

function SidebarContent({
  editingCamp, activeSpot, activePendingSpot, activeAdminPendingSpot, ownerToken,
  filters, hasFilters, allRegions, filteredSpots, loading, spots, onBack, onEdit,
  onDelete, onSeeMore, onFilterChange, onToggleFilter, loadSpots, onReport,
  flaggedSpots, onAdminApprove, onAdminDelete, sidebarView, onSidebarViewChange,
}) {
  if (editingCamp) {
    return (
      <div className="spot-detail" style={{ padding: '0.75rem' }}>
        <AddSpotForm
          position={{ lat: editingCamp.latitude, lng: editingCamp.longitude }}
          camp={editingCamp}
          ownerToken={ownerToken}
          onCancel={() => onEdit(null)}
          onSaved={() => { onEdit(null); loadSpots() }}
        />
      </div>
    )
  }
  if (activePendingSpot) {
    return (
      <>
        <div className="pending-notice">
          <span className="pending-notice__icon">⏳</span>
          <div>
            <strong>Under godkjenning</strong>
            <p>Denne leirplassen er kun synlig for deg inntil den er godkjent av en administrator.</p>
          </div>
        </div>
        <SpotDetail spot={activePendingSpot} onBack={onBack} onReport={() => {}} alreadyReported={false} />
        <div className="owner-actions">
          <button className="owner-btn owner-btn--edit" onClick={() => onEdit(activePendingSpot)}>✏️ Rediger</button>
          <button className="owner-btn owner-btn--delete" onClick={() => onDelete(activePendingSpot)}>🗑 Slett</button>
        </div>
      </>
    )
  }
  if (activeAdminPendingSpot) {
    return (
      <>
        <div className="pending-notice" style={{ background: '#fff8e1', borderColor: '#f0c040' }}>
          <span className="pending-notice__icon">⏳</span>
          <div>
            <strong>Venter på godkjenning</strong>
            <p>Kun synlig for deg som admin og brukeren som la det inn.</p>
          </div>
        </div>
        <SpotDetail spot={activeAdminPendingSpot} onBack={onBack} onReport={() => {}} alreadyReported={false} />
        <div className="owner-actions">
          <button className="owner-btn owner-btn--approve" onClick={() => onAdminApprove(activeAdminPendingSpot)}>✓ Godkjenn</button>
          <button className="owner-btn owner-btn--delete" onClick={() => onAdminDelete(activeAdminPendingSpot)}>🗑 Slett</button>
        </div>
      </>
    )
  }
  if (activeSpot) {
    return (
      <>
        <SpotDetail spot={activeSpot} onBack={onBack} onReport={onReport} alreadyReported={flaggedSpots.includes(activeSpot.id)} />
        {activeSpot.owner_token === ownerToken && (
          <div className="owner-actions">
            <button className="owner-btn owner-btn--edit" onClick={() => onEdit(activeSpot)}>✏️ Rediger</button>
            <button className="owner-btn owner-btn--delete" onClick={() => onDelete(activeSpot)}>🗑 Slett</button>
          </div>
        )}
      </>
    )
  }
  if (sidebarView === 'mine') {
    const mySpots = spots.filter(s => s.owner_token === ownerToken)
    return (
      <>
        <div className="filter-panel">
          <div className="filter-panel-header">
            <span className="filter-panel-title">Mine bidrag</span>
          </div>
        </div>
        <div className="sidebar-body">
          {mySpots.length === 0 && (
            <p className="empty-state">Du har ikke lagt til noen leirplasser enda.</p>
          )}
          {mySpots.map((spot) => {
            const thumb = spot.photo_urls?.[0] || spot.photo_url ||
              `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/static/pin-s+d98e04(${spot.longitude},${spot.latitude})/${spot.longitude},${spot.latitude},12,0/400x200@2x?access_token=${TOKEN}`
            return (
              <div key={spot.id} className="spot-card" onClick={() => onSeeMore(spot)} style={{ cursor: 'pointer' }}>
                <img className="spot-card-thumb" src={thumb} alt="" loading="lazy" />
                <div className="spot-card-body">
                  <h3>{spot.name}</h3>
                  <SpotBadges spot={spot} />
                  <div className="spot-card-footer">
                    <button className="owner-btn owner-btn--edit" onClick={(e) => { e.stopPropagation(); onEdit(spot) }}>✏️</button>
                    <button className="owner-btn owner-btn--delete" onClick={(e) => { e.stopPropagation(); onDelete(spot) }}>✕</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </>
    )
  }

  return (
    <>
      <div className="filter-panel">
        <div className="filter-panel-header">
          <span className="filter-panel-title">Filtre</span>
          {hasFilters && <button className="filter-clear" onClick={() => onFilterChange({ types: [], access: [], regions: [] })}>Fjern alle</button>}
        </div>
        <div className="filter-group">
          <span className="filter-label">Type</span>
          <div className="filter-pills">
            {['tent', 'hammock'].map((t) => (
              <button key={t} className={`filter-pill${filters.types.includes(t) ? ' filter-pill--on' : ''}`} onClick={() => onToggleFilter('types', t)}>
                {t === 'tent' ? '⛺ Telt' : '🪢 Hengekøye'}
              </button>
            ))}
          </div>
        </div>
        <div className="filter-group">
          <span className="filter-label">Tilgang</span>
          <div className="filter-pills">
            {['road', 'short-hike', 'day-hike', 'remote'].map((a) => (
              <button key={a} className={`filter-pill${filters.access.includes(a) ? ' filter-pill--on' : ''}`} onClick={() => onToggleFilter('access', a)}>
                {ACCESS_LABELS[a]}
              </button>
            ))}
          </div>
        </div>
        <div className="filter-group">
          <span className="filter-label">Fylke</span>
          <select
            className="filter-region-select"
            value={filters.regions[0] || ''}
            onChange={(e) => onFilterChange((f) => ({ ...f, regions: e.target.value ? [e.target.value] : [] }))}
          >
            <option value="">Alle regioner</option>
            {allRegions.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>
      <div className="sidebar-body">
        {!loading && filteredSpots.length === 0 && (
          <p className="empty-state">{spots.length === 0 ? 'Ingen leirplasser enda. Legg til den første!' : 'Ingen leirplasser matcher filtrene dine.'}</p>
        )}
        {filteredSpots.map((spot) => {
          const thumb = spot.photo_urls?.[0] || spot.photo_url ||
            `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/static/pin-s+d98e04(${spot.longitude},${spot.latitude})/${spot.longitude},${spot.latitude},12,0/400x200@2x?access_token=${TOKEN}`
          return (
            <div key={spot.id} className="spot-card" onClick={() => onSeeMore(spot)} style={{ cursor: 'pointer' }}>
              <img className="spot-card-thumb" src={thumb} alt="" loading="lazy" />
              <div className="spot-card-body">
                <h3>{spot.name}</h3>
                <SpotBadges spot={spot} />
                {spot.owner_token === ownerToken && (
                  <div className="spot-card-footer">
                    <button className="owner-btn owner-btn--edit" onClick={(e) => { e.stopPropagation(); onEdit(spot) }}>✏️</button>
                    <button className="owner-btn owner-btn--delete" onClick={(e) => { e.stopPropagation(); onDelete(spot) }}>✕</button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

export default function CampingMap() {
  const mapRef = useRef(null)
  const nativeMap = useRef(null)
  const terrain3DRef = useRef(false)
  const terrengtypeRef = useRef(false)
  const helningRef = useRef(false)
  const vernRef = useRef(false)
  const kronedekningRef = useRef(false)
  const turruterRef = useRef(false)
  const planleggRef = useRef(null)
  const kartRef = useRef(null)
  const [viewState, setViewState] = useState({ longitude: 9.5, latitude: 62.0, zoom: 5, pitch: 0, bearing: 0 })
  const [terrain3D, setTerrain3D] = useState(false)
  const [terrengtype, setTerrengtype] = useState(false)
  const [helning, setHelning] = useState(false)
  const [vern, setVern] = useState(false)
  const [kronedekning, setKronedekning] = useState(false)
  // Turruter draws lines, not fills, so it stacks with the others rather than
  // competing — kept outside the one-at-a-time group on purpose.
  const [turruter, setTurruter] = useState(false)
  const [openMenu, setOpenMenu] = useState(null) // null | 'kart' | 'planlegg'
  // Per-layer opacity. Defaults differ because the layers cover different amounts
  // of ground — Vern is sparse polygons, Turruter is thin lines.
  const [opacity, setOpacity] = useState({
    terrengtype: 0.55, helning: 0.65, vern: 0.45, turruter: 0.9, kronedekning: 0.6,
  })
  const opacityRef = useRef(opacity)
  const [measuring, setMeasuring] = useState(false)
  const [measurePoints, setMeasurePoints] = useState([])
  const [elevation, setElevation] = useState(null) // null | 'loading' | 'error' | { gain, loss, min, max }
  const elevationTimeout = useRef(null)
  const [spots, setSpots] = useState([])
  const [ownPendingSpots, setOwnPendingSpots] = useState([])
  const [adminPendingSpots, setAdminPendingSpots] = useState([])
  const [pendingPosition, setPendingPosition] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeId, setActiveId] = useState(() => { const p = new URLSearchParams(window.location.search); return p.get('spot') || null })
  const [basemap, setBasemap] = useState('outdoors')
  const [filters, setFilters] = useState({ types: [], access: [], regions: [] })
  const [dropMode, setDropMode] = useState(false)
  const [locationChecking, setLocationChecking] = useState(false)
  const [locationError, setLocationError] = useState('')
  const [coordInput, setCoordInput] = useState({ lat: '', lng: '' })
  const [coordError, setCoordError] = useState('')
  const [coordExpanded, setCoordExpanded] = useState(false)
  const [userPosition, setUserPosition] = useState(null)
  const [locating, setLocating] = useState(false)
  const [locateError, setLocateError] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarView, setSidebarView] = useState('all') // 'all' | 'mine'
  const [editingCamp, setEditingCamp] = useState(null)
  const [sheetState, setSheetState] = useState('peek')
  const [aboutOpen, setAboutOpen] = useState(false)
  const [savedToast, setSavedToast] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchFocused, setSearchFocused] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchHighlight, setSearchHighlight] = useState(-1)
  const [spotMatches, setSpotMatches] = useState([])
  const [searchMarker, setSearchMarker] = useState(null)
  const searchMarkerTimeout = useRef(null)
  const searchRef = useRef(null)
  const searchTimeout = useRef(null)
  const ADMIN_KEY = import.meta.env.VITE_ADMIN_KEY || 'vilda-admin'
  const [respektOpen, setRespektOpen] = useState(false)
  const [isAdmin, setIsAdmin] = useState(() => localStorage.getItem('vilda_admin') === 'true')
  const [adminPanelOpen, setAdminPanelOpen] = useState(() => new URLSearchParams(window.location.search).get('v') === 'hvk0209X' || localStorage.getItem('vilda_admin') === 'true')
  const [flaggedSpots] = useState(() => JSON.parse(localStorage.getItem('vilda_flagged') || '[]'))
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  const sheetRef = useRef(null)
  const dragStartY = useRef(null)
  const dragStartTranslateY = useRef(0)

  useEffect(() => {
    function onResize() { setIsMobile(window.innerWidth < 768) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const el = sheetRef.current
    if (!el) return
    el.style.transition = 'transform 0.32s cubic-bezier(0.32, 0.72, 0, 1)'
    el.style.transform = sheetState === 'open' ? 'translateY(0)' : 'translateY(calc(100% - 28px))'
  }, [sheetState])

  function onHandleTouchStart(e) {
    const el = sheetRef.current
    const matrix = new DOMMatrix(getComputedStyle(el).transform)
    dragStartTranslateY.current = matrix.m42
    dragStartY.current = e.touches[0].clientY
    el.style.transition = 'none'
  }

  function onHandleTouchMove(e) {
    if (dragStartY.current === null) return
    e.preventDefault()
    const delta = e.touches[0].clientY - dragStartY.current
    const newY = Math.max(0, dragStartTranslateY.current + delta)
    sheetRef.current.style.transform = `translateY(${newY}px)`
  }

  function onHandleTouchEnd(e) {
    if (dragStartY.current === null) return
    const delta = e.changedTouches[0].clientY - dragStartY.current
    const el = sheetRef.current
    el.style.transition = 'transform 0.32s cubic-bezier(0.32, 0.72, 0, 1)'
    if (delta < -40) { setSheetState('open'); el.style.transform = 'translateY(0)' }
    else if (delta > 40) { setSheetState('peek'); el.style.transform = 'translateY(calc(100% - 28px))' }
    else { el.style.transform = sheetState === 'open' ? 'translateY(0)' : 'translateY(calc(100% - 28px))' }
    dragStartY.current = null
  }

  const [ownerToken] = useState(() => {
    let token = localStorage.getItem('vilda_owner_token')
    if (!token) { token = crypto.randomUUID(); localStorage.setItem('vilda_owner_token', token) }
    return token
  })

  async function loadSpots() {
    setLoading(true)
    const [{ data, error }, { data: ownPending }] = await Promise.all([
      supabase.from('spots').select('*').eq('status', 'approved').lt('flags', 3).is('deleted_at', null).order('created_at', { ascending: false }),
      supabase.from('spots').select('*').eq('status', 'pending').eq('owner_token', ownerToken).is('deleted_at', null),
    ])
    if (!error && data) {
      setSpots(data)
      const params = new URLSearchParams(window.location.search)
      const spotId = params.get('spot')
      if (spotId) {
        const spot = data.find((s) => String(s.id) === spotId)
        if (spot) { setActiveId(spot.id); if (window.innerWidth >= 768) setSidebarOpen(true) }
      }
    }
    if (ownPending) setOwnPendingSpots(ownPending)
    setLoading(false)
  }

  async function loadAdminPending() {
    const { data } = await supabase.from('spots').select('*').eq('status', 'pending').is('deleted_at', null)
    if (data) setAdminPendingSpots(data)
  }

  useEffect(() => { loadSpots() }, [])
  useEffect(() => { if (isAdmin) loadAdminPending(); else setAdminPendingSpots([]) }, [isAdmin])

  // Terrengtype is admin-only while in development. If admin logs out with the
  // layer on, the toggle disappears — so turn the layer off too.
  useEffect(() => {
    if (!openMenu) return
    function onDown(e) {
      const wrap = openMenu === 'kart' ? kartRef.current : planleggRef.current
      if (!wrap?.contains(e.target)) setOpenMenu(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [openMenu])

  useEffect(() => {
    if (isAdmin) return
    setOpenMenu(null)
    if (turruterRef.current) toggleTurruter()
    if (!terrengtypeRef.current && !helningRef.current && !vernRef.current && !kronedekningRef.current) return
    setOverlay(null)
  }, [isAdmin])

  useEffect(() => {
    if (sessionStorage.getItem('vilda_tracked')) return
    sessionStorage.setItem('vilda_tracked', '1')
    supabase.from('page_views').insert({ screen_width: window.innerWidth, visited_at: new Date().toISOString() }).then(({ error }) => {
      if (error) console.error('page_views insert failed:', error)
      else console.log('page_views insert ok')
    })
  }, [])

  useEffect(() => {
    const url = new URL(window.location)
    if (activeId) url.searchParams.set('spot', activeId)
    else url.searchParams.delete('spot')
    window.history.replaceState({}, '', url)
  }, [activeId])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') { setDropMode(false); setPendingPosition(null) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    function onClickOutside(e) {
      if (searchRef.current && !searchRef.current.contains(e.target)) { setSearchFocused(false); setSearchOpen(false) }
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('touchstart', onClickOutside)
    return () => { document.removeEventListener('mousedown', onClickOutside); document.removeEventListener('touchstart', onClickOutside) }
  }, [])

  const isPendingActive = typeof activeId === 'string' && activeId.startsWith('pending:')
  const isAdminPendingActive = typeof activeId === 'string' && activeId.startsWith('adminPending:')
  const activePendingSpot = isPendingActive ? ownPendingSpots.find(s => `pending:${s.id}` === activeId) || null : null
  const activeAdminPendingSpot = isAdminPendingActive ? adminPendingSpots.find(s => `adminPending:${s.id}` === activeId) || null : null
  const activeSpot = (isPendingActive || isAdminPendingActive) ? null : spots.find((s) => s.id === activeId) || null
  const basemapIndex = Math.max(0, BASEMAPS.findIndex((b) => b.key === basemap))

  // Measure flatness the first time a spot is opened, then reuse the stored
  // value. Kartverket is only asked once per spot.
  // Must sit below the activeSpot declaration above — the dependency array is
  // evaluated during render.
  useEffect(() => {
    if (!activeSpot || activeSpot.flatness_checked_at) return
    const id = activeSpot.id
    let cancelled = false
    fetch('/api/spot-flatness', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return
        setSpots((list) => list.map((x) => x.id === id ? {
          ...x,
          flatness_deg: d.slope_deg,
          flatness_relief_m: d.relief_m,
          flatness_offset_m: d.offset_m,
          flatness_checked_at: new Date().toISOString(),
        } : x))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [activeSpot?.id, activeSpot?.flatness_checked_at])

  const allRegions = useMemo(() => {
    const set = new Set(spots.map((s) => s.region).filter(Boolean))
    return [...set].sort()
  }, [spots])

  const filteredSpots = useMemo(() => {
    return spots.filter((s) => {
      if (filters.types.length && !filters.types.includes(s.spot_type || 'tent')) return false
      if (filters.access.length && !filters.access.includes(s.access)) return false
      if (filters.regions.length && !filters.regions.includes(s.region)) return false
      return true
    })
  }, [spots, filters])

  function toggleFilter(key, value) {
    setFilters((f) => { const arr = f[key]; return { ...f, [key]: arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value] } })
  }

  const hasFilters = filters.types.length || filters.access.length || filters.regions.length

  function toggle3D() {
    const map = nativeMap.current
    if (!map) return
    const next = !terrain3D
    setTerrain3D(next)
    terrain3DRef.current = next
    if (next) {
      map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.2 })
      map.easeTo({ pitch: 60, duration: 600 })
    } else {
      map.setTerrain(null)
      map.setFog(null)
      map.easeTo({ pitch: 0, bearing: 0, duration: 600 })
    }
  }

  // Only one coloured overlay at a time — stacking them is unreadable, and they
  // mean different things. Table-driven so adding a layer can't half-wire it.
  // Some overlays are drawn by more than one map layer — Kronedekning uses a
  // raster below z13 and a vector above it. Turruter is here too even though it
  // sits outside the exclusion group, so the opacity slider can find it.
  const LAYER_IDS = {
    terrengtype: ['ar50-terrengtype'],
    helning: ['kv-helning'],
    vern: ['md-vern'],
    kronedekning: ['nibio-kronedekning', 'nibio-kronedekning-v'],
    turruter: ['kv-turruter'],
  }

  const OVERLAYS = [
    { key: 'terrengtype', set: setTerrengtype, ref: terrengtypeRef },
    { key: 'helning', set: setHelning, ref: helningRef },
    { key: 'vern', set: setVern, ref: vernRef },
    { key: 'kronedekning', set: setKronedekning, ref: kronedekningRef },
  ].map((o) => ({ ...o, layers: LAYER_IDS[o.key] }))

  function setOverlay(which) {
    const map = nativeMap.current
    for (const o of OVERLAYS) {
      const on = o.key === which
      o.set(on)
      o.ref.current = on
      for (const id of o.layers) {
        if (map?.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
      }
    }
  }

  // Kept in a ref as well, because initTerrainLayers runs from a style.load
  // callback that closes over the state at mount time.
  function setLayerOpacity(key, value) {
    setOpacity((o) => { const next = { ...o, [key]: value }; opacityRef.current = next; return next })
    const map = nativeMap.current
    for (const id of LAYER_IDS[key] ?? []) {
      if (map?.getLayer(id)) map.setPaintProperty(id, 'raster-opacity', value)
    }
  }

  function toggleTerrengtype() { setOverlay(terrengtype ? null : 'terrengtype') }
  function toggleHelning() { setOverlay(helning ? null : 'helning') }
  function toggleVern() { setOverlay(vern ? null : 'vern') }
  function toggleKronedekning() { setOverlay(kronedekning ? null : 'kronedekning') }

  // Independent of the fill group — routes are meant to be read on top of terrain.
  function toggleTurruter() {
    const next = !turruter
    setTurruter(next)
    turruterRef.current = next
    const map = nativeMap.current
    if (map?.getLayer('kv-turruter')) {
      map.setLayoutProperty('kv-turruter', 'visibility', next ? 'visible' : 'none')
    }
  }

  function flyTo(lng, lat, zoom = null, bottomPadding = 0) {
    const map = nativeMap.current
    if (!map) return
    map.flyTo({
      center: [lng, lat],
      zoom: zoom ?? Math.max(map.getZoom(), 11),
      duration: 800,
      essential: true,
      padding: { top: 0, bottom: bottomPadding, left: 0, right: 0 },
    })
  }

  function openSpot(spot, fly = false) {
    setActiveId(spot.id)
    if (fly) flyTo(spot.longitude, spot.latitude)
  }

  function handleMapMarkerClick(spot) {
    const mobile = window.innerWidth < 768
    setActiveId(spot.id)
    if (!mobile) { setSidebarView('all'); setSidebarOpen(true) }
    if (mobile) {
      setSheetState('open')
      // Wait one frame for the sheet to render at its open height, then measure
      requestAnimationFrame(() => {
        const sheetHeight = sheetRef.current?.offsetHeight ?? 0
        flyTo(spot.longitude, spot.latitude, null, sheetHeight)
      })
    }
  }

  function handleSeeMore(spot) { openSpot(spot, true) }

  function handleBack() {
    setActiveId(null)
    setEditingCamp(null)
    if (isMobile) setSheetState('peek')
  }

  async function handleReport(spot, reason, comment) {
    const updated = [...flaggedSpots, spot.id]
    localStorage.setItem('vilda_flagged', JSON.stringify(updated))
    const { data: current } = await supabase.from('spots').select('flags, flag_reports').eq('id', spot.id).single()
    const existingReports = current?.flag_reports || []
    const newReport = { reason, comment: comment || '', flagged_at: new Date().toISOString() }
    await supabase.from('spots').update({
      flags: (current?.flags || 0) + 1,
      flag_reports: [...existingReports, newReport],
    }).eq('id', spot.id)
    setActiveId(null)
    loadSpots()
  }

  async function handleDelete(camp) {
    if (!window.confirm(`Slette "${camp.name}"? Dette kan ikke angres.`)) return
    await fetch('/api/spot-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: camp.id, owner_token: ownerToken }),
    })
    setActiveId(null)
    loadSpots()
  }

  async function handleAdminApprove(spot) {
    await fetch('/api/admin-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve', id: spot.id, admin_key: ADMIN_KEY }),
    })
    setActiveId(null)
    loadAdminPending()
    loadSpots()
  }

  async function handleAdminDelete(spot) {
    if (!window.confirm(`Slette "${spot.name}"?\n\nDen flyttes til Slettet og kan gjenopprettes.`)) return
    await fetch('/api/admin-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id: spot.id, admin_key: ADMIN_KEY }),
    })
    setActiveId(null)
    loadAdminPending()
  }

  async function placePin(lat, lng) {
    setLocationChecking(true)
    setLocationError('')
    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=country&access_token=${TOKEN}`,
        { signal: AbortSignal.timeout(5000) }
      )
      const data = await res.json()
      const country = data.features?.[0]?.properties?.short_code
      if (country !== 'no') {
        setLocationError('Pins kan kun plasseres i Norge.')
        setTimeout(() => setLocationError(''), 5000)
        return
      }
    } catch {
      // Geocoding failed — fail open and allow the pin
    }
    setPendingPosition({ lat, lng })
    setDropMode(false)
    setLocationError('')
    setLocationChecking(false)
  }

  function handleMapClick(e) {
    if (measuring) {
      setMeasurePoints((p) => [...p, { lng: e.lngLat.lng, lat: e.lngLat.lat }])
      return
    }
    if (!dropMode) return
    placePin(e.lngLat.lat, e.lngLat.lng).finally(() => setLocationChecking(false))
  }

  function stopMeasuring() {
    setMeasuring(false)
    setMeasurePoints([])
    setElevation(null)
    clearTimeout(elevationTimeout.current)
  }

  // Sample the terrain model along the drawn path. Kartverket allows this
  // straight from the browser (CORS *), so no proxy — but it can be slow on a
  // cold call, hence the debounce and the explicit loading state.
  useEffect(() => {
    clearTimeout(elevationTimeout.current)
    if (measurePoints.length < 2) { setElevation(null); return }
    setElevation('loading')
    let cancelled = false
    elevationTimeout.current = setTimeout(async () => {
      const pts = sampleAlong(measurePoints, 80)
      const body = new URLSearchParams({
        geometry: JSON.stringify({ points: pts.map((p) => [p.lng, p.lat]), spatialReference: { wkid: 4326 } }),
        geometryType: 'esriGeometryMultipoint',
        returnFirstValueOnly: 'true',
        interpolation: 'RSP_BilinearInterpolation',
        f: 'json',
      })
      try {
        const res = await fetch('https://hoydedata.no/arcgis/rest/services/DTM/ImageServer/getSamples', {
          method: 'POST', body, signal: AbortSignal.timeout(20000),
        })
        const json = await res.json()
        if (cancelled) return
        const z = new Array(pts.length).fill(NaN)
        for (const s of json.samples ?? []) {
          const v = parseFloat(s.value)
          if (Number.isFinite(v) && Number.isInteger(s.locationId)) z[s.locationId] = v
        }
        const known = z.filter(Number.isFinite)
        if (known.length < 2) { setElevation('error'); return }
        let gain = 0, loss = 0, prev = null
        for (const v of z) {
          if (!Number.isFinite(v)) continue
          if (prev !== null) { const d = v - prev; if (d > 0) gain += d; else loss -= d }
          prev = v
        }
        setElevation({ gain: Math.round(gain), loss: Math.round(loss), min: Math.round(Math.min(...known)), max: Math.round(Math.max(...known)) })
      } catch {
        if (!cancelled) setElevation('error')
      }
    }, 400)
    return () => { cancelled = true }
  }, [measurePoints])

  function handleCancel() { setPendingPosition(null); setDropMode(false); setCoordInput({ lat: '', lng: '' }); setCoordError(''); setCoordExpanded(false); setLocationError('') }

  function handleLocate() {
    if (!navigator.geolocation) { setLocateError('Nettleseren din støtter ikke posisjon.'); return }
    setLocating(true)
    setLocateError('')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // coords.accuracy is the 68% confidence radius in metres. Keeping it lets
        // the dot show its own uncertainty — which grows a lot under dense canopy,
        // exactly where people will be using this.
        setUserPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
        })
        setLocating(false)
        flyTo(pos.coords.longitude, pos.coords.latitude, 14)
      },
      (err) => { setLocating(false); setLocateError(err.code === err.PERMISSION_DENIED ? 'Posisjonstilgang nektet.' : 'Kunne ikke hente posisjonen din.') },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  function handleCoordSubmit(e) {
    e.preventDefault()
    const lat = parseFloat(coordInput.lat)
    const lng = parseFloat(coordInput.lng)
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) { setCoordError('Skriv inn gyldige koordinater (bredde −90→90, lengde −180→180)'); return }
    setCoordInput({ lat: '', lng: '' })
    setCoordError('')
    placePin(lat, lng).finally(() => setLocationChecking(false))
  }

  function placeIcon(types = []) {
    if (types.includes('poi')) return '📍'
    if (types.includes('address')) return '🏠'
    if (types.includes('place') || types.includes('locality')) return '🏙'
    if (types.includes('district') || types.includes('region')) return '🗺'
    if (types.includes('postcode')) return '📮'
    return '📌'
  }

  function handleSearch(q) {
    setSearchQuery(q)
    setSearchOpen(true)
    clearTimeout(searchTimeout.current)
    if (!q.trim()) { setSearchResults([]); setSpotMatches([]); setSearchLoading(false); return }
    const lower = q.toLowerCase()
    setSpotMatches(spots.filter(s => s.name.toLowerCase().includes(lower)).slice(0, 3))
    setSearchLoading(true)
    searchTimeout.current = setTimeout(async () => {
      const map = nativeMap.current
      const center = map ? map.getCenter() : { lng: 9.5, lat: 62 }

      // Kartverket's register knows Norwegian nature names — lakes, peaks, bogs —
      // that Mapbox simply doesn't have. Neither is a superset of the other, so
      // ask both and merge rather than replacing one with the other.
      const [kv, mb] = await Promise.allSettled([
        fetch(`https://ws.geonorge.no/stedsnavn/v1/navn?sok=${encodeURIComponent(q)}&treffPerSide=10&utkoordsys=4258`,
          { signal: AbortSignal.timeout(5000) }).then(r => r.json()),
        fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?country=no&language=no&limit=5&proximity=${center.lng},${center.lat}&access_token=${TOKEN}`,
          { signal: AbortSignal.timeout(5000) }).then(r => r.json()),
      ])

      const fromKv = (kv.status === 'fulfilled' ? kv.value?.navn ?? [] : [])
        // Street and property records are noise on a wild camping map.
        .filter((n) => !/adressenavn|eiendom/i.test(n.navneobjekttype || ''))
        .map((n) => ({
          id: `kv-${n.stedsnummer}`,
          name: n.skrivemåte,
          sub: [n.navneobjekttype, n.kommuner?.[0]?.kommunenavn].filter(Boolean).join(' · '),
          lng: n.representasjonspunkt?.øst,
          lat: n.representasjonspunkt?.nord,
          icon: stedsnavnIcon(n.navneobjekttype),
        }))
        .filter((r) => Number.isFinite(r.lng) && Number.isFinite(r.lat))

      // The register fuzzy-matches, so "Krokevann" can return "Kråkevatnet" first.
      // Rank exact, then prefix, then nearest to what the user is looking at.
      const dist = (r) => (r.lat - center.lat) ** 2 + (r.lng - center.lng) ** 2
      const rank = (r) => {
        const n = r.name.toLowerCase()
        return n === lower ? 0 : n.startsWith(lower) ? 1 : 2
      }
      fromKv.sort((a, b) => rank(a) - rank(b) || dist(a) - dist(b))

      const fromMb = (mb.status === 'fulfilled' ? mb.value?.features ?? [] : [])
        .filter((f) => Array.isArray(f.center))
        .map((f) => ({
          id: `mb-${f.id}`,
          name: f.text,
          sub: f.context?.slice(0, 2).map((c) => c.text).join(', ') ?? '',
          lng: f.center[0],
          lat: f.center[1],
          icon: placeIcon(f.place_type),
        }))

      // Cap the register's share so Mapbox always keeps a couple of slots —
      // otherwise a common name fills the whole list and the places only Mapbox
      // knows (towns, POIs) never surface.
      const seen = new Set()
      const merged = []
      for (const r of [...fromKv.slice(0, 6), ...fromMb]) {
        const key = `${r.name.toLowerCase()}|${r.lat.toFixed(2)},${r.lng.toFixed(2)}`
        if (seen.has(key)) continue
        seen.add(key)
        merged.push(r)
      }

      setSearchResults(merged.slice(0, 8))
      setSearchHighlight(-1)
      setSearchLoading(false)
    }, 300)
  }

  function handleSpotMatchSelect(spot) {
    setSearchQuery(spot.name)
    setSpotMatches([])
    setSearchResults([])
    setSearchOpen(false)
    setSearchFocused(false)
    const mobile = window.innerWidth < 768
    openSpot(spot, true)
    if (mobile) setSheetState('open')
  }

  function handleSearchSelect(result) {
    const { lng, lat } = result
    flyTo(lng, lat)
    setSearchQuery(result.name)
    setSearchResults([])
    setSearchOpen(false)
    clearTimeout(searchMarkerTimeout.current)
    setSearchMarker({ lat, lng })
    searchMarkerTimeout.current = setTimeout(() => setSearchMarker(null), 4000)
  }

  const activeLegends = [
    terrengtype && {
      key: 'terrengtype', layer: 'ar50-terrengtype', title: 'Terrengtype',
      bands: TERRENGTYPE_BANDS, minZoom: TERRENGTYPE_MIN_ZOOM,
      note: 'Viser myr, bart fjell og åpen mark fra NIBIOs arealdata. Vanlig skog er ikke fargelagt — bruk Kronedekning for det. Grove flater (ofte km-store), så sjekk alltid selv.',
    },
    helning && {
      key: 'helning', layer: 'kv-helning', title: 'Helning',
      bands: HELNING_BANDS, minZoom: HELNING_MIN_ZOOM,
      note: 'Målt i Kartverkets terrengmodell — viser formen på bakken, ikke stein, røtter eller vegetasjon.',
    },
    vern && {
      key: 'vern', layer: 'md-vern', title: 'Vern',
      bands: VERN_BANDS, minZoom: 0,
      note: 'Hvert verneområde har sin egen forskrift. Kartet viser bare hvor vernet gjelder — sjekk alltid reglene før du telter.',
    },
    kronedekning && {
      key: 'kronedekning', layer: 'nibio-kronedekning', title: 'Kronedekning',
      bands: KRONEDEKNING_BANDS, minZoom: 0,
      // NIBIO's own figures: the models explain ~70% of variation with ~50%
      // relative RMSE, and they state the pixel-level error averages out over
      // larger areas. So it is sound for comparing areas and unreliable for a
      // single point — the wording must not imply a measurement.
      note: 'Anslag på kronedekke, modellert fra laser og flybilder (NIBIO SR16). Godt egnet til å sammenligne områder, men kan bomme på enkeltpunkter — og vet ikke om kratt eller nyere hogst. Sjekk på stedet.',
    },
    turruter && {
      key: 'turruter', layer: 'kv-turruter', title: 'Turruter',
      bands: TURRUTER_BANDS, minZoom: TURRUTER_MIN_ZOOM,
      note: 'Merkede og vedlikeholdte ruter fra Kartverket. Umerkede stier vises ikke — de kan være like fine.',
    },
  ].filter(Boolean)

  const cursor = (dropMode || measuring) ? 'crosshair' : 'grab'
  const measureDistance = pathLength(measurePoints)

  return (
    <div className="app-root">
      <header className="topnav">
        <div className={`topnav-left${searchFocused ? ' topnav-left--expanded' : ''}`} ref={searchRef}>
          <div className="search-box">
            <input
              className="search-input"
              type="text"
              placeholder="Søk etter sted…"
              value={searchQuery}
              onChange={e => handleSearch(e.target.value)}
              onFocus={() => { setSearchFocused(true); searchResults.length > 0 && setSearchOpen(true) }}
              onKeyDown={e => {
                if (!searchOpen || searchResults.length === 0) return
                if (e.key === 'ArrowDown') { e.preventDefault(); setSearchHighlight(h => Math.min(h + 1, searchResults.length - 1)) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setSearchHighlight(h => Math.max(h - 1, 0)) }
                else if (e.key === 'Enter' && searchHighlight >= 0) { e.preventDefault(); handleSearchSelect(searchResults[searchHighlight]) }
              }}
            />
            {searchLoading && <span className="search-spinner" />}
            {searchQuery && !searchLoading && (
              <button className="search-clear" onClick={() => { setSearchQuery(''); setSearchResults([]); setSpotMatches([]); setSearchOpen(false); setSearchLoading(false) }}>✕</button>
            )}
            {searchOpen && searchQuery && !searchLoading && spotMatches.length === 0 && searchResults.length === 0 && (
              <ul className="search-results"><li className="search-no-results">Ingen steder funnet</li></ul>
            )}
            {searchOpen && (spotMatches.length > 0 || searchResults.length > 0) && (
              <ul className="search-results">
                {spotMatches.map(s => (
                  <li key={`spot-${s.id}`} onClick={() => handleSpotMatchSelect(s)}>
                    <span className="search-result-icon">⛺</span>
                    <span className="search-result-name">{s.name}</span>
                  </li>
                ))}
                {spotMatches.length > 0 && searchResults.length > 0 && <li className="search-divider" aria-hidden="true" />}
                {searchResults.map((r, i) => (
                  <li key={r.id} className={i === searchHighlight ? 'search-result--active' : ''} onClick={() => handleSearchSelect(r)}>
                    <span className="search-result-icon">{r.icon}</span>
                    <span>
                      <span className="search-result-name">{r.name}</span>
                      {r.sub && <span className="search-result-sub">{r.sub}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {searchFocused && (
            <button className="search-cancel-btn" onClick={() => { setSearchFocused(false); setSearchQuery(''); setSearchResults([]); setSpotMatches([]); setSearchOpen(false) }}>Avbryt</button>
          )}
        </div>

        <svg className="topnav-logo" width="126" height="34" viewBox="0 0 210 56" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Vilda">
          <circle cx="34" cy="10" r="9" fill="#d98e04" />
          <polygon points="22,2  42,26   2,26" fill="#f4f1ea" />
          <polygon points="22,14 46,40  -2,40" fill="#f4f1ea" />
          <polygon points="22,26 48,54  -4,54" fill="#f4f1ea" />
          <text x="58" y="46" fontFamily="Georgia, 'Times New Roman', serif" fontSize="46" fontWeight="700" fill="#f4f1ea" letterSpacing="-1.5">Vilda</text>
        </svg>

        <div className="topnav-right">
          <button className="about-btn" onClick={() => setAboutOpen(true)}>Om</button>
          <button className="respekt-btn" onClick={() => setRespektOpen(true)}>
            <span className="respekt-btn__full">Respekt for naturen</span>
            <span className="respekt-btn__short">Respekt</span>
          </button>
          {isAdmin && (
            <div className="admin-nav-indicator">
              <button className="admin-nav-btn" onClick={() => setAdminPanelOpen(true)}>⚙ Admin</button>
              <button className="admin-nav-logout" onClick={() => { setIsAdmin(false); localStorage.removeItem('vilda_admin'); setAdminPendingSpots([]) }}>Logg ut</button>
            </div>
          )}
        </div>

        <button className={`hamburger-btn${searchFocused ? ' hamburger-btn--hidden' : ''}`} onClick={() => setMenuOpen(o => !o)} aria-label="Meny">
          <span /><span /><span />
        </button>
        {menuOpen && (
          <div className="hamburger-menu" onClick={() => setMenuOpen(false)}>
            <button onClick={() => setAboutOpen(true)}>Om</button>
            <button onClick={() => setRespektOpen(true)}>Respekt for naturen</button>
          </div>
        )}
      </header>

      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
      {respektOpen && <RespektModal onClose={() => setRespektOpen(false)} />}
      {adminPanelOpen && (
        <AdminPanel
          isAdmin={isAdmin}
          adminKey={ADMIN_KEY}
          onLogin={(pw) => {
            if (pw === ADMIN_KEY) {
              setIsAdmin(true)
              localStorage.setItem('vilda_admin', 'true')
            } else {
              alert('Feil passord')
            }
          }}
          onLogout={() => { setIsAdmin(false); localStorage.removeItem('vilda_admin'); setAdminPendingSpots([]) }}
          onClose={() => setAdminPanelOpen(false)}
          onViewSpot={(spot) => {
            setActiveId(spot.status === 'pending' ? `adminPending:${spot.id}` : spot.id)
            if (isMobile) {
              // Close the full-screen admin panel and surface the spot in the bottom sheet
              setAdminPanelOpen(false)
              setSheetState('open')
              requestAnimationFrame(() => {
                const sheetHeight = sheetRef.current?.offsetHeight ?? 0
                flyTo(spot.longitude, spot.latitude, 13, sheetHeight)
              })
            } else {
              setSidebarView('all')
              setSidebarOpen(true)
              flyTo(spot.longitude, spot.latitude, 13)
            }
          }}
          onRefreshPending={loadAdminPending}
        />
      )}

      <div className="main-area">
        {!isMobile && (
          <aside className={`left-sidebar${sidebarOpen ? '' : ' left-sidebar--collapsed'}`}>
            {/* Collapsed rail */}
            {!sidebarOpen && (
              <div className="sidebar-rail">
                <button className="sidebar-rail-burger" onClick={() => setSidebarOpen(true)} aria-label="Åpne sidepanel">
                  <svg width="22" height="18" viewBox="0 0 22 18" fill="none"><line x1="0" y1="1" x2="22" y2="1" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/><line x1="0" y1="9" x2="22" y2="9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/><line x1="0" y1="17" x2="22" y2="17" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/></svg>
                </button>

                {/* Mine bidrag */}
                <button className="sidebar-rail-item" onClick={() => { setSidebarView('mine'); setSidebarOpen(true) }} title="Mine bidrag">
                  <div className="sidebar-rail-icon">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="8" r="4"/>
                      <path d="M4 20v-1a8 8 0 0116 0v1"/>
                    </svg>
                    {(() => { const n = spots.filter(s => s.owner_token === ownerToken).length; return n > 0 ? <span className="sidebar-rail-badge">{n}</span> : null })()}
                  </div>
                  <span className="sidebar-rail-label">Mine bidrag</span>
                </button>

                {/* Alle steder — stacked thumbnails with total count */}
                {spots.length > 0 && (
                  <button className="sidebar-rail-item" onClick={() => { setSidebarView('all'); setSidebarOpen(true) }} title="Alle steder">
                    <div className="sidebar-rail-stack">
                      {spots.slice(0, 3).map((spot, i) => {
                        const thumb = spot.photo_urls?.[0] || spot.photo_url ||
                          `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/static/pin-s+d98e04(${spot.longitude},${spot.latitude})/${spot.longitude},${spot.latitude},12,0/56x56@2x?access_token=${TOKEN}`
                        return <img key={spot.id} src={thumb} className="sidebar-rail-stack-img" style={{ zIndex: 3 - i, transform: `rotate(${(i - 1) * 5}deg)` }} alt="" />
                      })}
                      <span className="sidebar-rail-badge sidebar-rail-badge--stack">{spots.length}</span>
                    </div>
                    <span className="sidebar-rail-label">Alle steder</span>
                  </button>
                )}
              </div>
            )}
            {/* Expanded content */}
            {sidebarOpen && (
              <div className="sidebar-inner">
                <button className="sidebar-close-btn" onClick={() => { setSidebarOpen(false); setSidebarView('all') }} aria-label="Lukk sidepanel">✕</button>
                <SidebarContent
                  sidebarView={sidebarView} onSidebarViewChange={setSidebarView}
                  editingCamp={editingCamp} activeSpot={activeSpot} activePendingSpot={activePendingSpot}
                  activeAdminPendingSpot={activeAdminPendingSpot} ownerToken={ownerToken}
                  filters={filters} hasFilters={hasFilters} allRegions={allRegions}
                  filteredSpots={filteredSpots} loading={loading} spots={spots}
                  onBack={handleBack} onEdit={setEditingCamp} onDelete={handleDelete}
                  onSeeMore={handleSeeMore} onFilterChange={setFilters} onToggleFilter={toggleFilter}
                  loadSpots={loadSpots} onReport={handleReport} flaggedSpots={flaggedSpots}
                  onAdminApprove={handleAdminApprove} onAdminDelete={handleAdminDelete}
                />
              </div>
            )}
          </aside>
        )}

        <div className="map-root">
          <Map
            ref={mapRef}
            {...viewState}
            onMove={e => setViewState(e.viewState)}
            mapStyle={BASEMAPS[basemapIndex].style}
            // react-map-gl defaults to setStyle(..., {diff: true}). Diffing is
            // meant for small tweaks to the same style; going from a full Mapbox
            // vector style to a single raster source has nothing meaningful to
            // diff, and the swap can silently no-op. Force a clean reload — the
            // overlays re-attach on style.load either way.
            styleDiffing={false}
            mapboxAccessToken={TOKEN}
            projection={terrain3D ? 'globe' : 'mercator'}
            maxPitch={terrain3D ? 85 : 0}
            attributionControl={false}
            style={{ width: '100%', height: '100%' }}
            cursor={cursor}
            onClick={handleMapClick}
            onLoad={e => {
              const map = e.target
              nativeMap.current = map

              // Where to slot the coloured fills. Beneath the basemap's water if
              // it has one, so lakes and sea keep their own colour: the terrain
              // model treats a lake surface as perfectly flat ground, so Helning
              // would otherwise paint Tyrifjorden as prime camping (measured
              // 0.011°). Satellite has no water fill — water is part of the
              // imagery — so there we fall back to sitting under the labels.
              function fillInsertId() {
                const layers = map.getStyle().layers
                const water = layers.find((l) => l.id === 'water-shadow')
                  || layers.find((l) => l.id === 'water')
                  || layers.find((l) => l.type === 'fill' && /^water/.test(l.id))
                return water?.id ?? layers.find((l) => l.type === 'symbol')?.id
              }

              function initTerrainLayers() {
                if (!map.getSource('mapbox-dem')) {
                  map.addSource('mapbox-dem', {
                    type: 'raster-dem',
                    url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
                    tileSize: 256,
                    maxzoom: 14,
                  })
                }
                // Re-apply terrain if 3D was active before the style swap
                if (terrain3DRef.current) {
                  map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.2 })
                }

                // Terrengtype overlay (NIBIO AR50, proxied). The WMS returns
                // nothing above 1:500 000, which is roughly zoom 10.
                if (!map.getSource('ar50-terrengtype')) {
                  map.addSource('ar50-terrengtype', {
                    type: 'raster',
                    tiles: [`/api/ar50-tile?v=${styleKey(TERRENGTYPE_BANDS)}&bbox={bbox-epsg-3857}`],
                    tileSize: 256,
                    minzoom: TERRENGTYPE_MIN_ZOOM,
                    maxzoom: 16,
                    attribution: 'Kilde: <a href="https://www.nibio.no/" target="_blank" rel="noopener">NIBIO</a>',
                  })
                }
                if (!map.getLayer('ar50-terrengtype')) {
                  map.addLayer({
                    id: 'ar50-terrengtype',
                    type: 'raster',
                    source: 'ar50-terrengtype',
                    minzoom: TERRENGTYPE_MIN_ZOOM,
                    paint: { 'raster-opacity': opacityRef.current.terrengtype },
                    layout: { visibility: terrengtypeRef.current ? 'visible' : 'none' },
                  }, fillInsertId())
                }

                // Helning (slope) from Kartverket. No minzoom — this one renders
                // all the way out to the whole country.
                if (!map.getSource('kv-helning')) {
                  map.addSource('kv-helning', {
                    type: 'raster',
                    tiles: [`/api/slope-tile?v=${styleKey(HELNING_BANDS)}&bbox={bbox-epsg-3857}`],
                    tileSize: 256,
                    minzoom: HELNING_MIN_ZOOM,
                    maxzoom: 16,
                    attribution: 'Kilde: <a href="https://www.kartverket.no/" target="_blank" rel="noopener">Kartverket</a>',
                  })
                }
                if (!map.getLayer('kv-helning')) {
                  map.addLayer({
                    id: 'kv-helning',
                    type: 'raster',
                    source: 'kv-helning',
                    minzoom: HELNING_MIN_ZOOM,
                    paint: { 'raster-opacity': opacityRef.current.helning },
                    layout: { visibility: helningRef.current ? 'visible' : 'none' },
                  }, fillInsertId())
                }

                // Verneområder. Vector polygons upstream, so unlike Helning this
                // stays meaningful at every zoom — no minzoom needed.
                if (!map.getSource('md-vern')) {
                  map.addSource('md-vern', {
                    type: 'raster',
                    tiles: [`/api/vern-tile?v=${styleKey(VERN_BANDS)}&bbox={bbox-epsg-3857}`],
                    tileSize: 256,
                    maxzoom: 16,
                    attribution: 'Kilde: <a href="https://www.miljodirektoratet.no/" target="_blank" rel="noopener">Miljødirektoratet</a>',
                  })
                }
                if (!map.getLayer('md-vern')) {
                  map.addLayer({
                    id: 'md-vern',
                    type: 'raster',
                    source: 'md-vern',
                    paint: { 'raster-opacity': opacityRef.current.vern },
                    layout: { visibility: vernRef.current ? 'visible' : 'none' },
                  }, fillInsertId())
                }

                // Kronedekning (SR16 crown coverage) — measured canopy density.
                if (!map.getSource('nibio-kronedekning')) {
                  map.addSource('nibio-kronedekning', {
                    type: 'raster',
                    tiles: ['/api/kronedekning-tile?bbox={bbox-epsg-3857}'],
                    tileSize: 256,
                    maxzoom: 16,
                    attribution: 'Kilde: <a href="https://www.nibio.no/" target="_blank" rel="noopener">NIBIO</a>',
                  })
                }
                if (!map.getLayer('nibio-kronedekning')) {
                  map.addLayer({
                    id: 'nibio-kronedekning',
                    type: 'raster',
                    source: 'nibio-kronedekning',
                    maxzoom: KRONEDEKNING_VECTOR_MIN_ZOOM,
                    paint: { 'raster-opacity': opacityRef.current.kronedekning },
                    layout: { visibility: kronedekningRef.current ? 'visible' : 'none' },
                  }, fillInsertId())
                }

                if (!map.getSource('nibio-kronedekning-v')) {
                  map.addSource('nibio-kronedekning-v', {
                    type: 'raster',
                    tiles: ['/api/kronedekning-tile?vector=1&bbox={bbox-epsg-3857}'],
                    tileSize: 256,
                    minzoom: KRONEDEKNING_VECTOR_MIN_ZOOM,
                    maxzoom: 16,
                    attribution: 'Kilde: <a href="https://www.nibio.no/" target="_blank" rel="noopener">NIBIO</a>',
                  })
                }
                if (!map.getLayer('nibio-kronedekning-v')) {
                  map.addLayer({
                    id: 'nibio-kronedekning-v',
                    type: 'raster',
                    source: 'nibio-kronedekning-v',
                    minzoom: KRONEDEKNING_VECTOR_MIN_ZOOM,
                    paint: { 'raster-opacity': opacityRef.current.kronedekning },
                    layout: { visibility: kronedekningRef.current ? 'visible' : 'none' },
                  }, fillInsertId())
                }


                // Turruter — lines, so it sits ABOVE the fills rather than under
                // them, otherwise a fill would wash the routes out.
                if (!map.getSource('kv-turruter')) {
                  map.addSource('kv-turruter', {
                    type: 'raster',
                    tiles: ['/api/turrute-tile?bbox={bbox-epsg-3857}'],
                    tileSize: 256,
                    minzoom: TURRUTER_MIN_ZOOM,
                    maxzoom: 16,
                    attribution: 'Kilde: <a href="https://www.kartverket.no/" target="_blank" rel="noopener">Kartverket</a>',
                  })
                }
                if (!map.getLayer('kv-turruter')) {
                  const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id
                  map.addLayer({
                    id: 'kv-turruter',
                    type: 'raster',
                    source: 'kv-turruter',
                    minzoom: TURRUTER_MIN_ZOOM,
                    paint: { 'raster-opacity': opacityRef.current.turruter },
                    layout: { visibility: turruterRef.current ? 'visible' : 'none' },
                  }, firstSymbol)
                }
              }

              initTerrainLayers()
              map.on('style.load', initTerrainLayers)

              function onVisibilityChange() {
                if (document.visibilityState === 'visible') map.resize()
              }
              document.addEventListener('visibilitychange', onVisibilityChange)
              map.once('remove', () => document.removeEventListener('visibilitychange', onVisibilityChange))
            }}
          >
            <AttributionControl compact={false} position="bottom-right" />

            {filteredSpots.map((spot) => (
              <SpotMarker key={spot.id} spot={spot} active={spot.id === activeId} onClick={handleMapMarkerClick} />
            ))}

            {ownPendingSpots.map((spot) => (
              <Marker key={`own-pending-${spot.id}`} longitude={spot.longitude} latitude={spot.latitude} anchor="center" onClick={e => { e.originalEvent.stopPropagation(); setActiveId(`pending:${spot.id}`); if (!isMobile) { setSidebarView('all'); setSidebarOpen(true) } }}>
                <span className={`spot-badge spot-badge--pending${activeId === `pending:${spot.id}` ? ' spot-badge--active' : ''}`} style={{ width: activeId === `pending:${spot.id}` ? 36 : 28, height: activeId === `pending:${spot.id}` ? 36 : 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: '#9a9a9a', border: '2px dashed #777', cursor: 'pointer', opacity: 0.9 }} dangerouslySetInnerHTML={{ __html: TENT_SVG }} />
              </Marker>
            ))}

            {adminPendingSpots.map((spot) => (
              <Marker key={`adminPending-${spot.id}`} longitude={spot.longitude} latitude={spot.latitude} anchor="center" onClick={e => { e.originalEvent.stopPropagation(); setActiveId(`adminPending:${spot.id}`); if (!isMobile) { setSidebarView('all'); setSidebarOpen(true) } }}>
                <span style={{ width: activeId === `adminPending:${spot.id}` ? 36 : 28, height: activeId === `adminPending:${spot.id}` ? 36 : 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: '#9a9a9a', border: '2px dashed #666', opacity: 0.85, cursor: 'pointer', transition: 'width 0.15s, height 0.15s' }} dangerouslySetInnerHTML={{ __html: TENT_SVG }} />
              </Marker>
            ))}

            {pendingPosition && (
              <Marker longitude={pendingPosition.lng} latitude={pendingPosition.lat} anchor="center">
                <span className="spot-badge" style={{ background: '#d98e04', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%' }} dangerouslySetInnerHTML={{ __html: TENT_SVG }} />
              </Marker>
            )}

            {/* Drawn before the dot so the dot sits on top of its own circle. */}
            {userPosition?.accuracy > 0 && (
              <Source
                id="gps-accuracy"
                type="geojson"
                data={circlePolygon(userPosition.lng, userPosition.lat, userPosition.accuracy)}
              >
                <Layer id="gps-accuracy-fill" type="fill" paint={{ 'fill-color': '#2E7DB8', 'fill-opacity': 0.12 }} />
                <Layer id="gps-accuracy-line" type="line" paint={{ 'line-color': '#2E7DB8', 'line-width': 1, 'line-opacity': 0.45 }} />
              </Source>
            )}

            {userPosition && (
              <Marker longitude={userPosition.lng} latitude={userPosition.lat} anchor="center">
                <span className="user-location-dot"><span className="user-location-dot-pulse" /><span className="user-location-dot-core" /></span>
              </Marker>
            )}

            {searchMarker && (
              <Marker longitude={searchMarker.lng} latitude={searchMarker.lat} anchor="center">
                <div className="search-marker-pin" />
              </Marker>
            )}

            {measurePoints.length > 0 && (
              <Source
                id="measure"
                type="geojson"
                data={{
                  type: 'FeatureCollection',
                  features: [
                    ...(measurePoints.length > 1 ? [{
                      type: 'Feature',
                      geometry: { type: 'LineString', coordinates: measurePoints.map((p) => [p.lng, p.lat]) },
                    }] : []),
                    ...measurePoints.map((p) => ({
                      type: 'Feature',
                      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
                    })),
                  ],
                }}
              >
                <Layer
                  id="measure-line-casing"
                  type="line"
                  filter={['==', '$type', 'LineString']}
                  paint={{ 'line-color': '#fff', 'line-width': 6, 'line-opacity': 0.9 }}
                  layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                />
                <Layer
                  id="measure-line"
                  type="line"
                  filter={['==', '$type', 'LineString']}
                  paint={{ 'line-color': '#d98e04', 'line-width': 3 }}
                  layout={{ 'line-cap': 'round', 'line-join': 'round' }}
                />
                <Layer
                  id="measure-points"
                  type="circle"
                  filter={['==', '$type', 'Point']}
                  paint={{ 'circle-radius': 5, 'circle-color': '#d98e04', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' }}
                />
              </Source>
            )}
          </Map>

          <div className="controls">
            <button className={`layer-toggle${terrain3D ? ' layer-toggle--active' : ''}`} onClick={toggle3D}>
              {terrain3D ? '🏔 3D på' : '🏔 3D'}
            </button>
            <button
              className={`layer-toggle${measuring ? ' layer-toggle--active' : ''}`}
              onClick={() => (measuring ? stopMeasuring() : (setMeasuring(true), setOpenMenu(null)))}
            >
              📏 Mål
            </button>
            <div className="ctrl-menu-wrap" ref={kartRef}>
              <button
                className="layer-toggle"
                onClick={() => setOpenMenu((m) => (m === 'kart' ? null : 'kart'))}
              >
                {BASEMAPS[basemapIndex].label}
              </button>
              {openMenu === 'kart' && (
                <div className="ctrl-menu">
                  <p className="ctrl-menu-group">Kart</p>
                  {BASEMAPS.map((b) => (
                    <button
                      key={b.key}
                      className={`ctrl-menu-item${b.key === basemap ? ' ctrl-menu-item--on' : ''}`}
                      onClick={() => { setBasemap(b.key); setOpenMenu(null) }}
                    >
                      <span className="ctrl-menu-check">{b.key === basemap ? '✓' : ''}</span>
                      <span className="ctrl-menu-item-text">
                        <strong>{b.label}</strong>
                        <span>{b.hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Under utvikling — kun synlig for admin */}
            {isAdmin && (() => {
              const active = [terrengtype, helning, vern, kronedekning, turruter].filter(Boolean).length
              const fills = [
                { on: terrengtype, toggle: toggleTerrengtype, icon: '🌲', label: 'Terrengtype', hint: 'Myr, bart fjell og åpen mark' },
                { on: helning, toggle: toggleHelning, icon: '📐', label: 'Helning', hint: 'Hvor flatt det er' },
                { on: vern, toggle: toggleVern, icon: '🛡', label: 'Vern', hint: 'Verneområder og regler' },
                { on: kronedekning, toggle: toggleKronedekning, icon: '🌳', label: 'Kronedekning', hint: 'Hvor tett trærne står' },
              ]
              return (
                <div className="ctrl-menu-wrap" ref={planleggRef}>
                  <button
                    className={`layer-toggle${active ? ' layer-toggle--active' : ''}`}
                    onClick={() => setOpenMenu((m) => (m === 'planlegg' ? null : 'planlegg'))}
                  >
                    🧭 Planlegg{active > 0 && <span className="ctrl-menu-count">{active}</span>}
                  </button>
                  {openMenu === 'planlegg' && (
                    <div className="ctrl-menu">
                      <p className="ctrl-menu-group">Terreng <span>· velg én</span></p>
                      {fills.map((f) => (
                        <button
                          key={f.label}
                          className={`ctrl-menu-item${f.on ? ' ctrl-menu-item--on' : ''}`}
                          onClick={f.toggle}
                        >
                          <span className="ctrl-menu-check">{f.on ? '✓' : ''}</span>
                          <span className="ctrl-menu-item-text">
                            <strong>{f.icon} {f.label}</strong>
                            <span>{f.hint}</span>
                          </span>
                        </button>
                      ))}
                      <p className="ctrl-menu-group">Ruter</p>
                      <button
                        className={`ctrl-menu-item${turruter ? ' ctrl-menu-item--on' : ''}`}
                        onClick={toggleTurruter}
                      >
                        <span className="ctrl-menu-check">{turruter ? '✓' : ''}</span>
                        <span className="ctrl-menu-item-text">
                          <strong>🥾 Turruter</strong>
                          <span>Merkede stier — kan vises sammen med terreng</span>
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              )
            })()}
            <button
              className={`submit-btn${dropMode ? ' submit-btn--active' : ''}`}
              onClick={() => { setDropMode((d) => !d); setPendingPosition(null); setCoordExpanded(false) }}
            >
              {dropMode ? '✕ Avbryt' : '＋ Legg til leirplass'}
            </button>
          </div>

          {/* Legends sit where the Planlegg menu opens, so they yield to it.
              The menu already shows which layers are on. */}
          {measuring && (
            <div className="measure-panel">
              {measurePoints.length < 2 ? (
                <p className="measure-hint">
                  {measurePoints.length === 0
                    ? 'Klikk i kartet for å måle avstand'
                    : 'Klikk et punkt til'}
                </p>
              ) : (
                <>
                  <div className="measure-readout">
                    <span className="measure-distance">{formatDistance(measureDistance)}</span>
                    <span className="measure-points-count">{measurePoints.length} punkter</span>
                  </div>
                  <div className="measure-elev">
                    {elevation === 'loading' && <span className="measure-elev-muted">Henter høyde…</span>}
                    {elevation === 'error' && <span className="measure-elev-muted">Ingen høydedata her</span>}
                    {elevation && typeof elevation === 'object' && (
                      <>
                        <span>↑ {elevation.gain} m</span>
                        <span>↓ {elevation.loss} m</span>
                        <span className="measure-elev-muted">{elevation.min}–{elevation.max} moh.</span>
                      </>
                    )}
                  </div>
                </>
              )}
              <div className="measure-actions">
                <button onClick={() => setMeasurePoints((p) => p.slice(0, -1))} disabled={!measurePoints.length}>
                  ↩ Angre
                </button>
                <button onClick={() => setMeasurePoints([])} disabled={!measurePoints.length}>
                  Nullstill
                </button>
                <button className="measure-close" onClick={stopMeasuring}>Ferdig</button>
              </div>
            </div>
          )}

          {/* One panel, a section per active layer. Turruter can be on alongside
              a fill, so the panel has to hold more than one section. */}
          {isAdmin && !openMenu && activeLegends.length > 0 && (
            <div className="terrengtype-legend">
              {activeLegends.map((l, i) => (
                <div key={l.key} className={i > 0 ? 'legend-section legend-section--divided' : 'legend-section'}>
                  <p className="legend-title">{l.title}</p>
                  {viewState.zoom < l.minZoom ? (
                    <p className="terrengtype-zoom-hint">Zoom inn for å vise {l.title.toLowerCase()}</p>
                  ) : (
                    <>
                      <div className="terrengtype-legend-rows">
                        {l.bands.map((b) => (
                          <div key={b.label} className="terrengtype-legend-row" title={b.hint}>
                            <span className="terrengtype-swatch" style={{ background: b.color }} />
                            <span className="terrengtype-legend-label">{b.label}</span>
                          </div>
                        ))}
                      </div>
                      <label className="legend-opacity">
                        <span className="legend-opacity-label">Gjennomsiktighet</span>
                        <input
                          type="range"
                          min="0" max="100" step="5"
                          value={Math.round(opacity[l.key] * 100)}
                          onChange={(e) => setLayerOpacity(l.key, Number(e.target.value) / 100)}
                        />
                        <span className="legend-opacity-value">{Math.round(opacity[l.key] * 100)}%</span>
                      </label>
                      <p className="terrengtype-disclaimer">{l.note}</p>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {terrain3D && (
            <div className="hint-3d">
              <span className="hint-3d-desktop">🖱 Høyreklikk + dra for å vippe og rotere</span>
              <span className="hint-3d-mobile">👆 To fingre for å vippe og rotere</span>
            </div>
          )}

          {!dropMode && !pendingPosition && (
            <div className="locate-wrap">
              {locateError && <p className="locate-error">{locateError}</p>}
              {userPosition?.accuracy > 0 && (
                <p
                  className="locate-accuracy"
                  title="Usikkerheten i posisjonen. Blir gjerne dårligere under tett skog."
                >
                  ±{Math.round(userPosition.accuracy)} m
                </p>
              )}
              <button className="locate-btn" onClick={handleLocate} disabled={locating} aria-label="Show my location">
                {locating ? '…' : '⌖'}
              </button>
            </div>
          )}

          {locationChecking && (
            <div className="drop-panel">
              <p className="drop-panel-hint">Sjekker plassering…</p>
            </div>
          )}

          {locationError && !locationChecking && (
            <div className="drop-panel">
              <p className="drop-panel-hint" style={{ color: '#a32d2d' }}>⚠ {locationError}</p>
              <p className="drop-panel-hint" style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>Klikk et annet sted i Norge.</p>
            </div>
          )}

          {dropMode && !pendingPosition && !locationChecking && !locationError && (
            <div className="drop-panel">
              <p className="drop-panel-hint">Klikk på kartet for å plassere leirplassen</p>
              <button type="button" className="coord-toggle" onClick={() => setCoordExpanded((e) => !e)}>
                <span>eller skriv inn koordinater</span>
                <span className={`coord-toggle-chevron${coordExpanded ? ' coord-toggle-chevron--open' : ''}`}>⌄</span>
              </button>
              {coordExpanded && (
                <form className="coord-form" onSubmit={handleCoordSubmit}>
                  <input type="text" placeholder="Breddegrad (f.eks. 61.234)" value={coordInput.lat} onChange={(e) => { setCoordInput((c) => ({ ...c, lat: e.target.value })); setCoordError('') }} />
                  <input type="text" placeholder="Lengdegrad (f.eks. 8.567)" value={coordInput.lng} onChange={(e) => { setCoordInput((c) => ({ ...c, lng: e.target.value })); setCoordError('') }} />
                  {coordError && <p className="coord-error">{coordError}</p>}
                  <button type="submit" className="primary">Plasser pin</button>
                </form>
              )}
            </div>
          )}

          {pendingPosition && (
            <div className="floating-form">
              <p className="hint">Pin ved {pendingPosition.lat.toFixed(3)}, {pendingPosition.lng.toFixed(3)}</p>
              <AddSpotForm
                position={pendingPosition}
                ownerToken={ownerToken}
                onCancel={handleCancel}
                onSaved={() => { setPendingPosition(null); loadSpots(); setSavedToast(true); setTimeout(() => setSavedToast(false), 5000) }}
              />
            </div>
          )}
        </div>

        {savedToast && <div className="saved-toast">✓ Leirplassen er sendt til godkjenning.</div>}

        {isMobile && (
          <div className="bottom-sheet" ref={sheetRef}>
            <div
              className="bottom-sheet-handle"
              onClick={() => setSheetState((s) => s === 'peek' ? 'open' : 'peek')}
              onTouchStart={onHandleTouchStart}
              onTouchMove={onHandleTouchMove}
              onTouchEnd={onHandleTouchEnd}
            />
            <div className="bottom-sheet-body">
              <SidebarContent
                editingCamp={editingCamp} activeSpot={activeSpot} activePendingSpot={activePendingSpot}
                activeAdminPendingSpot={activeAdminPendingSpot} ownerToken={ownerToken}
                filters={filters} hasFilters={hasFilters} allRegions={allRegions}
                filteredSpots={filteredSpots} loading={loading} spots={spots}
                onBack={handleBack} onEdit={setEditingCamp} onDelete={handleDelete}
                onSeeMore={(spot) => { handleSeeMore(spot); setSheetState('open') }}
                onFilterChange={setFilters} onToggleFilter={toggleFilter}
                loadSpots={loadSpots} onReport={handleReport} flaggedSpots={flaggedSpots}
                onAdminApprove={handleAdminApprove} onAdminDelete={handleAdminDelete}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
