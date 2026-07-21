import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MapContainer, TileLayer, Marker, GeoJSON, useMap, useMapEvents } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
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

function makeSpotIcon(type = 'tent') {
  const bg = SPOT_COLORS[type] ?? SPOT_COLORS.tent
  const svg = SPOT_ICONS[type] ?? TENT_SVG
  const html = `<span class="spot-badge" style="background:${bg}">${svg}</span>`
  return L.divIcon({ html, className: '', iconSize: [28, 28], iconAnchor: [14, 14] })
}

function makeActiveSpotIcon(type = 'tent') {
  const bg = SPOT_COLORS[type] ?? SPOT_COLORS.tent
  const svg = SPOT_ICONS[type] ?? TENT_SVG
  const html = `<span class="spot-badge spot-badge--active" style="background:${bg}">${svg}</span>`
  return L.divIcon({ html, className: '', iconSize: [36, 36], iconAnchor: [18, 18] })
}

function createClusterIcon(cluster) {
  const count = cluster.getChildCount()
  return L.divIcon({
    html: `<span class="cluster-badge">${count}</span>`,
    className: '',
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  })
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

function FlyToSpot({ target, pan, onDone }) {
  const map = useMap()
  useEffect(() => {
    if (!target) return
    if (pan) {
      map.panTo([target.latitude, target.longitude], { animate: true, duration: 0.4 })
    } else {
      const currentZoom = map.getZoom()
      map.flyTo([target.latitude, target.longitude], Math.max(currentZoom, 11), { duration: 0.8 })
    }
    onDone()
  }, [target])
  return null
}

function FlyToUser({ target }) {
  const map = useMap()
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], 14, { duration: 0.8 })
  }, [target, map])
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

function SpotDetail({ spot, onBack, onReport, alreadyReported }) {
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
      <button
        className={`report-btn${alreadyReported ? ' report-btn--done' : ''}`}
        onClick={() => !alreadyReported && onReport(spot)}
        disabled={alreadyReported}
      >
        {alreadyReported ? 'Rapportert' : 'Rapporter innhold'}
      </button>
    </div>
  )
}

function AboutModal({ onClose }) {
  const [contactStatus, setContactStatus] = useState('idle') // idle | sending | sent | error

  async function handleContactSubmit(e) {
    e.preventDefault()
    setContactStatus('sending')
    const form = e.target
    try {
      const res = await fetch('https://formspree.io/f/mykrpyjj', {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
        body: new FormData(form),
      })
      if (res.ok) { setContactStatus('sent'); form.reset() }
      else setContactStatus('error')
    } catch {
      setContactStatus('error')
    }
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
              <button type="submit" className="primary" disabled={contactStatus === 'sending'}>
                {contactStatus === 'sending' ? 'Sender…' : 'Send melding'}
              </button>
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
          <h2>Allemannsretten</h2>
          <p>I Norge har alle rett til å ferdes og overnatte i utmark, uansett hvem som eier landet. Du kan slå opp teltet der du vil, så lenge du holder minst 150 meter fra nærmeste bebodde hus eller hytte. Du kan oppholde deg inntil to netter på samme sted uten tillatelse fra grunneier. Er du på høyfjellet eller langt fra bebyggelse, kan du bli lenger.</p>
          <p style={{ marginTop: '0.65rem' }}><strong>Allemannsretten gjelder kun til fots eller på sykkel,</strong> ikke med motoriserte kjøretøy. Det er ulovlig å kjøre bil, motorsykkel eller bobil inn i utmark for å nå en leirplass. Kjøretøy skal stå på lovlig parkering ved vei.</p>
          <p style={{ marginTop: '0.65rem' }}>Allemannsretten gjelder heller ikke på innmark, dyrka mark, beite nær bebyggelse eller private hager. Sjekk alltid at plassen du camper på er i utmark.</p>
        </section>

        <section className="about-section">
          <h2>Legg ingen spor</h2>
          <p>Ta med deg alt søppel ut igjen, også det minste. Grav ned menneskelig avfall minst 60 meter fra vann og stier. Telt på stein eller gress der det er mulig, ikke på sårbar vegetasjon.</p>
          <p style={{ marginTop: '0.65rem' }}><strong>Bålforbudet gjelder fra 15. april til 15. september</strong> i og nær skog over hele landet. Utenfor denne perioden skal du alltid være forsiktig, bruke eksisterende ildsteder der det er mulig, og aldri bruke levende trær eller røtter som brensel.</p>
        </section>

        <section className="about-section">
          <h2>Sårbar natur</h2>
          <p>Mange av de vakreste plassene er vakre nettopp fordi de er ukjente. Gjentatte besøk, selv av folk med gode intensjoner, kan ødelegge vegetasjon, eksponere røtter og gjøre stier til gjørmehull. Hvis en plass ser uberørt ut, tenk deg om to ganger før du deler den videre.</p>
          <p style={{ marginTop: '0.65rem' }}>En god tommelfingerregel: neste person som kommer dit skal ikke se at du har vært der.</p>
        </section>

        <section className="about-section">
          <h2>Dyreliv og årstider</h2>
          <p>I hekke- og yngletiden (april–juli) er mange fugler og pattedyr svært sårbare for forstyrrelser. Hold avstand til reirplasser og unger. Hunder skal holdes i bånd fra 1. april til 20. august. Respekter beitedyr og hold deg unna områder der det er sau eller storfe.</p>
        </section>

        <section className="about-section">
          <h2>Den uskrevne regelen</h2>
          <p>Allemannsretten er et privilegium vi deler, ikke en rettighet vi kan ta for gitt. Jo bedre vi tar vare på naturen og respekterer grunneierne, jo lenger kan vi beholde denne friheten. Bruk naturen, men behandle den som om den tilhører alle, fordi det gjør den.</p>
        </section>

        <section className="about-section respekt-sources">
          <h2>Kilder</h2>
          <ul>
            <li><a href="https://www.miljodirektoratet.no/ansvarsomrader/friluftsliv/friluftsliv-og-allemannsretten/allemannsretten/" target="_blank" rel="noopener noreferrer">Allemannsretten, Miljødirektoratet</a></li>
            <li><a href="https://www.miljodirektoratet.no/ansvarsomrader/friluftsliv/friluftsliv-og-allemannsretten/telt-og-hengekoye/" target="_blank" rel="noopener noreferrer">Telt og hengekøye, Miljødirektoratet</a></li>
            <li><a href="https://www.miljodirektoratet.no/ansvarsomrader/friluftsliv/friluftsliv-og-allemannsretten/ga-tur/" target="_blank" rel="noopener noreferrer">Gå tur, Miljødirektoratet</a></li>
            <li><a href="https://lovdata.no/dokument/NL/lov/1957-06-28-16" target="_blank" rel="noopener noreferrer">Friluftsloven, Lovdata</a></li>
          </ul>
        </section>
      </div>
    </div>,
    document.body
  )
}

function AdminPanel({ onClose }) {
  const ADMIN_KEY = import.meta.env.VITE_ADMIN_KEY || 'vilda-admin'
  const [password, setPassword] = useState('')
  const [authed, setAuthed] = useState(false)
  const [spots, setSpots] = useState([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('all')
  const [stats, setStats] = useState(null)

  function handleLogin(e) {
    e.preventDefault()
    if (password === ADMIN_KEY) { setAuthed(true); fetchAll(); fetchStats() }
    else alert('Feil passord')
  }

  async function fetchAll() {
    setLoading(true)
    const { data } = await supabase.from('spots').select('*').order('created_at', { ascending: false })
    if (data) setSpots(data)
    setLoading(false)
  }

  async function fetchStats() {
    const { data } = await supabase.from('page_views').select('visited_at')
    if (!data) return
    const now = new Date()
    const todayStr = now.toISOString().slice(0, 10)
    const weekAgo = new Date(now - 7 * 864e5)
    const today = data.filter(v => v.visited_at.slice(0, 10) === todayStr).length
    const week = data.filter(v => new Date(v.visited_at) >= weekAgo).length
    // Build last 7 days breakdown
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now - i * 864e5)
      const key = d.toISOString().slice(0, 10)
      const label = d.toLocaleDateString('no', { weekday: 'short', day: 'numeric' })
      const count = data.filter(v => v.visited_at.slice(0, 10) === key).length
      return { label, count }
    }).reverse()
    setStats({ total: data.length, today, week, days })
  }

  async function handleDelete(id) {
    if (!window.confirm('Slette denne leirplassen?')) return
    await supabase.from('spots').delete().eq('id', id)
    setSpots((s) => s.filter((x) => x.id !== id))
  }

  async function handleClearFlags(id) {
    await supabase.from('spots').update({ flags: 0 }).eq('id', id)
    setSpots((s) => s.map((x) => x.id === id ? { ...x, flags: 0 } : x))
  }

  async function handleApprove(id) {
    await supabase.from('spots').update({ status: 'approved' }).eq('id', id)
    setSpots((s) => s.map((x) => x.id === id ? { ...x, status: 'approved' } : x))
  }

  const flagged = spots.filter((s) => s.flags >= 3)
  const pending = spots.filter((s) => s.status === 'pending')
  const displayed = filter === 'flagged' ? flagged : filter === 'pending' ? pending : spots

  if (!authed) return createPortal(
    <div className="admin-overlay">
      <div className="admin-login">
        <button className="about-close" onClick={onClose}>✕</button>
        <h2>Admin</h2>
        <form onSubmit={handleLogin}>
          <input type="password" placeholder="Passord" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          <button type="submit" className="primary">Logg inn</button>
        </form>
      </div>
    </div>,
    document.body
  )

  return createPortal(
    <div className="admin-overlay">
      <div className="admin-panel">
        <div className="admin-header">
          <div>
            <h2>Admin</h2>
            <span className="admin-subtitle">{spots.length} leirplasser totalt</span>
          </div>
          <div className="admin-header-right">
            <div className="admin-tabs">
              <button className={`admin-tab${filter === 'all' ? ' admin-tab--active' : ''}`} onClick={() => setFilter('all')}>Alle</button>
              <button className={`admin-tab${filter === 'pending' ? ' admin-tab--active' : ''}`} onClick={() => setFilter('pending')}>
                Til godkjenning {pending.length > 0 && <span className="admin-flag-badge admin-flag-badge--pending">{pending.length}</span>}
              </button>
              <button className={`admin-tab${filter === 'flagged' ? ' admin-tab--active' : ''}`} onClick={() => setFilter('flagged')}>
                Flagget {flagged.length > 0 && <span className="admin-flag-badge">{flagged.length}</span>}
              </button>
            </div>
            <button className="about-close" style={{ position: 'static' }} onClick={onClose}>✕</button>
          </div>
        </div>
        {stats && (
          <div className="admin-stats">
            <div className="admin-stat-cards">
              <div className="admin-stat-card">
                <span className="admin-stat-value">{stats.total}</span>
                <span className="admin-stat-label">Totalt</span>
              </div>
              <div className="admin-stat-card">
                <span className="admin-stat-value">{stats.week}</span>
                <span className="admin-stat-label">Siste 7 dager</span>
              </div>
              <div className="admin-stat-card">
                <span className="admin-stat-value">{stats.today}</span>
                <span className="admin-stat-label">I dag</span>
              </div>
            </div>
            <div className="admin-chart">
              {(() => {
                const max = Math.max(...stats.days.map(d => d.count), 1)
                return stats.days.map((d, i) => (
                  <div key={i} className="admin-chart-col">
                    <span className="admin-chart-count">{d.count || ''}</span>
                    <div className="admin-chart-bar-wrap">
                      <div className="admin-chart-bar" style={{ height: `${(d.count / max) * 100}%` }} />
                    </div>
                    <span className="admin-chart-label">{d.label}</span>
                  </div>
                ))
              })()}
            </div>
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
                  </span>
                </div>
                <div className="admin-spot-actions">
                  {spot.status === 'pending' && <button className="admin-btn admin-btn--approve" onClick={() => handleApprove(spot.id)}>Godkjenn</button>}
                  {spot.flags > 0 && <button className="admin-btn" onClick={() => handleClearFlags(spot.id)}>Fjern flagg</button>}
                  <button className="admin-btn admin-btn--delete" onClick={() => handleDelete(spot.id)}>Slett</button>
                </div>
              </div>
            ))}
            {displayed.length === 0 && <p style={{ padding: '1rem', color: '#999' }}>Ingen leirplasser her.</p>}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

function SidebarContent({
  editingCamp, activeSpot, ownerToken, filters, hasFilters, allRegions,
  filteredSpots, loading, spots, onBack, onEdit, onDelete, onSeeMore,
  onFilterChange, onToggleFilter, loadSpots, onReport, flaggedSpots,
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
        <SpotDetail
          spot={activeSpot}
          onBack={onBack}
          onReport={onReport}
          alreadyReported={flaggedSpots.includes(activeSpot.id)}
        />
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

const WORLD_RING = [[-180,-90],[180,-90],[180,90],[-180,90],[-180,-90]]

function NorwayMask() {
  const [maskData, setMaskData] = useState(null)
  useEffect(() => {
    fetch('https://raw.githubusercontent.com/johan/world.geo.json/master/countries/NOR.geo.json')
      .then(r => r.json())
      .then(data => {
        const geom = data.features[0].geometry
        const rings = geom.type === 'MultiPolygon'
          ? geom.coordinates.flatMap(poly => poly)
          : geom.coordinates
        setMaskData({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [WORLD_RING, ...rings] } })
      })
      .catch(() => {})
  }, [])
  if (!maskData) return null
  return <GeoJSON data={maskData} pathOptions={{ fillColor: '#000', fillOpacity: 0.35, stroke: false, fillRule: 'evenodd' }} />
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
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 768)
  const [editingCamp, setEditingCamp] = useState(null)
  const [sheetState, setSheetState] = useState('peek') // 'peek' | 'open'
  const [aboutOpen, setAboutOpen] = useState(false)
  const [savedToast, setSavedToast] = useState(false)
  const [respektOpen, setRespektOpen] = useState(false)
  const [showAdmin, setShowAdmin] = useState(() => new URLSearchParams(window.location.search).get('v') === 'hvk0209X')
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

  // Animate sheet to new state (used for programmatic state changes)
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
    if (delta < -40) {
      setSheetState('open')
      el.style.transform = 'translateY(0)'
    } else if (delta > 40) {
      setSheetState('peek')
      el.style.transform = 'translateY(calc(100% - 28px))'
    } else {
      el.style.transform = sheetState === 'open' ? 'translateY(0)' : 'translateY(calc(100% - 28px))'
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
    const { data, error } = await supabase.from('spots').select('*').eq('status', 'approved').lt('flags', 3)
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
    if (sessionStorage.getItem('vilda_tracked')) return
    sessionStorage.setItem('vilda_tracked', '1')
    supabase.from('page_views').insert({ screen_width: window.innerWidth })
  }, [])

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
    spots.forEach((s) => { icons[s.id] = makeSpotIcon(s.spot_type) })
    return icons
  }, [spots])

  const activeSpotIcons = useMemo(() => {
    const icons = {}
    spots.forEach((s) => { icons[s.id] = makeActiveSpotIcon(s.spot_type) })
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

  async function handleReport(spot) {
    const updated = [...flaggedSpots, spot.id]
    localStorage.setItem('vilda_flagged', JSON.stringify(updated))
    const { data: current } = await supabase.from('spots').select('flags').eq('id', spot.id).single()
    await supabase.from('spots').update({ flags: (current?.flags || 0) + 1 }).eq('id', spot.id)
    setActiveId(null)
    loadSpots()
  }

  async function handleDelete(camp) {
    if (!window.confirm(`Slette "${camp.name}"? Dette kan ikke angres.`)) return
    await supabase.from('spots').delete().eq('id', camp.id).eq('owner_token', ownerToken)
    setActiveId(null)
    loadSpots()
  }

  function handleMapClick(latlng) {
    const { lat, lng } = latlng
    if (lat < 57 || lat > 71.5 || lng < 4 || lng > 31.5) return
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
        <button className="about-btn" onClick={() => setAboutOpen(true)}>Om</button>
        <button className="respekt-btn" onClick={() => setRespektOpen(true)}>
          <span className="respekt-btn__full">Respekt for naturen</span>
          <span className="respekt-btn__short">Respekt</span>
        </button>
      </header>

      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
      {respektOpen && <RespektModal onClose={() => setRespektOpen(false)} />}
      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}

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
              onReport={handleReport}
              flaggedSpots={flaggedSpots}
            />
            </div>
          </aside>
        )}

        {/* Map */}
        <div className="map-root">
          <MapContainer center={[62.0, 9.5]} zoom={5} id="map">
            <TileLayer key={layerKey} attribution={layer.attribution} url={layer.url} tileSize={512} zoomOffset={-1} />
            <ClickHandler dropMode={dropMode} onMapClick={handleMapClick} />
            <FlyToSpot target={flyTarget} pan={false} onDone={() => setFlyTarget(null)} />
            <FlyToSpot target={panTarget} pan={true} onDone={() => setPanTarget(null)} />
            <NorwayMask />
            <MarkerClusterGroup iconCreateFunction={createClusterIcon} chunkedLoading disableClusteringAtZoom={10} maxClusterRadius={60}>
              {spots.map((spot) => (
                <Marker
                  key={spot.id}
                  position={[spot.latitude, spot.longitude]}
                  icon={spot.id === activeId ? activeSpotIcons[spot.id] : spotIcons[spot.id]}
                  ref={(ref) => { if (ref) markerRefs.current[spot.id] = ref }}
                  eventHandlers={{ click: () => handleMapMarkerClick(spot) }}
                />
              ))}
            </MarkerClusterGroup>
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
                onSaved={() => { setPendingPosition(null); loadSpots(); setSavedToast(true); setTimeout(() => setSavedToast(false), 5000) }}
              />
            </div>
          )}
        </div>

        {savedToast && (
          <div className="saved-toast">
            ✓ Leirplassen er sendt til godkjenning.
          </div>
        )}

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
                onReport={handleReport}
                flaggedSpots={flaggedSpots}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
