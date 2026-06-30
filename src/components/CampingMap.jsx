import { useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { supabase } from '../supabaseClient'
import AddSpotForm from './AddSpotForm'

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

const LAYERS = {
  outdoors: {
    label: 'Outdoors',
    url: `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/tiles/{z}/{x}/{y}?access_token=${TOKEN}`,
    attribution: '&copy; <a href="https://www.mapbox.com/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  },
  satellite: {
    label: 'Satellite',
    url: `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/{z}/{x}/{y}?access_token=${TOKEN}`,
    attribution: '&copy; <a href="https://www.mapbox.com/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }
}

function makePinIcon(color = '#1b4332', dotColor = '#fff') {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
      <path d="M14 0C6.27 0 0 6.27 0 14c0 9.25 12.18 21.12 13.16 22.06a1.18 1.18 0 0 0 1.68 0C15.82 35.12 28 23.25 28 14 28 6.27 21.73 0 14 0z"
        fill="${color}" />
      <circle cx="14" cy="14" r="5" fill="${dotColor}" opacity="0.9" />
    </svg>`
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [28, 36],
    iconAnchor: [14, 36],
    popupAnchor: [0, -38]
  })
}

const markerIcon = makePinIcon()
const pendingIcon = makePinIcon('#d98e04')

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
      map.flyTo([target.latitude, target.longitude], 11, { duration: 0.8 })
    }
  }, [target, map])
  return null
}

export default function CampingMap() {
  const [spots, setSpots] = useState([])
  const [pendingPosition, setPendingPosition] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeId, setActiveId] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [layerKey, setLayerKey] = useState('outdoors')
  const [dropMode, setDropMode] = useState(false)
  const [coordInput, setCoordInput] = useState({ lat: '', lng: '' })
  const [coordError, setCoordError] = useState('')
  const markerRefs = useRef({})

  async function loadSpots() {
    setLoading(true)
    const { data, error } = await supabase
      .from('spots')
      .select('*')
      .eq('status', 'approved')
    if (!error && data) setSpots(data)
    setLoading(false)
  }

  useEffect(() => {
    loadSpots()
  }, [])

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

  const activeSpot = spots.find((s) => s.id === activeId) || null
  const layer = LAYERS[layerKey]
  const nextKey = layerKey === 'outdoors' ? 'satellite' : 'outdoors'

  function handleCardClick(spot) {
    setActiveId(spot.id)
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
    <div className="map-root">
      <MapContainer center={[62.0, 9.5]} zoom={5} id="map">
        <TileLayer key={layerKey} attribution={layer.attribution} url={layer.url} tileSize={512} zoomOffset={-1} />
        <ClickHandler dropMode={dropMode} onMapClick={handleMapClick} />
        <FlyToSpot target={activeSpot} />
        {spots.map((spot) => (
          <Marker
            key={spot.id}
            position={[spot.latitude, spot.longitude]}
            icon={markerIcon}
            ref={(ref) => { if (ref) markerRefs.current[spot.id] = ref }}
            eventHandlers={{ click: () => setActiveId(spot.id) }}
          >
            <Popup>
              <h3>{spot.name}</h3>
              {spot.photo_url && (
                <img src={spot.photo_url} alt={spot.name} className="popup-photo" />
              )}
              <div style={{ fontSize: '0.85rem', color: '#555' }}>{spot.description}</div>
            </Popup>
          </Marker>
        ))}
        {pendingPosition && (
          <Marker position={pendingPosition} icon={pendingIcon} />
        )}
      </MapContainer>

      {/* Floating wordmark */}
      <div className="wordmark">
        <span className="wordmark-eyebrow">Norway</span>
        <span className="wordmark-title">Wild Camping</span>
      </div>

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
          onClick={() => { setDropMode((d) => !d); setPendingPosition(null) }}
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
              <p>{spot.description}</p>
            </div>
          ))}
        </div>
      </aside>

      {/* Drop mode panel */}
      {dropMode && !pendingPosition && (
        <div className="drop-panel">
          <p className="drop-panel-hint">Click the map to place your spot</p>
          <div className="drop-panel-divider"><span>or enter coordinates</span></div>
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
  )
}
