import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { supabase } from '../supabaseClient'
import AddSpotForm from './AddSpotForm'

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

const ACCESS_LABELS = {
  'road': '🚗 Bilvei',
  'short-hike': '🥾 Kort tur',
  'day-hike': '⛰ Dagstur',
  'remote': '🏔 Avsidesliggende',
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
  return L.divIcon({ html, className: '', iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -16] })
}

function makeSpotIcon(name, type = 'tent') {
  const bg = SPOT_COLORS[type] ?? SPOT_COLORS.tent
  const svg = SPOT_ICONS[type] ?? TENT_SVG
  const html = `
    <span class="spot-marker">
      <span class="spot-badge" style="background:${bg}">${svg}</span>
      <span class="spot-marker-label">${escapeHtml(name)}</span>
    </span>`
  return L.divIcon({ html, className: '', iconAnchor: [14, 14], popupAnchor: [0, -16] })
}

function makeActiveSpotIcon(name, type = 'tent') {
  const bg = SPOT_COLORS[type] ?? SPOT_COLORS.tent
  const svg = SPOT_ICONS[type] ?? TENT_SVG
  const html = `
    <span class="spot-marker spot-marker--active">
      <span class="spot-badge spot-badge--active" style="background:${bg}">${svg}</span>
      <span class="spot-marker-label spot-marker-label--active">${escapeHtml(name)}</span>
    </span>`
  return L.divIcon({ html, className: '', iconAnchor: [18, 18], popupAnchor: [0, -20] })
}

const pendingIcon = makeBadgeIcon('tent', '#d98e04')

const userLocationIcon = L.divIcon({
  html: `<span class="user-location-dot"><span class="user-location-dot-pulse"></span><span class="user-location-dot-core"></span></span>`,
  className: '', iconSize: [20, 20], iconAnchor: [10, 10]
})

function ClickHandler({ dropMode, onMapClick }) {
  const map = useMap()
  useEffect(() => {
    map.getContainer().style.cursor = dropMode ? 'crosshair' : ''
  }, [dropMode, map])
  useMapEvents({ click(e) { if (dropMode) onMapClick(e.latlng) } })
  return null
}

function FlyToSpot({ target, pan }) {
  const map = useMap()
  useEffect(() => {
    if (!target) return
    if (pan) {
      map.panTo([target.latitude, target.longitude], { animate: true, duration: 0.4 })
    } else {
      const currentZoom = map.getZoom()
      map.flyTo([target.latitude, target.longitude], Math.max(currentZoom, 11), { duration: 0.8 })
    }
  }, [target, map, pan])
  return null
}

function FlyToUser({ target }) {
  const map = useMap()
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], 14, { duration: 0.8 })
  }, [target, map])
  return null
}

const LABEL_ZOOM_THRESHOLD = 11

function ZoomWatcher({ onZoomChange }) {
  const map = useMap()
  useEffect(() => { onZoomChange(map.getZoom()) }, [map, onZoomChange])
  useMapEvents({ zoomend() { onZoomChange(map.getZoom()) } })
  return null
}

function SpotBadges({ spot }) {
  return (
    <div className="badge-row">
      <span className={`access-badge access-badge--type-${spot.spot_type || 'tent'}`}>
        {spot.spot_type === 'hammock' ? '🪢 Hengekøye' : '⛺ Telt'}
      </span>
      {spot.access && (
        <span className={`access-badge access-badge--${spot.access}`}>{ACCESS_LABELS[spot.access]}</span>
      )}
      {spot.region && (
        <span className="access-badge access-badge--region">📍 {spot.region}</span>
      )}
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
              {photos.map((_, i) => (
                <span key={i} className={`lightbox-dot${i === index ? ' lightbox-dot--active' : ''}`} onClick={() => setIndex(i)} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}

function SpotDetail({ spot, onBack }) {
  const photos = spot.photo_urls?.length ? spot.photo_urls : spot.photo_url ? [spot.photo_url] : []
  const [lightboxIndex, setLightboxIndex] = useState(null)

  return (
    <div className="spot-detail">
      {lightboxIndex !== null && (
        <Lightbox photos={photos} startIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} />
      )}
      <button className="go-back-btn" onClick={onBack}>← Gå tilbake</button>
      <h2 className="spot-detail-name">{spot.name}</h2>
      <SpotBadges spot={spot} />
      {photos.length > 0 && (
        <div className="detail-photo-strip">
          {photos.map((url, i) => (
            <img key={i} src={url} alt={`${spot.name} ${i + 1}`} className="detail-photo" onClick={() => setLightboxIndex(i)} />
          ))}
        </div>
      )}
      {spot.description && <p className="spot-detail-desc">{spot.description}</p>}
      <p className="spot-detail-coords">
        {spot.latitude.toFixed(5)}, {spot.longitude.toFixed(5)}
      </p>
    </div>
  )
}

function SidebarContent({
  editingCamp, activeSpot, ownerToken, filters, hasFilters, allRegions,
  filteredSpots, loading, spots, onBack, onEdit, onDelete, onSeeMore,
  onFilterChange, onToggleFilter, loadSpots,
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
  if (activeSpot) {
    return (
      <>
        <SpotDetail spot={activeSpot} onBack={onBack} />
        {activeSpot.owner_token === ownerToken && (
          <div className="owner-actions">
            <button className="owner-btn owner-btn--edit" onClick={() => onEdit(activeSpot)}>✏️ Rediger</button>
            <button className="owner-btn owner-btn--delete" onClick={() => onDelete(activeSpot)}>🗑 Slett</button>
          </div>
        )}
      </>
    )
  }
  return (
    <>
      <div className="filter-panel">
        <div className="filter-panel-header">
          <span className="filter-panel-title">Filtre</span>
          {hasFilters && (
            <button className="filter-clear" onClick={() => onFilterChange({ types: [], access: [], regions: [] })}>
              Fjern alle
            </button>
          )}
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
        {filteredSpots.map((spot) => (
          <div key={spot.id} className="spot-card">
            <h3>{spot.name}</h3>
            <SpotBadges spot={spot} />
            <div className="spot-card-footer">
              <button className="see-more-btn" onClick={() => onSeeMore(spot)}>Se mer →</button>
              {spot.owner_token === ownerToken && (
                <div className="owner-actions owner-actions--inline">
                  <button className="owner-btn owner-btn--edit" onClick={() => { onEdit(spot) }}>✏️</button>
                  <button className="owner-btn owner-btn--delete" onClick={() => onDelete(spot)}>🗑</button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

export default function CampingMap() {
  const [spots, setSpots] = useState([])
  const [pendingPosition, setPendingPosition] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeId, setActiveId] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('spot') || null
  })
  const [flyTarget, setFlyTarget] = useState(null)
  const [panTarget, setPanTarget] = useState(null)
  const [layerKey, setLayerKey] = useState('outdoors')
  const [filters, setFilters] = useState({ types: [], access: [], regions: [] })
  const [dropMode, setDropMode] = useState(false)
  const [coordInput, setCoordInput] = useState({ lat: '', lng: '' })
  const [coordError, setCoordError] = useState('')
  const [coordExpanded, setCoordExpanded] = useState(false)
  const [userPosition, setUserPosition] = useState(null)
  const [locating, setLocating] = useState(false)
  const [locateError, setLocateError] = useState('')
  const [zoom, setZoom] = useState(5)
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 768)
  const [editingCamp, setEditingCamp] = useState(null)
  const [sheetState, setSheetState] = useState('peek') // 'peek' | 'open'
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  const sheetRef = useRef(null)
  const dragStartY = useRef(null)
  const dragStartTranslateY = useRef(0)

  useEffect(() => {
    function onResize() { setIsMobile(window.innerWidth < 768) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Animate sheet to new state (used for programmatic state changes)
  useEffect(() => {
    const el = sheetRef.current
    if (!el) return
    el.style.transition = 'transform 0.32s cubic-bezier(0.32, 0.72, 0, 1)'
    el.style.transform = sheetState === 'open' ? 'translateY(0)' : 'translateY(calc(100% - 72px))'
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
    if (delta < -40) {
      setSheetState('open')
      el.style.transform = 'translateY(0)'
    } else if (delta > 40) {
      setSheetState('peek')
      el.style.transform = 'translateY(calc(100% - 72px))'
    } else {
      el.style.transform = sheetState === 'open' ? 'translateY(0)' : 'translateY(calc(100% - 72px))'
    }
    dragStartY.current = null
  }
  const [ownerToken] = useState(() => {
    let token = localStorage.getItem('vilda_owner_token')
    if (!token) {
      token = crypto.randomUUID()
      localStorage.setItem('vilda_owner_token', token)
    }
    return token
  })
  const markerRefs = useRef({})

  async function loadSpots() {
    setLoading(true)
    const { data, error } = await supabase.from('spots').select('*').eq('status', 'approved')
    if (!error && data) {
      setSpots(data)
      const params = new URLSearchParams(window.location.search)
      const spotId = params.get('spot')
      if (spotId) {
        const spot = data.find((s) => String(s.id) === spotId)
        if (spot) setActiveId(spot.id)
      }
    }
    setLoading(false)
  }

  useEffect(() => { loadSpots() }, [])

  useEffect(() => {
    const url = new URL(window.location)
    if (activeId) url.searchParams.set('spot', activeId)
    else url.searchParams.delete('spot')
    window.history.replaceState({}, '', url)
  }, [activeId])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') { setDropMode(false); setPendingPosition(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const spotIcons = useMemo(() => {
    const icons = {}
    spots.forEach((s) => { icons[s.id] = makeSpotIcon(s.name, s.spot_type) })
    return icons
  }, [spots])

  const activeSpotIcons = useMemo(() => {
    const icons = {}
    spots.forEach((s) => { icons[s.id] = makeActiveSpotIcon(s.name, s.spot_type) })
    return icons
  }, [spots])

  const activeSpot = spots.find((s) => s.id === activeId) || null
  const layer = LAYERS[layerKey]
  const nextKey = layerKey === 'outdoors' ? 'satellite' : 'outdoors'

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
    setFilters((f) => {
      const arr = f[key]
      return { ...f, [key]: arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value] }
    })
  }

  const hasFilters = filters.types.length || filters.access.length || filters.regions.length

  function openSpot(spot, fly = false, pan = false) {
    setActiveId(spot.id)
    if (fly) setFlyTarget(spot)
    if (pan) setPanTarget(spot)
    if (!isMobile) {
      const marker = markerRefs.current[spot.id]
      if (marker) marker.openPopup()
    }
  }

  function handleMapMarkerClick(spot) {
    const mobile = window.innerWidth < 768
    openSpot(spot, false, mobile)
    if (mobile) setSheetState('open')
  }

  function handleSeeMore(spot) {
    openSpot(spot, true)
  }

  function handleBack() {
    setActiveId(null)
    setFlyTarget(null)
    setEditingCamp(null)
    if (isMobile) setSheetState('peek')
  }

  async function handleDelete(camp) {
    if (!window.confirm(`Slette "${camp.name}"? Dette kan ikke angres.`)) return
    await supabase.from('spots').delete().eq('id', camp.id).eq('owner_token', ownerToken)
    setActiveId(null)
    loadSpots()
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
    if (!navigator.geolocation) { setLocateError('Nettleseren din støtter ikke posisjon.'); return }
    setLocating(true)
    setLocateError('')
    navigator.geolocation.getCurrentPosition(
      (pos) => { setUserPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setLocating(false) },
      (err) => { setLocating(false); setLocateError(err.code === err.PERMISSION_DENIED ? 'Posisjonstilgang nektet.' : 'Kunne ikke hente posisjonen din.') },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  function handleCoordSubmit(e) {
    e.preventDefault()
    const lat = parseFloat(coordInput.lat)
    const lng = parseFloat(coordInput.lng)
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setCoordError('Skriv inn gyldige koordinater (bredde −90→90, lengde −180→180)')
      return
    }
    setPendingPosition({ lat, lng })
    setDropMode(false)
    setCoordInput({ lat: '', lng: '' })
    setCoordError('')
  }

  return (
    <div className="app-root">
      <header className="topnav">
        <svg className="topnav-logo" width="126" height="34" viewBox="0 0 210 56" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Vilda">
          <circle cx="34" cy="10" r="9" fill="#d98e04" />
          <polygon points="22,2  42,26   2,26" fill="#f4f1ea" />
          <polygon points="22,14 46,40  -2,40" fill="#f4f1ea" />
          <polygon points="22,26 48,54  -4,54" fill="#f4f1ea" />
          <text x="58" y="46" fontFamily="Georgia, 'Times New Roman', serif" fontSize="46" fontWeight="700" fill="#f4f1ea" letterSpacing="-1.5">Vilda</text>
        </svg>
      </header>

      <div className="main-area">
        {/* Sidebar collapse button — desktop only */}
        {!isMobile && (
          <button
            className={`sidebar-collapse-btn${sidebarOpen ? '' : ' sidebar-collapse-btn--collapsed'}`}
            style={{ left: sidebarOpen ? 300 : 0 }}
            onClick={() => setSidebarOpen((o) => !o)}
            aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            {sidebarOpen
              ? <svg width="10" height="16" viewBox="0 0 10 16" fill="none"><polyline points="8,2 2,8 8,14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              : <svg width="10" height="16" viewBox="0 0 10 16" fill="none"><polyline points="2,2 8,8 2,14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            }
          </button>
        )}

        {/* Left sidebar — desktop only */}
        {!isMobile && (
          <aside className={`left-sidebar${sidebarOpen ? '' : ' left-sidebar--collapsed'}`}>
            <div className="sidebar-inner">
            <SidebarContent
              editingCamp={editingCamp}
              activeSpot={activeSpot}
              ownerToken={ownerToken}
              filters={filters}
              hasFilters={hasFilters}
              allRegions={allRegions}
              filteredSpots={filteredSpots}
              loading={loading}
              spots={spots}
              onBack={handleBack}
              onEdit={setEditingCamp}
              onDelete={handleDelete}
              onSeeMore={handleSeeMore}
              onFilterChange={setFilters}
              onToggleFilter={toggleFilter}
              loadSpots={loadSpots}
            />
            </div>
          </aside>
        )}

        {/* Map */}
        <div className={`map-root${zoom >= LABEL_ZOOM_THRESHOLD ? ' labels-visible' : ''}`}>
          <MapContainer center={[62.0, 9.5]} zoom={5} id="map">
            <TileLayer key={layerKey} attribution={layer.attribution} url={layer.url} tileSize={512} zoomOffset={-1} />
            <ClickHandler dropMode={dropMode} onMapClick={handleMapClick} />
            <FlyToSpot target={flyTarget} pan={false} />
            <FlyToSpot target={panTarget} pan={true} />
            <ZoomWatcher onZoomChange={setZoom} />
            {spots.map((spot) => (
              <Marker
                key={spot.id}
                position={[spot.latitude, spot.longitude]}
                icon={isMobile && spot.id === activeId ? activeSpotIcons[spot.id] : spotIcons[spot.id]}
                ref={(ref) => { if (ref) markerRefs.current[spot.id] = ref }}
                eventHandlers={{ click: () => handleMapMarkerClick(spot) }}
              >
                {!isMobile && (
                  <Popup>
                    <h3>{spot.name}</h3>
                    <SpotBadges spot={spot} />
                  </Popup>
                )}
              </Marker>
            ))}
            {pendingPosition && <Marker position={pendingPosition} icon={pendingIcon} />}
            {userPosition && <Marker position={[userPosition.lat, userPosition.lng]} icon={userLocationIcon} />}
            <FlyToUser target={userPosition} />
          </MapContainer>

          {/* Top-right controls */}
          <div className="controls">
            <button className="layer-toggle" onClick={() => setLayerKey(nextKey)}>
              {LAYERS[nextKey].label === 'Satellite' ? '🛰' : '🗺'} {LAYERS[nextKey].label}
            </button>
            <button
              className={`submit-btn${dropMode ? ' submit-btn--active' : ''}`}
              onClick={() => { setDropMode((d) => !d); setPendingPosition(null); setCoordExpanded(false) }}
            >
              {dropMode ? '✕ Avbryt' : '＋ Legg til leirplass'}
            </button>
          </div>

          {/* Locate me */}
          {!dropMode && !pendingPosition && (
            <div className="locate-wrap">
              {locateError && <p className="locate-error">{locateError}</p>}
              <button className="locate-btn" onClick={handleLocate} disabled={locating} aria-label="Show my location">
                {locating ? '…' : '⌖'}
              </button>
            </div>
          )}

          {/* Drop mode panel */}
          {dropMode && !pendingPosition && (
            <div className="drop-panel">
              <p className="drop-panel-hint">Klikk på kartet for å plassere leirplassen</p>
              <button type="button" className="coord-toggle" onClick={() => setCoordExpanded((e) => !e)}>
                <span>eller skriv inn koordinater</span>
                <span className={`coord-toggle-chevron${coordExpanded ? ' coord-toggle-chevron--open' : ''}`}>⌄</span>
              </button>
              {coordExpanded && (
                <form className="coord-form" onSubmit={handleCoordSubmit}>
                  <input type="text" placeholder="Breddegrad (f.eks. 61.234)" value={coordInput.lat}
                    onChange={(e) => { setCoordInput((c) => ({ ...c, lat: e.target.value })); setCoordError('') }} />
                  <input type="text" placeholder="Lengdegrad (f.eks. 8.567)" value={coordInput.lng}
                    onChange={(e) => { setCoordInput((c) => ({ ...c, lng: e.target.value })); setCoordError('') }} />
                  {coordError && <p className="coord-error">{coordError}</p>}
                  <button type="submit" className="primary">Plasser pin</button>
                </form>
              )}
            </div>
          )}

          {/* Add spot form */}
          {pendingPosition && (
            <div className="floating-form">
              <p className="hint">Pin ved {pendingPosition.lat.toFixed(3)}, {pendingPosition.lng.toFixed(3)}</p>
              <AddSpotForm
                position={pendingPosition}
                ownerToken={ownerToken}
                onCancel={handleCancel}
                onSaved={() => { setPendingPosition(null); loadSpots() }}
              />
            </div>
          )}
        </div>

        {/* Mobile bottom sheet */}
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
                editingCamp={editingCamp}
                activeSpot={activeSpot}
                ownerToken={ownerToken}
                filters={filters}
                hasFilters={hasFilters}
                allRegions={allRegions}
                filteredSpots={filteredSpots}
                loading={loading}
                spots={spots}
                onBack={handleBack}
                onEdit={setEditingCamp}
                onDelete={handleDelete}
                onSeeMore={(spot) => { handleSeeMore(spot); setSheetState('open') }}
                onFilterChange={setFilters}
                onToggleFilter={toggleFilter}
                loadSpots={loadSpots}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
