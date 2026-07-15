import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { supabase } from '../supabaseClient'
import AddSpotForm from './AddSpotForm'

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

const ACCESS_LABELS = {
  'road': '🚗 Road access',
  'short-hike': '🥾 Short hike',
  'day-hike': '⛰ Day hike',
  'remote': '🏔 Remote',
}

const LAYERS = {
  outdoors: {
    label: 'Outdoors',
    url: `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/tiles/{z}/{x}/{y}{r}?access_token=${TOKEN}`,
    attribution: '&copy; <a href="https://www.mapbox.com/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  },
  satellite: {
    label: 'Satellite',
    url: `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/{z}/{x}/{y}{r}?access_token=${TOKEN}`,
    attribution: '&copy; <a href="https://www.mapbox.com/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

const TENT_SVG = `
  <svg width="17" height="17" viewBox="0 0 24 19" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M10 0L14 3M14 0L10 3" stroke="#fff" stroke-width="1.5" stroke-linecap="round" />
    <path fill-rule="evenodd" clip-rule="evenodd" d="M12 2.2L22.4 17.8H1.6L12 2.2ZM12 10.6L16.5 17.8H7.4L12 10.6Z" fill="#fff" />
    <rect x="0" y="17.8" width="24" height="1" fill="#fff" />
  </svg>`

const HAMMOCK_SVG = `
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <line x1="4" y1="3" x2="4" y2="21" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>
    <line x1="20" y1="3" x2="20" y2="21" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M4 9 Q12 18 20 9" stroke="#fff" stroke-width="2" fill="#fff" fill-opacity="0.25" stroke-linecap="round"/>
    <line x1="4" y1="7.5" x2="8" y2="9.5" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>
    <line x1="20" y1="7.5" x2="16" y2="9.5" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`

const SPOT_ICONS = { tent: TENT_SVG, hammock: HAMMOCK_SVG }
const SPOT_COLORS = { tent: '#1b4332', hammock: '#5c4a1e' }

function makeBadgeIcon(type = 'tent', color) {
  const bg = color ?? SPOT_COLORS[type] ?? SPOT_COLORS.tent
  const svg = SPOT_ICONS[type] ?? TENT_SVG
  const html = `<span class="spot-badge" style="background:${bg}">${svg}</span>`
  return L.divIcon({
    html,
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16]
  })
}

function makeSpotIcon(name, type = 'tent') {
  const bg = SPOT_COLORS[type] ?? SPOT_COLORS.tent
  const svg = SPOT_ICONS[type] ?? TENT_SVG
  const html = `
    <span class="spot-marker">
      <span class="spot-badge" style="background:${bg}">${svg}</span>
      <span class="spot-marker-label">${escapeHtml(name)}</span>
    </span>`
  return L.divIcon({
    html,
    className: '',
    iconAnchor: [14, 14],
    popupAnchor: [0, -16]
  })
}

const pendingIcon = makeBadgeIcon('tent', '#d98e04')

const userLocationIcon = L.divIcon({
  html: `
    <span class="user-location-dot">
      <span class="user-location-dot-pulse"></span>
      <span class="user-location-dot-core"></span>
    </span>`,
  className: '',
  iconSize: [20, 20],
  iconAnchor: [10, 10]
})

function ClickHandler({ dropMode, onMapClick }) {
  const map = useMap()

  useEffect(() => {
    const container = map.getContainer()
    container.style.cursor = dropMode ? 'crosshair' : ''
  }, [dropMode, map])

  useMapEvents({
    click(e) {
      if (dropMode) onMapClick(e.latlng)
    }
  })
  return null
}

function FlyToSpot({ target }) {
  const map = useMap()
  useEffect(() => {
    if (target) {
      const currentZoom = map.getZoom()
      map.flyTo([target.latitude, target.longitude], Math.max(currentZoom, 11), { duration: 0.8 })
    }
  }, [target, map])
  return null
}

function FlyToUser({ target }) {
  const map = useMap()
  useEffect(() => {
    if (target) {
      map.flyTo([target.lat, target.lng], 14, { duration: 0.8 })
    }
  }, [target, map])
  return null
}

const LABEL_ZOOM_THRESHOLD = 11

function ZoomWatcher({ onZoomChange }) {
  const map = useMap()
  useEffect(() => {
    onZoomChange(map.getZoom())
  }, [map, onZoomChange])
  useMapEvents({
    zoomend() {
      onZoomChange(map.getZoom())
    }
  })
  return null
}

export default function CampingMap() {
  const [spots, setSpots] = useState([])
  const [pendingPosition, setPendingPosition] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeId, setActiveId] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('spot') || null
  })
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [layerKey, setLayerKey] = useState('outdoors')
  const [dropMode, setDropMode] = useState(false)
  const [coordInput, setCoordInput] = useState({ lat: '', lng: '' })
  const [coordError, setCoordError] = useState('')
  const [coordExpanded, setCoordExpanded] = useState(false)
  const [userPosition, setUserPosition] = useState(null)
  const [locating, setLocating] = useState(false)
  const [locateError, setLocateError] = useState('')
  const [zoom, setZoom] = useState(5)
  const markerRefs = useRef({})

  async function loadSpots() {
    setLoading(true)
    const { data, error } = await supabase
      .from('spots')
      .select('*')
      .eq('status', 'approved')
    if (!error && data) {
      setSpots(data)
      // If URL had ?spot=id, open that spot once data arrives
      const params = new URLSearchParams(window.location.search)
      const spotId = params.get('spot')
      if (spotId) {
        const spot = data.find((s) => String(s.id) === spotId)
        if (spot) {
          setActiveId(spot.id)
          setSidebarOpen(true)
        }
      }
    }
    setLoading(false)
  }

  useEffect(() => {
    loadSpots()
  }, [])

  // Sync activeId → URL
  useEffect(() => {
    const url = new URL(window.location)
    if (activeId) {
      url.searchParams.set('spot', activeId)
    } else {
      url.searchParams.delete('spot')
    }
    window.history.replaceState({}, '', url)
  }, [activeId])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        setDropMode(false)
        setPendingPosition(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const spotIcons = useMemo(() => {
    const icons = {}
    spots.forEach((spot) => { icons[spot.id] = makeSpotIcon(spot.name, spot.spot_type) })
    return icons
  }, [spots])

  const activeSpot = spots.find((s) => s.id === activeId) || null
  const [flyTarget, setFlyTarget] = useState(null)
  const layer = LAYERS[layerKey]
  const nextKey = layerKey === 'outdoors' ? 'satellite' : 'outdoors'

  function handleCardClick(spot) {
    setActiveId(spot.id)
    setFlyTarget(spot)
    const marker = markerRefs.current[spot.id]
    if (marker) marker.openPopup()
  }

  function handleMapClick(latlng) {
    setPendingPosition(latlng)
    setDropMode(false)
  }

  function handleCancel() {
    setPendingPosition(null)
    setDropMode(false)
    setCoordInput({ lat: '', lng: '' })
    setCoordError('')
    setCoordExpanded(false)
  }

  function handleLocate() {
    if (!navigator.geolocation) {
      setLocateError("Your browser doesn't support location.")
      return
    }
    setLocating(true)
    setLocateError('')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setLocating(false)
      },
      (err) => {
        setLocating(false)
        setLocateError(err.code === err.PERMISSION_DENIED
          ? 'Location permission denied.'
          : 'Could not get your location.')
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  function handleCoordSubmit(e) {
    e.preventDefault()
    const lat = parseFloat(coordInput.lat)
    const lng = parseFloat(coordInput.lng)
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setCoordError('Enter valid coordinates (lat −90→90, lng −180→180)')
      return
    }
    setPendingPosition({ lat, lng })
    setDropMode(false)
    setCoordInput({ lat: '', lng: '' })
    setCoordError('')
  }

  return (
    <div className="app-root">
      {/* Top navigation bar */}
      <header className="topnav">
        <svg className="topnav-logo" width="126" height="34" viewBox="0 0 210 56" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Vilda">
          <circle cx="34" cy="10" r="9" fill="#d98e04" />
          <polygon points="22,2  42,26   2,26" fill="#f4f1ea" />
          <polygon points="22,14 46,40  -2,40" fill="#f4f1ea" />
          <polygon points="22,26 48,54  -4,54" fill="#f4f1ea" />
          <text x="58" y="46" fontFamily="Georgia, 'Times New Roman', serif" fontSize="46" fontWeight="700" fill="#f4f1ea" letterSpacing="-1.5">Vilda</text>
        </svg>
      </header>

      <div className={`map-root${zoom >= LABEL_ZOOM_THRESHOLD ? ' labels-visible' : ''}`}>
      <MapContainer center={[62.0, 9.5]} zoom={5} id="map">
        <TileLayer key={layerKey} attribution={layer.attribution} url={layer.url} tileSize={512} zoomOffset={-1} detectRetina={true} />
        <ClickHandler dropMode={dropMode} onMapClick={handleMapClick} />
        <FlyToSpot target={flyTarget} />
        <ZoomWatcher onZoomChange={setZoom} />
        {spots.map((spot) => (
          <Marker
            key={spot.id}
            position={[spot.latitude, spot.longitude]}
            icon={spotIcons[spot.id] || markerIcon}
            ref={(ref) => { if (ref) markerRefs.current[spot.id] = ref }}
            eventHandlers={{ click: () => setActiveId(spot.id) }}
          >
            <Popup>
              <h3>{spot.name}</h3>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.2rem' }}>
                <span className={`access-badge access-badge--type-${spot.spot_type || 'tent'}`}>
                  {spot.spot_type === 'hammock' ? '🪢 Hammock spot' : '⛺ Tent spot'}
                </span>
                {spot.access && <span className={`access-badge access-badge--${spot.access}`}>{ACCESS_LABELS[spot.access]}</span>}
              </div>
              {(() => {
                const photos = spot.photo_urls?.length ? spot.photo_urls : spot.photo_url ? [spot.photo_url] : []
                return photos.length > 0 && (
                  <div className="popup-photo-strip">
                    {photos.map((url, i) => (
                      <img key={i} src={url} alt={`${spot.name} ${i + 1}`} className="popup-photo" />
                    ))}
                  </div>
                )
              })()}
              <div style={{ fontSize: '0.85rem', color: '#555', marginTop: '0.3rem' }}>{spot.description}</div>
            </Popup>
          </Marker>
        ))}
        {pendingPosition && (
          <Marker position={pendingPosition} icon={pendingIcon} />
        )}
        {userPosition && (
          <Marker position={[userPosition.lat, userPosition.lng]} icon={userLocationIcon} />
        )}
        <FlyToUser target={userPosition} />
      </MapContainer>

      {/* Top-right controls */}
      <div className="controls">
        <button
          className="sidebar-toggle"
          onClick={() => setSidebarOpen((o) => !o)}
        >
          <span className="sidebar-toggle-icon">{sidebarOpen ? '✕' : '☰'}</span>
          <span>{sidebarOpen ? 'Close' : `${spots.length} spots`}</span>
        </button>
        <button
          className="layer-toggle"
          onClick={() => setLayerKey(nextKey)}
        >
          {LAYERS[nextKey].label === 'Satellite' ? '🛰' : '🗺'} {LAYERS[nextKey].label}
        </button>
        <button
          className={`submit-btn${dropMode ? ' submit-btn--active' : ''}`}
          onClick={() => { setDropMode((d) => !d); setPendingPosition(null); setCoordExpanded(false) }}
        >
          {dropMode ? '✕ Cancel' : '＋ Submit a spot'}
        </button>
      </div>

      {/* Floating sidebar */}
      <aside className={`sidebar${sidebarOpen ? ' sidebar--open' : ''}`}>
        <div className="sidebar-header">
          <h2>{spots.length} spot{spots.length === 1 ? '' : 's'}</h2>
        </div>
        <div className="sidebar-body">
          {loading && <p className="empty-state">Loading spots…</p>}
          {!loading && spots.length === 0 && (
            <p className="empty-state">No approved spots yet.</p>
          )}
          {spots.map((spot) => (
            <div
              key={spot.id}
              className={`spot-card${activeId === spot.id ? ' active' : ''}`}
              onClick={() => handleCardClick(spot)}
            >
              <h3>{spot.name}</h3>
              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginBottom: '0.3rem' }}>
                <span className={`access-badge access-badge--type-${spot.spot_type || 'tent'}`}>
                  {spot.spot_type === 'hammock' ? '🪢 Hammock' : '⛺ Tent'}
                </span>
                {spot.access && <span className={`access-badge access-badge--${spot.access}`}>{ACCESS_LABELS[spot.access]}</span>}
              </div>
              <p>{spot.description}</p>
            </div>
          ))}
        </div>
      </aside>

      {/* Locate me */}
      {!dropMode && !pendingPosition && (
        <div className="locate-wrap">
          {locateError && <p className="locate-error">{locateError}</p>}
          <button
            className="locate-btn"
            onClick={handleLocate}
            disabled={locating}
            aria-label="Show my location"
            title="Show my location"
          >
            {locating ? '…' : '⌖'}
          </button>
        </div>
      )}

      {/* Drop mode panel */}
      {dropMode && !pendingPosition && (
        <div className="drop-panel">
          <p className="drop-panel-hint">Click the map to submit a spot</p>
          <button
            type="button"
            className="coord-toggle"
            onClick={() => setCoordExpanded((e) => !e)}
            aria-expanded={coordExpanded}
          >
            <span>or enter coordinates</span>
            <span className={`coord-toggle-chevron${coordExpanded ? ' coord-toggle-chevron--open' : ''}`}>⌄</span>
          </button>
          {coordExpanded && (
            <form className="coord-form" onSubmit={handleCoordSubmit}>
              <input
                type="text"
                placeholder="Latitude (e.g. 61.234)"
                value={coordInput.lat}
                onChange={(e) => { setCoordInput((c) => ({ ...c, lat: e.target.value })); setCoordError('') }}
              />
              <input
                type="text"
                placeholder="Longitude (e.g. 8.567)"
                value={coordInput.lng}
                onChange={(e) => { setCoordInput((c) => ({ ...c, lng: e.target.value })); setCoordError('') }}
              />
              {coordError && <p className="coord-error">{coordError}</p>}
              <button type="submit" className="primary">Place pin</button>
            </form>
          )}
        </div>
      )}

      {/* Add spot form */}
      {pendingPosition && (
        <div className="floating-form">
          <p className="hint">
            Pin at {pendingPosition.lat.toFixed(3)}, {pendingPosition.lng.toFixed(3)}
          </p>
          <AddSpotForm
            position={pendingPosition}
            onCancel={handleCancel}
            onSaved={() => { setPendingPosition(null); loadSpots() }}
          />
        </div>
      )}
      </div>
    </div>
  )
}
